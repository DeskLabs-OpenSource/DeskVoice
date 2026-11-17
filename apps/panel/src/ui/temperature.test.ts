import { describe, expect, it } from "vitest";
import { lastTemperature } from "./temperature";

const event = (id: string, kind: string, payload: Record<string, unknown>) => ({ id, kind, at: `2026-11-17T12:00:0${id}.000Z`, payload });

describe("o selo de temperatura do detalhe da chamada", () => {
  it("é a última temperatura lida a tempo", () => {
    expect(
      lastTemperature([
        event("1", "analyst_read", { onTime: true, temperature: { score: 2, confidence: 0.9 } }),
        event("2", "transcript_user", { text: "pode ser" }),
        event("3", "analyst_read", { onTime: true, temperature: { score: 4, confidence: 0.8 } }),
        // A leitura fora do prazo não conta, mesmo que trouxesse um número.
        event("4", "analyst_read", { onTime: false, failure: "late", temperature: { score: 1, confidence: 0.9 } }),
        event("5", "analyst_read", { onTime: true, temperature: null }),
      ]),
    ).toEqual({ score: 4, at: "2026-11-17T12:00:03.000Z" });
  });

  it("sem analista, com a temperatura desligada ou sem leitura a tempo, não há selo", () => {
    expect(lastTemperature([])).toBeNull();
    expect(lastTemperature([event("1", "transcript_user", { text: "oi" })])).toBeNull();
    expect(lastTemperature([event("1", "analyst_read", { onTime: true, temperature: null })])).toBeNull();
    expect(lastTemperature([event("1", "analyst_read", { onTime: false, failure: "key_missing" })])).toBeNull();
  });
});
