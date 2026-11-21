import { describe, expect, it } from "vitest";
import { fakeClock } from "./testing/db";
import { createTurnLatencyMeter } from "./turn-latency";

describe("latência por turno: a conta", () => {
  it("percentil pelo posto mais próximo: com 10 turnos de 100 a 1000 ms, p50 500, p90 900, máximo 1000", () => {
    const clock = fakeClock();
    const meter = createTurnLatencyMeter(clock);
    for (const ms of [1000, 100, 900, 200, 800, 300, 700, 400, 600, 500]) {
      meter.callerTurnEnded("openai-realtime", "vad", false);
      clock.advance(ms);
      meter.agentAudioDelivered();
    }
    expect(meter.summary()).toEqual({ engine: "openai-realtime", source: "vad", turns: 10, p50Ms: 500, p90Ms: 900, maxMs: 1000, toolTurns: 0, toolP50Ms: null, guardTurns: 0 });
  });

  it("um número de um motor só: depois de uma passagem para outro motor, os turnos dele ficam fora", () => {
    const clock = fakeClock();
    const meter = createTurnLatencyMeter(clock);
    meter.callerTurnEnded("openai-realtime", "vad", false);
    clock.advance(400);
    meter.agentAudioDelivered();
    meter.callerTurnEnded("gemini-live", "transcript", false);
    clock.advance(100);
    meter.agentAudioDelivered();
    expect(meter.summary()).toMatchObject({ engine: "openai-realtime", source: "vad", turns: 1, p50Ms: 400 });
  });

  it("só turnos com ferramenta: nenhum evento", () => {
    const clock = fakeClock();
    const meter = createTurnLatencyMeter(clock);
    meter.callerTurnEnded("openai-realtime", "vad", true);
    clock.advance(2000);
    meter.agentAudioDelivered();
    expect(meter.summary()).toBeNull();
  });

  it("a guarda agiu sem marco aberto: conta 1 na hora com o motor e o source da perna; sem source declarado, não conta; o marco depois não soma", () => {
    const clock = fakeClock();
    const meter = createTurnLatencyMeter(clock);
    // Barulho: o provedor não viu o fim da fala, e a guarda fecha a vez sem marco nenhum.
    meter.guardActed({ engine: "openai-realtime", source: "vad" });
    expect(meter.summary()).toMatchObject({ engine: "openai-realtime", source: "vad", turns: 0, guardTurns: 1 });
    // O `speech_stopped` que chega depois do `commit`, antes da resposta: o mesmo turno.
    meter.callerTurnEnded("openai-realtime", "vad", false);
    clock.advance(1000);
    meter.guardActed({ engine: "openai-realtime", source: "vad" });
    meter.agentAudioDelivered();
    expect(meter.summary()).toMatchObject({ turns: 0, guardTurns: 1 });

    // Motor que não declara o marco (o simulado): a vez fechada sem marco não conta.
    const bare = createTurnLatencyMeter(clock);
    bare.guardActed({ engine: "simulated", source: undefined });
    bare.agentAudioDelivered();
    expect(bare.summary()).toBeNull();
  });

  it("a guarda agiu: o turno sai sem valor e conta uma vez em guardTurns; só com eles, o evento sai com turns 0 e os máximos null", () => {
    const clock = fakeClock();
    const meter = createTurnLatencyMeter(clock);
    const gemini = { engine: "gemini-live", source: "transcript" } as const;
    meter.callerTurnEnded("gemini-live", "transcript", false);
    clock.advance(2500);
    // Fechamento e pedido para repetir no mesmo turno, com a transcrição atrasada no meio.
    meter.guardActed(gemini);
    meter.callerTurnEnded("gemini-live", "transcript", false);
    clock.advance(4000);
    meter.guardActed(gemini);
    clock.advance(500);
    meter.agentAudioDelivered();
    expect(meter.summary()).toEqual({ engine: "gemini-live", source: "transcript", turns: 0, p50Ms: null, p90Ms: null, maxMs: null, toolTurns: 0, toolP50Ms: null, guardTurns: 1 });
    // Depois da fala do agente, o próximo turno é outro.
    meter.callerTurnEnded("gemini-live", "transcript", false);
    meter.guardActed(gemini);
    meter.agentAudioDelivered();
    meter.callerTurnEnded("gemini-live", "transcript", false);
    clock.advance(600);
    meter.agentAudioDelivered();
    expect(meter.summary()).toMatchObject({ turns: 1, maxMs: 600, guardTurns: 2 });
  });

  it("a fala do sistema (notAnswer) tira o turno sem contar em guardTurns", () => {
    const clock = fakeClock();
    const meter = createTurnLatencyMeter(clock);
    meter.callerTurnEnded("openai-realtime", "vad", false);
    meter.notAnswer();
    meter.agentAudioDelivered();
    expect(meter.summary()).toBeNull();
  });
});
