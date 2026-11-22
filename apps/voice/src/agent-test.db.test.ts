// O executor do teste do agente (item 7, fatia 7a, seção 5.4 de
// docs/specs/2026-11-21-testes-do-agente.md), contra o banco, com o motor simulado em modo texto.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withOrg, withSystem, type AgentTestTurns, type Db } from "@deskvoice/core";
import { runTool } from "@deskvoice/tools";
import { createSimulatedEngine, SIMULATED_PREFIX, type SimulatedScript, type VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { createFixture, fakeFetch, fakeLookup, putSetting, secretKey } from "../../../packages/tools/test/helpers";
import { createCallWebhook } from "../../../packages/tools/src/tools/call_webhook";
import { loadTools } from "@deskvoice/tools";
import { AGENT_TEST_RUNS_KEPT, AGENT_TEST_TURN_TIMEOUT_MS, NO_WRITTEN_RESULT, startAgentTest, type AgentTestDeps } from "./agent-test";
import { LIA_TEST_TURNS, liaTestScript } from "./cli/demo-agent-test";
import { closeOrphanTestRuns } from "./reconcile";
import { startVoiceServer } from "./server";
import { createAgent, createOrganization, fakeAri, fakeClock, testSchedule } from "./testing/db";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const LIA_GREETING = "Clínica Bem Viver, bom dia. Aqui é a Lia. Como posso ajudar?";
const LIA_TOOLS = ["create_task", "notify_human", "request_approval", "transfer_to_human", "end_call"];
const script = (steps: SimulatedScript): string => SIMULATED_PREFIX + JSON.stringify(steps);

async function harness(engines: VoiceEngine[] = [createSimulatedEngine()], tools?: AgentTestDeps["tools"]) {
  const clock = fakeClock();
  const timers = testSchedule();
  const deps: AgentTestDeps = { db: app, clock, engines: new Map(engines.map((engine) => [engine.id, engine])), tools: tools ?? (await loadTools()), schedule: timers.schedule };
  return { deps, clock, timers };
}

async function createTest(db: Db, organizationId: string, agentId: string, turns: AgentTestTurns = LIA_TEST_TURNS): Promise<string> {
  const row = await withOrg(db, organizationId, (q) =>
    q.one<{ id: string }>("insert into agent_tests (organization_id, agent_id, name, turns) values ($1, $2, 'Teste', $3) returning id", [organizationId, agentId, JSON.stringify(turns)]),
  );
  if (!row) throw new Error("test not created");
  return row.id;
}

interface RunRow {
  id: string;
  status: string;
  error_code: string | null;
  config_hash: string;
  engine: string;
  turns: unknown[];
  started_at: Date;
  finished_at: Date | null;
}
const runsOf = (organizationId: string, testId: string): Promise<RunRow[]> =>
  withOrg(app, organizationId, (q) => q.many<RunRow>("select id, status, error_code, config_hash, engine, turns, started_at, finished_at from agent_test_runs where test_id = $1 order by started_at, id", [testId]));
const countAll = async (table: string, organizationId: string): Promise<number> =>
  (await withSystem(app, (q) => q.one<{ n: number }>(`select count(*)::int as n from ${table} where organization_id = $1`, [organizationId])))?.n ?? -1;

async function liaAgent(label: string, steps: SimulatedScript = liaTestScript()) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { name: "Lia", greeting: LIA_GREETING, tools: LIA_TOOLS, instructions: script(steps) });
  return { organizationId, agentId, testId: await createTest(app, organizationId, agentId) };
}

async function run(deps: AgentTestDeps, organizationId: string, testId: string) {
  const started = await startAgentTest(deps, { organizationId, testId });
  if (!("runId" in started)) throw new Error(`${started.code}: ${started.message}`);
  return { ...started, outcome: await started.done };
}

describe("teste do agente no motor simulado", { timeout: 120_000 }, () => {
  it("o teste da Lia passa, grava a rodada `passed` com o retrato, e nada sai: nem ligação, nem pendência, nem aviso", async () => {
    const lia = await liaAgent("agent-test-pass");
    const { deps, clock } = await harness();
    const { runId, configHash, outcome } = await run(deps, lia.organizationId, lia.testId);

    expect(outcome.status).toBe("passed");
    expect(outcome.turns.map((turn) => turn.verdict)).toEqual([
      { passed: true, failures: [] },
      { passed: true, failures: [] },
    ]);
    // A abertura (a saudação) não entra no primeiro turno; a fala de cada turno é a do roteiro.
    expect(outcome.turns[0]?.says).toBe("Claro, Marina. Vou deixar o pedido de remarcação anotado para a recepção confirmar o novo horário com você. Pronto, a recepção já tem o pedido e retorna para confirmar.");
    // O modelo recebeu o `result` escrito no teste, e não o de uma ferramenta.
    expect(outcome.turns.map((turn) => turn.tools.map((tool) => [tool.name, tool.result]))).toEqual([
      [["create_task", { ok: true, message: "Pendência aberta para a recepção." }]],
      [["end_call", { ok: true, message: "A ligação vai ser encerrada." }]],
    ]);

    const [row] = await runsOf(lia.organizationId, lia.testId);
    expect(row).toMatchObject({ id: runId, status: "passed", error_code: null, engine: "simulated", config_hash: configHash, finished_at: clock.now() });
    expect(row?.config_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.turns).toHaveLength(2);
    for (const table of ["calls", "call_events", "follow_ups", "notifications", "tasks", "approvals", "usage_ledger"]) {
      expect(await countAll(table, lia.organizationId), table).toBe(0);
    }
  });

  it("trocar a ferramenta no roteiro reprova com tool_missing e tool_unexpected, com o esperado e o que veio", async () => {
    const steps = liaTestScript().map((step) => ("toolCall" in step && step.toolCall.name === "create_task" ? { toolCall: { name: "notify_human", args: { message: "Marina quer remarcar para sexta.", urgency: "normal" } } } : step));
    const lia = await liaAgent("agent-test-swap-tool", steps);
    const { deps } = await harness();
    const { outcome } = await run(deps, lia.organizationId, lia.testId);

    expect(outcome.status).toBe("failed");
    expect(outcome.turns[0]?.verdict.failures).toEqual([
      { reason: "tool_missing", detail: { expected: { tool: "create_task", args: { title: { contains: "marina" }, details: { contains: "sexta" } } }, got: ["notify_human"] } },
      { reason: "tool_unexpected", detail: { expected: ["create_task"], got: { tool: "notify_human", args: { message: "Marina quer remarcar para sexta.", urgency: "normal" } } } },
    ]);
    // A ferramenta sem resposta escrita recebe a recusa do teste.
    expect(outcome.turns[0]?.tools[0]?.result).toEqual(NO_WRITTEN_RESULT);
    expect(outcome.turns[1]?.verdict.passed).toBe(true);
    expect((await runsOf(lia.organizationId, lia.testId))[0]).toMatchObject({ status: "failed", error_code: null });
  });

  it("trocar um argumento no roteiro reprova com args_mismatch, com o esperado e o que veio", async () => {
    const details = "Ela tem limpeza de pele marcada para quinta às 14h e quer outro horário na quinta.";
    const steps = liaTestScript().map((step) => ("toolCall" in step && step.toolCall.name === "create_task" ? { toolCall: { name: "create_task", args: { ...(step.toolCall.args as object), details } } } : step));
    const lia = await liaAgent("agent-test-swap-arg", steps);
    const { deps } = await harness();
    const { outcome } = await run(deps, lia.organizationId, lia.testId);

    expect(outcome.status).toBe("failed");
    expect(outcome.turns[0]?.verdict.failures).toEqual([
      {
        reason: "args_mismatch",
        detail: {
          expected: { tool: "create_task", args: { title: { contains: "marina" }, details: { contains: "sexta" } } },
          got: { tool: "create_task", args: { title: "Confirmar com Marina Duarte o novo horário da limpeza de pele", details } },
        },
      },
    ]);
  });

  it("nenhum webhook sai: a ferramenta call_webhook pedida no teste não chega ao servidor falso, e a mesma ferramenta, rodada, chega", async () => {
    const net = fakeFetch(() => new Response('{"ok":true}'));
    const webhook = createCallWebhook({ fetch: net.fetch, lookup: fakeLookup(), secretKey: () => secretKey });
    const tools = new Map([...(await loadTools())].map(([name, tool]) => [name, name === "call_webhook" ? webhook : tool]));
    const organizationId = await createOrganization(app, "agent-test-webhook");
    await putSetting(app, organizationId, "webhooks.allowed", [{ name: "abrir_chamado", url: "https://desk.example.com/tickets" }]);
    const agentId = await createAgent(app, organizationId, {
      tools: ["call_webhook", "create_task"],
      instructions: script([
        { expectUserAudio: 1 },
        { toolCall: { name: "call_webhook", args: { name: "abrir_chamado", payload: { assunto: "remarcação" } } } },
        { toolCall: { name: "create_task", args: { title: "x" } } },
      ]),
    });
    const testId = await createTest(app, organizationId, agentId, [
      { user: "Quero abrir um chamado.", expect: { tools: [{ tool: "call_webhook", args: { name: { equals: "abrir_chamado" } }, result: { ok: true, data: { status: 200 } } }], onlyThese: false } },
    ]);
    const { deps } = await harness([createSimulatedEngine()], tools);
    const { outcome } = await run(deps, organizationId, testId);

    expect(outcome.status).toBe("passed");
    expect(outcome.turns[0]?.tools.map((tool) => tool.name)).toEqual(["call_webhook", "create_task"]);
    expect(net.requests).toEqual([]);
    expect(await countAll("follow_ups", organizationId)).toBe(0);

    // O controle: o mesmo objeto de ferramenta, rodado por `runTool`, chega ao servidor falso.
    const ctx = await createFixture(app, "agent-test-webhook-control");
    await putSetting(app, ctx.organizationId, "webhooks.allowed", [{ name: "abrir_chamado", url: "https://desk.example.com/tickets" }]);
    expect((await runTool(webhook, { name: "abrir_chamado" }, ctx)).ok).toBe(true);
    expect(net.requests).toHaveLength(1);
  });

  it("a organização B não lê nem roda o teste da A, e a recusa não cria rodada", async () => {
    const lia = await liaAgent("agent-test-org-a");
    const other = await createOrganization(app, "agent-test-org-b");
    const { deps } = await harness();

    expect(await startAgentTest(deps, { organizationId: other, testId: lia.testId })).toMatchObject({ code: "test_not_found" });
    expect(await withOrg(app, other, (q) => q.many("select id from agent_tests where id = $1", [lia.testId]))).toEqual([]);
    await run(deps, lia.organizationId, lia.testId);
    expect(await withOrg(app, other, (q) => q.many("select id from agent_test_runs where test_id = $1", [lia.testId]))).toEqual([]);
    expect(await countAll("agent_test_runs", other)).toBe(0);
    expect(await countAll("agent_test_runs", lia.organizationId)).toBe(1);
  });

  it("guarda as 20 rodadas mais novas: a 21ª apaga a mais velha; apagar o teste leva as rodadas", async () => {
    const lia = await liaAgent("agent-test-retention");
    const { deps, clock } = await harness();
    const old = await withOrg(app, lia.organizationId, async (q) => {
      const ids: string[] = [];
      for (let i = 0; i < AGENT_TEST_RUNS_KEPT; i++) {
        const row = await q.one<{ id: string }>(
          "insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at, finished_at) values ($1, $2, 'passed', 'simulated', 'x', $3, $3) returning id",
          [lia.organizationId, lia.testId, new Date(clock.now().getTime() - (AGENT_TEST_RUNS_KEPT - i) * 60_000)],
        );
        if (row) ids.push(row.id);
      }
      return ids;
    });
    const { runId } = await run(deps, lia.organizationId, lia.testId);

    const kept = (await runsOf(lia.organizationId, lia.testId)).map((row) => row.id);
    expect(kept).toHaveLength(AGENT_TEST_RUNS_KEPT);
    expect(kept).not.toContain(old[0]);
    expect(kept).toEqual([...old.slice(1), runId]);

    await withOrg(app, lia.organizationId, (q) => q.exec("delete from agent_tests where id = $1", [lia.testId]));
    expect(await countAll("agent_test_runs", lia.organizationId)).toBe(0);
  });

  it("mais de 8 ferramentas num turno param a rodada com error/tool_loop", async () => {
    const organizationId = await createOrganization(app, "agent-test-loop");
    const agentId = await createAgent(app, organizationId, {
      tools: ["create_task"],
      instructions: script([{ expectUserAudio: 1 }, ...Array.from({ length: 9 }, () => ({ toolCall: { name: "create_task", args: { title: "x" } } }))]),
    });
    const testId = await createTest(app, organizationId, agentId, [{ user: "Oi", expect: { tools: [{ tool: "create_task", result: { ok: true } }], onlyThese: false } }, { user: "De novo" }]);
    const { deps } = await harness();
    const { outcome } = await run(deps, organizationId, testId);
    expect(outcome).toMatchObject({ status: "error", errorCode: "tool_loop" });
    expect(outcome.turns[0]?.tools).toHaveLength(9);
    expect((await runsOf(organizationId, testId))[0]).toMatchObject({ status: "error", error_code: "tool_loop" });
  });

  it("o turno que passa de 30 s sem resposta para a rodada com error/turn_timeout", async () => {
    const simulated = createSimulatedEngine();
    // Um motor que aceita a sessão em texto e nunca responde.
    const mute: VoiceEngine = {
      ...simulated,
      id: "mute",
      async connect(config, key) {
        const session = await simulated.connect(config, key);
        return {
          on: (event, handler) => (event === "turnDone" ? undefined : session.on(event, handler)),
          sendAudio: () => undefined,
          sendToolResult: () => undefined,
          say: () => undefined,
          closeCallerTurn: () => undefined,
          sendUserText: () => undefined,
          close: () => session.close(),
        };
      },
    };
    const organizationId = await createOrganization(app, "agent-test-timeout");
    const agentId = await createAgent(app, organizationId, { engine: "mute", instructions: script([{ expectUserAudio: 1 }]) });
    const testId = await createTest(app, organizationId, agentId, [{ user: "Oi" }]);
    const { deps, timers } = await harness([mute]);
    const started = await startAgentTest(deps, { organizationId, testId });
    if (!("runId" in started)) throw new Error(started.message);
    await waitFor(async () => timers.held().includes(AGENT_TEST_TURN_TIMEOUT_MS), "the turn deadline to be armed");
    expect(timers.fire(AGENT_TEST_TURN_TIMEOUT_MS)).toBe(1);
    expect(await started.done).toMatchObject({ status: "error", errorCode: "turn_timeout" });
    expect((await runsOf(organizationId, testId))[0]).toMatchObject({ status: "error", error_code: "turn_timeout" });
  });

  it("o motor que cai no meio para a rodada com error/engine_failed", async () => {
    const organizationId = await createOrganization(app, "agent-test-engine-failed");
    const agentId = await createAgent(app, organizationId, { instructions: script([{ expectUserAudio: 1 }, { fail: "o provedor caiu" }]) });
    const testId = await createTest(app, organizationId, agentId, [{ user: "Oi" }, { user: "Alô?" }]);
    const { deps } = await harness();
    expect((await run(deps, organizationId, testId)).outcome).toMatchObject({ status: "error", errorCode: "engine_failed" });
  });

  it("motor sem modo texto não roda teste, e a recusa não cria rodada", async () => {
    const organizationId = await createOrganization(app, "agent-test-no-text");
    const { textMode: _textMode, ...audioOnly } = { ...createSimulatedEngine(), id: "audio-only" };
    const agentId = await createAgent(app, organizationId, { engine: "audio-only" });
    const testId = await createTest(app, organizationId, agentId, [{ user: "Oi" }]);
    const { deps } = await harness([audioOnly]);
    expect(await startAgentTest(deps, { organizationId, testId })).toMatchObject({ code: "engine_no_text_mode" });
    expect(await countAll("agent_test_runs", organizationId)).toBe(0);
  });
});

describe("rodadas órfãs na partida do processo", { timeout: 120_000 }, () => {
  it("a rodada `running` vira error/process_restarted, a `passed` fica intacta, e rodar de novo não muda nada", async () => {
    const clock = fakeClock();
    const first = await liaAgent("agent-test-orphan-a");
    const second = await liaAgent("agent-test-orphan-b");
    const insertRun = (org: { organizationId: string; testId: string }, status: string) =>
      withOrg(app, org.organizationId, (q) =>
        q.one<{ id: string }>(
          "insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at, finished_at) values ($1, $2, $3, 'simulated', 'x', $4, case when $3 = 'running' then null else $4::timestamptz end) returning id",
          [org.organizationId, org.testId, status, clock.now()],
        ),
      );
    const runningA = await insertRun(first, "running");
    const runningB = await insertRun(second, "running");
    const passed = await insertRun(first, "passed");
    const before = (await runsOf(first.organizationId, first.testId)).find((row) => row.id === passed?.id);

    clock.advance(5000);
    const logs: string[] = [];
    expect(await closeOrphanTestRuns(app, clock, (_level, message) => void logs.push(message))).toBeGreaterThanOrEqual(2);
    for (const [org, runRow] of [[first, runningA], [second, runningB]] as const) {
      expect((await runsOf(org.organizationId, org.testId)).find((row) => row.id === runRow?.id)).toMatchObject({ status: "error", error_code: "process_restarted", finished_at: clock.now() });
    }
    expect((await runsOf(first.organizationId, first.testId)).find((row) => row.id === passed?.id)).toEqual(before);
    expect(logs).toContain("agent test runs left open by the previous process were closed");

    clock.advance(5000);
    expect(await closeOrphanTestRuns(app, clock, () => undefined)).toBe(0);
    expect((await runsOf(first.organizationId, first.testId)).find((row) => row.id === runningA?.id)?.finished_at).not.toEqual(clock.now());
  });

  // A fiação na partida, e não a função (coberta acima): sem a chamada em `startVoiceServer`,
  // a rodada órfã continua `running` depois de o processo subir.
  it("subir o processo de voz fecha a rodada `running` que o processo anterior deixou", async () => {
    const org = await liaAgent("agent-test-orphan-startup");
    const clock = fakeClock();
    const orphan = await withOrg(app, org.organizationId, (q) =>
      q.one<{ id: string }>("insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at) values ($1, $2, 'running', 'simulated', 'x', $3) returning id", [org.organizationId, org.testId, clock.now()]),
    );
    clock.advance(5000);
    const scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-agent-test-"));
    const timers = testSchedule();
    const server = await startVoiceServer({
      db: app,
      clock,
      engines: new Map([["simulated", createSimulatedEngine()]]),
      tools: await loadTools(),
      ari: fakeAri(),
      secretKey,
      audioSocketPort: 0,
      internalPort: 0,
      webPort: 0,
      internalToken: "token-de-teste",
      trunksFile: path.join(scratch, "trunks.conf"),
      publicIp: "203.0.113.10",
      host: "127.0.0.1",
      schedule: timers.schedule,
      resolveName: async () => ["192.0.2.53"],
      now: timers.now,
    });
    try {
      expect((await runsOf(org.organizationId, org.testId)).find((row) => row.id === orphan?.id)).toMatchObject({ status: "error", error_code: "process_restarted", finished_at: clock.now() });
    } finally {
      await server.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
