import { countCharacters, speechUsageOf } from "../synthesis";
import type { Speech, SpeechEvents, SpeechSynthesizer, SynthesizerPricing } from "../types";

/**
 * Voz simulada do pipeline: um tom curto por caractere, sem rede e sem chave. Serve aos testes
 * das fatias 3 a 5 e à demonstração sem chave.
 *
 * Cada caractere enviado vira `MS_PER_CHARACTER` de um tom de `TONE_HZ`, em PCM16 mono 8 kHz. O
 * áudio sai pelo agendador (`setImmediate` por padrão), nunca pelo relógio. O `usage` sai no envio,
 * como na voz real, com custo zero: o simulado não chama provedor.
 */
const SAMPLE_RATE = 8000;
const MS_PER_CHARACTER = 10;
const TONE_HZ = 300;
const AMPLITUDE = 3000;
const MODEL = "simulated";

const PRICING: SynthesizerPricing = { centsPerThousandCharacters: 0, checkedOn: "2026-11-17", source: "voz simulada: não chama provedor, não tem custo" };

/** O tom de `characters` caracteres, em PCM16 mono 8 kHz little-endian. */
export function toneFor(characters: number): Buffer {
  const samples = Math.round((characters * MS_PER_CHARACTER * SAMPLE_RATE) / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(AMPLITUDE * Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE)), i * 2);
  return pcm;
}

type Schedule = (task: () => void) => void;

class SimulatedSpeech implements Speech {
  private readonly handlers = new Map<keyof SpeechEvents, Array<(...args: unknown[]) => void>>();
  private state: "open" | "ending" | "done" | "cancelled" = "open";
  /** Texto enviado e ainda sem áudio: sai no `flush`, no `end`, ou ao passar de uma palavra. */
  private buffered = "";
  private spoken = 0;

  constructor(private readonly schedule: Schedule) {}

  on<K extends keyof SpeechEvents>(event: K, handler: SpeechEvents[K]): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as (...args: unknown[]) => void);
    this.handlers.set(event, list);
  }

  private emit<K extends keyof SpeechEvents>(event: K, ...args: Parameters<SpeechEvents[K]>): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  push(text: string, options: { flush?: boolean } = {}): void {
    if (this.state !== "open") return;
    const characters = countCharacters(text);
    if (characters > 0) this.emit("usage", speechUsageOf(PRICING, characters));
    this.buffered += text;
    if (options.flush === true || /\s$/.test(this.buffered)) this.generate();
  }

  end(): void {
    if (this.state !== "open") return;
    this.state = "ending";
    this.generate();
    // O agendador roda em ordem: isto roda depois do último áudio agendado.
    this.schedule(() => {
      if (this.state !== "ending") return;
      this.state = "done";
      this.emit("done");
    });
  }

  cancel(): void {
    if (this.state === "open" || this.state === "ending") this.state = "cancelled";
    this.buffered = "";
  }

  private generate(): void {
    const text = this.buffered;
    this.buffered = "";
    const characters = countCharacters(text);
    if (characters === 0) return;
    this.schedule(() => {
      if (this.state !== "open" && this.state !== "ending") return;
      this.emit("audio", toneFor(characters));
      this.spoken += characters;
      this.emit("spoken", this.spoken);
    });
  }
}

/** Uma voz simulada com o agendador dado; a peça da pasta usa `setImmediate`. */
export function createSimulatedSynthesizer(schedule: Schedule = (task) => setImmediate(task)): SpeechSynthesizer {
  return {
    id: "simulated",
    label: "Voz simulada",
    provider: "none",
    processingLocation: { kind: "this-server" },
    defaultModel: MODEL,
    pricing: PRICING,
    pricingOf: (model) => (model === MODEL ? PRICING : undefined),
    keyless: true,
    async listVoices() {
      return { ok: true, voices: [{ id: "simulated", name: "Tom simulado", languages: [] }] };
    },
    async checkKey() {
      return { result: "not_needed" };
    },
    async speak() {
      return new SimulatedSpeech(schedule);
    },
  };
}

export default createSimulatedSynthesizer();
