import { spokenLanguageOf, type Clock, type SpokenLanguage } from "@deskvoice/core";
import type { Schedule } from "./transport";

/**
 * "Ainda está aí?" (item 9 da segunda leva Vapi, desenho `segunda-leva` da DESA-277).
 *
 * O caso oposto ao da guarda contra o silêncio (`silence-guard.ts`): o agente terminou de falar e
 * quem ligou ficou calado (afastou o telefone, a ligação ficou aberta no bolso, a secretária
 * eletrônica terminou). Sem esta guarda, o agente esperava até a duração máxima, pagando o motor.
 * As duas guardas ficam separadas: têm gatilhos opostos, e juntá-las misturaria dois relógios.
 *
 * O relógio conta do fim do áudio do agente que já chegou (a mesma conta de `agentSpeakingUntil` da
 * guarda contra o silêncio) e não conta enquanto o agente espera algo que não depende de quem
 * ligou: ferramenta em curso (aprovação em espera inclusive), o próprio agente falando, a guarda
 * contra o silêncio armada. A transferência para a equipe é uma ferramenta (`transfer_to_human`) e,
 * depois dela, a sessão encerra, o que para a guarda (`stop`); quem abrir um estado de espera da
 * transferência sem encerrar a sessão para a guarda ao entrar nele (`stop`), e o trecho de volta
 * começa com uma guarda nova, como na passagem entre agentes.
 *
 * Pura: não conhece banco nem motor. Quem a liga aos eventos da sessão é `call-session.ts`.
 */

/** Calado depois do fim da fala do agente: primeiro lembrete. */
export const IDLE_FIRST_MS = 10_000;
/** Calado depois do fim do primeiro lembrete: segundo lembrete. */
export const IDLE_SECOND_MS = 10_000;
/** Calado depois do fim do segundo lembrete: despedida e fim da ligação. */
export const IDLE_END_MS = 8_000;
// Os prazos acima são o ponto de partida do desenho, sem medida com gente (28 s no total, para não
// derrubar quem só estava pensando). Se o teste com pessoas mostrar que são curtos, viram configuração.

/**
 * Os textos falados, no idioma do agente do trecho (`language` das dependências, escolhido por
 * `spokenLanguageOf`, como `HANDOFF_GREETINGS`). Vão já no idioma: o motor pipeline entrega o texto
 * à voz como veio, sem cérebro no meio que traduza (DESA-517).
 */
export const IDLE_ASK: Readonly<Record<SpokenLanguage, string>> = {
  "pt-BR": "Você ainda está aí?",
  en: "Are you still there?",
  es: "¿Sigue ahí?",
};
export const IDLE_ASK_AGAIN: Readonly<Record<SpokenLanguage, string>> = {
  "pt-BR": "Se ainda estiver na linha, é só falar.",
  en: "If you're still on the line, just say something.",
  es: "Si todavía está en la línea, solo hable.",
};
export const IDLE_FAREWELL: Readonly<Record<SpokenLanguage, string>> = {
  "pt-BR": "Como não estou ouvindo você, vou encerrar. Pode ligar de novo quando quiser.",
  en: "Since I can't hear you, I'm going to end the call. Feel free to call back anytime.",
  es: "Como no lo escucho, voy a terminar la llamada. Puede volver a llamar cuando quiera.",
};

/** O `endReason` da ligação que a guarda encerrou. */
export const CALLER_SILENT = "caller_silent";

/** O payload de `caller_idle`. */
export interface CallerIdle {
  action: "asked" | "asked_again" | "ended";
  /** Quanto quem ligou está calado: do fim da fala do agente que armou a guarda até a ação. */
  silentMs: number;
}

export interface CallerIdleDeps {
  clock: Clock;
  schedule: Schedule;
  /** O idioma do agente do trecho, como gravado (`en-US`): os textos saem nele. */
  language: string;
  say(text: string): void;
  /** A despedida e o fim da ligação, com `endReason: "caller_silent"`. */
  end(farewell: string): void;
  /** Cada ação da guarda, para a linha do tempo. */
  acted(report: CallerIdle): void;
  /** A guarda contra o silêncio está armada: quem ligou falou e espera resposta, e esta guarda não age. */
  silenceArmed(): boolean;
}

export interface CallerIdleGuard {
  /** Quem ligou dá sinal de fala, com ou sem palavras: volta tudo ao zero, e só o próximo áudio do agente arma. */
  callerActivity(): void;
  /** Chegou áudio do agente: `durationMs` é quanto o pedaço leva para tocar. O relógio conta do fim dele. */
  agentAudio(durationMs: number): void;
  /** Quem ligou falou por cima do agente: é sinal de quem ligou, e volta tudo ao zero. */
  agentInterrupted(): void;
  /** Uma ferramenta começou. Enquanto alguma estiver em curso (aprovação em espera inclusive), o relógio não conta. */
  toolStarted(): void;
  /** Acabada a última ferramenta, o relógio recomeça do zero, do fim da fala do agente. */
  toolFinished(): void;
  /** Despedida, encerramento ou passagem: a guarda não age mais nesta sessão. */
  stop(): void;
}

export function createCallerIdleGuard(deps: CallerIdleDeps): CallerIdleGuard {
  const { clock, schedule } = deps;
  const spoken = spokenLanguageOf(deps.language);
  let stopped = false;
  let toolsRunning = 0;
  /** Quantos lembretes já foram feitos desde o último sinal de quem ligou. */
  let step: 0 | 1 | 2 = 0;
  /** O agente falou depois do último sinal de quem ligou: só assim a guarda tem o que esperar. */
  let agentSpoke = false;
  /** Até quando o áudio do agente que já chegou ainda está tocando. */
  let agentSpeakingUntil = 0;
  /** Desde quando quem ligou está calado (ver `silentMs`). */
  let quietSince = 0;
  let cancel: () => void = () => undefined;

  const now = (): number => clock.now().getTime();
  const disarm = (): void => {
    cancel();
    cancel = () => undefined;
  };
  const report = (action: CallerIdle["action"]): CallerIdle => ({ action, silentMs: Math.max(0, now() - quietSince) });

  /** Arma o próximo passo, contado do fim do que ainda toca, se nada segura o relógio. */
  function plan(): void {
    disarm();
    if (stopped || toolsRunning > 0 || !agentSpoke) return;
    const playing = Math.max(0, agentSpeakingUntil - now());
    if (step === 0) quietSince = now() + playing;
    cancel = schedule(fire, playing + (step === 0 ? IDLE_FIRST_MS : step === 1 ? IDLE_SECOND_MS : IDLE_END_MS));
  }

  function fire(): void {
    cancel = () => undefined;
    if (stopped || toolsRunning > 0) return;
    // Quem ligou falou e a outra guarda cuida dele; o áudio que ela pedir arma esta de novo.
    if (deps.silenceArmed()) return;
    if (step === 0) {
      step = 1;
      deps.acted(report("asked"));
      deps.say(IDLE_ASK[spoken]);
      return plan();
    }
    if (step === 1) {
      step = 2;
      deps.acted(report("asked_again"));
      deps.say(IDLE_ASK_AGAIN[spoken]);
      return plan();
    }
    stopped = true;
    deps.acted(report("ended"));
    deps.end(IDLE_FAREWELL[spoken]);
  }

  /** Sinal de quem ligou: volta ao zero, e a guarda espera a próxima fala do agente. */
  function heard(): void {
    step = 0;
    agentSpoke = false;
    disarm();
  }

  return {
    callerActivity: heard,
    agentAudio(durationMs) {
      agentSpeakingUntil = Math.max(now(), agentSpeakingUntil) + durationMs;
      agentSpoke = true;
      plan();
    },
    agentInterrupted() {
      agentSpeakingUntil = 0;
      heard();
    },
    toolStarted() {
      toolsRunning++;
      step = 0;
      disarm();
    },
    toolFinished() {
      toolsRunning = Math.max(0, toolsRunning - 1);
      plan();
    },
    stop() {
      stopped = true;
      disarm();
    },
  };
}
