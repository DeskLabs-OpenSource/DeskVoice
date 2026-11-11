import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { openTestDbs } from "../../core/test/helpers";
import { createFixture, eventsOf, t0, type FakeContext } from "../test/helpers";
import { defineTool } from "./define-tool";
import { runTool } from "./run-tool";
import endCall from "./tools/end_call";

const { app, owner } = openTestDbs();
let ctx: FakeContext;

beforeAll(async () => {
  ctx = await createFixture(app, "run-tool");
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

const lastTwo = async (): Promise<{ kind: string; payload: Record<string, unknown>; at: Date }[]> => (await eventsOf(app, ctx.callId)).slice(-2);

describe("runTool", () => {
  it("executa a ferramenta e grava tool_called com os argumentos e tool_result com o desfecho", async () => {
    const result = await runTool(endCall, { reason: "a pessoa se despediu" }, ctx);
    expect(result).toEqual({ ok: true, message: expect.stringContaining("encerrada") });
    expect(ctx.hangups).toBe(1);
    expect(await lastTwo()).toEqual([
      { kind: "tool_called", at: t0, payload: { name: "end_call", args: { reason: "a pessoa se despediu" } } },
      { kind: "tool_result", at: t0, payload: { name: "end_call", ok: true, message: result.message } },
    ]);
  });

  it("devolve ok: false explicando o que corrigir quando a entrada é inválida, sem executar nem lançar", async () => {
    const before = ctx.hangups;
    for (const bad of [{}, { reason: 42 }, undefined, "texto solto"]) {
      const result = await runTool(endCall, bad, ctx);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Argumentos inválidos para end_call/);
      expect(result.message).toMatch(/chame a ferramenta de novo/);
    }
    expect((await runTool(endCall, {}, ctx)).message).toContain("reason");
    expect(ctx.hangups).toBe(before);
    const [called, finished] = await lastTwo();
    expect(called).toMatchObject({ kind: "tool_called", payload: { name: "end_call", args: {} } });
    expect(finished).toMatchObject({ kind: "tool_result", payload: { name: "end_call", ok: false } });
  });

  it("transforma exceção da ferramenta em resposta que o agente pode dizer, sem vazar o erro para o modelo", async () => {
    const exploding = defineTool({
      name: "exploding",
      description: "Ferramenta de teste",
      inputSchema: z.object({}),
      async run() {
        throw new Error("connect ECONNREFUSED 10.0.0.7:5432 at Socket.internal");
      },
    });
    const result = await runTool(exploding, {}, ctx);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Não consegui concluir isso agora/) });
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|Socket|10\.0\.0\.7/);
    const [, finished] = await lastTwo();
    // O motivo fica na linha do tempo, para o operador.
    expect(finished).toEqual({ kind: "tool_result", at: t0, payload: { name: "exploding", ok: false, message: result.message, error: "connect ECONNREFUSED 10.0.0.7:5432 at Socket.internal" } });
  });

  it("entrega à ferramenta a entrada já validada, com os padrões aplicados", async () => {
    let received: unknown;
    const echo = defineTool({
      name: "echo",
      description: "Ferramenta de teste",
      inputSchema: z.object({ times: z.number().int().default(3) }),
      async run(input) {
        received = input;
        return { ok: true, message: "ok" };
      },
    });
    await runTool(echo, {}, ctx);
    expect(received).toEqual({ times: 3 });
  });
});
