// O formulário do teste do agente (fatia 7c): os campos da tela viram o formato que o banco guarda,
// sem ninguém escrever JSON, e o teste gravado volta aos campos sem perder nada.
import { AGENT_TEST_MAX_TURNS, AGENT_TEST_MAX_USER_CHARACTERS, agentTestTurns, judgeTurn, type AgentTestTurns } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
import { LIA_TEST_TURNS } from "../../../../../../../voice/src/cli/demo-agent-test";
import { blankArg, blankTest, blankTool, blankTurn, draftProblems, MAX_TURNS, MAX_USER_CHARACTERS, toDraft, toolChoices, toTurns, type TestDraft } from "./form";

function filled(): TestDraft {
  const draft = blankTest();
  draft.name = "  Marca consulta  ";
  draft.turns = [
    {
      ...blankTurn(),
      user: " Quero marcar para terça. ",
      tools: [
        {
          ...blankTool("create_task"),
          args: [
            { field: "title", kind: "contains", value: "terça" },
            { field: "minutes", kind: "equalsNumber", value: "30,5" },
            { field: "urgent", kind: "isFalse", value: "" },
            { field: "phone", kind: "present", value: "" },
            { field: "note", kind: "isEmpty", value: "" },
          ],
          answer: " Marcado. ",
        },
      ],
      forbid: ["transfer_to_human"],
      says: "terça\n\n  recepção  ",
    },
    { ...blankTurn(), user: "Obrigado.", onlyThese: false, saysNot: "desconto" },
  ];
  return draft;
}

describe("o formulário do teste do agente", () => {
  it("os tetos da tela são os do core", () => {
    expect([MAX_TURNS, MAX_USER_CHARACTERS]).toEqual([AGENT_TEST_MAX_TURNS, AGENT_TEST_MAX_USER_CHARACTERS]);
  });

  it("os campos viram o formato do banco: o que está vazio não entra, e o resultado aceita", () => {
    const turns = toTurns(filled());
    expect(turns).toEqual([
      {
        user: "Quero marcar para terça.",
        expect: {
          tools: [
            {
              tool: "create_task",
              args: { title: { contains: "terça" }, minutes: { equals: 30.5 }, urgent: { equals: false }, phone: { present: true }, note: { equals: null } },
              result: { ok: true, message: "Marcado." },
            },
          ],
          forbid: ["transfer_to_human"],
          says: ["terça", "recepção"],
        },
      },
      { user: "Obrigado.", expect: { onlyThese: false, saysNot: ["desconto"] } },
    ]);
    expect(agentTestTurns.safeParse(turns).success).toBe(true);
    // O campo sem nome não entra (o formulário o aponta antes, em `draftProblems`).
    const blankField = filled();
    blankField.turns[0]?.tools[0]?.args.push({ field: "  ", kind: "equalsText", value: "ignorado" });
    expect(toTurns(blankField)).toEqual(turns);
    // O turno sem nada esperado fica sem `expect`, e a ferramenta sem resposta devolve `{ ok: true }`.
    expect(toTurns({ name: "x", turns: [{ ...blankTurn(), user: "Oi", tools: [blankTool("end_call")] }] })).toEqual([{ user: "Oi", expect: { tools: [{ tool: "end_call", result: { ok: true } }] } }]);
  });

  it("o teste do pnpm demo volta aos campos e sai igual, inclusive a resposta escrita", () => {
    const back = toTurns(toDraft("Lia", LIA_TEST_TURNS));
    expect(back).toEqual(LIA_TEST_TURNS);
  });

  it("a resposta gravada em outro formato fica como está enquanto ninguém escrever outra", () => {
    const turns: AgentTestTurns = [{ user: "Oi", expect: { tools: [{ tool: "check_slots", result: { slots: ["9h", "10h"] } }] } }];
    const draft = toDraft("Agenda", turns);
    expect(draft.turns[0]?.tools[0]).toMatchObject({ answer: "", keptResult: { slots: ["9h", "10h"] } });
    expect(toTurns(draft)).toEqual(turns);
    const rewritten = toDraft("Agenda", turns);
    const tool = rewritten.turns[0]?.tools[0];
    if (tool) tool.answer = "Há vaga às 9h.";
    expect(toTurns(rewritten)[0]?.expect?.tools?.[0]?.result).toEqual({ ok: true, message: "Há vaga às 9h." });
  });

  it("o que o formulário esperava é o que o juiz confere", () => {
    const [turn] = toTurns(filled());
    const verdict = judgeTurn(turn?.expect, { tools: [{ name: "create_task", args: { title: "Terca às 9h", minutes: 30.5, urgent: false, phone: "+5511999990000", note: null } }], says: "A recepção confirma terça." });
    expect(verdict).toEqual({ passed: true, failures: [] });
  });

  it("aponta cada problema no lugar dele, antes de mandar", () => {
    const draft: TestDraft = {
      name: " ",
      turns: [
        { ...blankTurn(), user: "", tools: [{ ...blankTool(""), args: [blankArg(), { field: "n", kind: "equalsNumber", value: "dez" }, { field: "t", kind: "contains", value: " " }] }] },
        { ...blankTurn(), user: "x".repeat(1001) },
      ],
    };
    expect(draftProblems(draft)).toEqual([
      { problem: "nameMissing" },
      { problem: "userMissing", turn: 0 },
      { problem: "toolMissing", turn: 0, tool: 0 },
      { problem: "fieldMissing", turn: 0, tool: 0, arg: 0 },
      { problem: "numberInvalid", turn: 0, tool: 0, arg: 1 },
      { problem: "valueMissing", turn: 0, tool: 0, arg: 2 },
      { problem: "userTooLong", turn: 1 },
    ]);
    expect(draftProblems({ name: "ok", turns: [] })).toEqual([{ problem: "noTurns" }]);
    expect(draftProblems({ name: "ok", turns: Array.from({ length: 13 }, () => ({ ...blankTurn(), user: "a" })) })).toEqual([{ problem: "tooManyTurns" }]);
    expect(draftProblems(filled())).toEqual([]);
  });

  it("oferece as ferramentas do agente, a passagem quando há destino, e as que o teste já cita", () => {
    expect(toolChoices(["create_task", "end_call"], false, blankTest())).toEqual(["create_task", "end_call"]);
    expect(toolChoices(["create_task"], true, toDraft("x", LIA_TEST_TURNS))).toEqual(["create_task", "transfer_to_agent", "transfer_to_human", "end_call"]);
  });
});
