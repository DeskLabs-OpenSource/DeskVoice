/**
 * Motor Gemini Live (Google), por WebSocket.
 *
 * Documentação oficial consultada em 2026-11-10 (ai.google.dev redireciona para aistudio.google.com):
 *   - https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket  (URL, setup, realtimeInput, toolCall/toolResponse)
 *   - https://ai.google.dev/api/live  (mensagens: setup, setupComplete, serverContent, usageMetadata)
 *   - https://ai.google.dev/api/generate-content  (speechConfig, FunctionDeclaration, FunctionResponse, Blob)
 *   - https://ai.google.dev/gemini-api/docs/live-api/capabilities  (áudio 16 kHz na entrada, 24 kHz na saída, interrupção, transcrição)
 *   - https://ai.google.dev/gemini-api/docs/live-api/tools  (chamada de função bloqueante)
 *   - https://ai.google.dev/gemini-api/docs/speech-generation  (lista de vozes)
 *   - https://ai.google.dev/gemini-api/docs/pricing  (preços)
 *
 * Teste da chave (`checkKey`), consultado em 2026-11-12 (ai.google.dev redireciona para aistudio.google.com):
 *   - https://ai.google.dev/api/models  (`GET /v1beta/models/{model}`: lê os dados do modelo, não gera nada)
 *   - https://ai.google.dev/gemini-api/docs/api-key  (a chave vai no cabeçalho `x-goog-api-key`)
 *   - https://ai.google.dev/gemini-api/docs/api-errors  (401 chave inválida, 402 crédito pré-pago esgotado,
 *     403 sem permissão ou chave bloqueada, 404 modelo inexistente, 429 limite, 5xx do lado do Google)
 *   A página de modelos não diz se ler um modelo é cobrado; nenhuma página de preço lista essa chamada.
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - o código de uma chave inválida na API de modelos: a página de erros diz 401, e a forma antiga
 *     da API respondia 400 com `API_KEY_INVALID`; as duas são tratadas como chave recusada;
 *   - se a leitura do modelo confere crédito (402) ou só a chave: a resposta "aceita" não promete crédito;
 *   - `responseModalities`/`speechConfig` vão dentro de `setup.generationConfig`, como na referência da
 *     API; o exemplo do guia de WebSocket mostra `responseModalities` direto em `setup`;
 *   - `inputAudioTranscription.languageCodes` (está na referência; os guias só mostram `{}`);
 *   - se `usageMetadata` é por turno ou acumulado na sessão. Aqui é tratado como incremento.
 */
import { z } from "zod";
import { SessionEmitter } from "../emitter";
import { awaitSessionReady, openProviderSocket } from "../provider-socket";
import { resample } from "../resample";
import { checkKeyOverHttp } from "../key-check";
import type { VoiceEngine, VoiceSession } from "../types";

const DEFAULT_BASE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const DEFAULT_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-live";
const DEFAULT_VOICE = "Sulafat";
const BRIDGE_HZ = 8000;
const INPUT_HZ = 16000;
const DEFAULT_OUTPUT_HZ = 24000;

const transcription = z.object({ text: z.string().optional() });
const serverMessage = z.object({
  setupComplete: z.object({}).optional(),
  serverContent: z
    .object({
      modelTurn: z
        .object({
          parts: z.array(
            z.object({ inlineData: z.object({ data: z.string(), mimeType: z.string().optional() }).optional() }),
          ),
        })
        .optional(),
      turnComplete: z.boolean().optional(),
      interrupted: z.boolean().optional(),
      inputTranscription: transcription.optional(),
      outputTranscription: transcription.optional(),
    })
    .optional(),
  toolCall: z
    .object({ functionCalls: z.array(z.object({ id: z.string().optional(), name: z.string(), args: z.unknown() })) })
    .optional(),
  usageMetadata: z
    .object({ promptTokenCount: z.number().optional(), responseTokenCount: z.number().optional() })
    .optional(),
});

// O modelo lido: o recurso devolve o próprio nome. A forma antiga da API recusava a chave com 400 e
// o motivo `API_KEY_INVALID` nos detalhes.
const modelResource = z.object({ name: z.string().startsWith("models/") });
const errorDetails = z.object({ error: z.object({ details: z.array(z.unknown()) }) });
const invalidKeyDetail = z.object({ reason: z.literal("API_KEY_INVALID") });
const saysInvalidKey = (body: unknown): boolean =>
  errorDetails.safeParse(body).data?.error.details.some((detail) => invalidKeyDetail.safeParse(detail).success) ?? false;

function literalSpeech(text: string, language: string): string {
  return `Say exactly the following to the caller, in ${language}, without adding anything: "${text}"`;
}

const engine: VoiceEngine = {
  id: "gemini-live",
  label: "Gemini Live (Google)",
  pricing: {
    // US$ 3,00 e US$ 12,00 por milhão de tokens de áudio (entrada e saída) do gemini-3.8-live.
    // O prompt de texto custa menos (US$ 0,75); cobrar tudo como áudio superestima um pouco, nunca subestima.
    centsPerMillionInputTokens: 300,
    centsPerMillionOutputTokens: 1200,
    checkedOn: "2026-11-10",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
  },

  async connect(config, apiKey, options = {}) {
    const emitter = new SessionEmitter();
    const toolNames = new Map<string, string>();
    let anonymousCalls = 0;
    let userText = "";
    let agentText = "";

    let setupDone: () => void = () => undefined;
    let setupFailed: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      setupDone = resolve;
      setupFailed = reject;
    });

    const flush = (speaker: "user" | "agent"): void => {
      const text = (speaker === "user" ? userText : agentText).trim();
      if (speaker === "user") userText = "";
      else agentText = "";
      if (text) emitter.emit("transcript", { speaker, text });
    };

    const onMessage = (raw: unknown): void => {
      const parsed = serverMessage.safeParse(raw);
      if (!parsed.success) return;
      const { setupComplete, serverContent, toolCall, usageMetadata } = parsed.data;
      if (setupComplete) setupDone();

      if (serverContent) {
        // A transcrição chega em fragmentos; o contrato entrega a fala inteira de cada turno.
        if (serverContent.inputTranscription?.text) userText += serverContent.inputTranscription.text;
        if (serverContent.modelTurn || serverContent.outputTranscription) flush("user");
        if (serverContent.outputTranscription?.text) agentText += serverContent.outputTranscription.text;
        for (const part of serverContent.modelTurn?.parts ?? []) {
          if (!part.inlineData) continue;
          const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? DEFAULT_OUTPUT_HZ);
          // ponytail: reamostra cada pedaço isolado; a emenda entre pedaços perde uma fração de amostra.
          // Se aparecer estalo na fala, trocar por um reamostrador com estado entre pedaços.
          emitter.emit("audio", resample(Buffer.from(part.inlineData.data, "base64"), rate, BRIDGE_HZ));
        }
        if (serverContent.interrupted) emitter.emit("interrupted");
        if (serverContent.turnComplete || serverContent.interrupted) {
          flush("user");
          flush("agent");
        }
      }

      if (toolCall) {
        flush("user");
        for (const call of toolCall.functionCalls) {
          const id = call.id ?? `gemini-call-${++anonymousCalls}`;
          toolNames.set(id, call.name);
          emitter.emit("toolCall", { id, name: call.name, args: call.args ?? {} });
        }
      }

      if (usageMetadata) {
        emitter.emit("usage", {
          inputTokens: usageMetadata.promptTokenCount ?? 0,
          outputTokens: usageMetadata.responseTokenCount ?? 0,
        });
      }
    };

    const socket = await openProviderSocket({
      url: `${options.baseUrl ?? DEFAULT_BASE_URL}?key=${encodeURIComponent(apiKey)}`,
      label: "Gemini Live",
      emitter,
      onMessage,
      onClosed: () => setupFailed(new Error("Gemini Live: a conexão fechou antes de confirmar a sessão (chave ou modelo inválido?)")),
      timeout: options,
    });

    socket.send({
      setup: {
        model: `models/${options.model ?? DEFAULT_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceId ?? DEFAULT_VOICE } } },
        },
        // Os modelos de áudio nativo não aceitam código de idioma para a fala; a documentação manda
        // restringir o idioma pela instrução de sistema.
        systemInstruction: { parts: [{ text: `${config.instructions}\n\nSpeak only in ${config.language}.` }] },
        ...(config.tools.length > 0 && {
          tools: [
            {
              functionDeclarations: config.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.parameters,
              })),
            },
          ],
        }),
        inputAudioTranscription: { languageCodes: [config.language] },
        outputAudioTranscription: {},
      },
    });
    await awaitSessionReady(ready, socket, { label: "Gemini Live", emitter, timeout: options });

    const session: VoiceSession = {
      on: (event, handler) => emitter.on(event, handler),
      sendAudio(pcm16_8k) {
        socket.send({
          realtimeInput: {
            audio: { data: resample(pcm16_8k, BRIDGE_HZ, INPUT_HZ).toString("base64"), mimeType: `audio/pcm;rate=${INPUT_HZ}` },
          },
        });
      },
      sendToolResult(id, result) {
        const name = toolNames.get(id);
        if (!name) {
          emitter.emit("error", new Error(`Gemini Live: resultado para uma chamada de ferramenta desconhecida: ${id}`));
          return;
        }
        toolNames.delete(id);
        // A chamada é bloqueante: o modelo retoma a fala sozinho ao receber a resposta.
        socket.send({ toolResponse: { functionResponses: [{ id, name, response: { result } }] } });
      },
      say(text) {
        socket.send({ realtimeInput: { text: literalSpeech(text, config.language) } });
      },
      close: () => socket.close(),
    };

    if (config.greeting) session.say(config.greeting);
    return session;
  },

  checkKey(apiKey, options = {}) {
    const model = options.model ?? DEFAULT_MODEL;
    return checkKeyOverHttp(
      {
        url: `${options.baseUrl ?? DEFAULT_API_URL}/models/${encodeURIComponent(model)}`,
        // No cabeçalho, e não na URL como no WebSocket: endereço de pedido costuma ir para log de proxy.
        headers: { "x-goog-api-key": apiKey },
        model,
        accepted: modelResource,
        classify: (status, body) => (status === 400 && saysInvalidKey(body) ? "rejected" : undefined),
      },
      options,
    );
  },
};

export default engine;
