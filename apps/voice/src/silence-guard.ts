import type { Clock } from "@deskvoice/core";
import type { Schedule } from "./transport";

/**
 * Guarda contra o silêncio (antipadrão 15, desenho em `docs/specs/2026-11-14-ambiente-barulhento.md`).
 *
 * Com ruído de fundo (obra, música, outras vozes), a detecção de fala do provedor não vê o fim do
 * turno de quem ligou, e o agente fica esperando calado. A guarda percebe que quem ligou falou e
 * ficou sem resposta, e age uma vez por turno: primeiro pede ao provedor que dê a fala por encerrada
 * e responda (`closeCallerTurn`); se o agente continuar calado, pede para repetir (`say`).
 *
 * Pura: não conhece banco nem motor. Quem a liga aos eventos da sessão é `call-session.ts`.
 */

/** Sem texto novo de quem ligou e sem resposta do agente, depois do último texto. */
export const AFTER_WORDS_MS = 2500;
/** Houve início de fala, mas nenhum texto e nenhuma resposta (o OpenAI só transcreve depois do fim do turno). */
export const WITHOUT_WORDS_MS = 8000;
/** O turno foi fechado à força e o agente continua calado. */
export const AFTER_CLOSE_MS = 4000;
// Os prazos acima são o ponto de partida do desenho, sem medida: a fatia 5 mede e ajusta.

/** O pedido curto para repetir. O motor fala no idioma do agente. */
export const ASK_TO_REPEAT = "Desculpe, a linha está com bastante barulho. Pode repetir, por favor?";

/** O payload de `caller_unanswered`. */
export interface CallerUnanswered {
  action: "turn_closed" | "asked_to_repeat";
  /**
   * Quanto quem ligou esperou: do último texto novo dele, ou, se o turno não teve texto, do primeiro
   * sinal de fala do turno, até a ação.
   */
  waitedMs: number;
  /** O turno teve texto de quem ligou (e não só detecção de início de fala). */
  words: boolean;
}

export interface SilenceGuardDeps {
  clock: Clock;
  schedule: Schedule;
  closeCallerTurn(): void;
  say(text: string): void;
  /** Cada ação da guarda, para a linha do tempo. */
  acted(report: CallerUnanswered): void;
}

export interface SilenceGuard {
  /** Quem ligou dá sinal de fala (`callerActivity` do motor). */
  callerActivity(signal: { words: boolean }): void;
  /** Chegou áudio do agente: ele respondeu. */
  agentAudio(): void;
  /** Uma ferramenta começou. Enquanto alguma estiver em curso (aprovação em espera inclusive), a guarda não arma. */
  toolStarted(): void;
  toolFinished(): void;
  /** Despedida ou encerramento: a guarda não arma mais nesta chamada. */
  stop(): void;
}

type Phase =
  | { kind: "idle" }
  /** Quem ligou falou e o agente ainda não respondeu. */
  | { kind: "listening" }
  /** O turno foi fechado à força; falta o agente responder. */
  | { kind: "closed" };

export function createSilenceGuard(deps: SilenceGuardDeps): SilenceGuard {
  const { clock, schedule } = deps;
  let phase: Phase = { kind: "idle" };
  let stopped = false;
  let toolsRunning = 0;
  let turnWords = false;
  /** Desde quando quem ligou espera (ver `waitedMs`). */
  let since = 0;
  let cancel: () => void = () => undefined;

  const now = (): number => clock.now().getTime();
  const disarm = (): void => {
    cancel();
    cancel = () => undefined;
    phase = { kind: "idle" };
  };
  const arm = (delayMs: number, fire: () => void): void => {
    cancel();
    cancel = schedule(fire, delayMs);
  };
  const report = (action: CallerUnanswered["action"]): CallerUnanswered => ({ action, waitedMs: Math.max(0, now() - since), words: turnWords });

  function listen(delayMs: number): void {
    phase = { kind: "listening" };
    arm(delayMs, () => {
      phase = { kind: "closed" };
      deps.closeCallerTurn();
      deps.acted(report("turn_closed"));
      arm(AFTER_CLOSE_MS, () => {
        // Depois de pedir para repetir, não insiste: só um sinal novo de quem ligou arma de novo.
        disarm();
        deps.say(ASK_TO_REPEAT);
        deps.acted(report("asked_to_repeat"));
      });
    });
  }

  return {
    callerActivity({ words }) {
      if (stopped || toolsRunning > 0) return;
      if (phase.kind === "idle") {
        turnWords = words;
        since = now();
        listen(words ? AFTER_WORDS_MS : WITHOUT_WORDS_MS);
        return;
      }
      // Detecção de início de fala sem texto não adia o prazo: com ruído contínuo ela nunca pararia.
      if (!words) return;
      // Texto novo: quem ligou ainda fala. O prazo recomeça, e a guarda não fala por cima. Depois do
      // fechamento à força, é a pessoa que seguiu falando: um turno novo começa.
      turnWords = true;
      since = now();
      listen(AFTER_WORDS_MS);
    },
    agentAudio: disarm,
    toolStarted() {
      toolsRunning++;
      disarm();
    },
    toolFinished() {
      toolsRunning = Math.max(0, toolsRunning - 1);
    },
    stop() {
      stopped = true;
      disarm();
    },
  };
}
