import { describe, expect, it } from "vitest";
import { speechFilterQuestions } from "../speech-filter";
import simulated, { createSimulatedDecider } from "./simulated";

const input = { state: "Pessoa: alô", questions: speechFilterQuestions("alô", ["Melgaço"]) };

describe("modelo de decisão simulado", () => {
  it("o padrão responde o neutro, sem custo: fala de quem liga, leitura nenhum", async () => {
    expect(await simulated.decide("", input)).toMatchObject({
      ok: true,
      costMicrocents: 0,
      answers: { background: { kind: "noul", value: 1 }, finished: { kind: "noul", value: 0.5 }, reading: { kind: "choice", choice: "nenhum" } },
    });
  });

  it("a demora passa do prazo: volta late, e a resposta que viria depois não é entregue", async () => {
    const fns = new Map<number, () => void>();
    const schedule = (fn: () => void, delayMs: number) => (fns.set(delayMs, fn), () => fns.delete(delayMs));
    const decider = createSimulatedDecider(() => ({ answers: {}, delayMs: 5000 }));
    const pending = decider.decide("", input, { timeoutMs: 1000, schedule });
    expect([...fns.keys()]).toEqual([1000]);
    fns.get(1000)?.();
    expect(await pending).toMatchObject({ ok: false, failure: "late" });
  });
});
