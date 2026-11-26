// A regra do preço do cérebro é uma só (fatia 5b-1): o modelo que a tela do agente oferece
// (`pricedBrainModels`) é exatamente o que a gravação e a abertura aceitam (`pricePipeline`).
import { describe, expect, it } from "vitest";
import { brainPriceOf, pricedBrainModels, pricePipeline, readConsent } from "./pipeline-choice";

const PRICE = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "https://exemplo.invalid/precos", checkedOn: "2026-03-01" };
const VOICE = { id: "elevenlabs", defaultModel: "eleven_flash_v2_5", pricingOf: () => ({ centsPerThousandCharacters: 30, checkedOn: "2026-11-24", source: "teste" }) };

describe("pricedBrainModels e pricePipeline", () => {
  it("oferecem os mesmos modelos: com preço, na ordem da lista", () => {
    const list = { fetchedAt: "2026-03-01", stale: false, models: [{ id: "b", label: "B", price: PRICE }, { id: "a", label: "A" }, { id: "c", label: "C", price: { ...PRICE, centsPerMillionInputTokens: 0 } }] };
    expect(pricedBrainModels(list)).toEqual(["b", "c"]);
    for (const model of ["a", "b", "c", "fora"]) {
      const accepted = !("unpriced" in pricePipeline({ brain: "openai", model }, list, VOICE));
      expect(accepted, model).toBe(pricedBrainModels(list).includes(model));
      expect(brainPriceOf(list, model) !== undefined, model).toBe(accepted);
    }
  });

  it("a lista fora da forma não tem preço nenhum, nos dois lados", () => {
    for (const wrong of [undefined, null, "x", { models: "x" }, { models: [{ id: "b", price: { centsPerMillionInputTokens: -1 } }] }]) {
      expect(pricedBrainModels(wrong)).toEqual([]);
      expect(pricePipeline({ brain: "openai", model: "b" }, wrong, VOICE)).toEqual({ unpriced: { kind: "brain", id: "openai", model: "b" } });
    }
  });
});

describe("readConsent", () => {
  it("só a forma da tela vale como confirmação", () => {
    expect(readConsent({ userId: "u", confirmedAt: "2026-11-24T12:00:00.000Z" })).toEqual({ userId: "u", confirmedAt: "2026-11-24T12:00:00.000Z" });
    for (const wrong of [undefined, null, true, "sim", { userId: "u" }, { confirmedAt: "2026-11-24" }]) expect(readConsent(wrong)).toBeNull();
  });
});
