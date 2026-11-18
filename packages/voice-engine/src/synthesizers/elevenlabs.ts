/**
 * Voz da ElevenLabs para o pipeline (R5, fatia 1a). Fontes conferidas em 17/11/2026:
 *
 * - Fala em streaming: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
 *   `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`, chave no cabeçalho
 *   `xi-api-key`, `model_id`, `output_format`, `language_code` e `inactivity_timeout` (padrão 20 s)
 *   na URL. A primeira mensagem tem `text: " "`; o texto vai em `text`, com `flush: true` para forçar
 *   a geração; `text: ""` fecha. A resposta traz `audio` em base64, `alignment` por caractere e, no
 *   fim, `isFinal: true`. **A página não mostra consumo de caracteres na resposta**: o custo é
 *   contado aqui, pelo que foi enviado, e sai sempre como estimado.
 * - Formato de saída: https://elevenlabs.io/docs/api-reference/text-to-speech/stream lista `pcm_8000`.
 *   A página do WebSocket não lista os valores, e nenhuma das duas diz a forma do PCM. **Não
 *   conferido** contra a conta: se o WebSocket aceita `pcm_8000` e se o PCM é 16 bits assinado,
 *   little-endian (é o que este arquivo supõe, sem reamostrar).
 * - `language_code` (ISO 639-1), na página do streaming HTTP acima: "not supported for
 *   multilingual_v2 models"; código que o modelo não suporta é ignorado. A página não lista os
 *   modelos que o aceitam. Por isso ele só vai com os modelos marcados na tabela
 *   (`enforcesLanguage`): Flash e Turbo v2.5, os multilíngues de baixa latência.
 * - Vozes: https://elevenlabs.io/docs/api-reference/voices/search, `GET /v2/voices`, `page_size`
 *   até 100, `next_page_token` e `has_more`; cada voz com `voice_id`, `name`, `preview_url` e
 *   `verified_languages[]` (`language`, `locale`).
 * - Teste da chave: `GET /v2/voices?page_size=1`. É a chamada mais barata que prova a chave sem
 *   sintetizar (não gasta caractere) e é a mesma permissão que a tela usa para listar as vozes.
 *   `GET /v1/models` não serve: a página não diz que exige chave. Não prova o modelo: o modelo vem
 *   da tabela de preço abaixo, e não da conta.
 *   Leitura de 18/11/2026 (incidente da ElevenLabs): o `/v2/voices` deu 502 com e sem chave, e o
 *   teste fica nele, sem plano B. O `/v1/voices` responde 200 sem chave (aceitaria qualquer chave);
 *   o `/v1/user` prova a chave, mas não a permissão de vozes. O 502 sai como `provider_error`.
 * - Preço: tabela abaixo.
 */
import WebSocket from "ws";
import { z } from "zod";
import type { BrainFailure } from "../brain";
import { byStatus, checkKeyOverHttp } from "../key-check";
import { countCharacters, speechUsageOf } from "../synthesis";
import {
  SynthesizerOpenError,
  type ConnectOptions,
  type KeyCheckOptions,
  type Speech,
  type SpeechEvents,
  type SpeechSynthesizer,
  type SynthesizerOpenFailure,
  type SynthesizerPricing,
  type SynthesizerVoice,
  type SynthesizerVoicesResult,
} from "../types";

const WS_BASE = "wss://api.elevenlabs.io";
const HTTP_BASE = "https://api.elevenlabs.io";
const OPEN_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 10_000;
/** 100 páginas de 100 vozes: muito acima de qualquer conta; só impede um laço sem fim. */
const MAX_VOICE_PAGES = 100;
const OUTPUT_FORMAT = "pcm_8000";
const DEFAULT_MODEL = "eleven_flash_v2_5";

/**
 * Preço por modelo, conferido em https://elevenlabs.io/pricing/api em 17/11/2026, no HTML da
 * página (e não por resumo): "Flash / Turbo" a US$ 0,04 por mil caracteres, "v2 Multilingual" e
 * "v3" a US$ 0,08, o mesmo em todos os planos. A dica da página diz que "Flash/Turbo" inclui
 * "Flash/Turbo V2 and V2.5". O nome do modelo na API (`eleven_flash_v2_5`) é a leitura deste
 * arquivo do nome comercial. Modelo fora da tabela é "sem preço conhecido", nunca zero.
 */
const PRICE_SOURCE = "https://elevenlabs.io/pricing/api";
const PRICE_CHECKED_ON = "2026-11-17";
const MODELS: Readonly<Record<string, { centsPerThousandCharacters: number; enforcesLanguage: boolean }>> = {
  eleven_flash_v2_5: { centsPerThousandCharacters: 4, enforcesLanguage: true },
  eleven_turbo_v2_5: { centsPerThousandCharacters: 4, enforcesLanguage: true },
  eleven_flash_v2: { centsPerThousandCharacters: 4, enforcesLanguage: false },
  eleven_turbo_v2: { centsPerThousandCharacters: 4, enforcesLanguage: false },
  eleven_multilingual_v2: { centsPerThousandCharacters: 8, enforcesLanguage: false },
  eleven_v3: { centsPerThousandCharacters: 8, enforcesLanguage: false },
};

const pricingOf = (model: string): SynthesizerPricing | undefined => {
  const entry = Object.hasOwn(MODELS, model) ? MODELS[model] : undefined;
  return entry === undefined ? undefined : { centsPerThousandCharacters: entry.centsPerThousandCharacters, source: PRICE_SOURCE, checkedOn: PRICE_CHECKED_ON };
};

const timer = (options: Pick<ConnectOptions, "schedule">, fn: () => void, delayMs: number): (() => void) => {
  if (options.schedule) return options.schedule(fn, delayMs);
  const handle = setTimeout(fn, delayMs);
  return () => clearTimeout(handle);
};

/** O idioma como a ElevenLabs pede (ISO 639-1): `pt-BR` vira `pt`. */
const languageCodeOf = (language: string): string | undefined => {
  const code = language.trim().split(/[-_]/)[0]?.toLowerCase();
  return code !== undefined && /^[a-z]{2}$/.test(code) ? code : undefined;
};

/** O status da recusa na abertura, no vocabulário fechado. */
const openFailureOf = (status: number): SynthesizerOpenFailure => {
  const result = byStatus(status);
  return result === "accepted" || result === "not_needed" ? "unexpected_response" : result;
};

const audioMessage = z.object({
  audio: z.string().nullable().optional(),
  isFinal: z.boolean().nullable().optional(),
  alignment: z.object({ chars: z.array(z.string()) }).nullable().optional().catch(undefined),
});

type SpeechState = "open" | "ending" | "done" | "cancelled" | "failed";

class ElevenLabsSpeech implements Speech {
  private readonly handlers = new Map<keyof SpeechEvents, Array<(...args: unknown[]) => void>>();
  private state: SpeechState = "open";
  private spokenChars = 0;
  /** Byte que sobrou de um pedaço ímpar: uma amostra PCM16 não pode sair partida ao meio. */
  private carry: Buffer | undefined;

  constructor(
    private readonly ws: WebSocket,
    private readonly pricing: SynthesizerPricing | undefined,
  ) {
    ws.on("message", (data) => this.receive(data.toString()));
    ws.on("close", (code, reason) => this.closed(code, reason.toString()));
    ws.on("error", () => undefined); // o fechamento que vem depois diz o que houve
  }

  on<K extends keyof SpeechEvents>(event: K, handler: SpeechEvents[K]): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as (...args: unknown[]) => void);
    this.handlers.set(event, list);
  }

  private emit<K extends keyof SpeechEvents>(event: K, ...args: Parameters<SpeechEvents[K]>): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(...args);
      } catch (cause) {
        // Roda no callback do socket: exceção de quem escuta não pode derrubar o processo.
        if (event !== "error") this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  }

  private send(text: string, flush: boolean): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(flush ? { text, flush: true } : { text }));
    // Cobrado no envio: o que saiu para o provedor é pago, mesmo que a interrupção descarte o áudio.
    const characters = countCharacters(text);
    if (characters > 0) this.emit("usage", speechUsageOf(this.pricing, characters));
  }

  push(text: string, options: { flush?: boolean } = {}): void {
    if (this.state !== "open") return;
    if (text !== "") this.send(text, options.flush === true);
    // Texto vazio fecharia a fala; o `flush` sem texto novo vai com um espaço, e o espaço é cobrado.
    else if (options.flush === true) this.send(" ", true);
  }

  end(): void {
    if (this.state !== "open") return;
    this.state = "ending";
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ text: "" }));
  }

  cancel(): void {
    if (this.state !== "open" && this.state !== "ending") return;
    this.state = "cancelled";
    this.carry = undefined;
    this.ws.terminate();
  }

  private receive(raw: string): void {
    if (this.state !== "open" && this.state !== "ending") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const message = audioMessage.safeParse(parsed);
    if (!message.success) return;
    const { audio, isFinal, alignment } = message.data;
    if (typeof audio === "string" && audio !== "") {
      let pcm = Buffer.from(audio, "base64");
      if (this.carry !== undefined) pcm = Buffer.concat([this.carry, pcm]);
      const even = pcm.length - (pcm.length % 2);
      this.carry = even < pcm.length ? pcm.subarray(even) : undefined;
      if (even > 0) this.emit("audio", pcm.subarray(0, even));
    }
    if (alignment !== null && alignment !== undefined && alignment.chars.length > 0) {
      this.spokenChars += alignment.chars.length;
      this.emit("spoken", this.spokenChars);
    }
    if (isFinal === true) this.finish();
  }

  private finish(): void {
    if (this.state !== "open" && this.state !== "ending") return;
    this.state = "done";
    this.carry = undefined;
    this.emit("done");
    this.ws.close();
  }

  private closed(code: number, reason: string): void {
    if (this.state === "ending" && code === 1000) {
      // Fechamento normal depois do `text: ""`, sem `isFinal`: a fala acabou do mesmo jeito.
      this.finish();
      return;
    }
    if (this.state !== "open" && this.state !== "ending") return;
    this.state = "failed";
    // O motivo do provedor vai só para o log, pela mensagem; o painel recebe o vocabulário fechado.
    this.emit("error", new Error(`elevenlabs: a conexão da fala caiu antes do fim (código ${code}${reason ? `; ${reason}` : ""})`));
  }
}

function openSocket(url: string, headers: Record<string, string>, options: ConnectOptions): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timeoutMs = options.readyTimeoutMs ?? OPEN_TIMEOUT_MS;
    let settled = false;
    const fail = (error: SynthesizerOpenError): void => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      ws.terminate();
      reject(error);
    };
    // Sem prazo, um provedor que aceita o TCP e não completa o aperto de mão deixaria a ligação muda.
    const cancelTimeout = timer(options, () => fail(new SynthesizerOpenError("unreachable", `elevenlabs: o provedor não abriu a fala em ${timeoutMs / 1000} s`)), timeoutMs);
    ws.on("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      fail(new SynthesizerOpenError(openFailureOf(status), `elevenlabs: o provedor recusou a fala (HTTP ${status})`));
    });
    ws.on("error", (error) => fail(new SynthesizerOpenError("unreachable", `elevenlabs: não foi possível abrir a fala (${error.message})`)));
    ws.on("close", (code) => fail(new SynthesizerOpenError("unreachable", `elevenlabs: a conexão fechou antes de abrir (código ${code})`)));
    ws.on("open", () => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      resolve(ws);
    });
  });
}

const voiceSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string(),
  preview_url: z.string().nullable().optional(),
  verified_languages: z
    .array(z.object({ language: z.string().nullable().optional(), locale: z.string().nullable().optional() }).catch({}))
    .nullable()
    .optional(),
});
const pageSchema = z.object({
  voices: z.array(z.unknown()),
  has_more: z.boolean(),
  next_page_token: z.string().nullable().optional(),
});

const httpsOnly = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string" || !URL.canParse(value)) return undefined;
  return new URL(value).protocol === "https:" ? value : undefined;
};

/** Uma voz na forma, ou `undefined`: voz fora da forma é pulada, sem derrubar a lista. */
export function voiceOf(raw: unknown): SynthesizerVoice | undefined {
  const parsed = voiceSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { voice_id, name, preview_url, verified_languages } = parsed.data;
  const languages = [
    ...new Set((verified_languages ?? []).map((entry) => (entry.locale ?? entry.language ?? "").trim()).filter((value) => value !== "")),
  ];
  const previewUrl = httpsOnly(preview_url);
  return previewUrl === undefined ? { id: voice_id, name, languages } : { id: voice_id, name, languages, previewUrl };
}

const listFailureOf = (status: number): BrainFailure => {
  const result = byStatus(status);
  return result === "accepted" || result === "not_needed" || result === "model_unavailable" ? "unexpected_response" : result;
};

async function listVoices(apiKey: string, options: KeyCheckOptions = {}): Promise<SynthesizerVoicesResult> {
  const base = (options.baseUrl ?? HTTP_BASE).replace(/\/+$/, "");
  const voices: SynthesizerVoice[] = [];
  const seenTokens = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < MAX_VOICE_PAGES; page++) {
    const query = new URLSearchParams({ page_size: "100" });
    if (token !== undefined) query.set("next_page_token", token);
    const controller = new AbortController();
    const cancel = timer(options, () => controller.abort(), options.timeoutMs ?? LIST_TIMEOUT_MS);
    let response: Response;
    let body: unknown;
    try {
      response = await (options.fetch ?? fetch)(`${base}/v2/voices?${query.toString()}`, {
        method: "GET",
        headers: { "xi-api-key": apiKey, accept: "application/json" },
        signal: controller.signal,
      });
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    } catch {
      return { ok: false, failure: "unreachable", status: null };
    } finally {
      cancel();
    }
    if (!response.ok) return { ok: false, failure: listFailureOf(response.status), status: response.status };
    const parsed = pageSchema.safeParse(body);
    if (!parsed.success) return { ok: false, failure: "unexpected_response", status: response.status };
    for (const raw of parsed.data.voices) {
      const voice = voiceOf(raw);
      if (voice !== undefined) voices.push(voice);
    }
    const next = parsed.data.next_page_token ?? undefined;
    if (!parsed.data.has_more || next === undefined || next === "") return { ok: true, voices };
    // Um token que volta repetido levaria a um laço sem fim: é resposta fora do que a página descreve.
    if (seenTokens.has(next)) return { ok: false, failure: "unexpected_response", status: response.status };
    seenTokens.add(next);
    token = next;
  }
  return { ok: false, failure: "unexpected_response", status: null };
}

const synthesizer: SpeechSynthesizer = {
  id: "elevenlabs",
  label: "ElevenLabs",
  provider: "elevenlabs",
  // A ElevenLabs tem servidores por região, mas escolher a região fica de fora desta frente.
  processingLocation: { kind: "undeclared" },
  defaultModel: DEFAULT_MODEL,
  pricing: pricingOf(DEFAULT_MODEL) as SynthesizerPricing,
  pricingOf,
  keyUrl: "https://elevenlabs.io/app/settings/api-keys",
  listVoices,
  checkKey(apiKey, options = {}) {
    const base = (options.baseUrl ?? HTTP_BASE).replace(/\/+$/, "");
    return checkKeyOverHttp(
      {
        url: `${base}/v2/voices?page_size=1`,
        headers: { "xi-api-key": apiKey, accept: "application/json" },
        model: options.model ?? DEFAULT_MODEL,
        accepted: z.object({ voices: z.array(z.unknown()) }),
        // 404 numa lista de vozes não é "modelo indisponível": é resposta que a página não descreve.
        classify: (status) => (status === 404 ? "unexpected_response" : undefined),
      },
      options,
    );
  },
  async speak(config, apiKey, options = {}) {
    const model = config.model ?? DEFAULT_MODEL;
    const query = new URLSearchParams({ model_id: model, output_format: OUTPUT_FORMAT });
    const language = languageCodeOf(config.language);
    if (language !== undefined && MODELS[model]?.enforcesLanguage === true) query.set("language_code", language);
    const base = (options.baseUrl ?? WS_BASE).replace(/\/+$/, "");
    const url = `${base}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream-input?${query.toString()}`;
    const ws = await openSocket(url, { "xi-api-key": apiKey }, options);
    const speech = new ElevenLabsSpeech(ws, pricingOf(model));
    // A abertura que a página pede: um espaço. Não é cobrado aqui (não conferido se a conta cobra).
    ws.send(JSON.stringify({ text: " " }));
    return speech;
  },
};

export default synthesizer;
