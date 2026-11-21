import type { Clock } from "@deskvoice/core";
import type { CallerTurnSource } from "@deskvoice/voice-engine";

/**
 * Latência por turno nos motores diretos (desenho da segunda leva Vapi, DESA-277, item 6).
 *
 * Quanto quem ligou espera entre o fim da vez dele (`callerTurnEnded` do motor) e o primeiro pedaço de
 * áudio do agente entregue ao transporte. Quem mede é a sessão, com o relógio dela, nunca o motor.
 * Cada turno fica só aqui, na memória; a linha do tempo recebe um evento por ligação (`turn_latency`).
 *
 * Não entram na conta:
 *   - a resposta forçada pela guarda contra o silêncio (`closeCallerTurn`), que já tem `caller_unanswered`;
 *   - a fala do próprio sistema (`say`: aviso de gravação, despedida, teto, a fala de uma ferramenta);
 *   - o turno em que uma ferramenta rodou: esse vai em separado, porque mede o webhook e não o motor.
 *
 * Pura: não conhece banco nem motor. Quem a liga aos eventos da sessão é `call-session.ts`.
 */

/** O payload de `turn_latency`. */
export interface TurnLatency {
  /** O motor dos turnos medidos. */
  engine: string;
  /** De onde veio o marco: `transcript` (Gemini) é medida aproximada, para menos. */
  source: CallerTurnSource;
  /** Turnos sem ferramenta. */
  turns: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
  /** Turnos em que uma ferramenta rodou entre o fim da fala e a resposta. */
  toolTurns: number;
  /** `null` sem turno com ferramenta. */
  toolP50Ms: number | null;
}

export interface TurnLatencyMeter {
  /** O motor viu o fim da vez de quem ligou. Vale o último antes da resposta. */
  callerTurnEnded(engine: string, source: CallerTurnSource, toolRunning: boolean): void;
  /** Uma ferramenta começou: o turno aberto, se houver, vai para os turnos com ferramenta. */
  toolStarted(): void;
  /**
   * O próximo áudio do agente é fala pedida pelo sistema (`say`) ou a resposta forçada pela guarda:
   * ele não fecha turno, e o turno aberto se perde.
   */
  notAnswer(): void;
  /** Quem ligou falou por cima: o marco de antes já não é o fim da vez dele. */
  interrupted(): void;
  /** Um pedaço de áudio do agente foi entregue ao transporte. */
  agentAudioDelivered(): void;
  /** O evento da ligação, ou `null` sem turno sem ferramenta medido. */
  summary(): TurnLatency | null;
}

interface Sample {
  engine: string;
  source: CallerTurnSource;
  ms: number;
  withTool: boolean;
}

/** Percentil pelo posto mais próximo: sempre um valor medido, nunca uma interpolação. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

export function createTurnLatencyMeter(clock: Clock): TurnLatencyMeter {
  let open: { at: number; engine: string; source: CallerTurnSource; withTool: boolean } | undefined;
  let skipNext = false;
  const samples: Sample[] = [];

  return {
    callerTurnEnded(engine, source, toolRunning) {
      open = { at: clock.now().getTime(), engine, source, withTool: toolRunning || (open?.withTool ?? false) };
    },
    toolStarted() {
      if (open) open.withTool = true;
    },
    notAnswer() {
      open = undefined;
      skipNext = true;
    },
    interrupted() {
      open = undefined;
    },
    agentAudioDelivered() {
      if (skipNext) {
        // O áudio é o da fala pedida: o marco que chegou enquanto ela não começava também sai.
        skipNext = false;
        open = undefined;
        return;
      }
      if (!open) return;
      samples.push({ engine: open.engine, source: open.source, ms: Math.max(0, clock.now().getTime() - open.at), withTool: open.withTool });
      open = undefined;
    },
    summary() {
      const first = samples[0];
      if (!first) return null;
      // Um número de um motor só: depois de uma passagem para um agente de outro motor, os turnos dele
      // ficam fora, para a medida não misturar provedores (nem a exata com a aproximada).
      const same = samples.filter((sample) => sample.engine === first.engine && sample.source === first.source);
      const plain = same.filter((sample) => !sample.withTool).map((sample) => sample.ms).sort((a, b) => a - b);
      const tool = same.filter((sample) => sample.withTool).map((sample) => sample.ms).sort((a, b) => a - b);
      if (plain.length === 0) return null;
      return {
        engine: first.engine,
        source: first.source,
        turns: plain.length,
        p50Ms: Math.round(percentile(plain, 0.5)),
        p90Ms: Math.round(percentile(plain, 0.9)),
        maxMs: Math.round(plain[plain.length - 1] ?? 0),
        toolTurns: tool.length,
        toolP50Ms: tool.length > 0 ? Math.round(percentile(tool, 0.5)) : null,
      };
    },
  };
}
