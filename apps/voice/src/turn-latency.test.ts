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
    expect(meter.summary()).toEqual({ engine: "openai-realtime", source: "vad", turns: 10, p50Ms: 500, p90Ms: 900, maxMs: 1000, toolTurns: 0, toolP50Ms: null });
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
});
