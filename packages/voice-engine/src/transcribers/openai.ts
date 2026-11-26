/**
 * Transcrição em streaming da OpenAI (`gpt-4o-mini-transcribe`), por WebSocket: a peça provisória do
 * pipeline (fatia 6, parte 1; DESA-398, decisão 2, opção B). É o mesmo modelo que transcreve a fala de
 * quem ligou no OpenAI Realtime, numa sessão só de transcrição, até a medida da R12 escolher o vencedor.
 *
 * **A chave é a do motor OpenAI Realtime** que a organização já tem (`engine.openai-realtime.api_key`,
 * em `keySetting`): não há chave nova para gravar. O áudio de quem ligou vai para a OpenAI, e por isso
 * a peça só abre com a confirmação da seção 9.1 (`transcriber.openai.consent`), como a voz da 1b.
 *
 * Documentação oficial consultada em 2026-11-26:
 *   - https://developers.openai.com/api/docs/guides/realtime-transcription  (a URL
 *     `wss://api.openai.com/v1/realtime?intent=transcription`, sem `model` na URL; `session.update` com
 *     `session.type: "transcription"`; os eventos `conversation.item.input_audio_transcription.delta` e
 *     `.completed`)
 *   - https://developers.openai.com/api/reference/resources/realtime/client-events  (`audio.input.format`
 *     aceita `audio/pcmu`, G.711 μ-law; `transcription.model` aceita `gpt-4o-mini-transcribe`;
 *     `transcription.language` em ISO-639-1; `transcription.prompt` em texto livre para a família
 *     `gpt-4o-transcribe`; `turn_detection` `server_vad`, com `silence_duration_ms` padrão 500)
 *   - https://developers.openai.com/api/reference/resources/realtime/server-events  (`session.updated`;
 *     `input_audio_buffer.speech_started.audio_start_ms`, `.speech_stopped.audio_end_ms`, `.committed.item_id`;
 *     `.completed` com `transcript` e `usage` em tokens, `{ input_tokens, output_tokens }`, ou em duração,
 *     `{ seconds }`; `.failed` com `error`; `error` com `code`, `type` e `message`)
 *   - https://developers.openai.com/api/docs/pricing  (o preço de `TRANSCRIBE_PRICING`, o mesmo do motor)
 *
 * **Como os trechos saem.** A detecção de fala do servidor (`server_vad`) fecha cada vez de quem ligou
 * num item. O texto do item chega por `delta` (o parcial, acumulado) e por `completed` (o final). Os
 * itens saem na ordem em que foram fechados: o parcial do segundo espera o final do primeiro, porque o
 * pipeline conta um trecho de cada vez. `startMs` é o `audio_start_ms` do item. `endMs` é o
 * `audio_end_ms` menos o silêncio que o servidor esperou (`SILENCE_MS`), porque a referência diz que o
 * `audio_end_ms` inclui esse silêncio. `failed` é `error` não fatal, e o item sai como final vazio.
 *
 * **O custo.** Cada `completed` emite o consumo dele: em tokens, quando o servidor os declara; em
 * segundos, quando declara duração; e, sem `usage`, os segundos de fala do item, pelo preço por minuto.
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - que o servidor mande `delta` antes do `completed` neste modelo, e quanto o final chega depois do
 *     fim da fala (é o p95 da régua da R12, 700 ms; **não medido**);
 *   - que `session.updated` seja a confirmação da sessão de transcrição (a página de guia não a nomeia);
 *   - que a sessão de transcrição aceite `audio/pcmu` a 8 kHz: o guia só mostra `audio/pcm` a 24 kHz, e a
 *     referência aceita os três formatos;
 *   - o efeito do `prompt` (o vocabulário) no `gpt-4o-mini-transcribe`, e o limite de tamanho dele.
 */
import WebSocket from "ws";
import { z } from "zod";
import { byStatus, checkKeyOverHttp } from "../key-check";
import { pcm16ToUlaw } from "../resample";
import {
  EngineTimeoutError,
  TranscriberOpenError,
  type EnginePricing,
  type KeyCheckResult,
  type StreamingTranscriber,
  type StreamingTranscription,
  type StreamingTranscriptionEvents,
  type TranscriptPiece,
  type Usage,
} from "../types";

const DEFAULT_BASE_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const DEFAULT_API_URL = "https://api.openai.com/v1";
const MODEL = "gpt-4o-mini-transcribe";
const READY_TIMEOUT_MS = 10_000;
/** O silêncio que o servidor espera para fechar a vez (o padrão da referência, dito aqui por extenso). */
const SILENCE_MS = 500;
/** A chave da organização que esta peça usa: a do motor OpenAI Realtime. */
const KEY_SETTING = "engine.openai-realtime.api_key";

// gpt-4o-mini-transcribe, na seção "Transcription" da página de preços (conferida em 2026-11-13 para o
// motor OpenAI Realtime, a mesma linha): entrada US$ 1,25 e saída US$ 5,00 por milhão de tokens, e a
// estimativa de US$ 0,003 por minuto. A linha não separa áudio de texto na entrada.
const PRICING: EnginePricing = {
  centsPerMillionInputTokens: 125,
  centsPerMillionOutputTokens: 500,
  centsPerMinute: 0.3,
  checkedOn: "2026-11-13",
  source: "https://developers.openai.com/api/docs/pricing",
};

const usageSchema = z.union([
  z.object({ type: z.literal("tokens"), input_tokens: z.number(), output_tokens: z.number() }),
  z.object({ type: z.literal("duration"), seconds: z.number() }),
]);

const serverEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.updated") }),
  z.object({ type: z.literal("input_audio_buffer.speech_started"), audio_start_ms: z.number() }),
  z.object({ type: z.literal("input_audio_buffer.speech_stopped"), audio_end_ms: z.number() }),
  z.object({ type: z.literal("input_audio_buffer.committed"), item_id: z.string() }),
  z.object({ type: z.literal("conversation.item.input_audio_transcription.delta"), item_id: z.string(), delta: z.string().optional() }),
  z.object({ type: z.literal("conversation.item.input_audio_transcription.completed"), item_id: z.string(), transcript: z.string(), usage: usageSchema.optional().catch(undefined) }),
  z.object({ type: z.literal("conversation.item.input_audio_transcription.failed"), item_id: z.string(), error: z.object({ message: z.string().optional() }).optional() }),
  z.object({ type: z.literal("error"), error: z.object({ code: z.string().nullish(), type: z.string().nullish(), message: z.string() }) }),
]);

/** O que a OpenAI diz de próprio no erro: falta de crédito e país não atendido não são defeito da chave. */
const BILLING = new Set(["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"]);
const failureOf = (error: { code?: string | null; type?: string | null }): Exclude<KeyCheckResult, "accepted" | "not_needed"> => {
  if (error.code === "invalid_api_key") return "rejected";
  if (BILLING.has(error.code ?? "") || BILLING.has(error.type ?? "")) return "no_credit";
  if (error.code === "unsupported_country_region_territory") return "region_unavailable";
  if (error.code === "rate_limit_exceeded") return "rate_limited";
  if (error.type === "server_error") return "provider_error";
  return "unexpected_response";
};
const classifyHttp = (status: number, body: unknown): KeyCheckResult | undefined => {
  const error = z.object({ error: z.object({ code: z.string().nullish(), type: z.string().nullish() }) }).safeParse(body).data?.error;
  if (!error) return undefined;
  if (status === 429 && (BILLING.has(error.code ?? "") || BILLING.has(error.type ?? ""))) return "no_credit";
  if (status === 403 && error.code === "unsupported_country_region_territory") return "region_unavailable";
  return undefined;
};

type Item = { id: string; startMs?: number; endMs?: number; text: string; final?: TranscriptPiece; usage?: Usage };
type AnyHandler = (...args: unknown[]) => void;

class OpenAITranscription implements StreamingTranscription {
  private readonly handlers = new Map<keyof StreamingTranscriptionEvents, AnyHandler[]>();
  /** Os itens fechados e ainda não entregues como final, na ordem do servidor. */
  private readonly items: Item[] = [];
  private speechStartMs: number | undefined;
  private speechEndMs: number | undefined;
  private finished = false;
  private closedByClient = false;
  private lastError: Error | undefined;

  constructor(private readonly ws: WebSocket) {}

  on<K extends keyof StreamingTranscriptionEvents>(event: K, handler: StreamingTranscriptionEvents[K]): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler as AnyHandler]);
  }

  sendAudio(pcm16_8k: Buffer): void {
    // Áudio que ainda chega da ponte depois do fechamento é esperado: não há a quem entregar.
    if (this.finished || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm16ToUlaw(pcm16_8k).toString("base64") }));
  }

  close(): Promise<void> {
    if (this.finished) return Promise.resolve();
    this.closedByClient = true;
    const closed = new Promise<void>((resolve) => this.ws.once("close", () => resolve()));
    this.ws.close();
    return closed;
  }

  /** Uma mensagem do servidor, já decodificada. Fora do formato, ignorada. */
  receive(raw: unknown): void {
    const parsed = serverEvent.safeParse(raw);
    if (!parsed.success || this.finished) return;
    const event = parsed.data;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.speechStartMs = event.audio_start_ms;
        return;
      case "input_audio_buffer.speech_stopped":
        this.speechEndMs = Math.max(this.speechStartMs ?? 0, event.audio_end_ms - SILENCE_MS);
        return;
      case "input_audio_buffer.committed":
        this.item(event.item_id);
        return;
      case "conversation.item.input_audio_transcription.delta": {
        const item = this.item(event.item_id);
        item.text += event.delta ?? "";
        if (item === this.items[0] && item.text.trim() !== "") this.emit("piece", this.piece(item, false));
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const item = this.item(event.item_id);
        item.text = event.transcript;
        item.final = this.piece(item, true);
        item.usage = this.usageOf(item, event.usage);
        return this.deliver();
      }
      case "conversation.item.input_audio_transcription.failed": {
        const item = this.item(event.item_id);
        this.emit("error", new Error(`OpenAI transcription: the item failed (${event.error?.message ?? "no detail"})`));
        item.text = "";
        item.final = this.piece(item, true);
        return this.deliver();
      }
      case "error":
        // Erro do servidor com a sessão aberta: não fatal, como o contrato pede; só o fechamento derruba.
        this.lastError = new TranscriberOpenError(failureOf(event.error), `OpenAI transcription: ${event.error.message}`);
        this.emit("error", this.lastError);
        return;
      case "session.updated":
        return;
    }
  }

  /** O socket fechou. Fechamento que ninguém pediu é `error` e `closed`. */
  ended(detail: string): void {
    if (this.finished) return;
    this.finished = true;
    if (this.closedByClient) return this.emit("closed", "client");
    this.emit("error", this.lastError ?? new Error(`OpenAI transcription: the connection dropped (${detail})`));
    this.emit("closed", "socket_closed");
  }

  /** O item pelo id, criado na primeira vez, com o início e o fim da fala que o servidor deu. */
  private item(id: string): Item {
    const known = this.items.find((item) => item.id === id);
    if (known) return known;
    const created: Item = { id, text: "", ...(this.speechStartMs !== undefined && { startMs: this.speechStartMs }), ...(this.speechEndMs !== undefined && { endMs: this.speechEndMs }) };
    this.speechStartMs = undefined;
    this.speechEndMs = undefined;
    this.items.push(created);
    return created;
  }

  private piece(item: Item, final: boolean): TranscriptPiece {
    return { text: item.text, final, alternatives: [], ...(item.startMs !== undefined && { startMs: item.startMs }), ...(item.endMs !== undefined && { endMs: item.endMs }) };
  }

  /** Sem `usage`, os segundos de fala do item, pelo preço por minuto; sem início e fim, nada (não medido). */
  private usageOf(item: Item, usage: z.infer<typeof usageSchema> | undefined): Usage | undefined {
    if (usage?.type === "tokens") return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
    if (usage?.type === "duration") return { seconds: usage.seconds };
    if (item.startMs !== undefined && item.endMs !== undefined) return { seconds: (item.endMs + SILENCE_MS - item.startMs) / 1000 };
    return undefined;
  }

  /** Entrega, na ordem, os itens da frente que já têm final, e o parcial do que ficar na frente. */
  private deliver(): void {
    for (let head = this.items[0]; head?.final; head = this.items[0]) {
      this.items.shift();
      if (head.usage) this.emit("usage", head.usage);
      this.emit("piece", head.final);
      if (this.finished) return;
      const next = this.items[0];
      if (next && !next.final && next.text.trim() !== "") this.emit("piece", this.piece(next, false));
    }
  }

  private emit<K extends keyof StreamingTranscriptionEvents>(event: K, ...args: Parameters<StreamingTranscriptionEvents[K]>): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(...args);
      } catch (cause) {
        // Exceção de quem escuta não derruba o fluxo; no próprio handler de erro, não há para onde avisar.
        if (event !== "error") this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  }
}

/** O motivo da recusa ao abrir: o status HTTP do aperto de mão, quando houve, e o prazo. */
const openFailure = (error: unknown): Exclude<KeyCheckResult, "accepted" | "not_needed"> => {
  if (error instanceof TranscriberOpenError) return error.result;
  if (error instanceof EngineTimeoutError) return "unreachable";
  const status = /Unexpected server response: (\d{3})/.exec(error instanceof Error ? error.message : "")?.[1];
  if (status === undefined) return "unreachable";
  const result = byStatus(Number(status));
  return result === "accepted" || result === "not_needed" ? "unexpected_response" : result;
};

const transcriber: StreamingTranscriber = {
  id: "openai",
  label: "OpenAI (gpt-4o-mini-transcribe)",
  provider: "openai",
  // O mesmo do motor OpenAI Realtime: a OpenAI documenta residência de dados por projeto, e a instalação
  // usa a API padrão, sem projeto regional escolhido (developers.openai.com/api/docs/guides/your-data,
  // consultado em 12/11/2026).
  processingLocation: { kind: "undeclared" },
  pricing: PRICING,
  keySetting: KEY_SETTING,
  // O `prompt` é texto livre e a referência não publica limite: o mesmo teto do simulado.
  maxVocabulary: 100,

  async connect(config, apiKey, options = {}) {
    const ws = new WebSocket(options.baseUrl ?? DEFAULT_BASE_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    const session = new OpenAITranscription(ws);
    const timeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    let ready = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const cancel = (options.schedule ?? ((fn, ms) => {
          const handle = setTimeout(fn, ms);
          return () => clearTimeout(handle);
        }))(() => {
          ws.terminate();
          reject(new EngineTimeoutError(`OpenAI transcription: no confirmed session in ${timeoutMs / 1000} s`));
        }, timeoutMs);
        let lastError: Error | undefined;
        ws.on("error", (error) => (lastError = error));
        ws.on("open", () => {
          const language = config.language.split("-")[0] ?? config.language;
          const prompt = config.vocabulary.length > 0 ? { prompt: `Names and terms that may appear: ${config.vocabulary.join(", ")}.` } : {};
          ws.send(
            JSON.stringify({
              type: "session.update",
              session: {
                type: "transcription",
                audio: {
                  input: {
                    format: { type: "audio/pcmu" },
                    transcription: { model: MODEL, language, ...prompt },
                    turn_detection: { type: "server_vad", silence_duration_ms: SILENCE_MS },
                  },
                },
              },
            }),
          );
        });
        ws.on("message", (data) => {
          let message: unknown;
          try {
            message = JSON.parse(data.toString());
          } catch {
            return; // quadro que não é JSON não faz parte do protocolo
          }
          if (!ready) {
            const event = serverEvent.safeParse(message).data;
            if (event?.type === "session.updated") {
              ready = true;
              cancel();
              return resolve();
            }
            if (event?.type === "error") {
              cancel();
              ws.terminate();
              return reject(new TranscriberOpenError(failureOf(event.error), `OpenAI transcription: ${event.error.message}`));
            }
            return;
          }
          session.receive(message);
        });
        ws.on("close", (code, reason) => {
          const detail = [lastError?.message, `code ${code}`, reason.toString()].filter(Boolean).join("; ");
          if (ready) return session.ended(detail);
          cancel();
          reject(lastError ?? new Error(`OpenAI transcription: could not connect (${detail})`));
        });
      });
    } catch (error) {
      if (error instanceof TranscriberOpenError) throw error;
      throw new TranscriberOpenError(openFailure(error), error instanceof Error ? error.message : String(error));
    }
    return session;
  },

  checkKey(apiKey, options = {}) {
    return checkKeyOverHttp(
      {
        url: `${options.baseUrl ?? DEFAULT_API_URL}/models/${encodeURIComponent(MODEL)}`,
        headers: { Authorization: `Bearer ${apiKey}` },
        model: MODEL,
        accepted: z.object({ id: z.string(), object: z.literal("model") }),
        classify: classifyHttp,
      },
      options,
    );
  },
};

export default transcriber;
