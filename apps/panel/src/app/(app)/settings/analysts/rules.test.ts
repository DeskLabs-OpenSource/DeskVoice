import { describe, expect, it } from "vitest";
import { objectionKeyFor } from "./objection-key";
import { GUIDED_ENGINES, needsConfirmation, offeredModels, type DecisionModelView } from "./rules";

const jev: DecisionModelView = { id: "jev", label: "Jev", provider: "typesafe", processingLocation: { kind: "undeclared" }, keyless: false, key: { configured: true } };
const local: DecisionModelView = { id: "local", label: "Local", provider: "local", processingLocation: { kind: "this-server" }, keyless: true, key: { configured: false } };

describe("a tela de analistas", () => {
  it("oferece só o modelo instalado e com chave; o gravado sem chave fica, para não sumir em silêncio", () => {
    const keyless = { ...jev, key: { configured: false } };
    expect(offeredModels([jev, local], null).map((model) => model.id)).toEqual(["jev", "local"]);
    expect(offeredModels([keyless, local], null).map((model) => model.id)).toEqual(["local"]);
    expect(offeredModels([keyless, local], "jev").map((model) => model.id)).toEqual(["jev", "local"]);
  });

  it("pede a confirmação do fornecedor no analista novo, no modelo trocado e no nunca confirmado; nunca no modelo deste servidor", () => {
    const at = "2026-11-17T11:00:00.000Z";
    expect(needsConfirmation(jev, null)).toBe(true);
    expect(needsConfirmation(jev, { decisionModel: "local", providerConfirmedAt: null })).toBe(true);
    expect(needsConfirmation(jev, { decisionModel: "jev", providerConfirmedAt: null })).toBe(true);
    expect(needsConfirmation(jev, { decisionModel: "jev", providerConfirmedAt: at })).toBe(false);
    expect(needsConfirmation(local, null)).toBe(false);
  });

  it("o Gemini Live não recebe orientação; o OpenAI Realtime e o simulado recebem", () => {
    expect(GUIDED_ENGINES).not.toContain("gemini-live");
    expect(GUIDED_ENGINES).toEqual(expect.arrayContaining(["openai-realtime", "simulated"]));
  });

  it("a key da objeção nasce do rótulo: sem acento, minúscula, única na lista e nunca none", () => {
    expect(objectionKeyFor("Preço", [])).toBe("preco");
    expect(objectionKeyFor("  Prazo de entrega!  ", [])).toBe("prazo_de_entrega");
    expect(objectionKeyFor("Preço", ["preco"])).toBe("preco_2");
    expect(objectionKeyFor("Preço", ["preco", "preco_2"])).toBe("preco_3");
    expect(objectionKeyFor("None", [])).toBe("none_2");
    expect(objectionKeyFor("???", [])).toBe("objecao");
    const long = objectionKeyFor("x".repeat(40), ["x".repeat(30)]);
    expect(long).toBe(`${"x".repeat(28)}_2`);
    for (const key of [long, objectionKeyFor("Ação já", [])]) expect(key).toMatch(/^[a-z0-9_]{1,30}$/);
  });
});
