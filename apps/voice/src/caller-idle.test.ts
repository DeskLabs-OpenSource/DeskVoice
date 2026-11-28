import { describe, expect, it } from "vitest";
import { IDLE_ASK, IDLE_ASK_AGAIN, IDLE_END_MS, IDLE_FAREWELL, IDLE_FIRST_MS, IDLE_SECOND_MS, createCallerIdleGuard, type CallerIdle } from "./caller-idle";

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

function scene(language = "pt-BR") {
  const time = fakeTime();
  const log: string[] = [];
  const reports: CallerIdle[] = [];
  let silenceArmed = false;
  const guard = createCallerIdleGuard({
    clock: time.clock,
    schedule: time.schedule,
    language,
    say: (text) => log.push(`say:${text}`),
    end: (farewell) => log.push(`end:${farewell}`),
    acted: (report) => reports.push(report),
    silenceArmed: () => silenceArmed,
  });
  return { time, log, reports, guard, setSilenceArmed: (armed: boolean) => (silenceArmed = armed) };
}

describe("guarda do \"ainda está aí?\"", () => {
  it("os prazos do contrato: 10000, 10000 e 8000 ms", () => {
    expect({ IDLE_FIRST_MS, IDLE_SECOND_MS, IDLE_END_MS }).toEqual({ IDLE_FIRST_MS: 10_000, IDLE_SECOND_MS: 10_000, IDLE_END_MS: 8_000 });
  });

  it("I1: os três passos nos prazos, cada um contado do fim do que o agente falou", () => {
    const { time, log, reports, guard } = scene();
    guard.agentAudio(2000);
    time.advance(2000 + IDLE_FIRST_MS - 1);
    expect(log).toEqual([]);
    time.advance(1);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
    expect(reports).toEqual([{ action: "asked", silentMs: IDLE_FIRST_MS }]);

    // O lembrete toca 1,5 s: o segundo prazo conta do fim dele.
    guard.agentAudio(1500);
    time.advance(1500 + IDLE_SECOND_MS - 1);
    expect(log).toHaveLength(1);
    time.advance(1);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`, `say:${IDLE_ASK_AGAIN["pt-BR"]}`]);

    guard.agentAudio(1000);
    time.advance(1000 + IDLE_END_MS - 1);
    expect(log).toHaveLength(2);
    time.advance(1);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`, `say:${IDLE_ASK_AGAIN["pt-BR"]}`, `end:${IDLE_FAREWELL["pt-BR"]}`]);
    expect(reports).toEqual([
      { action: "asked", silentMs: IDLE_FIRST_MS },
      { action: "asked_again", silentMs: IDLE_FIRST_MS + 1500 + IDLE_SECOND_MS },
      { action: "ended", silentMs: IDLE_FIRST_MS + 1500 + IDLE_SECOND_MS + 1000 + IDLE_END_MS },
    ]);
    // Depois do fim, nada mais: nem a despedida que toca arma de novo.
    guard.agentAudio(3000);
    time.advance(60_000);
    expect(log).toHaveLength(3);
    expect(time.pending()).toBe(0);
  });

  it("o lembrete que o motor não chega a falar não trava a guarda: o prazo conta do pedido", () => {
    const { time, log, guard } = scene();
    guard.agentAudio(100);
    time.advance(100 + IDLE_FIRST_MS + IDLE_SECOND_MS + IDLE_END_MS);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`, `say:${IDLE_ASK_AGAIN["pt-BR"]}`, `end:${IDLE_FAREWELL["pt-BR"]}`]);
  });

  it("I2: um sinal de quem ligou entre o primeiro e o segundo lembrete volta tudo ao zero, com ou sem palavras", () => {
    for (const via of ["callerActivity", "agentInterrupted"] as const) {
      const { time, log, reports, guard } = scene();
      guard.agentAudio(1000);
      time.advance(1000 + IDLE_FIRST_MS);
      expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
      guard.agentAudio(1000);
      time.advance(500);
      guard[via]();
      // Calado de novo, sem o agente falar: nada conta (pode ser a pessoa pensando no que dizer).
      time.advance(60_000);
      expect(log, via).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
      expect(time.pending(), via).toBe(0);
      // O agente responde: o relógio recomeça do primeiro passo, e não do segundo.
      guard.agentAudio(1000);
      time.advance(1000 + IDLE_FIRST_MS);
      expect(log, via).toEqual([`say:${IDLE_ASK["pt-BR"]}`, `say:${IDLE_ASK["pt-BR"]}`]);
      expect(reports.map((report) => report.action), via).toEqual(["asked", "asked"]);
      expect(reports[1]?.silentMs, via).toBe(IDLE_FIRST_MS);
    }
  });

  it("I3: com ferramenta em curso (aprovação em espera inclusive) não arma; acabada, o relógio recomeça do zero", () => {
    const { time, log, guard } = scene();
    guard.agentAudio(1000);
    time.advance(5000);
    guard.toolStarted();
    // O agente avisa que vai consultar e espera: a fala dele durante a ferramenta não arma.
    guard.agentAudio(2000);
    time.advance(60_000);
    expect(log).toEqual([]);
    expect(time.pending()).toBe(0);
    guard.toolFinished();
    time.advance(IDLE_FIRST_MS - 1);
    expect(log).toEqual([]);
    time.advance(1);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
  });

  it("I3: duas ferramentas em curso, uma acaba: ainda não arma", () => {
    const { time, log, guard } = scene();
    guard.agentAudio(1000);
    guard.toolStarted();
    guard.toolStarted();
    guard.toolFinished();
    time.advance(60_000);
    expect(log).toEqual([]);
    guard.toolFinished();
    time.advance(IDLE_FIRST_MS);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
  });

  it("I4: com áudio ainda tocando não arma: o pedaço de 3 s que chegou em 100 ms conta do fim dele", () => {
    const { time, log, guard } = scene();
    guard.agentAudio(1500);
    time.advance(50);
    guard.agentAudio(1500);
    time.advance(50);
    // 100 ms depois da chegada, o agente ainda fala por 2,9 s: o primeiro passo só vem depois disso.
    time.advance(2900 + IDLE_FIRST_MS - 1);
    expect(log).toEqual([]);
    time.advance(1);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
  });

  it("não arma antes de o agente falar (a saudação ainda não tocou)", () => {
    const { time, log, guard } = scene();
    time.advance(60_000);
    guard.toolFinished();
    time.advance(60_000);
    expect(log).toEqual([]);
    expect(time.pending()).toBe(0);
  });

  it("I5: depois de stop não faz nada", () => {
    const { time, log, reports, guard } = scene();
    guard.agentAudio(1000);
    time.advance(1000 + IDLE_FIRST_MS);
    guard.stop();
    guard.agentAudio(1000);
    guard.toolStarted();
    guard.toolFinished();
    time.advance(120_000);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
    expect(reports).toHaveLength(1);
    expect(time.pending()).toBe(0);
  });

  it("I6: com a guarda contra o silêncio armada não pergunta, e o próximo áudio do agente arma de novo", () => {
    const { time, log, guard, setSilenceArmed } = scene();
    guard.agentAudio(1000);
    setSilenceArmed(true);
    time.advance(60_000);
    expect(log).toEqual([]);
    expect(time.pending()).toBe(0);
    setSilenceArmed(false);
    guard.agentAudio(1000);
    time.advance(1000 + IDLE_FIRST_MS);
    expect(log).toEqual([`say:${IDLE_ASK["pt-BR"]}`]);
  });
});

describe("as falas do \"ainda está aí?\" no idioma do agente (DESA-517)", () => {
  const silentToTheEnd = (language: string): string[] => {
    const { time, log, guard } = scene(language);
    guard.agentAudio(0);
    time.advance(IDLE_FIRST_MS);
    time.advance(IDLE_SECOND_MS);
    time.advance(IDLE_END_MS);
    return log;
  };

  it("en-US e es-MX falam as três no idioma; pt-BR e um idioma que as falas não têm (fr) falam o texto de sempre", () => {
    expect(silentToTheEnd("en-US")).toEqual(["say:Are you still there?", "say:If you're still on the line, just say something.", "end:Since I can't hear you, I'm going to end the call. Feel free to call back anytime."]);
    expect(silentToTheEnd("es-MX")).toEqual([`say:${IDLE_ASK.es}`, `say:${IDLE_ASK_AGAIN.es}`, `end:${IDLE_FAREWELL.es}`]);
    const today = ["say:Você ainda está aí?", "say:Se ainda estiver na linha, é só falar.", "end:Como não estou ouvindo você, vou encerrar. Pode ligar de novo quando quiser."];
    expect(silentToTheEnd("pt-BR")).toEqual(today);
    expect(silentToTheEnd("fr")).toEqual(today);
    expect(silentToTheEnd("")).toEqual(today);
  });
});
