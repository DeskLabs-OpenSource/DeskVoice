// A tela dos testes do agente (item 7, fatia 7c, seção 6.1 de docs/specs/2026-11-21-testes-do-agente.md),
// pelas rotas do painel contra o processo de voz de verdade: a API interna, o executor da 7b e o
// motor simulado em modo texto. O teste é criado pelo formulário (os campos da tela viram o corpo por
// `toTurns`), roda pelo botão e é lido como a tela lê, até a rodada acabar.
import { withOrg, withSystem } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { createSimulatedEngine, SIMULATED_PREFIX, type SimulatedScript } from "@deskvoice/voice-engine";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { agentTestState, startAgentTest, type AgentTestDeps } from "../../../../../voice/src/agent-test";
import { startInternalApi } from "../../../../../voice/src/internal-api";
import { createAgent, fakeClock, manualEngine, testSchedule } from "../../../../../voice/src/testing/db";
import { call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { blankTest, blankTool, toTurns, type TestDraft } from "../../(app)/agents/[id]/tests/form";
import { pollRun } from "../../(app)/agents/[id]/tests/poll";
import type { RunDetail, TestsList } from "../../(app)/agents/[id]/tests/view";
import { PATCH as patchAgent } from "./agents/[id]/route";
import { GET as listTests, POST as createTest } from "./agents/[id]/tests/route";
import { DELETE as deleteTest, PATCH as editTest } from "./agents/[id]/tests/[testId]/route";
import { POST as runTest } from "./agents/[id]/tests/[testId]/run/route";
import { GET as readRun } from "./agents/[id]/tests/[testId]/runs/[runId]/route";

const panel = startPanel();
const INTERNAL_TOKEN = "internal-test-token";
const unused = async (): Promise<never> => {
  throw new Error("not part of this test");
};
const timers = testSchedule();
const deps: AgentTestDeps = {
  db: panel.app,
  clock: fakeClock(),
  // O simulado roda teste; o motor manual, não (não tem `textMode`).
  engines: new Map([
    ["simulated", createSimulatedEngine()],
    ["manual", manualEngine({ keyless: true }).engine],
  ]),
  tools: await loadTools(),
  schedule: timers.schedule,
};
const started: Promise<unknown>[] = [];
// A mesma ligação do `server.ts`: a rodada segue em segundo plano, e a rota devolve só o id.
const voice = await startInternalApi({
  port: 0,
  host: "127.0.0.1",
  token: INTERNAL_TOKEN,
  handlers: {
    health: unused,
    applyTrunks: unused,
    outbound: unused,
    simulate: unused,
    web: unused,
    stopRecording: unused,
    whatsappCalls: { state: unused, connect: unused, disconnect: unused },
    async runAgentTest(input) {
      const run = await startAgentTest(deps, input);
      if (!("runId" in run)) return run;
      started.push(run.done);
      return { runId: run.runId };
    },
    agentTestState: (input) => agentTestState(deps, input),
  },
});

beforeEach(() => {
  panel.deps.fetch = (input, init) => fetch(input, init);
  panel.deps.voiceUrl = `http://127.0.0.1:${voice.port}`;
  panel.deps.internalToken = INTERNAL_TOKEN;
});
afterAll(async () => {
  await Promise.allSettled(started);
  await voice.close();
  await panel.close();
});

const script = (steps: SimulatedScript): string => SIMULATED_PREFIX + JSON.stringify(steps);
/** O "modelo" do simulado: anota a pendência da Marina e confirma. `title` muda na sabotagem. */
const marina = (title = "Remarcar a limpeza de pele da Marina", closing = "Pronto, a recepção retorna."): SimulatedScript => [
  { expectUserAudio: 1000 },
  { say: "Vou anotar o pedido para a recepção." },
  { toolCall: { name: "create_task", args: { title, details: "Prefere sexta de manhã." } } },
  { say: closing },
];

/** O teste como quem edita o agente preenche o formulário: uma fala, uma ferramenta, um campo e um trecho. */
function formDraft(): TestDraft {
  const draft = blankTest();
  draft.name = "Remarcação da Marina";
  const [turn] = draft.turns;
  if (!turn) throw new Error("blank test without a turn");
  turn.user = "Aqui é a Marina, preciso remarcar a limpeza de pele para sexta.";
  turn.tools = [{ ...blankTool("create_task"), args: [{ field: "title", kind: "contains", value: "Marina" }], answer: "Pendência aberta." }];
  turn.says = "recepção";
  return draft;
}

async function organization(label: string, options: { engine?: string; steps?: SimulatedScript } = {}) {
  const organizationId = await createOrganization(panel.app, label);
  const admin = await createUser(panel.app, organizationId, "admin");
  const operator = await createUser(panel.app, organizationId, "operator");
  const agentId = await createAgent(panel.app, organizationId, { engine: options.engine ?? "simulated", tools: ["create_task", "end_call"], instructions: script(options.steps ?? marina()) });
  return { organizationId, admin, operator, agentId };
}

const list = async (cookie: string, agentId: string): Promise<TestsList> => {
  const answer = await call(listTests, { cookie, params: { id: agentId } });
  expect(answer.status).toBe(200);
  return answer.data as TestsList;
};
const create = (cookie: string, agentId: string, draft: TestDraft = formDraft()) => call(createTest, { method: "POST", cookie, params: { id: agentId }, body: { name: draft.name, turns: toTurns(draft) } });
const run = (cookie: string, agentId: string, testId: string) => call(runTest, { method: "POST", cookie, params: { id: agentId, testId } });
const read = (cookie: string, agentId: string, testId: string, runId: string) => call(readRun, { cookie, params: { id: agentId, testId, runId } });

/** Roda pelo botão e consulta como a tela consulta (`pollRun`), até a rodada acabar. */
async function runAndFollow(cookie: string, agentId: string, testId: string): Promise<RunDetail> {
  const answer = await run(cookie, agentId, testId);
  expect(answer.status).toBe(200);
  const { runId } = answer.data as { runId: string };
  const outcome = await pollRun(
    async () => {
      const got = await read(cookie, agentId, testId, runId);
      expect(got.status).toBe(200);
      return got.data as RunDetail;
    },
    { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), intervalMs: 20, giveUpMs: 30_000 },
  );
  if (!outcome.finished) throw new Error("the run did not finish");
  return outcome.run;
}

describe("a tela dos testes do agente, pelas rotas", { timeout: 180_000 }, () => {
  it("quem edita cria pelo formulário, roda e vê 'passou'; o teste gravado é o do formulário", async () => {
    const org = await organization("agent-tests-pass");
    const created = await create(org.admin.cookie, org.agentId);
    expect(created.status).toBe(200);
    const testId = (created.data as { id: string }).id;

    const before = await list(org.admin.cookie, org.agentId);
    expect(before.textMode).toBe(true);
    expect(before.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(before.tests).toEqual([expect.objectContaining({ id: testId, name: "Remarcação da Marina", lastRun: null, stale: false, turns: toTurns(formDraft()) })]);

    const result = await runAndFollow(org.admin.cookie, org.agentId, testId);
    expect(result.status).toBe("passed");
    expect(result.turns).toEqual([
      expect.objectContaining({
        user: "Aqui é a Marina, preciso remarcar a limpeza de pele para sexta.",
        tools: [{ name: "create_task", args: expect.objectContaining({ title: "Remarcar a limpeza de pele da Marina" }), result: { ok: true, message: "Pendência aberta." } }],
        verdict: { passed: true, failures: [] },
      }),
    ]);
    // O retrato da rodada é o que a lista diz ser o de agora.
    expect(result.configHash).toBe(before.configHash);
    expect((await list(org.admin.cookie, org.agentId)).tests[0]).toMatchObject({ lastRun: { id: result.id, status: "passed" }, stale: false });
  });

  it("o roteiro que muda o argumento reprova, com o esperado e o que veio para a tela pôr lado a lado", async () => {
    const org = await organization("agent-tests-fail", { steps: marina("Remarcar a limpeza de pele") });
    const testId = ((await create(org.admin.cookie, org.agentId)).data as { id: string }).id;

    const result = await runAndFollow(org.admin.cookie, org.agentId, testId);

    expect(result.status).toBe("failed");
    expect(result.turns[0]?.verdict.failures).toEqual([
      {
        reason: "args_mismatch",
        detail: {
          expected: { tool: "create_task", args: { title: { contains: "Marina" } } },
          got: { tool: "create_task", args: expect.objectContaining({ title: "Remarcar a limpeza de pele" }) },
        },
      },
    ]);
  });

  it("mudar as instruções faz aparecer 'não rodado com a configuração atual', e rodar de novo faz sumir", async () => {
    const org = await organization("agent-tests-stale");
    const testId = ((await create(org.admin.cookie, org.agentId)).data as { id: string }).id;
    await runAndFollow(org.admin.cookie, org.agentId, testId);
    expect((await list(org.admin.cookie, org.agentId)).tests[0]?.stale).toBe(false);

    // A mudança pela tela do agente, como quem edita faria.
    const patched = await call(patchAgent, { method: "PATCH", cookie: org.admin.cookie, params: { id: org.agentId }, body: { instructions: script(marina(undefined, "Pronto, a recepção retorna ainda hoje.")) } });
    expect(patched.status).toBe(200);
    const changed = await list(org.admin.cookie, org.agentId);
    expect(changed.tests[0]?.stale).toBe(true);
    // Quem só vê o agente vê o mesmo aviso.
    expect((await list(org.operator.cookie, org.agentId)).tests[0]?.stale).toBe(true);

    const again = await runAndFollow(org.admin.cookie, org.agentId, testId);
    expect(again.configHash).toBe(changed.configHash);
    expect((await list(org.admin.cookie, org.agentId)).tests[0]).toMatchObject({ lastRun: { id: again.id }, stale: false });
  });

  it("quem só vê o agente vê os testes e os resultados; criar, editar, rodar e apagar respondem 403 e nada muda", async () => {
    const org = await organization("agent-tests-viewer");
    const testId = ((await create(org.admin.cookie, org.agentId)).data as { id: string }).id;
    const result = await runAndFollow(org.admin.cookie, org.agentId, testId);

    expect((await list(org.operator.cookie, org.agentId)).tests).toEqual([expect.objectContaining({ id: testId, lastRun: expect.objectContaining({ status: "passed" }) })]);
    expect((await read(org.operator.cookie, org.agentId, testId, result.id)).data).toMatchObject({ status: "passed", turns: result.turns });

    const draft = formDraft();
    const body = { name: "Outro", turns: toTurns(draft) };
    const refused = [
      await call(createTest, { method: "POST", cookie: org.operator.cookie, params: { id: org.agentId }, body }),
      await call(editTest, { method: "PATCH", cookie: org.operator.cookie, params: { id: org.agentId, testId }, body }),
      await run(org.operator.cookie, org.agentId, testId),
      await call(deleteTest, { method: "DELETE", cookie: org.operator.cookie, params: { id: org.agentId, testId } }),
    ];
    expect(refused.map((answer) => [answer.status, answer.code])).toEqual([
      [403, "forbidden"],
      [403, "forbidden"],
      [403, "forbidden"],
      [403, "forbidden"],
    ]);
    const after = await list(org.admin.cookie, org.agentId);
    expect(after.tests.map((test) => [test.name, test.lastRun?.id])).toEqual([["Remarcação da Marina", result.id]]);
  });

  it("quem edita edita e apaga; as rodadas vão junto, e a outra organização não vê nem roda o teste", async () => {
    const org = await organization("agent-tests-edit");
    const other = await organization("agent-tests-edit-other");
    const testId = ((await create(org.admin.cookie, org.agentId)).data as { id: string }).id;

    const renamed = { ...formDraft(), name: "Marina, sexta" };
    expect((await call(editTest, { method: "PATCH", cookie: org.admin.cookie, params: { id: org.agentId, testId }, body: { name: renamed.name, turns: toTurns(renamed) } })).status).toBe(200);
    expect((await list(org.admin.cookie, org.agentId)).tests.map((test) => test.name)).toEqual(["Marina, sexta"]);

    // A outra organização: nem pelo agente dela, nem pelo agente desta.
    expect((await call(listTests, { cookie: other.admin.cookie, params: { id: org.agentId } })).status).toBe(404);
    expect((await run(other.admin.cookie, other.agentId, testId)).status).toBe(404);
    expect((await run(other.admin.cookie, org.agentId, testId)).status).toBe(404);
    expect((await call(deleteTest, { method: "DELETE", cookie: other.admin.cookie, params: { id: other.agentId, testId } })).status).toBe(404);

    await runAndFollow(org.admin.cookie, org.agentId, testId);
    expect((await call(deleteTest, { method: "DELETE", cookie: org.admin.cookie, params: { id: org.agentId, testId } })).status).toBe(200);
    expect((await list(org.admin.cookie, org.agentId)).tests).toEqual([]);
    const runsLeft = await withOrg(panel.app, org.organizationId, (q) => q.one<{ n: number }>("select count(*)::int as n from agent_test_runs where test_id = $1", [testId]));
    expect(runsLeft?.n).toBe(0);
  });

  it("o formulário que a tela deixaria passar e o banco recusa volta 400; o 21º teste do agente volta 409 com o teto", async () => {
    const org = await organization("agent-tests-limits");
    const invalid = await call(createTest, { method: "POST", cookie: org.admin.cookie, params: { id: org.agentId }, body: { name: "Vazio", turns: [] } });
    expect([invalid.status, invalid.code]).toEqual([400, "validation_error"]);

    for (let index = 0; index < 20; index += 1) expect((await create(org.admin.cookie, org.agentId)).status).toBe(200);
    const over = await create(org.admin.cookie, org.agentId);
    expect([over.status, over.code]).toEqual([409, "agent_tests_limit"]);
    expect(JSON.parse(over.text).error.detail).toEqual({ limit: 20 });
  });

  it("num motor sem textMode a lista diz `textMode: false` e rodar volta a recusa do processo de voz, sem criar rodada", async () => {
    const org = await organization("agent-tests-no-text", { engine: "manual" });
    const testId = ((await create(org.admin.cookie, org.agentId)).data as { id: string }).id;

    const listed = await list(org.admin.cookie, org.agentId);
    expect([listed.textMode, listed.configHash]).toEqual([false, null]);
    const refused = await run(org.admin.cookie, org.agentId, testId);
    expect([refused.status, refused.code]).toEqual([422, "engine_no_text_mode"]);
    const runs = await withSystem(panel.app, (q) => q.one<{ n: number }>("select count(*)::int as n from agent_test_runs where test_id = $1", [testId]));
    expect(runs?.n).toBe(0);
  });

  it("com o processo de voz fora do ar, a lista ainda abre, sem afirmar que a configuração mudou", async () => {
    const org = await organization("agent-tests-voice-down");
    const testId = ((await create(org.admin.cookie, org.agentId)).data as { id: string }).id;
    await runAndFollow(org.admin.cookie, org.agentId, testId);

    panel.deps.voiceUrl = "http://127.0.0.1:9";
    const listed = await list(org.admin.cookie, org.agentId);
    expect([listed.textMode, listed.configHash]).toEqual([null, null]);
    expect(listed.tests[0]).toMatchObject({ lastRun: { status: "passed" }, stale: false });
  });

  it("a consulta para na rodada fechada como `process_restarted`, e a tela não fica girando", async () => {
    const org = await organization("agent-tests-orphan");
    const testId = ((await create(org.admin.cookie, org.agentId)).data as { id: string }).id;
    const runId = await withOrg(panel.app, org.organizationId, async (q) => {
      const row = await q.one<{ id: string }>(
        "insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at) values ($1, $2, 'running', 'simulated', 'x', $3) returning id",
        [org.organizationId, testId, new Date("2026-03-01T14:00:00Z")],
      );
      return row?.id ?? "";
    });
    let reads = 0;
    const poll = pollRun(
      async () => {
        reads += 1;
        // Na segunda leitura, o processo de voz já reiniciou e fechou a rodada órfã.
        if (reads === 2) {
          await withOrg(panel.app, org.organizationId, (q) =>
            q.exec("update agent_test_runs set status = 'error', error_code = 'process_restarted', finished_at = $2 where id = $1", [runId, new Date("2026-03-01T14:08:00Z")]),
          );
        }
        return (await read(org.operator.cookie, org.agentId, testId, runId)).data as RunDetail;
      },
      { sleep: async () => undefined, intervalMs: 10, giveUpMs: 10_000 },
    );
    const outcome = await poll;
    expect(outcome).toMatchObject({ finished: true, run: { status: "error", errorCode: "process_restarted" } });
    expect(reads).toBe(2);
  });
});
