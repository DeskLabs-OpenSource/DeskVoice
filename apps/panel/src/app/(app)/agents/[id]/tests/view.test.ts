// A tela dos testes do agente (fatia 7c), desenhada no servidor: o resultado com o esperado e o que
// veio lado a lado e a frase do que o teste não cobre; a frase de custo antes do primeiro clique; o
// botão desligado, com o motivo, no motor sem `textMode`; e quem só vê o agente sem botão nenhum.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../../i18n/en/agent-tests";
import es from "../../../../../i18n/es/agent-tests";
import ptBR from "../../../../../i18n/pt-BR/agent-tests";
import { TestEditor, problemText } from "./editor";
import { blankTest, blankTool, toDraft } from "./form";
import { RunControls, RunResult, TestRow, type ListedTest, type RunDetail } from "./view";

const noop = (): void => undefined;
const TURNS: ListedTest["turns"] = [
  { user: "Quero remarcar para sexta.", expect: { tools: [{ tool: "create_task", args: { title: { contains: "Marina" } }, result: { ok: true, message: "Pendência aberta." } }] } },
  { user: "Era só isso.", expect: { tools: [{ tool: "end_call", result: { ok: true } }] } },
];
const failedRun: RunDetail = {
  id: "r1",
  testId: "t1",
  engine: "openai-realtime",
  status: "failed",
  errorCode: null,
  configHash: "h1",
  startedAt: "2026-11-23T12:00:00.000Z",
  finishedAt: "2026-11-23T12:00:05.000Z",
  turns: [
    {
      user: "Quero remarcar para sexta.",
      says: "Vou anotar para a recepção.",
      tools: [{ name: "create_task", args: { title: "Remarcar limpeza" }, result: { ok: true, message: "Pendência aberta." } }],
      verdict: {
        passed: false,
        failures: [{ reason: "args_mismatch", detail: { expected: { tool: "create_task", args: { title: { contains: "Marina" } } }, got: { tool: "create_task", args: { title: "Remarcar limpeza" } } } }],
      },
    },
  ],
};
const test = (overrides: Partial<ListedTest> = {}): ListedTest => ({
  id: "t1",
  name: "Remarcação",
  turns: TURNS,
  updatedAt: "2026-11-23T11:00:00.000Z",
  lastRun: { id: "r1", status: "failed", errorCode: null, configHash: "h1", startedAt: "2026-11-23T12:00:00.000Z", finishedAt: "2026-11-23T12:00:05.000Z" },
  stale: false,
  ...overrides,
});
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const buttons = (html: string): string[] => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => text(match[1] ?? "").trim());

describe("o resultado da rodada", () => {
  it("reprovou: o veredito, a frase do que o teste não cobre e o esperado ao lado do que veio", () => {
    const html = renderToStaticMarkup(createElement(RunResult, { run: failedRun, testTurns: TURNS, t: ptBR }));
    const shown = text(html);
    expect(shown).toContain(ptBR.result.failed);
    expect(shown).toContain("O teste confere o que o agente decide, e não como ele ouve e fala.");
    expect(shown).toContain(ptBR.result.reasons.args_mismatch);
    // Lado a lado: Esperado e O que veio na mesma grade, cada um com o seu valor.
    expect(html).toMatch(/md:grid-cols-2[^>]*><div[^>]*><span[^>]*>Esperado<\/span><pre[^>]*>[^<]*&quot;contains&quot;: &quot;Marina&quot;[\s\S]*?<\/pre><\/div><div[^>]*><span[^>]*>O que veio<\/span><pre[^>]*>[^<]*&quot;title&quot;: &quot;Remarcar limpeza&quot;/);
    // O turno do teste que não está na rodada aparece como não rodado.
    expect(shown).toContain("Era só isso.");
    expect(shown.split(ptBR.result.notReached)).toHaveLength(2);
  });

  it("passou e erro também trazem a frase do que o teste não cobre; o erro diz o motivo, inclusive o reinício", () => {
    const passed = text(renderToStaticMarkup(createElement(RunResult, { run: { ...failedRun, status: "passed", turns: [] }, testTurns: [], t: ptBR })));
    expect(passed).toContain(ptBR.result.passed);
    expect(passed).toContain(ptBR.scope);
    const restarted = text(renderToStaticMarkup(createElement(RunResult, { run: { ...failedRun, status: "error", errorCode: "process_restarted", turns: [] }, testTurns: TURNS, t: ptBR })));
    expect(restarted).toContain(ptBR.result.errors.process_restarted);
    expect(restarted).toContain(ptBR.scope);
    expect(restarted.split(ptBR.result.notReached)).toHaveLength(3);
    const gaveUp = text(renderToStaticMarkup(createElement(RunResult, { run: { ...failedRun, status: "running", turns: [] }, testTurns: TURNS, t: ptBR, gaveUp: true })));
    expect(gaveUp).toContain(ptBR.result.gaveUp);
  });

  it("a frase do que o teste não cobre existe nos três idiomas", () => {
    for (const t of [ptBR, en, es]) expect(text(renderToStaticMarkup(createElement(RunResult, { run: failedRun, testTurns: TURNS, t })))).toContain(t.scope);
  });
});

describe("os botões e a frase de custo", () => {
  it("a frase de custo aparece antes do primeiro clique, com os botões ligados", () => {
    const html = renderToStaticMarkup(createElement(RunControls, { t: ptBR, canConfigure: true, textMode: true, busy: false, hasTests: true, onNew: noop, onRunAll: noop }));
    expect(text(html)).toContain("Cada rodada usa o motor deste agente com a sua chave e entra no custo do mês. Nenhuma ferramenta roda de verdade.");
    expect(buttons(html)).toEqual([ptBR.newTest, ptBR.runAll]);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Rodar todos/);
  });

  it("num motor sem textMode, 'Rodar todos' e 'Rodar' vêm desligados, com o motivo na tela", () => {
    const controls = renderToStaticMarkup(createElement(RunControls, { t: ptBR, canConfigure: true, textMode: false, busy: false, hasTests: true, onNew: noop, onRunAll: noop }));
    expect(text(controls)).toContain("Este motor ainda não roda testes.");
    expect(controls).toMatch(/<button[^>]*disabled=""[^>]*>Rodar todos<\/button>/);
    const row = renderToStaticMarkup(createElement(TestRow, { test: test(), t: ptBR, locale: "pt-BR", canConfigure: true, textMode: false, busy: false, open: false, onRun: noop, onEdit: noop, onDelete: noop, onToggle: noop }));
    expect(row).toMatch(/<button[^>]*disabled=""[^>]*title="Este motor ainda não roda testes."[^>]*>Rodar<\/button>/);
  });

  it("quem só vê o agente vê o resultado e o aviso, e não tem botão de criar, rodar, editar nem apagar", () => {
    expect(renderToStaticMarkup(createElement(RunControls, { t: ptBR, canConfigure: false, textMode: true, busy: false, hasTests: true, onNew: noop, onRunAll: noop }))).toBe("");
    const row = renderToStaticMarkup(createElement(TestRow, { test: test({ stale: true }), t: ptBR, locale: "pt-BR", canConfigure: false, textMode: true, busy: false, open: false, onRun: noop, onEdit: noop, onDelete: noop, onToggle: noop }));
    expect(buttons(row)).toEqual([ptBR.showResult]);
    expect(text(row)).toContain(ptBR.status.failed);
    expect(text(row)).toContain("Não rodado com a configuração atual");
  });

  it("quem edita tem os quatro botões na linha; sem mudança de configuração, nenhum aviso", () => {
    const row = renderToStaticMarkup(createElement(TestRow, { test: test(), t: ptBR, locale: "pt-BR", canConfigure: true, textMode: true, busy: false, open: true, onRun: noop, onEdit: noop, onDelete: noop, onToggle: noop }));
    expect(buttons(row)).toEqual([ptBR.hideResult, ptBR.run, ptBR.edit, ptBR.delete]);
    expect(text(row)).not.toContain(ptBR.stale);
    const never = renderToStaticMarkup(createElement(TestRow, { test: test({ lastRun: null }), t: ptBR, locale: "pt-BR", canConfigure: true, textMode: true, busy: false, open: false, onRun: noop, onEdit: noop, onDelete: noop, onToggle: noop }));
    expect(text(never)).toContain(ptBR.status.never);
  });
});

describe("o editor do teste", () => {
  it("é um formulário: fala, ferramenta, campo, resposta e trechos em campos próprios, sem caixa de JSON", () => {
    const draft = toDraft("Remarcação", TURNS);
    const html = renderToStaticMarkup(createElement(TestEditor, { draft, onChange: noop, t: ptBR, tools: ["create_task", "end_call"], isNew: false, problems: [], saving: false, error: "", onSave: noop, onCancel: noop }));
    const shown = text(html);
    for (const label of [ptBR.editor.name, ptBR.editor.user, ptBR.editor.tool, ptBR.editor.field, ptBR.editor.kind, ptBR.editor.answer, ptBR.editor.says, ptBR.editor.saysNot, ptBR.editor.onlyThese]) expect(shown).toContain(label);
    expect(html).toMatch(/<textarea[^>]*>Quero remarcar para sexta\.<\/textarea>/);
    expect(html).toMatch(/<option value="create_task" selected="">create_task<\/option>/);
    expect(html).toContain('value="title"');
    expect(html).toMatch(/<option value="contains" selected="">contém o trecho<\/option>/);
    expect(html).toContain('value="Pendência aberta."');
    // Nenhum campo mostra JSON: nem chave, nem colchete.
    expect(html).not.toMatch(/value="[{[]/);
    expect(html).not.toMatch(/<textarea[^>]*>[{[]/);
  });

  it("mostra os problemas no lugar, contados a partir de 1", () => {
    const html = renderToStaticMarkup(
      createElement(TestEditor, { draft: { ...blankTest(), turns: [{ ...blankTest().turns[0]!, tools: [blankTool()] }] }, onChange: noop, t: ptBR, tools: [], isNew: true, problems: [{ problem: "toolMissing", turn: 0, tool: 0 }], saving: false, error: "", onSave: noop, onCancel: noop }),
    );
    expect(text(html)).toContain("Escolha a ferramenta 1 do turno 1.");
    expect(problemText({ problem: "nameMissing" }, en)).toBe("Give the test a name.");
  });
});
