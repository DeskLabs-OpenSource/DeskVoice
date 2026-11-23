import { describe, expect, it } from "vitest";
import { agentTestTurns, configHash, judgeTurn, TURN_FAILURE_REASONS, type TurnExpectation } from "./agent-tests";

const task = (args: unknown) => ({ name: "create_task", args });
const expectTask: TurnExpectation = {
  tools: [{ tool: "create_task", args: { title: { contains: "marina" }, priority: { equals: "alta" }, details: { present: true } }, result: { ok: true } }],
  says: ["Recepção"],
  saysNot: ["desconto"],
};

describe("judgeTurn", () => {
  it("passa quando a ferramenta, os argumentos citados e a fala batem (sem maiúsculas nem acentos, e com espaço em volta do equals)", () => {
    const verdict = judgeTurn(expectTask, { tools: [task({ title: "Retornar para MARÍNA", priority: "  alta ", details: "x", extra: 1 })], says: "Vou avisar a recepcao." });
    expect(verdict).toEqual({ passed: true, failures: [] });
  });

  it("aceita os argumentos em texto JSON, como o provedor manda", () => {
    expect(judgeTurn(expectTask, { tools: [task('{"title":"Marina","priority":"alta","details":"y"}')], says: "recepção" }).passed).toBe(true);
  });

  it("tool_missing: a ferramenta esperada não veio, com o esperado e o que veio", () => {
    expect(judgeTurn(expectTask, { tools: [], says: "recepção" }).failures).toEqual([
      { reason: "tool_missing", detail: { expected: { tool: "create_task", args: expectTask.tools?.[0]?.args }, got: [] } },
    ]);
  });

  it("tool_unexpected: outra ferramenta veio, e por padrão só as esperadas valem", () => {
    const verdict = judgeTurn({ tools: [] }, { tools: [{ name: "notify_human", args: { message: "oi" } }], says: "" });
    expect(verdict.failures).toEqual([{ reason: "tool_unexpected", detail: { expected: [], got: { tool: "notify_human", args: { message: "oi" } } } }]);
    // Sem expectativa nenhuma, também: o teste não tem resposta escrita para dar.
    expect(judgeTurn(undefined, { tools: [{ name: "end_call", args: {} }], says: "" }).failures.map((f) => f.reason)).toEqual(["tool_unexpected"]);
    // Com `onlyThese: false`, a ferramenta a mais passa.
    expect(judgeTurn({ onlyThese: false }, { tools: [{ name: "notify_human", args: {} }], says: "" }).passed).toBe(true);
  });

  it("tool_forbidden: a ferramenta proibida veio, mesmo com onlyThese falso", () => {
    expect(judgeTurn({ onlyThese: false, forbid: ["transfer_to_human"] }, { tools: [{ name: "transfer_to_human", args: { reason: "x" } }], says: "" }).failures).toEqual([
      { reason: "tool_forbidden", detail: { expected: { forbid: ["transfer_to_human"] }, got: { tool: "transfer_to_human", args: { reason: "x" } } } },
    ]);
  });

  it("args_mismatch: a ferramenta veio, mas um argumento citado não bate; o que não foi citado fica livre", () => {
    const verdict = judgeTurn(expectTask, { tools: [task({ title: "Retornar para Paula", priority: "alta", details: "x" })], says: "recepção" });
    expect(verdict.failures).toEqual([
      { reason: "args_mismatch", detail: { expected: { tool: "create_task", args: expectTask.tools?.[0]?.args }, got: { tool: "create_task", args: { title: "Retornar para Paula", priority: "alta", details: "x" } } } },
    ]);
    // equals não ignora maiúsculas.
    expect(judgeTurn(expectTask, { tools: [task({ title: "Marina", priority: "Alta", details: "x" })], says: "recepção" }).failures.map((f) => f.reason)).toEqual(["args_mismatch"]);
    // present não aceita vazio nem ausente.
    expect(judgeTurn(expectTask, { tools: [task({ title: "Marina", priority: "alta", details: "  " })], says: "recepção" }).failures.map((f) => f.reason)).toEqual(["args_mismatch"]);
    expect(judgeTurn(expectTask, { tools: [task({ title: "Marina", priority: "alta" })], says: "recepção" }).failures.map((f) => f.reason)).toEqual(["args_mismatch"]);
  });

  it("args_invalid_json: o argumento não é JSON válido", () => {
    expect(judgeTurn(expectTask, { tools: [task('{"title": "Marina"')], says: "recepção" }).failures).toEqual([
      { reason: "args_invalid_json", detail: { expected: { tool: "create_task", args: expectTask.tools?.[0]?.args }, got: '{"title": "Marina"' } },
    ]);
  });

  it("text_missing: a fala não tem o trecho pedido", () => {
    expect(judgeTurn({ says: ["recepção"] }, { tools: [], says: "Vou anotar." }).failures).toEqual([{ reason: "text_missing", detail: { expected: "recepção", got: "Vou anotar." } }]);
  });

  it("text_forbidden: a fala tem o trecho proibido, sem olhar maiúsculas nem acentos", () => {
    expect(judgeTurn({ saysNot: ["desconto"] }, { tools: [], says: "Posso dar DESCONTÓ." }).failures).toEqual([{ reason: "text_forbidden", detail: { expected: "desconto", got: "Posso dar DESCONTÓ." } }]);
  });

  it("cobre o vocabulário fechado inteiro (os 7 motivos)", () => {
    expect([...TURN_FAILURE_REASONS].sort()).toEqual(["args_invalid_json", "args_mismatch", "text_forbidden", "text_missing", "tool_forbidden", "tool_missing", "tool_unexpected"]);
  });

  it("duas expectativas do mesmo nome casam com duas chamadas; a terceira chamada é inesperada", () => {
    const two: TurnExpectation = {
      tools: [
        { tool: "notify_human", args: { message: { contains: "b" } }, result: 1 },
        { tool: "notify_human", args: { message: { contains: "a" } }, result: 2 },
      ],
    };
    const calls = [
      { name: "notify_human", args: { message: "a" } },
      { name: "notify_human", args: { message: "b" } },
    ];
    expect(judgeTurn(two, { tools: calls, says: "" }).passed).toBe(true);
    expect(judgeTurn(two, { tools: [...calls, { name: "notify_human", args: { message: "c" } }], says: "" }).failures.map((f) => f.reason)).toEqual(["tool_unexpected"]);
  });
});

describe("agentTestTurns", () => {
  const turn = { user: "Oi" };

  it("aceita de 1 a 12 turnos", () => {
    expect(agentTestTurns.safeParse([turn]).success).toBe(true);
    expect(agentTestTurns.safeParse(Array.from({ length: 12 }, () => turn)).success).toBe(true);
  });

  it("recusa 0 e 13 turnos", () => {
    expect(agentTestTurns.safeParse([]).success).toBe(false);
    expect(agentTestTurns.safeParse(Array.from({ length: 13 }, () => turn)).success).toBe(false);
  });

  it("recusa fala vazia, em branco ou com mais de 1 000 caracteres, e aceita 1 000", () => {
    expect(agentTestTurns.safeParse([{ user: "" }]).success).toBe(false);
    expect(agentTestTurns.safeParse([{ user: "   " }]).success).toBe(false);
    expect(agentTestTurns.safeParse([{ user: "a".repeat(1001) }]).success).toBe(false);
    expect(agentTestTurns.safeParse([{ user: "a".repeat(1000) }]).success).toBe(true);
  });

  it("recusa campo desconhecido, matcher fora do vocabulário e ferramenta esperada sem resultado escrito", () => {
    expect(agentTestTurns.safeParse([{ user: "Oi", extra: 1 }]).success).toBe(false);
    expect(agentTestTurns.safeParse([{ user: "Oi", expect: { tools: [{ tool: "x", args: { a: { regex: ".*" } }, result: 1 } ] } }]).success).toBe(false);
    expect(agentTestTurns.safeParse([{ user: "Oi", expect: { tools: [{ tool: "x" }] } }]).success).toBe(false);
    expect(agentTestTurns.safeParse([{ user: "Oi", expect: { tools: [{ tool: "x", args: { a: { equals: null } }, result: null }] } }]).success).toBe(true);
  });
});

describe("configHash", () => {
  const base = { instructions: "Você é a Lia.", tools: [{ name: "end_call", description: "Encerra", parameters: { type: "object", properties: { reason: { type: "string" } } } }], engine: "simulated", model: null, language: "pt-BR" };

  it("é sha256 em hexadecimal e não depende da ordem das chaves", () => {
    const hash = configHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(configHash({ ...base, tools: [{ parameters: { properties: { reason: { type: "string" } }, type: "object" }, description: "Encerra", name: "end_call" }] })).toBe(hash);
  });

  it("muda quando muda o que o modelo recebe", () => {
    const hash = configHash(base);
    for (const changed of [
      { ...base, instructions: "Você é a Ana." },
      { ...base, tools: [] },
      { ...base, engine: "openai-realtime" },
      { ...base, model: "gpt-realtime" },
      { ...base, language: "en" },
      { ...base, tools: [{ ...base.tools[0]!, description: "Desliga" }] },
    ]) {
      expect(configHash(changed)).not.toBe(hash);
    }
  });
});
