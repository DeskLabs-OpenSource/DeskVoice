import { MICROCENTS_PER_CENT } from "./pricing";
import {
  SynthesizerOpenError,
  type ConnectOptions,
  type KeyCheckOptions,
  type SpeakConfig,
  type SpeechSynthesizer,
  type SpeechUsage,
  type SynthesizerPricing,
} from "./types";

/**
 * Os caracteres de um texto como o provedor de voz conta: um por ponto de código, e não por
 * unidade UTF-16 (`"ção".length` é 3, mas um emoji contaria 2). **Não conferido** contra o
 * consumo da conta: é o que a bancada da fatia 1a compara.
 */
export const countCharacters = (text: string): number => [...text].length;

/**
 * O custo da voz: caracteres enviados × preço por mil, em micro-centavos inteiros. Sem preço
 * conhecido, `undefined`, e nunca zero (regra da R4: zero só se o provedor publica zero).
 */
export function speechCostMicrocents(pricing: SynthesizerPricing | undefined, characters: number): number | undefined {
  if (pricing === undefined) return undefined;
  return Math.max(0, Math.round((characters * pricing.centsPerThousandCharacters * MICROCENTS_PER_CENT) / 1000));
}

/** O incremento de consumo de um envio, já com o custo. */
export function speechUsageOf(pricing: SynthesizerPricing | undefined, characters: number): SpeechUsage {
  const costMicrocents = speechCostMicrocents(pricing, characters);
  return costMicrocents === undefined ? { characters, estimated: true } : { characters, costMicrocents, estimated: true };
}

/** O áudio de uma fala fixa e o que custou prepará-la nesta chamada (zero caractere se veio do cache). */
export interface FixedSpeech {
  /** O áudio de cada texto pedido, PCM16 mono 8 kHz, pela ordem de `texts`. */
  audio: Map<string, Buffer>;
  /** O que esta chamada enviou ao provedor (o que veio do cache não conta). */
  usage: SpeechUsage;
}

/**
 * Cache por processo, em memória: nunca em disco nem no banco (seção 8 de
 * `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`). Não atravessa organizações: a chave começa
 * pela organização (seção 3.3 do mesmo desenho).
 */
export class FixedSpeechCache {
  private readonly entries = new Map<string, Promise<{ audio: Buffer; usage: SpeechUsage }>>();

  constructor(private readonly maxEntries = 256) {}

  /**
   * A chave da seção 3.3 de `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`: organização,
   * sintetizador, voz, modelo e texto. Duas organizações com o mesmo `voiceId` nunca dividem uma entrada.
   */
  static keyOf(organizationId: string, synthesizerId: string, voiceId: string, model: string, text: string): string {
    return JSON.stringify([organizationId, synthesizerId, voiceId, model, text]);
  }

  get size(): number {
    return this.entries.size;
  }

  /** O pedido em voo ou pronto; dois pedidos iguais ao mesmo tempo pagam uma vez só. */
  getOrCreate(key: string, create: () => Promise<{ audio: Buffer; usage: SpeechUsage }>): { promise: Promise<{ audio: Buffer; usage: SpeechUsage }>; fresh: boolean } {
    const cached = this.entries.get(key);
    if (cached !== undefined) return { promise: cached, fresh: false };
    const promise = create();
    this.entries.set(key, promise);
    // Falha não fica guardada: a próxima ligação tenta de novo.
    promise.catch(() => {
      if (this.entries.get(key) === promise) this.entries.delete(key);
    });
    // O mais antigo sai primeiro: são poucas falas por voz, e o limite só protege a memória.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return { promise, fresh: true };
  }
}

const defaultCache = new FixedSpeechCache();

/** Prazo para uma fala fixa ficar pronta. Passado ele, a abertura é recusada. */
export const FIXED_SPEECH_TIMEOUT_MS = 10_000;

export interface FixedSpeechOptions extends ConnectOptions {
  /** Prazo de cada fala, da abertura até `done`. Padrão: `FIXED_SPEECH_TIMEOUT_MS`. */
  timeoutMs?: number;
  cache?: FixedSpeechCache;
  /** Opções da conferência da chave feita quando alguma fala vem do cache (a URL é a HTTP do provedor). */
  keyCheck?: KeyCheckOptions;
}

const timer = (options: Pick<ConnectOptions, "schedule">, fn: () => void, delayMs: number): (() => void) => {
  if (options.schedule) return options.schedule(fn, delayMs);
  const handle = setTimeout(fn, delayMs);
  return () => clearTimeout(handle);
};

/** Sintetiza um texto inteiro e devolve o áudio junto. Falha (inclusive prazo) é `SynthesizerOpenError`. */
async function synthesizeWhole(
  synthesizer: SpeechSynthesizer,
  voice: SpeakConfig,
  text: string,
  apiKey: string,
  options: FixedSpeechOptions,
): Promise<{ audio: Buffer; usage: SpeechUsage }> {
  const timeoutMs = options.timeoutMs ?? FIXED_SPEECH_TIMEOUT_MS;
  const speech = await synthesizer.speak(voice, apiKey, options);
  const chunks: Buffer[] = [];
  let characters = 0;
  let costMicrocents: number | undefined = 0;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const cancelTimer = timer(
      options,
      () => {
        if (settled) return;
        settled = true;
        speech.cancel();
        reject(new SynthesizerOpenError("unreachable", `${synthesizer.id}: a fala fixa não ficou pronta em ${timeoutMs / 1000} s`));
      },
      timeoutMs,
    );
    speech.on("audio", (pcm) => chunks.push(pcm));
    speech.on("usage", (usage) => {
      characters += usage.characters;
      costMicrocents = costMicrocents === undefined || usage.costMicrocents === undefined ? undefined : costMicrocents + usage.costMicrocents;
    });
    speech.on("error", (error) => {
      if (settled) return;
      settled = true;
      cancelTimer();
      speech.cancel();
      reject(error instanceof SynthesizerOpenError ? error : new SynthesizerOpenError("unreachable", `${synthesizer.id}: a fala fixa falhou (${error.message})`));
    });
    speech.on("done", () => {
      if (settled) return;
      settled = true;
      cancelTimer();
      const audio = Buffer.concat(chunks);
      // Uma fala de falha muda não serve: é o mesmo que não ter fala nenhuma.
      if (audio.length === 0) reject(new SynthesizerOpenError("unexpected_response", `${synthesizer.id}: a fala fixa voltou sem áudio`));
      else resolve({ audio, usage: costMicrocents === undefined ? { characters, estimated: true } : { characters, costMicrocents, estimated: true } });
    });
    speech.push(text, { flush: true });
    speech.end();
  });
}

/**
 * Confere a chave da organização sem sintetizar. Aceita (ou dispensada) passa; qualquer outro
 * resultado é `SynthesizerOpenError` com o mesmo motivo, ou seja, recusa de abertura.
 */
async function confirmKey(synthesizer: SpeechSynthesizer, apiKey: string, model: string, options: FixedSpeechOptions): Promise<void> {
  let result: string;
  try {
    ({ result } = await synthesizer.checkKey(apiKey, { ...options.keyCheck, model }));
  } catch {
    // O contrato diz que `checkKey` nunca lança; se lançar, a abertura é recusada do mesmo jeito.
    result = "unreachable";
  }
  if (result === "accepted" || result === "not_needed") return;
  const reason = result as SynthesizerOpenError["reason"];
  throw new SynthesizerOpenError(reason, `${synthesizer.id}: a chave não passou na conferência da abertura (${reason})`);
}

/**
 * Sintetiza na abertura da ligação as falas fixas (a fala de falha e as despedidas do teto), para
 * que estejam prontas quando a voz morrer ou o teto chegar, sem gasto novo nessa hora. A regra está
 * na seção 3.3 e no aceite 6 da fatia 1a de `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`.
 *
 * Usa um cache por processo com a chave (organização, sintetizador, voz, modelo, texto): a ligação
 * seguinte da mesma organização com a mesma voz não paga de novo, e outra organização nunca usa o
 * que esta sintetizou. Quando alguma fala vem do cache, a chave é conferida com `checkKey` antes de
 * devolver: a abertura confere a chave a cada ligação, com ou sem cache.
 *
 * Qualquer falha ao preparar, inclusive a chave recusada, lança `SynthesizerOpenError`, que quem
 * abre a ligação trata como **recusa de abertura**: uma ligação sem fala de falha não começa.
 */
export async function prepareFixedSpeech(
  synthesizer: SpeechSynthesizer,
  organizationId: string,
  voice: SpeakConfig,
  texts: readonly string[],
  apiKey: string,
  options: FixedSpeechOptions = {},
): Promise<FixedSpeech> {
  if (organizationId === "") throw new TypeError("prepareFixedSpeech: a organização é obrigatória");
  const cache = options.cache ?? defaultCache;
  const model = voice.model ?? synthesizer.defaultModel;
  const unique = [...new Set(texts)];
  const pending = unique.map((text) => {
    const key = FixedSpeechCache.keyOf(organizationId, synthesizer.id, voice.voiceId, model, text);
    const entry = cache.getOrCreate(key, () => synthesizeWhole(synthesizer, { ...voice, model }, text, apiKey, options));
    return { text, ...entry };
  });
  // O que veio do cache não passou pela chave desta abertura: ela é conferida agora, junto.
  const keyConfirmed = pending.some((entry) => !entry.fresh) ? confirmKey(synthesizer, apiKey, model, options) : Promise.resolve();
  // Espera todas, mesmo quando uma falha: nenhum pedido fica solto, sem dono, depois da recusa.
  const keyRefusal = keyConfirmed.then(
    () => undefined,
    (error: unknown) => error,
  );
  const settled = await Promise.allSettled(pending.map((entry) => entry.promise));
  const refused = await keyRefusal;
  if (refused !== undefined) throw refused;
  const failed = settled.find((result) => result.status === "rejected");
  if (failed !== undefined) {
    const reason: unknown = failed.reason;
    throw reason instanceof SynthesizerOpenError ? reason : new SynthesizerOpenError("unreachable", `${synthesizer.id}: a fala fixa falhou`);
  }
  const audio = new Map<string, Buffer>();
  let characters = 0;
  let costMicrocents: number | undefined = 0;
  pending.forEach((entry, index) => {
    const result = settled[index];
    if (result?.status !== "fulfilled") return;
    audio.set(entry.text, result.value.audio);
    // Só quem pediu paga: o que veio pronto do cache já foi cobrado na ligação que o fez.
    if (!entry.fresh) return;
    characters += result.value.usage.characters;
    costMicrocents = costMicrocents === undefined || result.value.usage.costMicrocents === undefined ? undefined : costMicrocents + result.value.usage.costMicrocents;
  });
  return { audio, usage: costMicrocents === undefined ? { characters, estimated: true } : { characters, costMicrocents, estimated: true } };
}
