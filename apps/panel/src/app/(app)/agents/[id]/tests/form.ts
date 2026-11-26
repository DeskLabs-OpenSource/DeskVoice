// O formulário do teste do agente (fatia 7c, seção 5.6 de docs/specs/2026-11-21-testes-do-agente.md):
// quem edita o agente escreve a conversa e o que espera dela em campos, e nunca em JSON. Este arquivo
// é a ponte entre os campos e o formato que o banco guarda (`agentTestTurns`, de @deskvoice/core),
// nos dois sentidos, sem perder o que a tela não sabe mostrar.
//
// Só tipos de @deskvoice/core: o arquivo dos testes lá usa `node:crypto` (o retrato), que não vai para
// o navegador. Os tetos abaixo são os mesmos de lá, e `form.test.ts` confere. A rota confere o
// formato de novo com `agentTestTurns`, e a recusa dela vem para a tela.
import type { AgentTestTurn, AgentTestTurns, ArgMatcher } from "@deskvoice/core";

/** Os tetos de `agentTestTurns` (`AGENT_TEST_MAX_TURNS` e `AGENT_TEST_MAX_USER_CHARACTERS` no core). */
export const MAX_TURNS = 12;
export const MAX_USER_CHARACTERS = 1000;

/** Como um campo da ferramenta é conferido, nas palavras da tela. */
export const ARG_KINDS = ["equalsText", "equalsNumber", "isTrue", "isFalse", "isEmpty", "contains", "present"] as const;
export type ArgKind = (typeof ARG_KINDS)[number];

export interface ArgDraft {
  field: string;
  kind: ArgKind;
  /** O valor, para `equalsText`, `equalsNumber` e `contains`. */
  value: string;
}

export interface ToolDraft {
  tool: string;
  args: ArgDraft[];
  /** O que a ferramenta "responde" ao agente no teste, em texto. Vira `{ ok: true, message }`. */
  answer: string;
  /**
   * A resposta gravada que não tem a forma `{ ok, message }` (um teste criado pelo `pnpm demo`, por
   * exemplo). Fica como está enquanto ninguém escrever outra resposta.
   */
  keptResult?: unknown;
}

export interface TurnDraft {
  user: string;
  tools: ToolDraft[];
  /** Chamar ferramenta fora da lista reprova (o padrão). */
  onlyThese: boolean;
  forbid: string[];
  /** Um trecho por linha. */
  says: string;
  saysNot: string;
}

export interface TestDraft {
  name: string;
  turns: TurnDraft[];
}

export const NAME_MAX = 120;

export const blankTool = (tool = ""): ToolDraft => ({ tool, args: [], answer: "" });
export const blankArg = (): ArgDraft => ({ field: "", kind: "equalsText", value: "" });
export const blankTurn = (): TurnDraft => ({ user: "", tools: [], onlyThese: true, forbid: [], says: "", saysNot: "" });
export const blankTest = (): TestDraft => ({ name: "", turns: [blankTurn()] });

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function matcherOf(arg: ArgDraft): ArgMatcher {
  switch (arg.kind) {
    case "equalsText":
      return { equals: arg.value.trim() };
    case "equalsNumber":
      return { equals: Number(arg.value.trim().replace(",", ".")) };
    case "isTrue":
      return { equals: true };
    case "isFalse":
      return { equals: false };
    case "isEmpty":
      return { equals: null };
    case "contains":
      return { contains: arg.value.trim() };
    case "present":
      return { present: true };
  }
}

function argOf(field: string, matcher: ArgMatcher): ArgDraft {
  if ("contains" in matcher) return { field, kind: "contains", value: matcher.contains };
  if ("present" in matcher) return { field, kind: "present", value: "" };
  const value = matcher.equals;
  if (typeof value === "number") return { field, kind: "equalsNumber", value: String(value) };
  if (value === true) return { field, kind: "isTrue", value: "" };
  if (value === false) return { field, kind: "isFalse", value: "" };
  if (value === null) return { field, kind: "isEmpty", value: "" };
  return { field, kind: "equalsText", value };
}

/** A resposta escrita na forma que a tela edita: `{ ok: true }` ou `{ ok: true, message }`. */
function answerOf(result: unknown): Pick<ToolDraft, "answer" | "keptResult"> {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    const { ok, message, ...rest } = result as Record<string, unknown>;
    if (ok === true && Object.keys(rest).length === 0 && (message === undefined || typeof message === "string")) return { answer: message ?? "" };
  }
  return { answer: "", keptResult: result };
}

/** O teste gravado, nos campos da tela. */
export function toDraft(name: string, turns: AgentTestTurns): TestDraft {
  return {
    name,
    turns: turns.map((turn) => ({
      user: turn.user,
      tools: (turn.expect?.tools ?? []).map((tool) => ({ tool: tool.tool, args: Object.entries(tool.args ?? {}).map(([field, matcher]) => argOf(field, matcher)), ...answerOf(tool.result) })),
      onlyThese: turn.expect?.onlyThese ?? true,
      forbid: turn.expect?.forbid ?? [],
      says: (turn.expect?.says ?? []).join("\n"),
      saysNot: (turn.expect?.saysNot ?? []).join("\n"),
    })),
  };
}

/** Os campos da tela, no formato que o banco guarda. Os campos vazios não entram. */
export function toTurns(draft: TestDraft): AgentTestTurns {
  return draft.turns.map((turn): AgentTestTurn => {
    const tools = turn.tools.map((tool) => {
      const args = Object.fromEntries(tool.args.filter((arg) => arg.field.trim() !== "").map((arg) => [arg.field.trim(), matcherOf(arg)]));
      const result = tool.answer.trim() !== "" ? { ok: true, message: tool.answer.trim() } : tool.keptResult !== undefined ? tool.keptResult : { ok: true };
      return { tool: tool.tool, ...(Object.keys(args).length > 0 && { args }), result };
    });
    const says = lines(turn.says);
    const saysNot = lines(turn.saysNot);
    const expect = {
      ...(tools.length > 0 && { tools }),
      ...(!turn.onlyThese && { onlyThese: false }),
      ...(turn.forbid.length > 0 && { forbid: turn.forbid }),
      ...(says.length > 0 && { says }),
      ...(saysNot.length > 0 && { saysNot }),
    };
    return { user: turn.user.trim(), ...(Object.keys(expect).length > 0 && { expect }) };
  });
}

/** O que está errado no formulário, numa chave do dicionário e no lugar dela. */
export type DraftProblem =
  | { problem: "nameMissing" | "nameTooLong" | "noTurns" | "tooManyTurns" }
  | { problem: "userMissing" | "userTooLong"; turn: number }
  | { problem: "toolMissing"; turn: number; tool: number }
  | { problem: "fieldMissing" | "valueMissing" | "numberInvalid"; turn: number; tool: number; arg: number };

/** Os problemas do formulário, na ordem da tela. Vazio: pode salvar. */
export function draftProblems(draft: TestDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const name = draft.name.trim();
  if (name === "") problems.push({ problem: "nameMissing" });
  else if (name.length > NAME_MAX) problems.push({ problem: "nameTooLong" });
  if (draft.turns.length === 0) problems.push({ problem: "noTurns" });
  if (draft.turns.length > MAX_TURNS) problems.push({ problem: "tooManyTurns" });
  draft.turns.forEach((turn, t) => {
    if (turn.user.trim() === "") problems.push({ problem: "userMissing", turn: t });
    else if (turn.user.trim().length > MAX_USER_CHARACTERS) problems.push({ problem: "userTooLong", turn: t });
    turn.tools.forEach((tool, i) => {
      if (tool.tool.trim() === "") problems.push({ problem: "toolMissing", turn: t, tool: i });
      tool.args.forEach((arg, a) => {
        const where = { turn: t, tool: i, arg: a };
        if (arg.field.trim() === "") problems.push({ problem: "fieldMissing", ...where });
        else if ((arg.kind === "equalsText" || arg.kind === "contains") && arg.value.trim() === "") problems.push({ problem: "valueMissing", ...where });
        else if (arg.kind === "equalsNumber" && !Number.isFinite(Number(arg.value.trim().replace(",", ".")))) problems.push({ problem: "numberInvalid", ...where });
        else if (arg.kind === "equalsNumber" && arg.value.trim() === "") problems.push({ problem: "numberInvalid", ...where });
      });
    });
  });
  return problems;
}

/** As ferramentas que o teste pode esperar: as do agente, mais as que o teste já cita. */
export function toolChoices(agentTools: readonly string[], handoff: boolean, draft: TestDraft): string[] {
  const names = new Set(agentTools);
  if (handoff) names.add("transfer_to_agent");
  for (const turn of draft.turns) {
    for (const tool of turn.tools) if (tool.tool) names.add(tool.tool);
    for (const name of turn.forbid) names.add(name);
  }
  return [...names];
}
