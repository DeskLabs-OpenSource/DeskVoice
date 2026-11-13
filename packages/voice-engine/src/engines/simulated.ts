import { z } from "zod";
import { SessionEmitter } from "../emitter";
import { UNKNOWN_OUTCOME } from "../outcome";
import type { VoiceEngine, VoiceSession, VoiceSessionConfig, VoiceSessionEvents } from "../types";

/**
 * Motor simulado: executa um roteiro em vez de falar com um provedor. Serve a testes, CI e
 * demonstração sem chave.
 *
 * De onde vem o roteiro, nesta ordem:
 *   1. `config.instructions` começando com `simulated:` seguido do JSON do roteiro (vale só para
 *      aquela sessão; é o caminho para um agente de demonstração cadastrado no painel);
 *   2. o roteiro definido por `setSimulatedScript(script)` (global do processo; para testes);
 *   3. um roteiro de demonstração curto.
 *
 * `config.greeting`, quando presente, é falado antes do primeiro passo, como nos motores reais.
 * O roteiro que termina sem `{ end: true }` deixa a sessão aberta até alguém chamar `close()`.
 * `usage` sai uma vez, no encerramento, com os segundos de áudio falados e recebidos.
 * Nada aqui olha o relógio: o roteiro avança por um agendador injetável (`setImmediate` por padrão).
 */
const stepSchema = z.union([
  z.strictObject({ say: z.string() }),
  z.strictObject({ expectUserAudio: z.number().positive(), text: z.string().optional() }),
  z.strictObject({ toolCall: z.strictObject({ name: z.string(), args: z.unknown() }) }),
  z.strictObject({ fail: z.string() }),
  z.strictObject({ end: z.literal(true) }),
]);
const scriptSchema = z.array(stepSchema);

export type SimulatedStep =
  | { say: string }
  | { expectUserAudio: number; text?: string }
  | { toolCall: { name: string; args?: unknown } }
  | { fail: string }
  | { end: true };
export type SimulatedScript = SimulatedStep[];

export const SIMULATED_PREFIX = "simulated:";

const SAMPLE_RATE = 8000;
const FRAME_SAMPLES = 160; // 20 ms
const MS_PER_CHARACTER = 50;
const TONE_HZ = 200;

let globalScript: SimulatedScript | undefined;

/** Define (ou limpa, com `undefined`) o roteiro usado pelas próximas sessões do motor simulado. */
export function setSimulatedScript(script: SimulatedScript | undefined): void {
  globalScript = script === undefined ? undefined : scriptSchema.parse(script);
}

function resolveScript(config: VoiceSessionConfig): SimulatedScript {
  let script: SimulatedScript;
  if (config.instructions.startsWith(SIMULATED_PREFIX)) {
    script = scriptSchema.parse(JSON.parse(config.instructions.slice(SIMULATED_PREFIX.length)));
  } else {
    script = globalScript ?? [
      { expectUserAudio: 1000, text: "(fala de quem ligou)" },
      { say: "Este é o motor simulado do DeskVoice. Cadastre uma chave de IA para falar com um agente de verdade." },
      { end: true },
    ];
  }
  return config.greeting ? [{ say: config.greeting }, ...script] : script;
}

type Schedule = (task: () => void) => void;
type Waiting = { kind: "audio"; remainingMs: number; text?: string } | { kind: "tool"; id: string };

class SimulatedSession implements VoiceSession {
  private readonly emitter = new SessionEmitter();
  private index = 0;
  private waiting: Waiting | undefined;
  private finished = false;
  private audioMs = 0;
  private toolCalls = 0;
  private tonePhase = 0;

  constructor(
    private readonly script: SimulatedScript,
    private readonly schedule: Schedule,
  ) {
    // Agendado, e não imediato, para quem chamou `connect` ter tempo de registrar os handlers.
    schedule(() => this.advance());
  }

  on<K extends keyof VoiceSessionEvents>(event: K, handler: VoiceSessionEvents[K]): void {
    this.emitter.on(event, handler);
  }

  sendAudio(pcm16_8k: Buffer): void {
    if (this.finished) return;
    const ms = (pcm16_8k.length / 2 / SAMPLE_RATE) * 1000;
    this.audioMs += ms;
    if (this.waiting?.kind !== "audio") return;
    this.waiting.remainingMs -= ms;
    if (this.waiting.remainingMs > 0) return;
    const { text } = this.waiting;
    this.resume(() => {
      if (text) this.emitter.emit("transcript", { speaker: "user", text });
    });
  }

  sendToolResult(id: string, _result: unknown): void {
    if (this.finished) return;
    if (this.waiting?.kind !== "tool" || this.waiting.id !== id) {
      this.emitter.emit("error", new Error(`simulated: resultado para uma chamada de ferramenta que não está pendente: ${id}`));
      return;
    }
    this.resume(() => undefined);
  }

  say(text: string): void {
    this.schedule(() => {
      if (!this.finished) this.speak(text);
    });
  }

  close(): Promise<void> {
    this.finish("client");
    return Promise.resolve();
  }

  private resume(before: () => void): void {
    this.waiting = undefined;
    this.schedule(() => {
      if (this.finished) return;
      before();
      this.advance();
    });
  }

  private advance(): void {
    if (this.finished || this.waiting) return;
    const step = this.script[this.index++];
    if (!step) return;
    if ("say" in step) {
      this.speak(step.say);
      this.schedule(() => this.advance());
    } else if ("expectUserAudio" in step) {
      this.waiting = { kind: "audio", remainingMs: step.expectUserAudio, text: step.text };
    } else if ("toolCall" in step) {
      const id = `sim-${++this.toolCalls}`;
      this.waiting = { kind: "tool", id };
      this.emitter.emit("toolCall", { id, name: step.toolCall.name, args: step.toolCall.args });
    } else if ("fail" in step) {
      this.finish("failed", new Error(step.fail));
    } else {
      this.finish("ended");
    }
  }

  private speak(text: string): void {
    this.emitter.emit("transcript", { speaker: "agent", text });
    const frames = Math.max(1, Math.ceil((text.length * MS_PER_CHARACTER) / 20));
    for (let frame = 0; frame < frames; frame++) {
      const pcm = Buffer.allocUnsafe(FRAME_SAMPLES * 2);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        pcm.writeInt16LE(Math.round(2000 * Math.sin((2 * Math.PI * TONE_HZ * this.tonePhase++) / SAMPLE_RATE)), i * 2);
      }
      this.emitter.emit("audio", pcm);
    }
    this.audioMs += frames * 20;
  }

  private finish(reason: string, error?: Error): void {
    if (this.finished) return;
    this.finished = true;
    this.emitter.emit("usage", { seconds: this.audioMs / 1000 });
    if (error) this.emitter.emit("error", error);
    this.emitter.emit("closed", reason);
  }
}

export function createSimulatedEngine(options: { schedule?: Schedule } = {}): VoiceEngine {
  const schedule = options.schedule ?? ((task) => void setImmediate(task));
  return {
    id: "simulated",
    label: "Simulado (sem chave)",
    provider: "none",
    // Roda neste processo: não chama provedor, então o áudio não sai da instalação.
    processingLocation: { kind: "this-server" },
    keyless: true,
    pricing: { centsPerMinute: 0, checkedOn: "2026-11-10", source: "motor simulado: não chama provedor, não tem custo" },
    async connect(config) {
      return new SimulatedSession(resolveScript(config), schedule);
    },
    async classifyOutcome() {
      // O motor simulado não chama provedor. Classificar aqui seria inventar sobre o cliente: o
      // desfecho honesto de uma instalação sem provedor é `unknown`, e é o que a tela mostra.
      return UNKNOWN_OUTCOME;
    },
    async checkKey() {
      return { result: "not_needed" };
    },
  };
}

export default createSimulatedEngine();
