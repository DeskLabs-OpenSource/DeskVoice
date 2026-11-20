// "Cérebros deste agente" desenhado no servidor, com `useApi` trocado por respostas fixas: o
// `required` do Modelo vem de `modelRequired` (lacuna (a) da DESA-195), e quem só lê vê o rótulo e os
// avisos da escolha gravada, que vêm de `GET /agents/{id}/analysis-status`, sem seletor (ajuste da 5b).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ptBR from "../../../../i18n/pt-BR/agents";
import { fill } from "../../../../i18n/locales";
import type { AnalysisDraft, AnalysisStatus, BrainModelOption, BrainOption } from "./analysis-choice";

const responses = new Map<string, unknown>();
const asked: string[] = [];

vi.mock("../../../../ui/api", () => ({
  useApi: (path: string | null) => {
    if (path !== null) asked.push(path);
    return { data: path === null ? undefined : responses.get(path), error: undefined, reload: () => undefined };
  },
}));

const { AgentBrains } = await import("./brains");

const AGENT = "11111111-1111-4111-8111-111111111111";
const STATUS = `/agents/${AGENT}/analysis-status`;
const accepted: BrainOption = { id: "anthropic", label: "Anthropic", configured: true, keyCheck: { result: "accepted" } };
const models: BrainModelOption[] = [
  { id: "claude-sonnet", label: "Claude Sonnet", price: { input: 3, output: 15 } },
  { id: "claude-sem-preco", label: "Claude sem preço" },
];

const render = (analysis: AnalysisDraft, canConfigure: boolean): string =>
  renderToStaticMarkup(
    createElement(AgentBrains, { agentId: AGENT, t: ptBR, engineLabel: "Simulado", analysis, onChange: () => undefined, costCeilingCents: 500, analyst: null, canConfigure }),
  );

const modelSelect = (html: string): string | undefined => /<select[^>]*aria-label="Modelo"[^>]*>/.exec(html)?.[0];

beforeEach(() => {
  responses.clear();
  asked.length = 0;
  responses.set("/settings/calls.analysis_brain", { key: "calls.analysis_brain", value: null });
});

describe("quem configura: o seletor de Modelo", () => {
  beforeEach(() => {
    responses.set("/brains", [accepted]);
    responses.set("/brains/anthropic/models", { models });
  });

  it("(a) o cérebro escolhido sem modelo liga `required`", () => {
    const select = modelSelect(render({ kind: "brain", brain: "anthropic", model: "" }, true));
    expect(select).toBeDefined();
    expect(select).toMatch(/\brequired=""/);
  });

  it("(a) o modelo gravado que saiu da lista não liga `required`, e o aviso aparece", () => {
    const html = render({ kind: "brain", brain: "anthropic", model: "claude-velho" }, true);
    const select = modelSelect(html);
    expect(select).toBeDefined();
    expect(select).not.toMatch(/\brequired/);
    expect(html).toContain(fill(ptBR.readModelGone, { model: "claude-velho" }));
  });

  it("o modelo da lista não liga `required`", () => {
    expect(modelSelect(render({ kind: "brain", brain: "anthropic", model: "claude-sonnet" }, true))).not.toMatch(/\brequired/);
  });

  it("não lê analysis-status e vê a frase de quem muda a escolha", () => {
    responses.set("/brains", [{ ...accepted, keyCheck: { result: "invalid_key" } }]);
    const html = render({ kind: "brain", brain: "anthropic", model: "claude-sonnet" }, true);
    expect(asked).not.toContain(STATUS);
    expect(html).toContain(fill(ptBR.readKeyGone, { brain: "Anthropic" }));
    expect(html).not.toContain(fill(ptBR.readKeyGoneAsk, { brain: "Anthropic" }));
  });
});

describe("quem só lê (operador): o rótulo e os avisos, sem seletor", () => {
  const brain: AnalysisDraft = { kind: "brain", brain: "anthropic", model: "claude-sem-preco" };
  const status = (problems: AnalysisStatus["problems"]): AnalysisStatus => ({ choice: "brain", brainLabel: "Anthropic", model: "claude-sem-preco", problems });

  it("lê analysis-status, nunca /brains nem a lista de modelos", () => {
    responses.set(STATUS, status([]));
    render(brain, false);
    expect(asked).toContain(STATUS);
    expect(asked.some((path) => path.startsWith("/brains"))).toBe(false);
  });

  it("vê o rótulo do cérebro no lugar do id, e nenhum <select>", () => {
    responses.set(STATUS, status([]));
    const html = render(brain, false);
    expect(html).toContain("Anthropic · claude-sem-preco");
    expect(html).not.toContain("anthropic · claude-sem-preco");
    expect(html).not.toContain("<select");
  });

  it("vê a chave recusada, com a frase de pedir a quem configura", () => {
    responses.set(STATUS, status(["key_gone"]));
    const html = render(brain, false);
    expect(html).toContain(fill(ptBR.readKeyGoneAsk, { brain: "Anthropic" }));
    // A frase do operador começa pela de quem configura: o que não pode aparecer é ela sozinha.
    expect(html).not.toContain(`${fill(ptBR.readKeyGone, { brain: "Anthropic" })}</div>`);
    expect(html).not.toContain("<select");
  });

  it("vê o modelo fora da lista e o modelo sem preço", () => {
    responses.set(STATUS, status(["model_gone"]));
    let html = render(brain, false);
    expect(html).toContain(fill(ptBR.readModelGoneAsk, { model: "claude-sem-preco" }));
    expect(html).not.toContain(ptBR.readUnmeasured);

    responses.set(STATUS, status(["unmeasured"]));
    html = render(brain, false);
    expect(html).toContain(ptBR.readUnmeasured);
    expect(html).not.toContain("<select");
  });

  it("sem resposta ainda, nenhum aviso; o agente novo não pergunta", () => {
    const html = render(brain, false);
    expect(html).not.toContain(ptBR.readUnmeasured);
    asked.length = 0;
    renderToStaticMarkup(
      createElement(AgentBrains, { agentId: null, t: ptBR, engineLabel: "Simulado", analysis: { kind: "organization" }, onChange: () => undefined, costCeilingCents: 0, analyst: null, canConfigure: false }),
    );
    expect(asked.some((path) => path.includes("analysis-status"))).toBe(false);
  });
});
