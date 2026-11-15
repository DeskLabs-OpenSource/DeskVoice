import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { openTestDbs } from "../../core/test/helpers";
import { createFixture, eventsOf, t0, type FakeContext } from "../test/helpers";
import { defineTool } from "./define-tool";
import { MAX_AGENDA_MARCAR_PER_CALL, MAX_AGENDA_REMARCAR_PER_CALL, MAX_CALL_WEBHOOK_PER_CALL, MAX_CREATE_TASK_PER_CALL, MAX_NOTIFY_HUMAN_PER_CALL, runTool } from "./run-tool";
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
  it("recusa a chamada que passa do teto de sucesso por ligação, sem executar a ferramenta", async () => {
    let runs = 0;
    const fake = defineTool({
      name: "notify_human",
      description: "Ferramenta de teste, com o teto de produção",
      inputSchema: z.object({}),
      async run() {
        runs += 1;
        return { ok: true, message: "avisado" };
      },
    });

    const allowed = MAX_NOTIFY_HUMAN_PER_CALL;
    for (let i = 0; i < allowed; i += 1) expect((await runTool(fake, {}, ctx)).ok).toBe(true);

    const refusedResult = await runTool(fake, {}, ctx);
    expect(refusedResult.ok).toBe(false);
    expect(refusedResult.message).toContain(`limite de ${allowed} chamadas a notify_human`);
    // A recusa não faz o agente afirmar que um pedido novo foi tratado.
    expect(refusedResult.message).toContain("este pedido não foi registrado");
    expect(refusedResult.message).toContain("Não diga que este pedido foi tratado");
    // A ferramenta não roda de novo: o teto é antes da escrita, não depois dela.
    expect(runs).toBe(allowed);
    // E a recusa deixa rastro na linha do tempo, como qualquer outro desfecho.
    const [, finished] = await lastTwo();
    expect(finished).toMatchObject({ kind: "tool_result", payload: { name: "notify_human", ok: false } });
  });

  it("não gasta a cota quando a chamada é recusada por argumento inválido", async () => {
    let runs = 0;
    const fake = defineTool({
      name: "create_task",
      description: "Ferramenta de teste, com o teto de produção",
      inputSchema: z.object({ quando: z.string() }),
      async run() {
        runs += 1;
        return { ok: true, message: "anotado" };
      },
    });

    const allowed = MAX_CREATE_TASK_PER_CALL;
    for (let i = 0; i < allowed + 2; i += 1) expect((await runTool(fake, {}, ctx)).ok).toBe(false);
    expect(runs).toBe(0);
    for (let i = 0; i < allowed; i += 1) expect((await runTool(fake, { quando: "amanhã" }, ctx)).ok).toBe(true);
    expect(runs).toBe(allowed);
  });

  it("vale para chamadas em paralelo no mesmo turno: só o teto executa, as outras são recusadas", async () => {
    const parallel = await createFixture(app, "run-tool-paralelo");
    const allowed = MAX_AGENDA_MARCAR_PER_CALL;
    const total = allowed + 3;
    let runs = 0;
    const refused: Array<{ ok: boolean; message: string }> = [];
    // Resolve quando toda chamada já decidiu: entrou na ferramenta ou voltou recusada.
    let allDecided: () => void = () => undefined;
    const decided = new Promise<void>((resolve) => (allDecided = resolve));
    const checkDecided = (): void => {
      if (runs + refused.length === total) allDecided();
    };
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    const fake = defineTool({
      name: "agenda_marcar",
      description: "Ferramenta de teste, com o teto de produção",
      inputSchema: z.object({}),
      async run() {
        runs += 1;
        checkDecided();
        await gate;
        return { ok: true, message: "marcado" };
      },
    });

    const pending = Array.from({ length: total }, () =>
      runTool(fake, {}, parallel).then((result) => {
        if (runs + refused.length < total) {
          refused.push(result);
          checkDecided();
        }
        return result;
      }),
    );
    await decided;
    openGate();
    const all = await Promise.all(pending);

    expect(runs).toBe(allowed);
    expect(refused).toHaveLength(3);
    for (const result of refused) expect(result).toMatchObject({ ok: false, message: expect.stringContaining(`limite de ${allowed} chamadas a agenda_marcar`) });
    expect(all.filter((result) => result.ok)).toHaveLength(allowed);
  });

  it("devolve a vaga quando a ferramenta recusa antes de fazer o efeito (noEffect)", async () => {
    const own = await createFixture(app, "run-tool-vaga");
    const allowed = MAX_CALL_WEBHOOK_PER_CALL;
    let refusals = 3;
    const fake = defineTool({
      name: "call_webhook",
      description: "Ferramenta de teste, com o teto de produção",
      inputSchema: z.object({}),
      async run() {
        if (refusals > 0) {
          refusals -= 1;
          return { ok: false, noEffect: true, message: "nada foi chamado" };
        }
        return { ok: true, message: "chamado" };
      },
    });

    const results = [];
    for (let i = 0; i < allowed + 3; i += 1) results.push(await runTool(fake, {}, own));
    expect(results.map((result) => result.ok)).toEqual([false, false, false, ...Array<boolean>(allowed).fill(true)]);
    expect((await runTool(fake, {}, own)).message).toContain(`limite de ${allowed} chamadas a call_webhook`);
  });

  it("na dúvida a vaga fica gasta: ok: false sem noEffect e erro lançado contam como efeito", async () => {
    const own = await createFixture(app, "run-tool-efeito");
    const allowed = MAX_CREATE_TASK_PER_CALL;
    let runs = 0;
    const fake = defineTool({
      name: "create_task",
      description: "Ferramenta de teste, com o teto de produção",
      inputSchema: z.object({}),
      async run() {
        runs += 1;
        if (runs === 1) return { ok: false, message: "escrevi, mas a confirmação falhou" };
        if (runs === 2) throw new Error("falha simulada depois de escrever");
        return { ok: true, message: "anotado" };
      },
    });

    for (let i = 0; i < allowed; i += 1) await runTool(fake, {}, own);
    const refusedResult = await runTool(fake, {}, own);
    expect(runs).toBe(allowed);
    expect(refusedResult.message).toContain(`limite de ${allowed} chamadas a create_task`);
  });

  it("soma os sucessos que o banco já tem às chamadas em paralelo, mesmo depois de a memória esquecer a ligação", async () => {
    const own = await createFixture(app, "run-tool-gravados");
    const allowed = MAX_AGENDA_REMARCAR_PER_CALL;
    const total = 3;
    let runs = 0;
    let parallelRuns = 0;
    const refused: Array<{ ok: boolean; message: string }> = [];
    let allDecided: () => void = () => undefined;
    const decided = new Promise<void>((resolve) => (allDecided = resolve));
    const checkDecided = (): void => {
      if (parallelRuns + refused.length === total) allDecided();
    };
    let gate: Promise<void> = Promise.resolve();
    const fake = defineTool({
      name: "agenda_remarcar",
      description: "Ferramenta de teste, com o teto de produção",
      inputSchema: z.object({}),
      async run() {
        runs += 1;
        if (runs >= allowed) {
          parallelRuns += 1;
          checkDecided();
        }
        await gate;
        return { ok: true, message: "remarcado" };
      },
    });

    for (let i = 0; i < allowed - 1; i += 1) expect((await runTool(fake, {}, own)).ok).toBe(true);
    // Um minuto parado: a memória poda a entrada, e o que veio antes só o banco sabe.
    own.advance(60_000);

    let openGate: () => void = () => undefined;
    gate = new Promise<void>((resolve) => (openGate = resolve));
    const pending = Array.from({ length: total }, () =>
      runTool(fake, {}, own).then((result) => {
        if (parallelRuns + refused.length < total) {
          refused.push(result);
          checkDecided();
        }
        return result;
      }),
    );
    await decided;
    openGate();
    const all = await Promise.all(pending);

    expect(parallelRuns).toBe(1);
    expect(refused).toHaveLength(2);
    for (const result of refused) expect(result).toMatchObject({ ok: false, message: expect.stringContaining(`limite de ${allowed} chamadas a agenda_remarcar`) });
    expect(all.filter((result) => result.ok)).toHaveLength(1);
  });
});
