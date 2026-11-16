import { describe, expect, it } from "vitest";
import { matchModels, searchable } from "./search";

describe("busca de modelo", () => {
  it("ignora acento e caixa, no nome e no id", () => {
    expect(searchable("Gêmeos Ação")).toBe("gemeos acao");
    const models = [
      { id: "gpt-5-mini", label: "GPT-5 mini" },
      { id: "modelo-acao", label: "Modelo Ação" },
      { id: "claude-x", label: "Claude X" },
    ];
    expect(matchModels(models, "gpt").map((model) => model.id)).toEqual(["gpt-5-mini"]);
    expect(matchModels(models, "ACAO").map((model) => model.id)).toEqual(["modelo-acao"]);
    expect(matchModels(models, "ação").map((model) => model.id)).toEqual(["modelo-acao"]);
    expect(matchModels(models, "CLAUDE-X").map((model) => model.id)).toEqual(["claude-x"]);
    expect(matchModels(models, "  ")).toHaveLength(3);
    expect(matchModels(models, "nada")).toEqual([]);
  });
});
