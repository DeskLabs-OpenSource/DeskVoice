/**
 * Motor OpenAI Realtime, por WebSocket.
 *
 * Documentação oficial consultada em 2026-11-10:
 *   - https://developers.openai.com/api/docs/api-reference/realtime  (URL, autenticação, session.update, formatos de áudio, vozes, eventos do cliente)
 *   - https://developers.openai.com/api/reference/resources/realtime/server-events  (eventos do servidor e seus campos)
 *   - https://developers.openai.com/api/docs/guides/realtime-conversations  (áudio, chamada de função, interrupção)
 *   - https://developers.openai.com/api/docs/pricing  (preços)
 *
 * Teste da chave (`checkKey`), consultado em 2026-11-12:
 *   - https://developers.openai.com/api/reference/resources/models/methods/retrieve  (`GET /v1/models/{model}`,
 *     `Authorization: Bearer`; devolve `id`, `object: "model"`, `created`, `owned_by`. Só lê, não gera nada)
 *   - https://developers.openai.com/api/docs/guides/error-codes  (401 chave inválida ou revogada, 403 país não
 *     atendido, 429 que é limite de pedidos OU falta de crédito/teto de gasto, pelo `error.code`, 5xx do lado deles).
 *     O 403 de país não atendido não é defeito da chave: trocar a chave não resolve, então tem resultado próprio.
 *   A página do modelo não cita preço; nenhuma página de preço lista essa chamada.
 *
 * A API aceita G.711 μ-law (`audio/pcmu`, 8 kHz) na entrada e na saída: a ligação não é reamostrada.
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - a taxa do `audio/pcmu` não aparece escrita na referência; G.711 é 8 kHz por definição;
 *   - `gpt-4o-mini-transcribe` como modelo de transcrição da fala de quem ligou (está na lista aceita);
 *   - que a leitura do modelo responda 404 a uma chave sem acesso a ele (a página de erros não lista 404);
 *   - se a leitura do modelo chega a conferir crédito: a resposta "aceita" não promete crédito.
 */
import { z } from "zod";
import { SessionEmitter } from "../emitter";
import { awaitSessionReady, openProviderSocket } from "../provider-socket";
import { pcm16ToUlaw, ulawToPcm16 } from "../resample";
import { checkKeyOverHttp } from "../key-check";
import { classifyOutcomeOverHttp } from "../outcome-over-http";
import { OUTCOME_GUESS_SCHEMA, outcomePrompt, readOutcomeGuess } from "../outcome";
import type { ClassifyOptions, KeyCheckResult, Usage, VoiceEngine, VoiceSession } from "../types";

const DEFAULT_BASE_URL = "wss://api.openai.com/v1/realtime";
const DEFAULT_API_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-realtime-2.1";
const DEFAULT_VOICE = "marin";
// Modelo de texto que classifica o desfecho: barato e com saída estruturada (conferido em
// 2026-11-13). O `gpt-5-mini` já tem desligamento marcado, então o padrão é o nano — e o operador
// pode trocar pelo modelo que quiser em `engine.openai.classify_model`.
const OUTCOME_MODEL = "gpt-5-nano";
// Vozes do Realtime, conferidas em 2026-11-12 (developers.openai.com, guia de conversas Realtime).
// A documentação recomenda marin e cedar pela qualidade; ela não descreve o estilo de cada uma.
const VOICES = [
  { id: "marin", recommended: true },
  { id: "cedar", recommended: true },
  { id: "alloy" },
  { id: "ash" },
  { id: "ballad" },
  { id: "coral" },
  { id: "echo" },
  { id: "sage" },
  { id: "shimmer" },
  { id: "verse" },
] as const;
const AUDIO_FORMAT = { type: "audio/pcmu" };

const responseDoneUsage = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    input_token_details: z
      .object({
        text_tokens: z.number().optional(),
        audio_tokens: z.number().optional(),
        cached_tokens: z.number().optional(),
        cached_tokens_details: z.object({ text_tokens: z.number().optional(), audio_tokens: z.number().optional() }).nullish(),
      })
      .nullish(),
    output_token_details: z.object({ text_tokens: z.number().optional(), audio_tokens: z.number().optional() }).nullish(),
  })
  .nullish();

const serverEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.updated") }),
  z.object({ type: z.literal("response.created") }),
  z.object({ type: z.literal("response.output_audio.delta"), delta: z.string() }),
  z.object({ type: z.literal("response.output_audio_transcript.done"), transcript: z.string() }),
  z.object({ type: z.literal("conversation.item.input_audio_transcription.completed"), transcript: z.string() }),
  z.object({
    type: z.literal("response.function_call_arguments.done"),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
  z.object({ type: z.literal("input_audio_buffer.speech_started") }),
  z.object({
    type: z.literal("response.done"),
    response: z.object({
      usage: responseDoneUsage,
    }),
  }),
  z.object({ type: z.literal("error"), error: z.object({ message: z.string() }) }),
]);

const modelResource = z.object({ id: z.string(), object: z.literal("model") });
// 429 nem sempre é "espere": estes códigos (e o tipo `insufficient_quota`) dizem que falta crédito ou
// que um teto de gasto foi atingido, e repetir não resolve.
const BILLING_CODES = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "insufficient_quota",
]);
const providerError = z.object({ error: z.object({ code: z.string().nullish(), type: z.string().nullish() }) });
const isBillingError = (body: unknown): boolean => {
  const error = providerError.safeParse(body).data?.error;
  return BILLING_CODES.has(error?.code ?? "") || BILLING_CODES.has(error?.type ?? "");
};
const isRegionError = (body: unknown): boolean => providerError.safeParse(body).data?.error.code === "unsupported_country_region_territory";
const classifyError = (status: number, body: unknown): KeyCheckResult | undefined => {
  if (status === 429 && isBillingError(body)) return "no_credit";
  if (status === 403 && isRegionError(body)) return "region_unavailable";
  return undefined;
};

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    // Devolve o texto cru: a validação da ferramenta recusa e o modelo recebe o erro para corrigir.
    return json;
  }
}

type RealtimeUsage = NonNullable<z.infer<typeof responseDoneUsage>>;

/**
 * O uso de uma resposta, separado como a OpenAI cobra. Sem o detalhe (formato antigo), tudo vai no
 * preço cheio de áudio: superestima, nunca subestima.
 */
export function usageOf(usage: RealtimeUsage): Usage {
  const input = usage.input_token_details;
  const output = usage.output_token_details;
  if (!input || !output) return { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 };
  const cachedText = input.cached_tokens_details?.text_tokens ?? 0;
  const cachedAudio = input.cached_tokens_details?.audio_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (input.audio_tokens ?? 0) - cachedAudio),
    textInputTokens: Math.max(0, (input.text_tokens ?? 0) - cachedText),
    cachedInputTokens: input.cached_tokens ?? cachedText + cachedAudio,
    outputTokens: output.audio_tokens ?? 0,
    textOutputTokens: output.text_tokens ?? 0,
  };
}

const engine: VoiceEngine = {
  id: "openai-realtime",
  label: "OpenAI Realtime",
  provider: "openai",
  // A OpenAI documenta data residency por projeto/região (Estados Unidos, Europa, Reino Unido,
  // Japão, entre outros) — não um país fixo por provedor. Como a instalação usa a API padrão, sem
  // projeto regional escolhido pelo operador, o lugar de processamento depende da conta dele.
  // Fonte: developers.openai.com/api/docs/guides/your-data (consultado em 12/11/2026).
  processingLocation: { kind: "undeclared" },
  voices: VOICES,
  defaultVoice: DEFAULT_VOICE,
  pricing: {
    // gpt-realtime-2.1, por milhão de tokens: áudio US$ 32 (entrada) e US$ 64 (saída); texto US$ 4
    // e US$ 24; entrada em cache US$ 0,40. Cada resposta reconta a conversa inteira como entrada, e
    // quase toda ela vem do cache: cobrar tudo como áudio novo dava seis vezes o valor da fatura.
    centsPerMillionInputTokens: 3200,
    centsPerMillionOutputTokens: 6400,
    centsPerMillionTextInputTokens: 400,
    centsPerMillionCachedInputTokens: 40,
    centsPerMillionTextOutputTokens: 2400,
    checkedOn: "2026-11-12",
    source: "https://developers.openai.com/api/docs/pricing",
  },

  async connect(config, apiKey, options = {}) {
    const emitter = new SessionEmitter();
    let configured = false;
    let responseActive = false;
    const queuedResponses: object[] = [];

    let sessionReady: () => void = () => undefined;
    let sessionFailed: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      sessionReady = resolve;
      sessionFailed = reject;
    });

    // A API recusa um `response.create` enquanto outra resposta está em curso; o pedido espera a vez.
    const requestResponse = (response: object): void => {
      if (responseActive) {
        queuedResponses.push(response);
        return;
      }
      responseActive = true;
      socket.send({ type: "response.create", response });
    };

    const onMessage = (raw: unknown): void => {
      const parsed = serverEvent.safeParse(raw);
      if (!parsed.success) return;
      const event = parsed.data;
      switch (event.type) {
        case "session.updated":
          configured = true;
          sessionReady();
          break;
        case "response.created":
          responseActive = true;
          break;
        case "response.output_audio.delta":
          emitter.emit("audio", ulawToPcm16(Buffer.from(event.delta, "base64")));
          break;
        case "response.output_audio_transcript.done":
          if (event.transcript) emitter.emit("transcript", { speaker: "agent", text: event.transcript });
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (event.transcript.trim()) emitter.emit("transcript", { speaker: "user", text: event.transcript.trim() });
          break;
        case "response.function_call_arguments.done":
          emitter.emit("toolCall", { id: event.call_id, name: event.name, args: parseArguments(event.arguments) });
          break;
        case "input_audio_buffer.speech_started":
          // Emitido mesmo sem resposta em curso: o modelo gera mais rápido que o tempo real, então a
          // ponte pode ainda estar tocando uma fala que, para a API, já terminou.
          // ponytail: não envia `conversation.item.truncate` (exige saber quantos ms a ponte já tocou);
          // o modelo fica achando que disse a fala inteira. Acrescentar se isso atrapalhar a conversa.
          emitter.emit("interrupted");
          break;
        case "response.done": {
          responseActive = false;
          const usage = event.response.usage;
          if (usage) emitter.emit("usage", usageOf(usage));
          const next = queuedResponses.shift();
          if (next) requestResponse(next);
          break;
        }
        case "error": {
          const error = new Error(`OpenAI Realtime: ${event.error.message}`);
          // Sem isto, um `response.create` recusado deixaria a fila de falas presa para sempre.
          responseActive = false;
          if (configured) emitter.emit("error", error);
          else sessionFailed(error);
          break;
        }
      }
    };

    const socket = await openProviderSocket({
      url: `${options.baseUrl ?? DEFAULT_BASE_URL}?model=${encodeURIComponent(options.model ?? DEFAULT_MODEL)}`,
      headers: { Authorization: `Bearer ${apiKey}` },
      label: "OpenAI Realtime",
      emitter,
      onMessage,
      onClosed: () => sessionFailed(new Error("OpenAI Realtime: a conexão fechou antes de confirmar a sessão")),
      timeout: options,
    });

    socket.send({
      type: "session.update",
      session: {
        type: "realtime",
        // O idioma só existe como parâmetro na transcrição; a fala segue a instrução.
        instructions: `${config.instructions}\n\nSpeak only in ${config.language}.`,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: AUDIO_FORMAT,
            transcription: { model: "gpt-4o-mini-transcribe", language: config.language.split("-")[0] },
            turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
          },
          output: { format: AUDIO_FORMAT, voice: config.voiceId ?? DEFAULT_VOICE },
        },
        tools: config.tools.map((tool) => ({ type: "function", ...tool })),
      },
    });
    await awaitSessionReady(ready, socket, { label: "OpenAI Realtime", emitter, timeout: options });

    const session: VoiceSession = {
      on: (event, handler) => emitter.on(event, handler),
      sendAudio(pcm16_8k) {
        socket.send({ type: "input_audio_buffer.append", audio: pcm16ToUlaw(pcm16_8k).toString("base64") });
      },
      sendToolResult(id, result) {
        socket.send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: id, output: JSON.stringify(result ?? null) },
        });
        requestResponse({});
      },
      say(text) {
        requestResponse({
          instructions: `Say exactly the following to the caller, in ${config.language}, without adding anything: "${text}"`,
        });
      },
      close: () => socket.close(),
    };

    if (config.greeting) session.say(config.greeting);
    return session;
  },

  async classifyOutcome(apiKey, input, options: ClassifyOptions = {}) {
    const model = options.model ?? OUTCOME_MODEL;
    return classifyOutcomeOverHttp(
      {
        url: `${options.baseUrl ?? DEFAULT_API_URL}/chat/completions`,
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: outcomePrompt(input) }],
          response_format: { type: "json_schema", json_schema: { name: "desfecho", strict: true, schema: OUTCOME_GUESS_SCHEMA } },
        }),
        read: (body) => {
          const content = (body as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
          if (typeof content !== "string") return null;
          try {
            return readOutcomeGuess(JSON.parse(content));
          } catch {
            return null;
          }
        },
      },
      options,
    );
  },

  checkKey(apiKey, options = {}) {
    const model = options.model ?? DEFAULT_MODEL;
    return checkKeyOverHttp(
      {
        url: `${options.baseUrl ?? DEFAULT_API_URL}/models/${encodeURIComponent(model)}`,
        headers: { Authorization: `Bearer ${apiKey}` },
        model,
        accepted: modelResource,
        classify: classifyError,
      },
      options,
    );
  },
};

export default engine;
