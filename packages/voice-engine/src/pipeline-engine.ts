import type { BrainChat, BrainChatMessage, BrainFailure, BrainToolCall } from "./brain";
import { SessionEmitter } from "./emitter";
import { estimateCostMicrocents } from "./pricing";
import { prepareFixedSpeech, type FixedSpeechCache } from "./synthesis";
import {
  PipelineOpenError,
  PipelinePieceError,
  SynthesizerOpenError,
  TranscriberOpenError,
  type KeyCheckResult,
  type PipelineConnectOptions,
  type PipelinePieceKind,
  type PipelinePieces,
  type PieceUsageLine,
  type Speech,
  type StreamingTranscription,
  type TranscriptPiece,
  type Usage,
  type VoiceEngine,
  type VoiceSession,
  type VoiceSessionConfig,
  type VoiceSessionEvents,
} from "./types";

/**
 * O motor de voz em pipeline (R5, fatia 3a): transcrição, cérebro e voz em série, cada um uma peça
 * escolhida à parte. Desenho: `docs/specs/2026-11-17-motor-de-voz-em-pipeline.md`, seções 3.3 e 3.4.
 *
 * **As peças chegam injetadas** em `PipelineConnectOptions.pieces`: este arquivo só conhece os
 * contratos (`types.ts`, `brain.ts`), nunca uma peça concreta. A cerca
 * `fences/engines-do-not-import-pieces.test.ts` reprova a importação de `transcribers/`,
 * `synthesizers/` ou `brains/` daqui e de `engines/`.
 *
 * **Fora da pasta `engines/` de propósito, até a fatia 5.** `loadEngines()` e o painel importam tudo
 * o que está lá e o oferecem como motor; aqui, nada carrega o pipeline, e quem já instalou não vê
 * nada novo. Ele vai para `engines/pipeline.ts`, com `default`, quando a tela do agente o oferecer.
 *
 * O laço de um turno (3.3):
 *   1. o áudio de quem ligou vai à transcrição; texto novo é `callerActivity({ words: true })`;
 *   2. o fim do turno é o trecho `final`; na falta dele, `closeCallerTurn` usa o último parcial;
 *   3. a fala final vai ao cérebro (`chat`), com as instruções, o histórico e as ferramentas;
 *   4. cada pedaço de texto vai à voz na hora (`push`), com `flush` no fim de frase;
 *   5. ferramenta: `toolCall` → `sendToolResult` → o cérebro é chamado de novo;
 *   6. `say(text)` vai direto à voz, sem o cérebro;
 *   7. `guide(text)` entra como mensagem `system` no próximo pedido ao cérebro.
 *
 * **A fala aberta e parada (o `inactivity_timeout` de 20 s da ElevenLabs).** A escolha desta fatia é a
 * primeira saída do desenho: a fala abre só quando o cérebro manda o primeiro texto, e fecha
 * (`end`) quando ele termina. Ela nunca fica aberta esperando quem ligou ou uma ferramenta. O prazo
 * padrão do pedido ao cérebro (`BRAIN_TIMEOUT_MS`, 15 s) é menor que os 20 s: um cérebro que para no
 * meio cai pelo prazo dele antes de a voz cair por inatividade. O custo é abrir a fala a cada
 * resposta, depois do primeiro texto, o que pesa em `voiceFirstAudioMs` (**não medido**).
 *
 * **As falas fixas** (a fala de falha da 3.4 e as que quem abre pedir em `fixedSpeech`, as despedidas
 * do teto) são sintetizadas no `connect`, por `prepareFixedSpeech`, com o cache por processo que não
 * atravessa organizações. Tocam por `say(text)` com o mesmo texto, sem gasto novo.
 *
 * **A falha (3.4).** Peça que cai nunca deixa a sessão muda: a voz ou a transcrição no meio da
 * ligação tocam a fala de falha já pronta e viram `error` (`PipelinePieceError`, fatal) e `closed`.
 * O cérebro que falha um pedido pede para repetir e vira `error` não fatal; duas vezes seguidas, é
 * fatal. O motivo vai no vocabulário fechado, e o texto do provedor só na mensagem, para o log.
 *
 * **O `error` da transcrição sozinho não é fatal** (o contrato de `StreamingTranscriptionEvents`: ele
 * vem "seguido de `closed` quando é fatal"). Vira `error` não fatal, e a conversa segue. Só o `closed`
 * derruba a sessão, com o motivo do último `error` quando ele veio tipado (`TranscriberOpenError`).
 *
 * **O pior caso antes de cada pedido ao cérebro** (3.3, fatia 3b-2). Com `ceiling`, o motor soma a
 * entrada estimada (um token por byte do que vai em `messages` e `tools`) e o teto de saída
 * (`PIPELINE_BRAIN_MAX_TOKENS`), pelo preço do modelo. Passou do que sobra do teto, o pedido não sai, e
 * quem abriu toca a despedida pronta (`ceiling.reached`). Sem preço conhecido, o pior caso não tem
 * conta: com teto, o pedido também não sai (a sessão já recusa abrir assim; isto é a rede de proteção).
 *
 * **A recusa de abertura** é `PipelineOpenError`: a peça, o motivo e o que a abertura já gastou (as
 * falas fixas sintetizadas antes de a outra peça recusar), para o custo entrar no extrato da tentativa.
 */

/** A fala de falha da seção 3.4, no padrão de `FAREWELL`. */
export const PIPELINE_FAILURE_SPEECH = "Estou com um problema técnico e não vou conseguir continuar. Se puder, ligue de novo em alguns minutos. Obrigado.";
/** O que quem ligou ouve quando um pedido ao cérebro falha, e a conversa segue (seção 3.4). */
export const PIPELINE_BRAIN_RETRY_SPEECH = "Desculpe, não consegui responder agora. Pode repetir, por favor?";
/** Prazo de um pedido ao cérebro. Menor que o `inactivity_timeout` de 20 s da ElevenLabs, de propósito. */
export const BRAIN_TIMEOUT_MS = 15_000;
/**
 * O teto de saída de cada pedido ao cérebro (`BrainChatRequest.maxTokens`, decisão (a) da DESA-420).
 * Uma fala de ligação cabe com folga, e o pior caso do pedido fica pequeno o bastante para não
 * recusar à toa um pedido perto do teto de custo. **Não medido:** se corta alguma resposta real.
 */
export const PIPELINE_BRAIN_MAX_TOKENS = 4096;
/** Falhas seguidas do cérebro que encerram a ligação (seção 3.4). */
const BRAIN_FAILURES_TO_GIVE_UP = 2;

/** Fim de frase: é onde a voz recebe `flush`, para gerar o que já chegou sem esperar mais texto. */
const SENTENCE_END = /[.!?…:;]["'”»)\]]*\s*$/;

type Failure = Exclude<KeyCheckResult, "accepted" | "not_needed">;
type Defer = (task: () => void) => void;

export interface PipelineEngineOptions {
  /** O cache das falas fixas. Padrão: o do processo, de `prepareFixedSpeech`. */
  fixedSpeechCache?: FixedSpeechCache;
  /** Agenda o que sai logo depois do `connect` (para quem chamou registrar os handlers). Padrão: `setImmediate`. */
  defer?: Defer;
  /** O `fetch` do cérebro (testes apontam para um servidor falso). */
  fetch?: typeof fetch;
  /** Prazo de um pedido ao cérebro. Padrão: `BRAIN_TIMEOUT_MS`. */
  brainTimeoutMs?: number;
}

export interface PipelineEngine extends VoiceEngine {
  /** Sem `options.pieces`, recusa abrir: o pipeline não tem peça padrão. */
  connect(config: VoiceSessionConfig, apiKey: string, options?: PipelineConnectOptions): Promise<VoiceSession>;
}

/** O texto que vai ao cérebro como resultado de uma ferramenta. */
const toolContent = (result: unknown): string => (typeof result === "string" ? result : (JSON.stringify(result) ?? "null"));

/** O `args` do cérebro é texto; quem executa a ferramenta valida com zod. Texto que não é JSON vai como veio. */
const toolArgs = (args: string): unknown => {
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return args;
  }
};

const failureOf = (error: unknown): Failure => {
  if (error instanceof SynthesizerOpenError) return error.reason;
  if (error instanceof TranscriberOpenError) return error.result;
  return "unreachable";
};

/** Um token por byte UTF-8: a regra do Jev, a mesma de `brain-http.ts`, para o pedido sem consumo declarado. */
const bytesOf = (value: unknown): number => Buffer.byteLength(typeof value === "string" ? value : (JSON.stringify(value) ?? ""), "utf8");

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Uma fala na fila de saída: a viva, aberta na voz, ou a fixa, já pronta. */
interface Utterance {
  /** Áudio que chegou antes de esta fala ser a primeira da fila. */
  held: Buffer[];
  finished: boolean;
  push(text: string, flush: boolean): void;
  end(): void;
  cancel(): void;
}

/** A fala fixa: o áudio já está pronto, e não há nada a mandar à voz. */
const readyUtterance = (audio: Buffer): Utterance => ({ held: [audio], finished: true, push: () => undefined, end: () => undefined, cancel: () => undefined });

/** Uma fala viva. O texto que chega antes de a voz abrir espera, e vai na ordem quando ela abre. */
class LiveUtterance implements Utterance {
  held: Buffer[] = [];
  finished = false;
  private speech: Speech | undefined;
  private readonly queued: Array<{ text: string; flush: boolean }> = [];
  private ended = false;
  private cancelled = false;

  /** A voz abriu: manda o que esperava. Depois do `cancel`, a fala que abriu tarde é cancelada. */
  opened(speech: Speech): void {
    if (this.cancelled) return speech.cancel();
    this.speech = speech;
    for (const { text, flush } of this.queued.splice(0)) speech.push(text, { flush });
    if (this.ended) speech.end();
  }

  push(text: string, flush: boolean): void {
    if (this.speech) this.speech.push(text, { flush });
    else this.queued.push({ text, flush });
  }

  end(): void {
    this.ended = true;
    this.speech?.end();
  }

  cancel(): void {
    this.cancelled = true;
    this.speech?.cancel();
  }
}

class PipelineSession implements VoiceSession {
  private readonly emitter = new SessionEmitter();
  private readonly history: BrainChatMessage[] = [];
  /** O que entra no histórico quando a rodada em curso acabar (o histórico não se intercala com ferramenta). */
  private readonly waiting: BrainChatMessage[] = [];
  private readonly guidance: string[] = [];
  private readonly output: Utterance[] = [];
  private chat: BrainChat | undefined;
  /** Uma rodada do cérebro em curso: o pedido, ou a espera das ferramentas dele. */
  private busy = false;
  private pendingTools: { calls: BrainToolCall[]; results: Map<string, string> } | undefined;
  private brainFailures = 0;
  private lastPartial: string | undefined;
  /** O parcial que `closeCallerTurn` já usou: o `final` dele, se vier depois, não vira outro turno. */
  private forcedPartial: string | undefined;
  private lastHeard = "";
  /** O último `error` da transcrição: explica o `closed` que vier depois dele. */
  private transcriptionError: unknown;
  private finished = false;

  constructor(
    private readonly config: VoiceSessionConfig,
    private readonly pieces: PipelinePieces,
    private readonly transcription: StreamingTranscription,
    private readonly fixedAudio: Map<string, Buffer>,
    fixedUsage: { characters: number; costMicrocents?: number },
    private readonly options: { fetch?: typeof fetch; brainTimeoutMs: number; schedule?: PipelineConnectOptions["schedule"]; ceiling?: PipelineConnectOptions["ceiling"] },
    defer: Defer,
  ) {
    if (config.instructions !== "") this.history.push({ role: "system", content: config.instructions });
    transcription.on("piece", (piece) => this.heard(piece));
    transcription.on("usage", (usage) => this.transcriberUsage(usage));
    // O `error` sozinho não é fatal: vai a quem abriu (log e painel), e a conversa segue. Ele explica o `closed`, se vier.
    transcription.on("error", (error) => this.transcriberError(error));
    transcription.on("closed", (reason) => {
      const last = this.transcriptionError;
      const detail = last === undefined ? "" : `: ${messageOf(last)}`;
      this.fail("transcriber", pieces.transcriber.piece.id, last === undefined ? "unreachable" : failureOf(last), `transcrição fechou no meio da ligação (${reason})${detail}`);
    });
    // Agendado: quem chamou `connect` registra os handlers antes do primeiro evento.
    defer(() => {
      if (this.finished) return;
      // O custo das falas fixas entra no extrato da ligação que as sintetizou (o que veio do cache, zero caractere).
      if (fixedUsage.characters > 0) this.synthesizerUsage(fixedUsage.characters, fixedUsage.costMicrocents);
      if (config.greeting) this.say(config.greeting);
    });
  }

  on<K extends keyof VoiceSessionEvents>(event: K, handler: VoiceSessionEvents[K]): void {
    this.emitter.on(event, handler);
  }

  sendAudio(pcm16_8k: Buffer): void {
    if (!this.finished) this.transcription.sendAudio(pcm16_8k);
  }

  sendToolResult(id: string, result: unknown): void {
    if (this.finished) return;
    const pending = this.pendingTools;
    if (!pending?.calls.some((call) => call.id === id) || pending.results.has(id)) {
      this.emitter.emit("error", new Error(`pipeline: resultado para uma chamada de ferramenta que não está pendente: ${id}`));
      return;
    }
    pending.results.set(id, toolContent(result));
    if (pending.results.size < pending.calls.length) return;
    this.pendingTools = undefined;
    // Na ordem das chamadas e depois de todas elas: o Gemini recusa intercalar (seção 3.2).
    for (const call of pending.calls) this.history.push({ role: "tool", toolCallId: call.id, content: pending.results.get(call.id) ?? "" });
    this.ask();
  }

  say(text: string): void {
    if (this.finished || text.trim() === "") return;
    const fixed = this.fixedAudio.get(text);
    this.emitter.emit("transcript", { speaker: "agent", text });
    this.remember({ role: "assistant", content: text });
    if (fixed) {
      // Já pronta na abertura: toca sem pedir nada à voz, e sem custo novo.
      this.enqueue(readyUtterance(fixed));
      return;
    }
    const utterance = this.openUtterance();
    utterance.push(text, true);
    utterance.end();
  }

  guide(text: string): void {
    if (!this.finished && text.trim() !== "") this.guidance.push(text);
  }

  closeCallerTurn(): boolean {
    if (this.finished) return false;
    const partial = this.lastPartial;
    if (partial === undefined || partial.trim() === "") return false;
    this.lastPartial = undefined;
    this.forcedPartial = partial;
    this.userTurn(partial);
    return true;
  }

  async close(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.stopTalking();
    await this.transcription.close().catch(() => undefined);
    this.emitter.emit("closed", "client");
  }

  // ---- 1 e 2: o ouvido ----

  private heard(piece: TranscriptPiece): void {
    if (this.finished) return;
    const text = piece.text.trim();
    if (text !== "" && text !== this.lastHeard) this.emitter.emit("callerActivity", { words: true });
    this.lastHeard = text;
    if (!piece.final) {
      this.lastPartial = piece.text;
      return;
    }
    this.lastPartial = undefined;
    this.lastHeard = "";
    const forced = this.forcedPartial;
    this.forcedPartial = undefined;
    // O `final` do trecho que a guarda já fechou não vira um segundo turno.
    if (text === "" || (forced !== undefined && text.startsWith(forced.trim()))) return;
    this.emitter.emit("callerTurnEnded", { source: "transcript" });
    this.userTurn(piece.text);
  }

  private transcriberError(error: unknown): void {
    if (this.finished) return;
    this.transcriptionError = error;
    const { id } = this.pieces.transcriber.piece;
    this.emitter.emit("error", new PipelinePieceError("transcriber", id, failureOf(error), false, `transcrição: ${messageOf(error)}`));
  }

  private userTurn(text: string): void {
    this.emitter.emit("transcript", { speaker: "user", text });
    if (this.busy) {
      // Interromper a resposta é da fatia 4: aqui, a fala espera a rodada acabar.
      this.waiting.push({ role: "user", content: text });
      return;
    }
    this.history.push({ role: "user", content: text });
    this.ask();
  }

  private remember(message: BrainChatMessage): void {
    if (this.busy) this.waiting.push(message);
    else this.history.push(message);
  }

  // ---- 3 a 5 e 7: o cérebro ----

  private ask(): void {
    if (this.finished) return;
    const { piece: brain, apiKey, model } = this.pieces.brain;
    if (!brain.chat) return this.fail("brain", brain.id, "unexpected_response", "o cérebro não conversa (sem `chat`)");
    for (const text of this.guidance.splice(0)) this.history.push({ role: "system", content: text });
    const messages = [...this.history];
    const inputTokens = bytesOf(messages) + (this.config.tools.length > 0 ? bytesOf(this.config.tools) : 0);
    if (this.overCeiling(inputTokens)) return;
    this.busy = true;
    const chat = brain.chat(
      apiKey,
      { model, messages, tools: this.config.tools, timeoutMs: this.options.brainTimeoutMs, maxTokens: PIPELINE_BRAIN_MAX_TOKENS },
      { fetch: this.options.fetch },
    );
    this.chat = chat;
    let text = "";
    const calls: BrainToolCall[] = [];
    let utterance: Utterance | undefined;
    let usage: { usage: Usage; estimated: boolean } | undefined;
    let end: { ok: true } | { ok: false; status: number | null } | { cancelled: true } | undefined;
    // O que saiu e o que voltou, para estimar o pedido que terminou sem consumo declarado.
    const sent = (): Usage => ({
      inputTokens,
      outputTokens: bytesOf(text) + calls.reduce((sum, call) => sum + bytesOf(call.args), 0),
    });
    const charge = (): void => {
      if (usage && end) this.brainUsage(usage.usage, usage.estimated, end, sent);
    };
    chat.on("usage", (value, estimated) => {
      usage = { usage: value, estimated };
      if (this.chat !== chat) end ??= { cancelled: true };
      charge();
    });
    chat.on("text", (delta) => {
      if (this.chat !== chat || this.finished || delta === "") return;
      text += delta;
      // A fala abre no primeiro texto, e não antes: não fica aberta esperando (o `inactivity_timeout`).
      utterance ??= this.openUtterance();
      utterance.push(delta, SENTENCE_END.test(delta));
    });
    chat.on("toolCall", (call) => {
      if (this.chat === chat) calls.push(call);
    });
    chat.on("done", () => {
      if (this.chat !== chat) return;
      end = { ok: true };
      charge();
      this.chat = undefined;
      utterance?.end();
      this.answered(text, calls);
    });
    chat.on("error", (failure, status) => {
      if (this.chat !== chat) return;
      end = { ok: false, status };
      charge();
      this.chat = undefined;
      utterance?.end();
      this.brainFailed(text, failure, status);
    });
  }

  /**
   * O pior caso do pedido contra o que sobra do teto (3.3): entrada estimada + `maxTokens` × preço.
   * Passou, o pedido não sai, e quem abriu toca a despedida pronta. Sem preço, não há conta: com teto,
   * o pedido também não sai. Sem `ceiling` ou sem teto, nada é conferido.
   */
  private overCeiling(inputTokens: number): boolean {
    const remaining = this.options.ceiling?.remainingMicrocents();
    if (remaining === undefined) return false;
    const { price } = this.pieces.brain;
    const worst = price === undefined ? undefined : estimateCostMicrocents(price, { inputTokens, outputTokens: PIPELINE_BRAIN_MAX_TOKENS });
    if (worst !== undefined && worst <= remaining) return false;
    // A rodada acaba aqui, sem pedido: o que esperava entra no histórico, e a despedida vem depois dele.
    this.busy = false;
    this.history.push(...this.waiting.splice(0));
    this.options.ceiling?.reached(worst);
    return true;
  }

  private answered(text: string, calls: BrainToolCall[]): void {
    if (this.finished) return;
    this.brainFailures = 0;
    if (text !== "") this.emitter.emit("transcript", { speaker: "agent", text });
    if (text !== "" || calls.length > 0) this.history.push(calls.length > 0 ? { role: "assistant", content: text, toolCalls: calls } : { role: "assistant", content: text });
    if (calls.length > 0) {
      this.pendingTools = { calls, results: new Map() };
      for (const call of calls) this.emitter.emit("toolCall", { id: call.id, name: call.name, args: toolArgs(call.args) });
      return;
    }
    this.roundOver();
  }

  private brainFailed(text: string, failure: BrainFailure, status: number | null): void {
    if (this.finished) return;
    const { id } = this.pieces.brain.piece;
    this.brainFailures += 1;
    if (this.brainFailures >= BRAIN_FAILURES_TO_GIVE_UP) return this.fail("brain", id, failure, `o cérebro falhou ${this.brainFailures} vezes seguidas (${failure}, ${status ?? "sem resposta"})`);
    // O que já foi falado fica no histórico; a ferramenta de uma volta que falhou não é executada.
    if (text !== "") {
      this.emitter.emit("transcript", { speaker: "agent", text });
      this.history.push({ role: "assistant", content: text });
    }
    this.emitter.emit("error", new PipelinePieceError("brain", id, failure, false, `o pedido ao cérebro falhou (${failure}, ${status ?? "sem resposta"})`));
    this.roundOver();
    this.say(PIPELINE_BRAIN_RETRY_SPEECH);
  }

  private roundOver(): void {
    this.busy = false;
    const waiting = this.waiting.splice(0);
    this.history.push(...waiting);
    if (waiting.some((message) => message.role === "user")) this.ask();
  }

  // ---- 4 e 6: a voz ----

  private openUtterance(): Utterance {
    const { piece: synthesizer, apiKey, voiceId, model } = this.pieces.synthesizer;
    const utterance = new LiveUtterance();
    this.enqueue(utterance);
    synthesizer.speak({ voiceId, language: this.config.language, ...(model === undefined ? {} : { model }) }, apiKey, { schedule: this.options.schedule }).then(
      (speech) => {
        if (this.finished) return speech.cancel();
        // Os handlers antes do texto que esperava: o consumo sai no envio, e nenhum fica sem dono.
        speech.on("audio", (pcm) => this.play(utterance, pcm));
        speech.on("usage", (usage) => this.synthesizerUsage(usage.characters, usage.costMicrocents));
        speech.on("done", () => this.utteranceDone(utterance));
        speech.on("error", (error) => this.fail("synthesizer", synthesizer.id, failureOf(error), `voz: ${messageOf(error)}`));
        utterance.opened(speech);
      },
      (error: unknown) => this.fail("synthesizer", synthesizer.id, failureOf(error), `a voz não abriu no meio da ligação: ${messageOf(error)}`),
    );
    return utterance;
  }

  /** As falas saem uma depois da outra: a de trás guarda o áudio até a da frente acabar. */
  private enqueue(utterance: Utterance): void {
    this.output.push(utterance);
    if (this.output[0] === utterance) this.drain();
  }

  private play(utterance: Utterance, pcm: Buffer): void {
    if (this.finished) return;
    if (this.output[0] === utterance) this.emitter.emit("audio", pcm);
    else utterance.held.push(pcm);
  }

  private utteranceDone(utterance: Utterance): void {
    utterance.finished = true;
    if (this.output[0] === utterance) {
      this.output.shift();
      this.drain();
    }
  }

  private drain(): void {
    for (let head = this.output[0]; head && !this.finished; head = this.output[0]) {
      for (const pcm of head.held.splice(0)) this.emitter.emit("audio", pcm);
      if (!head.finished) return;
      this.output.shift();
    }
  }

  private stopTalking(): void {
    const chat = this.chat;
    this.chat = undefined;
    chat?.cancel();
    for (const utterance of this.output.splice(0)) utterance.cancel();
  }

  // ---- 3.4: a falha ----

  private fail(piece: PipelinePieceKind, id: string, reason: Failure, message: string): void {
    if (this.finished) return;
    this.finished = true;
    this.stopTalking();
    // A fala de falha já estava pronta: não depende da voz estar viva.
    const speech = this.fixedAudio.get(PIPELINE_FAILURE_SPEECH);
    if (speech) {
      this.emitter.emit("transcript", { speaker: "agent", text: PIPELINE_FAILURE_SPEECH });
      this.emitter.emit("audio", speech);
    }
    this.emitter.emit("error", new PipelinePieceError(piece, id, reason, true, message));
    // O ouvido fecha antes do `closed`, para o consumo dele ainda entrar na ligação.
    if (piece !== "transcriber") void this.transcription.close().catch(() => undefined);
    this.emitter.emit("closed", "failed");
  }

  // ---- 3.3: o custo por peça ----

  private transcriberUsage(usage: Usage): void {
    const { piece } = this.pieces.transcriber;
    this.emitter.emit("pieceUsage", { piece: "transcriber", id: piece.id, usage, costMicrocents: estimateCostMicrocents(piece.pricing, usage), estimated: false });
  }

  private synthesizerUsage(characters: number, costMicrocents: number | undefined): void {
    this.emitter.emit("pieceUsage", synthesizerLine(this.pieces.synthesizer, characters, costMicrocents));
  }

  /**
   * O custo de um pedido ao cérebro, pela regra da seção 3.2: a recusa HTTP (fora de 2xx) com `{}` é
   * zero medido. Em qualquer outro fim, `{}` é consumo não declarado (a escrita em cache da Anthropic,
   * por exemplo): com o preço conhecido, a linha sai **estimada** pelo que foi e voltou, um token por
   * byte (a regra do Jev), nunca zero. Sem preço, o custo fica ausente (não medido); a sessão recusa
   * abrir com peça sem preço (`pipeline_piece_unpriced`), então isso só sobra para quem abre sem ela.
   */
  private brainUsage(usage: Usage, estimated: boolean, end: { ok: true } | { ok: false; status: number | null } | { cancelled: true }, sent: () => Usage): void {
    const { piece, model, price } = this.pieces.brain;
    const refused = "ok" in end && !end.ok && end.status !== null && (end.status < 200 || end.status >= 300);
    const declared = typeof usage.inputTokens === "number";
    if (refused && !declared) return this.emitter.emit("pieceUsage", { piece: "brain", id: piece.id, model, usage, costMicrocents: 0, estimated });
    const counted = declared ? usage : sent();
    const cost = price === undefined ? undefined : estimateCostMicrocents(price, counted);
    this.emitter.emit("pieceUsage", { piece: "brain", id: piece.id, model, usage: counted, ...(cost === undefined ? {} : { costMicrocents: cost }), estimated: estimated || !declared });
  }
}

/** A linha de custo da voz: caracteres enviados, com o preço do modelo, ou sem custo (não medido). */
function synthesizerLine(synthesizer: PipelinePieces["synthesizer"], characters: number, costMicrocents: number | undefined): PieceUsageLine {
  return {
    piece: "synthesizer",
    id: synthesizer.piece.id,
    model: synthesizer.model ?? synthesizer.piece.defaultModel,
    usage: {},
    characters,
    ...(costMicrocents === undefined ? {} : { costMicrocents }),
    estimated: true,
  };
}

export function createPipelineEngine(engineOptions: PipelineEngineOptions = {}): PipelineEngine {
  const defer = engineOptions.defer ?? ((task) => void setImmediate(task));
  return {
    id: "pipeline",
    label: "Pipeline (transcrição, cérebro e voz)",
    provider: "pipeline",
    // Cada peça declara onde processa; o motor sozinho não processa nada.
    processingLocation: { kind: "undeclared" },
    // Sem chave própria: cada peça traz a dela em `PipelineConnectOptions`.
    keyless: true,
    pricing: { centsPerMinute: 0, checkedOn: "2026-11-23", source: "pipeline: o custo é de cada peça, pelo evento pieceUsage" },
    async connect(config, _apiKey, options) {
      const pieces = options?.pieces;
      if (!pieces || !options.organizationId) throw new Error("pipeline: o connect precisa das peças e da organização (PipelineConnectOptions)");
      if (!pieces.brain.piece.chat) throw new PipelineOpenError("brain", pieces.brain.piece.id, "unexpected_response", [], `pipeline: o cérebro ${pieces.brain.piece.id} não conversa (sem chat)`);
      const { transcriber, synthesizer } = pieces;
      const timing = { schedule: options.schedule, readyTimeoutMs: options.readyTimeoutMs };
      // As duas aberturas ao mesmo tempo; qualquer recusa é recusa de abertura, e a outra é fechada.
      const [heard, fixed] = await Promise.allSettled([
        transcriber.piece.connect({ language: config.language, vocabulary: (config.vocabulary ?? []).slice(0, transcriber.piece.maxVocabulary) }, transcriber.apiKey, timing),
        prepareFixedSpeech(
          synthesizer.piece,
          options.organizationId,
          { voiceId: synthesizer.voiceId, language: config.language, ...(synthesizer.model === undefined ? {} : { model: synthesizer.model }) },
          [PIPELINE_FAILURE_SPEECH, ...(options.fixedSpeech ?? [])],
          synthesizer.apiKey,
          { schedule: options.schedule, ...(engineOptions.fixedSpeechCache ? { cache: engineOptions.fixedSpeechCache } : {}) },
        ),
      ]);
      if (heard.status === "rejected" || fixed.status === "rejected") {
        if (heard.status === "fulfilled") await heard.value.close().catch(() => undefined);
        // As falas fixas que ficaram prontas antes de a outra peça recusar já foram pagas: o custo vai junto da recusa.
        const spent: PieceUsageLine[] = [];
        if (fixed.status === "fulfilled" && fixed.value.usage.characters > 0) spent.push(synthesizerLine(synthesizer, fixed.value.usage.characters, fixed.value.usage.costMicrocents));
        if (heard.status === "rejected") throw new PipelineOpenError("transcriber", transcriber.piece.id, failureOf(heard.reason), spent, `transcrição: ${messageOf(heard.reason)}`);
        const reason: unknown = (fixed as PromiseRejectedResult).reason;
        throw new PipelineOpenError("synthesizer", synthesizer.piece.id, failureOf(reason), spent, `voz: ${messageOf(reason)}`);
      }
      return new PipelineSession(
        config,
        pieces,
        heard.value,
        fixed.value.audio,
        fixed.value.usage,
        { fetch: engineOptions.fetch, brainTimeoutMs: engineOptions.brainTimeoutMs ?? BRAIN_TIMEOUT_MS, schedule: options.schedule, ceiling: options.ceiling },
        defer,
      );
    },
    async checkKey() {
      // Cada peça confere a própria chave; o motor não tem uma.
      return { result: "not_needed" };
    },
  };
}
