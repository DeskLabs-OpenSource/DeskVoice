import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { openTestDbs } from "../../core/test/helpers";
import { createFixture, eventsOf, notificationsOf, type FakeContext } from "../test/helpers";
import { runTool, toolCalledArgs } from "./run-tool";
import { TEXT_MAX, TOOL_CALLED_ARGS_MAX } from "./text-limits";
import createTask from "./tools/create_task";
import notifyHuman from "./tools/notify_human";
import requestApproval from "./tools/request_approval";
import transferToHuman from "./tools/transfer_to_human";
import type { Tool } from "./types";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const long = (n: number, char = "a"): string => char.repeat(n);

/**
 * Os limites do contrato, escritos como números: o teste não lê o limite da constante. Se alguém
 * muda a constante, a comparação abaixo cai, e os casos de N e N+1 também.
 */
const CONTRACT = { notifyMessage: 1000, approvalQuestion: 300, approvalContext: 1000, taskDetails: 2000, transferReason: 300 };
const ARGS_MAX = 4000;

const approvalExpires = async (_approvalId: string, ctx: FakeContext) => {
  ctx.advance(45_000);
  return "expired" as const;
};

/** Onde o texto aceito fica gravado pelo efeito da ferramenta. */
const cases = [
  {
    tool: notifyHuman,
    field: "message",
    max: CONTRACT.notifyMessage,
    args: (text: string) => ({ message: text }),
    effect: async (ctx: FakeContext) => (await notificationsOf(app, ctx.organizationId))[0]?.body.replace(/^Aviso: /, ""),
  },
  {
    tool: requestApproval,
    field: "question",
    max: CONTRACT.approvalQuestion,
    args: (text: string) => ({ question: text, context: "Cliente antiga." }),
    effect: (ctx: FakeContext) => withSystem(app, async (q) => (await q.one<{ question: string }>("select question from approvals where call_id = $1", [ctx.callId]))?.question),
  },
  {
    tool: requestApproval,
    field: "context",
    max: CONTRACT.approvalContext,
    args: (text: string) => ({ question: "Posso dar desconto?", context: text }),
    effect: (ctx: FakeContext) => withSystem(app, async (q) => (await q.one<{ text: string }>("select context->>'text' as text from approvals where call_id = $1", [ctx.callId]))?.text),
  },
  {
    tool: createTask,
    field: "details",
    max: CONTRACT.taskDetails,
    args: (text: string) => ({ title: "Retornar para Ana", details: text }),
    effect: (ctx: FakeContext) => withSystem(app, async (q) => (await q.one<{ details: string }>("select details from follow_ups where call_id = $1", [ctx.callId]))?.details),
  },
  {
    tool: transferToHuman,
    field: "reason",
    max: CONTRACT.transferReason,
    args: (text: string) => ({ reason: text, summary: "Ana quer falar com o financeiro." }),
    effect: async (ctx: FakeContext) => (await eventsOf(app, ctx.callId)).find((event) => event.kind === "transfer_started")?.payload.reason,
  },
] as const;

const fixture = (label: string) => createFixture(app, label, { transferTo: "+5531999998888", onWait: approvalExpires });

describe("o teto de tamanho dos textos das ferramentas", () => {
  it("as constantes são as do contrato", () => {
    expect(TEXT_MAX).toEqual(CONTRACT);
    expect(TOOL_CALLED_ARGS_MAX).toBe(ARGS_MAX);
  });

  for (const { tool, field, max, args, effect } of cases) {
    it(`${tool.name}.${field} acima de ${max} caracteres é recusado com o limite, sem cortar e sem efeito`, async () => {
      const ctx = await fixture(`teto ${tool.name} ${field}`);
      const result = await runTool(tool, args(long(max + 1)), ctx);

      expect(result.ok).toBe(false);
      expect(result.message).toContain(`${field}: texto longo demais, o máximo é ${max} caracteres`);
      expect(await notificationsOf(app, ctx.organizationId)).toEqual([]);
      expect(ctx.transfers).toEqual([]);
      expect(ctx.waits).toEqual([]);
      expect((await eventsOf(app, ctx.callId)).map((event) => event.kind)).toEqual(["tool_called", "tool_result"]);
    });

    it(`${tool.name}.${field} com exatamente ${max} caracteres passa, e o texto chega inteiro ao efeito`, async () => {
      const ctx = await fixture(`teto exato ${tool.name} ${field}`);
      const text = long(max);
      expect((await runTool(tool, args(text), ctx)).ok).toBe(true);
      expect(await effect(ctx)).toBe(text);
    });

    it(`${tool.name} anuncia ao modelo o limite de ${field}`, () => {
      expect((tool.parameters as { properties: Record<string, { maxLength?: number }> }).properties[field]?.maxLength).toBe(max);
    });
  }
});

/** Ferramenta sem `personalTextArgs` que aceita qualquer texto: mede o teto do registro sozinho. */
const echo: Tool = {
  name: "eco",
  description: "Devolve o texto (teste).",
  parameters: { type: "object", properties: { x: { type: "string" } } },
  inputSchema: z.object({ x: z.string() }),
  run: async () => ({ ok: true, message: "ok" }),
};

const calledArgs = async (callId: string) => (await eventsOf(app, callId)).find((event) => event.kind === "tool_called")?.payload.args;

describe("o teto do registro dos argumentos em tool_called", () => {
  it("texto gigante recusado: o tool_called grava só a marca com o tamanho, e nenhum evento da ligação guarda o texto", async () => {
    const ctx = await fixture("tool_called gigante");
    const message = long(200_000);
    const result = await runTool(notifyHuman, { message }, ctx);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(`message: texto longo demais, o máximo é ${CONTRACT.notifyMessage} caracteres`);
    expect(await calledArgs(ctx.callId)).toEqual({ omitted: "too_long", chars: JSON.stringify({ message }).length });
    const leaked = await withSystem(app, (q) =>
      q.one<{ n: number }>("select count(*)::int as n from call_events where call_id = $1 and position(repeat('a', $2::int) in payload::text) > 0", [ctx.callId, ARGS_MAX + 1]),
    );
    expect(leaked?.n).toBe(0);
  });

  it("o maior argumento válido do request_approval, todo de aspas (o pior escape), é gravado inteiro", async () => {
    const ctx = await fixture("tool_called pior escape");
    const args = { question: long(CONTRACT.approvalQuestion, '"'), context: long(CONTRACT.approvalContext, '"') };
    expect((await runTool(requestApproval, args, ctx)).ok).toBe(true);
    expect(await calledArgs(ctx.callId)).toEqual(args);
  });

  it(`argumento com o JSON de exatamente ${ARGS_MAX} caracteres é gravado inteiro; com ${ARGS_MAX + 1}, vira a marca`, async () => {
    const wrapper = JSON.stringify({ x: "" }).length;
    const exact = { x: long(ARGS_MAX - wrapper) };
    expect(JSON.stringify(exact).length).toBe(ARGS_MAX);
    const atLimit = await fixture("tool_called no teto");
    await runTool(echo, exact, atLimit);
    expect(await calledArgs(atLimit.callId)).toEqual(exact);

    const over = { x: long(ARGS_MAX - wrapper + 1) };
    const aboveLimit = await fixture("tool_called acima do teto");
    await runTool(echo, over, aboveLimit);
    expect(await calledArgs(aboveLimit.callId)).toEqual({ omitted: "too_long", chars: ARGS_MAX + 1 });
  });

  it("a marca vale para ferramenta que não existe, e o texto pessoal continua com a marca dele", () => {
    expect(toolCalledArgs(undefined, { y: long(ARGS_MAX) })).toEqual({ omitted: "too_long", chars: ARGS_MAX + 8 });
    expect(toolCalledArgs(undefined, { y: "curto" })).toEqual({ y: "curto" });
    expect(toolCalledArgs(undefined, undefined)).toBeNull();
    expect(toolCalledArgs(createTask, { details: long(200_000) })).toEqual({ omitted: "personal_text" });
  });

  it("argumento que não serializa vira a marca, sem lançar", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toolCalledArgs(undefined, circular)).toEqual({ omitted: "unserializable" });
    expect(toolCalledArgs(undefined, { n: 1n })).toEqual({ omitted: "unserializable" });
  });
});
