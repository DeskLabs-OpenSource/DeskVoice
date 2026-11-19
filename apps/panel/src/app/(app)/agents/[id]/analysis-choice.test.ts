import { describe, expect, it } from "vitest";
import { analysisPatch, modelRequired, toAnalysisDraft, type AnalysisDraft } from "./analysis-choice";

const brain: AnalysisDraft = { kind: "brain", brain: "anthropic", model: "claude-sonnet" };

describe("quem lê a ligação na tela do agente", () => {
  it.each([
    [null, { kind: "organization" }],
    [undefined, { kind: "organization" }],
    [{ kind: "engine" }, { kind: "engine" }],
    [{ kind: "brain", brain: "anthropic", model: "claude-sonnet" }, brain],
  ])("lê %j como a escolha que ele é", (value, draft) => {
    expect(toAnalysisDraft(value)).toEqual(draft);
  });

  it.each([
    ["sem o kind", { brain: "anthropic", model: "claude-sonnet" }],
    ["um kind desconhecido", { kind: "organization" }],
    ["cérebro sem o modelo", { kind: "brain", brain: "anthropic" }],
    ["o motor com um campo a mais", { kind: "engine", brain: "anthropic" }],
    ["um texto solto", "engine"],
    ["uma lista", [null]],
  ])("a escolha gravada fora da forma (%s) é inválida, nunca a organização", (_caso, value) => {
    expect(toAnalysisDraft(value)).toEqual({ kind: "invalid" });
  });

  it("salvar sem mexer na escolha não manda o campo: a coluna não é regravada", () => {
    for (const saved of [{ kind: "organization" }, { kind: "engine" }, brain] as AnalysisDraft[]) expect(analysisPatch(saved, saved, false)).toEqual({});
    expect(analysisPatch({ ...brain }, brain, true)).toEqual({});
  });

  it("a escolha fora da forma nunca volta no salvar", () => {
    for (const saved of [{ kind: "invalid" }, { kind: "organization" }, { kind: "engine" }, brain] as AnalysisDraft[]) expect(analysisPatch({ kind: "invalid" }, saved, true)).toEqual({});
  });

  it("a escolha que mudou vai na forma da API, e o aceite do modelo sem preço só com o cérebro", () => {
    expect(analysisPatch({ kind: "organization" }, brain, false)).toEqual({ analysisBrain: null });
    expect(analysisPatch({ kind: "engine" }, { kind: "organization" }, true)).toEqual({ analysisBrain: { kind: "engine" } });
    expect(analysisPatch(brain, { kind: "organization" }, false)).toEqual({ analysisBrain: { kind: "brain", brain: "anthropic", model: "claude-sonnet" } });
    expect(analysisPatch(brain, { kind: "invalid" }, true)).toEqual({ analysisBrain: { kind: "brain", brain: "anthropic", model: "claude-sonnet" }, acceptUnmeasured: true });
    expect(analysisPatch({ ...brain, model: "outro" }, brain, false)).toEqual({ analysisBrain: { kind: "brain", brain: "anthropic", model: "outro" } });
  });

  it("o seletor de Modelo só barra o salvar com o cérebro escolhido sem modelo", () => {
    expect(modelRequired({ kind: "brain", brain: "anthropic", model: "" })).toBe(true);
    // O modelo gravado que saiu da lista: a escolha não mudou, o salvar não barra e não manda a coluna.
    const gone: AnalysisDraft = { kind: "brain", brain: "anthropic", model: "modelo-que-sumiu" };
    expect(modelRequired(gone)).toBe(false);
    expect(analysisPatch(gone, gone, false)).toEqual({});
    for (const draft of [{ kind: "organization" }, { kind: "engine" }, { kind: "invalid" }] as AnalysisDraft[]) expect(modelRequired(draft)).toBe(false);
  });
});
