import { describe, expect, it } from "vitest";
import { analysisPatch, analysisStatus, analysisView, modelRequired, toAnalysisDraft, type AnalysisDraft, type BrainModelOption, type BrainOption } from "./analysis-choice";

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

describe("os avisos de quem lê a ligação (analysisView)", () => {
  const anthropic: BrainOption = { id: "anthropic", label: "Anthropic", configured: true, keyCheck: { result: "accepted" } };
  const openai: BrainOption = { id: "openai", label: "OpenAI", configured: true, keyCheck: { result: "accepted" } };
  const priced: BrainModelOption = { id: "claude-sonnet", label: "Claude Sonnet", price: { input: 3, output: 15 } };
  const noPrice: BrainModelOption = { id: "claude-novo", label: "Claude Novo" };
  const brains = [anthropic, openai];
  const models = [priced, noPrice];
  const quiet = { keyGone: false, modelGone: false, unmeasured: false };

  it("o modelo gravado que saiu da lista avisa, e não barra o salvar", () => {
    const view = analysisView({ analysis: { kind: "brain", brain: "anthropic", model: "modelo-que-sumiu" }, brains, models });
    expect(view).toMatchObject({ keyGone: false, modelGone: true, unmeasured: false, required: false, model: undefined });
  });

  it("o cérebro escolhido sem modelo barra o salvar, sem aviso", () => {
    expect(analysisView({ analysis: { kind: "brain", brain: "anthropic", model: "" }, brains, models })).toMatchObject({ ...quiet, required: true });
    expect(analysisView({ analysis: { kind: "brain", brain: "anthropic", model: "" }, brains: undefined, models: undefined }).required).toBe(true);
  });

  it("o modelo da lista com preço: nenhum aviso, nada barra", () => {
    expect(analysisView({ analysis: brain, brains, models })).toMatchObject({ ...quiet, required: false, model: priced });
  });

  it.each([
    ["recusada", { ...anthropic, keyCheck: { result: "rejected" } }],
    ["nunca conferida", { ...anthropic, keyCheck: null }],
    ["sem configuração", { ...anthropic, configured: false }],
  ])("a chave %s acende o aviso dela, e não o do modelo nem o de sem preço", (_caso, option) => {
    // O modelo também não está na lista, e mesmo assim só o aviso da chave aparece.
    const gone = analysisView({ analysis: { kind: "brain", brain: "anthropic", model: "modelo-que-sumiu" }, brains: [option, openai], models });
    expect(gone).toMatchObject({ keyGone: true, modelGone: false, unmeasured: false });
    expect(gone.accepted).toEqual([openai]);
    const unpriced = analysisView({ analysis: { kind: "brain", brain: "anthropic", model: "claude-novo" }, brains: [option, openai], models });
    expect(unpriced).toMatchObject({ keyGone: true, modelGone: false, unmeasured: false });
  });

  it("o cérebro que sumiu da lista também é chave perdida", () => {
    expect(analysisView({ analysis: brain, brains: [openai], models }).keyGone).toBe(true);
  });

  it("o modelo sem preço acende o aviso, e escolher ele manda o aceite", () => {
    const view = analysisView({ analysis: { kind: "brain", brain: "anthropic", model: "claude-novo" }, brains, models });
    expect(view).toMatchObject({ keyGone: false, modelGone: false, unmeasured: true, required: false });
    expect(view.unmeasuredOf("claude-novo")).toBe(true);
    expect(view.unmeasuredOf("claude-sonnet")).toBe(false);
    expect(view.unmeasuredOf("fora-da-lista")).toBe(false);
  });

  it.each([
    ["as duas listas carregando", undefined, undefined],
    ["a lista de modelos carregando", brains, undefined],
    ["a lista de cérebros carregando", undefined, models],
  ])("com %s, nenhum aviso falso", (_caso, brainList, modelList) => {
    for (const analysis of [brain, { kind: "brain", brain: "anthropic", model: "modelo-que-sumiu" }] as AnalysisDraft[]) {
      const view = analysisView({ analysis, brains: brainList, models: modelList });
      expect(view.keyGone).toBe(false);
      // Sem a lista de modelos, o modelo nunca "saiu" dela.
      if (modelList === undefined) expect(view.modelGone).toBe(false);
      expect(view.unmeasured).toBe(false);
    }
  });

  it("quem só lê (listas que nunca chegam) não vê aviso em escolha nenhuma", () => {
    for (const analysis of [{ kind: "organization" }, { kind: "engine" }, { kind: "invalid" }, brain, { kind: "brain", brain: "x", model: "" }] as AnalysisDraft[]) {
      expect(analysisView({ analysis, brains: undefined, models: undefined })).toMatchObject(quiet);
    }
  });

  it("fora da escolha de cérebro não há aviso nem modelo, mesmo com as listas", () => {
    for (const analysis of [{ kind: "organization" }, { kind: "engine" }, { kind: "invalid" }] as AnalysisDraft[]) {
      expect(analysisView({ analysis, brains: [], models })).toMatchObject({ ...quiet, required: false, brain: "", modelId: "" });
    }
  });

  it("o rótulo vem da lista; o cérebro desconhecido, ou a lista carregando, cai no id", () => {
    expect(analysisView({ analysis: brain, brains, models }).labelOf("anthropic")).toBe("Anthropic");
    expect(analysisView({ analysis: brain, brains, models }).labelOf("desconhecido")).toBe("desconhecido");
    expect(analysisView({ analysis: brain, brains: undefined, models }).labelOf("anthropic")).toBe("anthropic");
  });

  it("o seletor oferece só os cérebros configurados com chave aceita", () => {
    const view = analysisView({ analysis: { kind: "organization" }, brains: [anthropic, { ...openai, keyCheck: { result: "rejected" } }, { ...openai, id: "x", configured: false }], models: undefined });
    expect(view.accepted).toEqual([anthropic]);
  });
});

describe("o que quem só lê vê da escolha gravada (analysisStatus, a regra de analysisView no servidor)", () => {
  const accepted: BrainOption = { id: "anthropic", label: "Anthropic", configured: true, keyCheck: { result: "accepted" } };
  const refused: BrainOption = { ...accepted, keyCheck: { result: "invalid_key" } };
  const priced: BrainModelOption = { id: "claude-sonnet", label: "Claude Sonnet", price: { input: 3, output: 15 } };
  const noPrice: BrainModelOption = { id: "claude-sem-preco", label: "Claude sem preço" };
  const status = (analysis: AnalysisDraft, brains: BrainOption[] | undefined, models: BrainModelOption[] | undefined) => analysisStatus({ analysis, brains, models });

  it("fora da escolha de cérebro: a escolha, sem rótulo, modelo nem aviso", () => {
    for (const choice of ["organization", "engine", "invalid"] as const) {
      expect(status({ kind: choice } as AnalysisDraft, [refused], [noPrice])).toEqual({ choice, brainLabel: null, model: null, problems: [] });
    }
  });

  it("o cérebro com chave aceita e modelo com preço: o rótulo, sem aviso", () => {
    expect(status(brain, [accepted], [priced])).toEqual({ choice: "brain", brainLabel: "Anthropic", model: "claude-sonnet", problems: [] });
  });

  it("cada aviso de analysisView, pelo nome", () => {
    expect(status(brain, [refused], [priced]).problems).toEqual(["key_gone"]);
    expect(status(brain, [{ ...accepted, configured: false }], [priced]).problems).toEqual(["key_gone"]);
    expect(status(brain, [accepted], [noPrice]).problems).toEqual(["model_gone"]);
    expect(status({ kind: "brain", brain: "anthropic", model: "claude-sem-preco" }, [accepted], [noPrice]).problems).toEqual(["unmeasured"]);
  });

  it("chave recusada e modelo fora da lista: só a chave, como na tela de quem configura", () => {
    expect(status(brain, [refused], [noPrice]).problems).toEqual(["key_gone"]);
    expect(analysisView({ analysis: brain, brains: [refused], models: [noPrice] })).toMatchObject({ keyGone: true, modelGone: false, unmeasured: false });
  });

  it("o cérebro que não é mais descoberto: chave perdida, com o id no lugar do rótulo", () => {
    expect(status({ kind: "brain", brain: "sumiu", model: "m" }, [accepted], undefined)).toEqual({ choice: "brain", brainLabel: "sumiu", model: "m", problems: ["key_gone"] });
  });
});
