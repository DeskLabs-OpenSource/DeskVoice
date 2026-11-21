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
 *   - o turno em que a guarda contra o silêncio agiu (o motor fechou a vez à força, ou a guarda pediu
 *     para repetir), que já tem `caller_unanswered`: ele sai sem valor e é contado em `guardTurns`,
 *     uma vez por turno, haja marco ou não (sem marco, com o motor da perna). Quando o motor diz
 *     que não agiu (`closeCallerTurn` devolveu `false`: o provedor já tinha fechado a vez e só está
 *     lento), o turno segue e conta normalmente;
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
  /** Turnos sem ferramenta medidos. */
  turns: number;
  /** `null` com `turns: 0` (só há turnos tirados pela guarda). */
  p50Ms: number | null;
  p90Ms: number | null;
  maxMs: number | null;
  /** Turnos em que uma ferramenta rodou entre o fim da fala e a resposta. */
  toolTurns: number;
  /** `null` sem turno com ferramenta. */
  toolP50Ms: number | null;
  /** Turnos de quem ligou que saíram da conta porque a guarda contra o silêncio agiu: sem valor. */
  guardTurns: number;
}

export interface TurnLatencyMeter {
  /** O motor viu o fim da vez de quem ligou. Vale o último antes da resposta. */
  callerTurnEnded(engine: string, source: CallerTurnSource, toolRunning: boolean): void;
  /** Uma ferramenta começou: o turno aberto, se houver, vai para os turnos com ferramenta. */
  toolStarted(): void;
  /**
   * O próximo áudio do agente é fala pedida pelo sistema (`say`): ele não fecha turno, e o turno
   * aberto se perde, sem contar em lugar nenhum.
   */
  notAnswer(): void;
  /**
   * A guarda contra o silêncio agiu: o motor fechou a vez à força, ou a guarda pediu para repetir.
   * Como `notAnswer`, e o turno de quem ligou vai para `guardTurns`, uma vez só, mesmo com o
   * fechamento e o pedido no mesmo turno. Quem chama só chama quando o motor agiu.
   *
   * `turn` é o motor da perna em curso e o marco que ele emite (`VoiceEngine.callerTurnSource`). Com
   * marco aberto, o turno conta com o motor e o `source` do marco. Sem marco (o provedor não viu o fim
   * da fala, como no barulho), conta na hora com os de `turn`; sem `source` declarado, não conta. O
   * marco que chegar depois, antes de o agente falar, é o mesmo turno e não soma de novo.
   */
  guardActed(turn: { engine: string; source: CallerTurnSource | undefined }): void;
  /** Quem ligou falou por cima: o marco de antes já não é o fim da vez dele. */
  interrupted(): void;
  /** Um pedaço de áudio do agente foi entregue ao transporte. */
  agentAudioDelivered(): void;
  /** O evento da ligação, ou `null` sem turno sem ferramenta medido e sem turno tirado pela guarda. */
  summary(): TurnLatency | null;
}

/** Um turno de quem ligou, na ordem: medido (com ou sem ferramenta) ou tirado pela guarda, sem valor. */
type Sample = { engine: string; source: CallerTurnSource } & ({ kind: "plain" | "tool"; ms: number } | { kind: "guard" });

/** Percentil pelo posto mais próximo: sempre um valor medido, nunca uma interpolação. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

export function createTurnLatencyMeter(clock: Clock): TurnLatencyMeter {
  let open: { at: number; engine: string; source: CallerTurnSource; withTool: boolean } | undefined;
  let skipNext = false;
  /**
   * A guarda agiu e o agente ainda não falou depois: é o mesmo turno de quem ligou. `counted` diz se
   * ele já entrou em `guardTurns` (na hora em que a guarda agiu, ou no marco que chegou depois, quando
   * o motor não declara o `source`).
   */
  let guarded: { counted: boolean } | undefined;
  const samples: Sample[] = [];

  const countGuarded = (turn: { engine: string; source: CallerTurnSource }): void => {
    if (!guarded || guarded.counted) return;
    guarded.counted = true;
    samples.push({ engine: turn.engine, source: turn.source, kind: "guard" });
  };

  return {
    callerTurnEnded(engine, source, toolRunning) {
      // Marco que chega depois de a guarda agir, antes de o agente falar (a transcrição atrasada do
      // Gemini): é o mesmo turno, já fora da conta.
      if (guarded) {
        countGuarded({ engine, source });
        return;
      }
      open = { at: clock.now().getTime(), engine, source, withTool: toolRunning || (open?.withTool ?? false) };
    },
    toolStarted() {
      if (open) open.withTool = true;
    },
    notAnswer() {
      open = undefined;
      skipNext = true;
    },
    guardActed(turn) {
      guarded ??= { counted: false };
      if (open) countGuarded(open);
      else if (turn.source) countGuarded({ engine: turn.engine, source: turn.source });
      open = undefined;
      skipNext = true;
    },
    interrupted() {
      open = undefined;
    },
    agentAudioDelivered() {
      // O agente falou: o turno que a guarda tirou acabou, e o próximo marco é de um turno novo.
      guarded = undefined;
      if (skipNext) {
        // O áudio é o da fala pedida: o marco que chegou enquanto ela não começava também sai.
        skipNext = false;
        open = undefined;
        return;
      }
      if (!open) return;
      samples.push({ engine: open.engine, source: open.source, kind: open.withTool ? "tool" : "plain", ms: Math.max(0, clock.now().getTime() - open.at) });
      open = undefined;
    },
    summary() {
      const first = samples[0];
      if (!first) return null;
      // Um número de um motor só: depois de uma passagem para um agente de outro motor, os turnos dele
      // ficam fora, para a medida não misturar provedores (nem a exata com a aproximada).
      const same = samples.filter((sample) => sample.engine === first.engine && sample.source === first.source);
      const msOf = (kind: "plain" | "tool"): number[] =>
        same.flatMap((sample) => (sample.kind === kind ? [sample.ms] : [])).sort((a, b) => a - b);
      const plain = msOf("plain");
      const tool = msOf("tool");
      const guardTurns = same.filter((sample) => sample.kind === "guard").length;
      // Só turnos com ferramenta: nenhum evento. Só turnos tirados pela guarda: o evento sai com
      // `turns: 0`, para a ligação toda lenta não sumir da linha do tempo.
      if (plain.length === 0 && guardTurns === 0) return null;
      const measured = plain.length > 0;
      return {
        engine: first.engine,
        source: first.source,
        turns: plain.length,
        p50Ms: measured ? Math.round(percentile(plain, 0.5)) : null,
        p90Ms: measured ? Math.round(percentile(plain, 0.9)) : null,
        maxMs: measured ? Math.round(plain[plain.length - 1] ?? 0) : null,
        toolTurns: tool.length,
        toolP50Ms: tool.length > 0 ? Math.round(percentile(tool, 0.5)) : null,
        guardTurns,
      };
    },
  };
}
