import { z } from "zod";
import { KEY_CHECK_RESULTS, TranscriberOpenError, type StreamingTranscriber, type StreamingTranscription, type StreamingTranscriptionEvents, type TranscriptPiece } from "../types";

/**
 * Transcritor simulado: devolve um roteiro de trechos em vez de falar com um serviço. Serve a
 * testes, CI e demonstração sem chave, como o motor simulado.
 *
 * O relógio é falso: é o áudio recebido. Cada trecho sai quando a peça já recebeu `afterAudioMs`
 * de áudio de quem ligou, com `endMs` nesse ponto e `startMs` no fim do último trecho final.
 * `{ fail }` derruba o fluxo no meio (`error` e `closed`); `refuse`, nas opções, recusa abrir.
 * `usage` sai uma vez, no encerramento, com os segundos de áudio recebidos.
 *
 * De onde vem o roteiro, nesta ordem: o das opções de `createSimulatedTranscriber`; o definido por
 * `setSimulatedTranscriptScript` (global do processo, para testes); um roteiro de demonstração curto.
 * Nada aqui olha o relógio: os trechos saem por um agendador injetável (`setImmediate` por padrão).
 */
const stepSchema = z.union([
  z.strictObject({
    afterAudioMs: z.number().nonnegative(),
    text: z.string(),
    final: z.boolean().optional(),
    alternatives: z.array(z.string()).optional(),
  }),
  z.strictObject({ afterAudioMs: z.number().nonnegative(), fail: z.string() }),
]);
const scriptSchema = z.array(stepSchema);
const refuseSchema = z.enum(KEY_CHECK_RESULTS).exclude(["accepted", "not_needed"]);

export type SimulatedTranscriptStep = z.infer<typeof stepSchema>;
export type SimulatedTranscriptScript = SimulatedTranscriptStep[];
type Refusal = z.infer<typeof refuseSchema>;
type Schedule = (task: () => void) => void;

const SAMPLE_RATE = 8000;

let globalScript: SimulatedTranscriptScript | undefined;

/** Define (ou limpa, com `undefined`) o roteiro usado pelas próximas transcrições simuladas. */
export function setSimulatedTranscriptScript(script: SimulatedTranscriptScript | undefined): void {
  globalScript = script === undefined ? undefined : scriptSchema.parse(script);
}

const DEMO_SCRIPT: SimulatedTranscriptScript = [
  { afterAudioMs: 500, text: "(fala" },
  { afterAudioMs: 1000, text: "(fala de quem ligou)", final: true },
];

type AnyHandler = (...args: unknown[]) => void;

export class SimulatedTranscription implements StreamingTranscription {
  /** Bytes de áudio recebidos, para o teste conferir que cada pedaço chegou. */
  audioBytes = 0;
  private readonly handlers = new Map<keyof StreamingTranscriptionEvents, AnyHandler[]>();
  private index = 0;
  private audioMs = 0;
  private segmentStartMs = 0;
  private finished = false;

  constructor(
    private readonly script: SimulatedTranscriptScript,
    private readonly schedule: Schedule,
  ) {}

  on<K extends keyof StreamingTranscriptionEvents>(event: K, handler: StreamingTranscriptionEvents[K]): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler as AnyHandler]);
  }

  sendAudio(pcm16_8k: Buffer): void {
    if (this.finished) return;
    this.audioBytes += pcm16_8k.length;
    this.audioMs += (pcm16_8k.length / 2 / SAMPLE_RATE) * 1000;
    // Como um serviço de verdade, o trecho chega depois, e nunca dentro de quem mandou o áudio.
    const due: SimulatedTranscriptStep[] = [];
    for (let step = this.script[this.index]; step && step.afterAudioMs <= this.audioMs; step = this.script[++this.index]) due.push(step);
    if (due.length > 0) this.schedule(() => this.deliver(due));
  }

  close(): Promise<void> {
    this.finish("client");
    return Promise.resolve();
  }

  private deliver(steps: SimulatedTranscriptStep[]): void {
    for (const step of steps) {
      if (this.finished) return;
      if ("fail" in step) return this.finish("failed", new Error(step.fail));
      const piece: TranscriptPiece = { text: step.text, final: step.final ?? false, alternatives: step.alternatives ?? [], startMs: this.segmentStartMs, endMs: step.afterAudioMs };
      if (piece.final) this.segmentStartMs = step.afterAudioMs;
      this.emit("piece", piece);
    }
  }

  private finish(reason: string, error?: Error): void {
    if (this.finished) return;
    this.finished = true;
    this.emit("usage", { seconds: this.audioMs / 1000 });
    if (error) this.emit("error", error);
    this.emit("closed", reason);
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

export interface SimulatedTranscriberOptions {
  script?: SimulatedTranscriptScript;
  /** Recusa abrir com este motivo, como um serviço com a chave recusada ou fora do ar. */
  refuse?: Refusal;
  schedule?: Schedule;
  /** Cada fluxo aberto, para o teste conferir o áudio que chegou. */
  onSession?: (session: SimulatedTranscription) => void;
}

export function createSimulatedTranscriber(options: SimulatedTranscriberOptions = {}): StreamingTranscriber {
  const schedule = options.schedule ?? ((task) => void setImmediate(task));
  const script = options.script === undefined ? undefined : scriptSchema.parse(options.script);
  const refuse = options.refuse === undefined ? undefined : refuseSchema.parse(options.refuse);
  return {
    id: "simulated",
    label: "Transcritor simulado (sem chave)",
    provider: "none",
    // Roda neste processo: o áudio não sai da instalação.
    processingLocation: { kind: "this-server" },
    keyless: true,
    maxVocabulary: 100,
    pricing: { centsPerMinute: 0, checkedOn: "2026-11-15", source: "transcritor simulado: não chama serviço, não tem custo" },
    async connect() {
      if (refuse) throw new TranscriberOpenError(refuse, `simulated transcriber: refused to open (${refuse})`);
      const session = new SimulatedTranscription(script ?? globalScript ?? DEMO_SCRIPT, schedule);
      options.onSession?.(session);
      return session;
    },
    async checkKey() {
      return { result: "not_needed" };
    },
  };
}

export default createSimulatedTranscriber();
