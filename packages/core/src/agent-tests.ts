// Os testes do agente (item 7 da pesquisa Vapi, seção 5.2 de
// docs/specs/2026-11-21-testes-do-agente.md): o formato do teste, o juiz de cada turno e o retrato
// da configuração. Funções puras: nada aqui fala com banco, motor ou ferramenta.
import { createHash } from "node:crypto";
import { z } from "zod";

/** Como um argumento da ferramenta é conferido. Só os campos citados no teste são conferidos. */
export type ArgMatcher = { equals: string | number | boolean | null } | { contains: string } | { present: true };

export interface ToolExpectation {
  /** Nome da ferramenta, como em `agents.tools`. */
  tool: string;
  /** Só os campos citados são conferidos; os outros ficam livres. */
  args?: Record<string, ArgMatcher>;
  /** O que o teste devolve ao modelo no lugar da ferramenta. Nenhuma ferramenta roda num teste. */
  result: unknown;
}

export interface TurnExpectation {
  /** Todas têm de acontecer neste turno, em qualquer ordem. */
  tools?: ToolExpectation[];
  /** Padrão `true`: chamar outra ferramenta reprova. */
  onlyThese?: boolean;
  /** Ferramentas que não podem ser chamadas. */
  forbid?: string[];
  /** Trechos que a fala do agente precisa ter. */
  says?: string[];
  /** Trechos que a fala do agente não pode ter. */
  saysNot?: string[];
}

/** Um turno: o que quem liga diz (`user`, de 1 a 1 000 caracteres) e o que se espera do agente. */
export interface AgentTestTurn {
  user: string;
  expect?: TurnExpectation;
}
/** De 1 a 12 turnos. */
export type AgentTestTurns = AgentTestTurn[];

export const AGENT_TEST_MAX_TURNS = 12;
export const AGENT_TEST_MAX_USER_CHARACTERS = 1000;

const text = z.string().min(1);
const argMatcher = z.union([
  z.strictObject({ equals: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  z.strictObject({ contains: text }),
  z.strictObject({ present: z.literal(true) }),
]);
const toolExpectation = z.strictObject({
  tool: text,
  args: z.record(z.string(), argMatcher).optional(),
  // Obrigatório: sem resposta escrita, o modelo receberia a recusa de ferramenta sem resposta.
  result: z.custom<unknown>((value) => value !== undefined, { message: "result is required" }),
});
const turnExpectation = z.strictObject({
  tools: z.array(toolExpectation).optional(),
  onlyThese: z.boolean().optional(),
  forbid: z.array(text).optional(),
  says: z.array(text).optional(),
  saysNot: z.array(text).optional(),
});
const agentTestTurn = z.strictObject({
  // A fala em branco também é vazia: o motor receberia nada.
  user: z.string().max(AGENT_TEST_MAX_USER_CHARACTERS).refine((value) => value.trim().length > 0, { message: "user must not be empty" }),
  expect: turnExpectation.optional(),
});

/** O teste como o banco guarda (`agent_tests.turns`). O banco não interpreta: quem grava e quem lê passam por aqui. */
export const agentTestTurns: z.ZodType<AgentTestTurns> = z.array(agentTestTurn).min(1).max(AGENT_TEST_MAX_TURNS);

/** O que aconteceu num turno: as ferramentas que o modelo pediu (com os argumentos como vieram) e a fala dele. */
export interface HappenedTurn {
  /** `args` como o motor entregou: objeto, ou o texto JSON que o provedor mandou. */
  tools: { name: string; args: unknown }[];
  says: string;
}

/** O vocabulário fechado das reprovações. */
export const TURN_FAILURE_REASONS = ["tool_missing", "tool_unexpected", "tool_forbidden", "args_mismatch", "args_invalid_json", "text_missing", "text_forbidden"] as const;
export type TurnFailureReason = (typeof TURN_FAILURE_REASONS)[number];

/** Uma reprovação, com o esperado e o que veio, para a tela mostrar lado a lado. */
export interface TurnFailure {
  reason: TurnFailureReason;
  detail: { expected: unknown; got: unknown };
}

export interface TurnVerdict {
  passed: boolean;
  failures: TurnFailure[];
}

/** Ignora maiúsculas e acentos: `NFD` e sem as marcas. */
const folded = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type ParsedArgs = { ok: true; value: Record<string, unknown> } | { ok: false; raw: string };

function parseArgs(args: unknown): ParsedArgs {
  let value = args;
  if (typeof args === "string") {
    try {
      value = JSON.parse(args);
    } catch {
      return { ok: false, raw: args };
    }
  }
  // Argumentos que não são objeto (ou nenhum) não têm campo: todo campo citado falta.
  return { ok: true, value: value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {} };
}

function matches(matcher: ArgMatcher, value: unknown): boolean {
  if ("equals" in matcher) return (typeof value === "string" ? value.trim() : value) === matcher.equals;
  if ("contains" in matcher) return typeof value === "string" && folded(value).includes(folded(matcher.contains));
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function argsMatch(expected: Record<string, ArgMatcher> | undefined, got: Record<string, unknown>): boolean {
  return Object.entries(expected ?? {}).every(([field, matcher]) => matches(matcher, got[field]));
}

/**
 * Confere um turno. Sem expectativa, vale a vazia: nenhuma ferramenta pode ser chamada (o executor
 * não tem resposta escrita para dar), e a fala é livre.
 *
 * Cada ferramenta esperada casa com uma chamada de mesmo nome; com várias de mesmo nome, vale a
 * primeira cujos argumentos batem. A chamada de nome esperado que não bate é a que reprova o
 * argumento, e não conta de novo como inesperada.
 */
export function judgeTurn(expect: TurnExpectation | undefined, happened: HappenedTurn): TurnVerdict {
  const failures: TurnFailure[] = [];
  const calls = happened.tools.map((call) => ({ ...call, parsed: parseArgs(call.args), used: false }));
  const forbidden = new Set(expect?.forbid ?? []);

  for (const wanted of expect?.tools ?? []) {
    const sameName = calls.filter((call) => !call.used && call.name === wanted.tool);
    const hit = sameName.find((call) => call.parsed.ok && argsMatch(wanted.args, call.parsed.value));
    if (hit) {
      hit.used = true;
      continue;
    }
    const first = sameName[0];
    if (!first) {
      failures.push({ reason: "tool_missing", detail: { expected: { tool: wanted.tool, args: wanted.args ?? {} }, got: happened.tools.map((call) => call.name) } });
      continue;
    }
    first.used = true;
    if (!first.parsed.ok) failures.push({ reason: "args_invalid_json", detail: { expected: { tool: wanted.tool, args: wanted.args ?? {} }, got: first.parsed.raw } });
    else failures.push({ reason: "args_mismatch", detail: { expected: { tool: wanted.tool, args: wanted.args ?? {} }, got: { tool: first.name, args: first.parsed.value } } });
  }

  for (const call of calls) {
    if (forbidden.has(call.name)) {
      failures.push({ reason: "tool_forbidden", detail: { expected: { forbid: [...forbidden] }, got: { tool: call.name, args: call.parsed.ok ? call.parsed.value : call.parsed.raw } } });
    } else if (!call.used && (expect?.onlyThese ?? true)) {
      failures.push({ reason: "tool_unexpected", detail: { expected: (expect?.tools ?? []).map((tool) => tool.tool), got: { tool: call.name, args: call.parsed.ok ? call.parsed.value : call.parsed.raw } } });
    }
  }

  const said = folded(happened.says);
  for (const snippet of expect?.says ?? []) {
    if (!said.includes(folded(snippet))) failures.push({ reason: "text_missing", detail: { expected: snippet, got: happened.says } });
  }
  for (const snippet of expect?.saysNot ?? []) {
    if (said.includes(folded(snippet))) failures.push({ reason: "text_forbidden", detail: { expected: snippet, got: happened.says } });
  }

  return { passed: failures.length === 0, failures };
}

/** A ferramenta como o motor a recebe (o `ToolSpec` de `@deskvoice/voice-engine`). */
export interface ConfigHashTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** JSON com as chaves em ordem: o mesmo objeto dá sempre o mesmo texto. A ordem das listas fica. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * O retrato do que o modelo recebe: as instruções já compostas, as ferramentas oferecidas (na ordem
 * em que são oferecidas), o motor, o modelo e o idioma. sha256 em hexadecimal. Se o da última rodada
 * é diferente do de agora, a configuração mudou desde então.
 */
export function configHash(input: { instructions: string; tools: readonly ConfigHashTool[]; engine: string; model: string | null; language: string }): string {
  const picked = {
    instructions: input.instructions,
    tools: input.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    engine: input.engine,
    model: input.model,
    language: input.language,
  };
  return createHash("sha256").update(canonical(picked)).digest("hex");
}
