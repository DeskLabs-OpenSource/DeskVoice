import { describe, expect, it } from "vitest";
import { AFTER_CLOSE_MS, AFTER_WORDS_MS, ASK_TO_REPEAT, WITHOUT_WORDS_MS, createSilenceGuard, type CallerUnanswered } from "./silence-guard";

/** Relógio e agendador falsos, juntos: `advance` anda o tempo e dispara o que venceu, na ordem. */
function fakeTime() {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void }> = [];
  return {
    clock: { now: () => new Date(now) },
    schedule(fn: () => void, delayMs: number) {
      const timer = { at: now + delayMs, fn };
      timers.push(timer);
      return () => void (timers = timers.filter((candidate) => candidate !== timer));
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((timer) => timer !== next);
        now = next.at;
        next.fn();
      }
      now = end;
    },
    pending: () => timers.length,
  };
}

function scene() {
  const time = fakeTime();
  const log: string[] = [];
  const reports: CallerUnanswered[] = [];
  const guard = createSilenceGuard({
    clock: time.clock,
    schedule: time.schedule,
    closeCallerTurn: () => log.push("close"),
    say: (text) => log.push(`say:${text}`),
    acted: (report) => reports.push(report),
  });
  return { time, log, reports, guard };
}

describe("guarda contra o silêncio", () => {
  it("quem ligou fala e o agente fica calado: fecha o turno no prazo e, calado ainda, pede para repetir", () => {
    const { time, log, reports, guard } = scene();
    // Fala com texto por 3 s; depois o ruído segue (início de fala sem texto) e ninguém responde.
    for (let second = 0; second < 3; second++) {
      guard.callerActivity({ words: true });
      time.advance(1000);
    }
    guard.callerActivity({ words: false });
    // O último texto foi em t = 2 s: o turno fecha em 2 s + AFTER_WORDS_MS, nem antes nem depois.
    time.advance(2000 + AFTER_WORDS_MS - 3000 - 1);
    expect(log).toEqual([]);
    time.advance(1);
    expect(log).toEqual(["close"]);
    expect(reports).toEqual([{ action: "turn_closed", waitedMs: AFTER_WORDS_MS, words: true }]);

    time.advance(AFTER_CLOSE_MS - 1);
    expect(log).toEqual(["close"]);
    time.advance(1);
    expect(log).toEqual(["close", `say:${ASK_TO_REPEAT}`]);
    expect(reports[1]).toEqual({ action: "asked_to_repeat", waitedMs: AFTER_WORDS_MS + AFTER_CLOSE_MS, words: true });
    expect(time.pending()).toBe(0);
  });

  it("só início de fala, sem texto (o caso do OpenAI): espera WITHOUT_WORDS_MS, e o sinal repetido não adia", () => {
    const { time, log, reports, guard } = scene();
    guard.callerActivity({ words: false });
    for (let i = 0; i < 7; i++) {
      time.advance(1000);
      guard.callerActivity({ words: false });
    }
    time.advance(WITHOUT_WORDS_MS - 7000 - 1);
    expect(log).toEqual([]);
    time.advance(1);
    expect(log).toEqual(["close"]);
    expect(reports).toEqual([{ action: "turn_closed", waitedMs: WITHOUT_WORDS_MS, words: false }]);
  });

  it("o agente responde depois do fechamento: não pede para repetir", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    time.advance(AFTER_WORDS_MS);
    expect(log).toEqual(["close"]);
    guard.agentAudio();
    time.advance(60_000);
    expect(log).toEqual(["close"]);
  });

  it("texto a cada segundo por 20 s: a guarda não age, porque quem ligou ainda fala", () => {
    const { time, log, guard } = scene();
    for (let second = 0; second < 20; second++) {
      guard.callerActivity({ words: true });
      time.advance(1000);
    }
    expect(log).toEqual([]);
  });

  it("áudio do agente desarma", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    time.advance(AFTER_WORDS_MS - 1);
    guard.agentAudio();
    time.advance(60_000);
    expect(log).toEqual([]);
    expect(time.pending()).toBe(0);
  });

  it("ferramenta em curso desarma, e a fala de quem ligou durante a espera não arma", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    guard.toolStarted();
    time.advance(60_000);
    // Uma aprovação em espera: quem ligou pergunta "alô?" e o agente espera a resposta da pessoa.
    guard.callerActivity({ words: true });
    guard.callerActivity({ words: false });
    time.advance(60_000);
    expect(log).toEqual([]);
    expect(time.pending()).toBe(0);

    guard.toolFinished();
    guard.callerActivity({ words: true });
    time.advance(AFTER_WORDS_MS);
    expect(log).toEqual(["close"]);
  });

  it("ferramenta que começa depois do fechamento cancela o pedido para repetir", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    time.advance(AFTER_WORDS_MS);
    guard.toolStarted();
    time.advance(60_000);
    expect(log).toEqual(["close"]);
  });

  it("encerramento desarma para sempre", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    guard.stop();
    time.advance(60_000);
    guard.callerActivity({ words: true });
    time.advance(60_000);
    expect(log).toEqual([]);
    expect(time.pending()).toBe(0);
  });

  it("age no máximo uma vez por turno, e nunca fala duas vezes sem quem ligou dizer algo entre uma fala e outra", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    time.advance(AFTER_WORDS_MS + AFTER_CLOSE_MS);
    expect(log).toEqual(["close", `say:${ASK_TO_REPEAT}`]);
    // Nada de quem ligou: a guarda não insiste, por mais que o silêncio dure.
    time.advance(10 * 60_000);
    expect(log).toHaveLength(2);
    expect(time.pending()).toBe(0);

    // Só um sinal novo de quem ligou arma de novo.
    guard.callerActivity({ words: false });
    time.advance(WITHOUT_WORDS_MS + AFTER_CLOSE_MS);
    expect(log).toEqual(["close", `say:${ASK_TO_REPEAT}`, "close", `say:${ASK_TO_REPEAT}`]);
  });

  it("início de fala sem texto depois do fechamento não impede o pedido para repetir", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    time.advance(AFTER_WORDS_MS);
    guard.callerActivity({ words: false });
    time.advance(AFTER_CLOSE_MS);
    expect(log).toEqual(["close", `say:${ASK_TO_REPEAT}`]);
  });

  it("texto novo depois do fechamento: quem ligou seguiu falando, e a guarda não fala por cima", () => {
    const { time, log, guard } = scene();
    guard.callerActivity({ words: true });
    time.advance(AFTER_WORDS_MS);
    expect(log).toEqual(["close"]);
    for (let second = 0; second < 10; second++) {
      time.advance(1000);
      guard.callerActivity({ words: true });
    }
    expect(log).toEqual(["close"]);
    // Parou de falar: o turno novo segue as mesmas regras.
    time.advance(AFTER_WORDS_MS);
    expect(log).toEqual(["close", "close"]);
  });
});
