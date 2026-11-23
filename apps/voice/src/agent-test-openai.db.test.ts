// O teste do agente no OpenAI Realtime em texto, pela rota interna (fatia 7b, seções 5.3 a 5.5 de
// docs/specs/2026-11-21-testes-do-agente.md), contra o banco e um servidor falso do provedor.
//
// Cada recusa de antes de começar passa pela rota, e o servidor falso confere que nenhuma abriu
// conexão. A rodada inteira grava o custo no extrato (`source = 'test'`), e o teto da rodada para a
// conversa antes do turno seguinte.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { costTotal, encryptSecret, withOrg, withSystem, type AgentTestTurns } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { createSimulatedEngine, type VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting, secretKey } from "../../../packages/tools/test/helpers";
import geminiLive from "../../../packages/voice-engine/src/engines/gemini-live";
import openaiRealtime from "../../../packages/voice-engine/src/engines/openai-realtime";
import { startFakeProvider } from "../../../packages/voice-engine/src/testing/fake-provider";
import { AGENT_TEST_RUNS_KEPT, AGENT_TEST_STALE_MS } from "./agent-test";
import { startVoiceServer } from "./server";
import { DEFAULT_RECORDING_NOTICE, engineKeySetting } from "./session-config";
import { createAgent, createOrganization, fakeAri, fakeClock, testSchedule } from "./testing/db";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const TOKEN = "token-de-teste";
type Message = Record<string, unknown>;
const ofType = (type: string) => (message: Message) => message.type === type;
const userText = (message: Message): boolean => {
  const item = message.item as { role?: string; content?: { type: string; text: string }[] } | undefined;
  return message.type === "conversation.item.create" && item?.role === "user";
};

const TURNS: AgentTestTurns = [
  {
    user: "Oi, aqui é a Marina. Queria remarcar minha limpeza de pele de quinta para sexta.",
    expect: { tools: [{ tool: "create_task", args: { title: { contains: "marina" } }, result: { ok: true, message: "Pendência aberta." } }], says: ["recepção"] },
  },
  { user: "Obrigada, era só isso.", expect: { tools: [], says: ["até logo"] } },
];

let fake: Awaited<ReturnType<typeof startFakeProvider>>;
let fakeGemini: Awaited<ReturnType<typeof startFakeProvider>>;
beforeEach(async () => {
  fake = await startFakeProvider();
  fakeGemini = await startFakeProvider();
});
afterEach(async () => {
  await fake.stop();
  await fakeGemini.stop();
});

async function voiceServer() {
  const clock = fakeClock();
  const timers = testSchedule();
  const scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-agent-test-openai-"));
  // Os motores de verdade, só com o endereço trocado pelo do servidor falso.
  const openai: VoiceEngine = { ...openaiRealtime, connect: (config, apiKey) => openaiRealtime.connect(config, apiKey, { baseUrl: fake.url, model: "modelo-x" }) };
  const gemini: VoiceEngine = { ...geminiLive, connect: (config, apiKey) => geminiLive.connect(config, apiKey, { baseUrl: fakeGemini.url, model: "modelo-x" }) };
  const server = await startVoiceServer({
    db: app,
    clock,
    engines: new Map([
      ["simulated", createSimulatedEngine()],
      ["openai-realtime", openai],
      ["gemini-live", gemini],
    ]),
    tools: await loadTools(),
    ari: fakeAri(),
    secretKey,
    audioSocketPort: 0,
    internalPort: 0,
    webPort: 0,
    internalToken: TOKEN,
    trunksFile: path.join(scratch, "trunks.conf"),
    publicIp: "203.0.113.10",
    host: "127.0.0.1",
    schedule: timers.schedule,
    resolveName: async () => ["192.0.2.53"],
    now: timers.now,
  });
  const run = async (body: { organizationId: string; testId: string; requestedBy?: string | null }) => {
    const response = await fetch(`http://127.0.0.1:${server.internalPort}/agent-tests/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": TOKEN },
      body: JSON.stringify({ requestedBy: null, ...body }),
    });
    return { status: response.status, body: (await response.json()) as { runId?: string; code?: string } };
  };
  return {
    clock,
    run,
    async close() {
      await server.close();
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

async function agentWithTest(label: string, options: { engine?: string; key?: boolean; costCeilingCents?: number; turns?: unknown } = {}) {
  const organizationId = await createOrganization(app, label);
  const engine = options.engine ?? "openai-realtime";
  const agentId = await createAgent(app, organizationId, {
    name: "Lia",
    engine,
    instructions: "Você é a Lia, da recepção da Clínica Bem Viver.",
    tools: ["create_task", "end_call"],
    costCeilingCents: options.costCeilingCents ?? 500,
  });
  if (options.key !== false && engine !== "simulated") await putSetting(app, organizationId, engineKeySetting(engine), encryptSecret("sk-teste", secretKey));
  const test = await withOrg(app, organizationId, (q) =>
    q.one<{ id: string }>("insert into agent_tests (organization_id, agent_id, name, turns) values ($1, $2, 'Remarcar', $3) returning id", [organizationId, agentId, JSON.stringify(options.turns ?? TURNS)]),
  );
  if (!test) throw new Error("test not created");
  return { organizationId, agentId, testId: test.id };
}

interface RunRow {
  id: string;
  status: string;
  error_code: string | null;
  turns: { user: string; says: string; tools: { name: string }[]; verdict: { passed: boolean } }[];
  started_at: Date;
}
const runsOf = (organizationId: string): Promise<RunRow[]> =>
  withOrg(app, organizationId, (q) => q.many<RunRow>("select id, status, error_code, turns, started_at from agent_test_runs order by started_at, id"));
const ledgerOf = (organizationId: string) =>
  withSystem(app, (q) =>
    q.many<{ source: string | null; call_id: string | null; test_run_id: string | null; agent_id: string | null; engine: string; input_tokens: number; output_tokens: number; cost_microcents: string }>(
      "select source, call_id, test_run_id, agent_id, engine, input_tokens, output_tokens, cost_microcents::text from usage_ledger where organization_id = $1 order by at, input_tokens",
      [organizationId],
    ),
  );
const callsOf = async (organizationId: string): Promise<number> =>
  (await withSystem(app, (q) => q.one<{ n: number }>("select count(*)::int as n from calls where organization_id = $1", [organizationId])))?.n ?? -1;

/** Abre a sessão do lado do provedor e devolve o `session.update` que o motor mandou. */
async function acceptSession(): Promise<Message> {
  const update = await fake.waitFor(ofType("session.update"));
  fake.send({ type: "session.updated", session: {} });
  return update;
}

/**
 * A abertura: como na ligação recebida, o agente fala primeiro o aviso de gravação (aqui o padrão, sem
 * saudação no agente). O pedido traz o aviso, e a resposta conta no extrato como qualquer outra.
 */
async function answerOpening(spent: { input: number; output: number }): Promise<void> {
  const opening = await fake.waitFor(ofType("response.create"));
  expect(JSON.stringify(opening)).toContain(DEFAULT_RECORDING_NOTICE);
  fake.send({ type: "response.created" });
  fake.send({ type: "response.output_text.done", text: DEFAULT_RECORDING_NOTICE });
  fake.send({ type: "response.done", response: { output: [{ type: "message" }], usage: usage(spent) } });
}

const usage = (text: { input: number; cached?: number; output: number }) => ({
  input_tokens: text.input + (text.cached ?? 0),
  output_tokens: text.output,
  input_token_details: { text_tokens: text.input + (text.cached ?? 0), audio_tokens: 0, cached_tokens: text.cached ?? 0, cached_tokens_details: { text_tokens: text.cached ?? 0, audio_tokens: 0 } },
  output_token_details: { text_tokens: text.output, audio_tokens: 0 },
});

describe("teste do agente no OpenAI Realtime em texto, pela rota interna", { timeout: 120_000 }, () => {
  it("a rodada inteira: sessão em texto, a fala como `input_text`, a ferramenta com o resultado do teste, o custo no extrato com `source = 'test'`", async () => {
    const lia = await agentWithTest("agent-test-openai-pass");
    const voice = await voiceServer();
    try {
      const started = await voice.run({ organizationId: lia.organizationId, testId: lia.testId });
      expect(started.status).toBe(200);
      const runId = started.body.runId;

      // A sessão do teste: as instruções e as ferramentas da ligação, sem nada de áudio.
      const update = await acceptSession();
      const session = update.session as Record<string, unknown>;
      expect(session).toMatchObject({ type: "realtime", output_modalities: ["text"], instructions: expect.stringMatching(/^Você é a Lia/) });
      expect(session).not.toHaveProperty("audio");
      expect((session.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["create_task", "end_call"]);
      await answerOpening({ input: 200, output: 30 });

      // Turno 1: o texto de quem liga, a ferramenta pedida, e a resposta depois do resultado.
      const first = await fake.waitFor(userText);
      expect(first.item).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: TURNS[0]?.user }] });
      await fake.waitFor(ofType("response.create"));
      fake.send({ type: "response.created" });
      fake.send({ type: "response.function_call_arguments.done", call_id: "c1", name: "create_task", arguments: JSON.stringify({ title: "Remarcar Marina para sexta", details: "Limpeza de pele" }) });
      fake.send({ type: "response.done", response: { output: [{ type: "function_call" }], usage: usage({ input: 3000, output: 40 }) } });
      const output = await fake.waitFor(ofType("conversation.item.create"));
      expect(output.item).toEqual({ type: "function_call_output", call_id: "c1", output: JSON.stringify({ ok: true, message: "Pendência aberta." }) });
      await fake.waitFor(ofType("response.create"));
      fake.send({ type: "response.created" });
      fake.send({ type: "response.output_text.done", text: "Pronto, Marina, a recepção já tem o pedido." });
      fake.send({ type: "response.done", response: { output: [{ type: "message" }], usage: usage({ input: 100, cached: 3000, output: 20 }) } });

      // Turno 2: só fala.
      await fake.waitFor(userText);
      await fake.waitFor(ofType("response.create"));
      fake.send({ type: "response.created" });
      fake.send({ type: "response.output_text.done", text: "Até logo!" });
      fake.send({ type: "response.done", response: { output: [{ type: "message" }], usage: usage({ input: 50, cached: 3100, output: 10 }) } });

      const [row] = await waitFor(async () => {
        const runs = await runsOf(lia.organizationId);
        return runs[0]?.status === "running" ? undefined : runs;
      }, "the run to finish");
      expect(row).toMatchObject({ id: runId, status: "passed", error_code: null });
      expect(row?.turns.map((turn) => [turn.says, turn.tools.map((tool) => tool.name), turn.verdict.passed])).toEqual([
        ["Pronto, Marina, a recepção já tem o pedido.", ["create_task"], true],
        ["Até logo!", [], true],
      ]);

      // Quatro `response.done` (a abertura e três respostas), quatro linhas: sem ligação, com a rodada e o agente, no preço de texto.
      const lines = await ledgerOf(lia.organizationId);
      expect(lines).toEqual([
        // A abertura: 200 × US$ 4/M + 30 × US$ 24/M = 0,152 centavo.
        { source: "test", call_id: null, test_run_id: runId, agent_id: lia.agentId, engine: "openai-realtime", input_tokens: 200, output_tokens: 30, cost_microcents: "152000" },
        // 3 000 × US$ 4/M + 40 × US$ 24/M = 1,296 centavo.
        { source: "test", call_id: null, test_run_id: runId, agent_id: lia.agentId, engine: "openai-realtime", input_tokens: 3000, output_tokens: 40, cost_microcents: "1296000" },
        // 100 × 4 + 3 000 × 0,40 (cache) + 20 × 24, por milhão: 0,208 centavo.
        { source: "test", call_id: null, test_run_id: runId, agent_id: lia.agentId, engine: "openai-realtime", input_tokens: 3100, output_tokens: 20, cost_microcents: "208000" },
        { source: "test", call_id: null, test_run_id: runId, agent_id: lia.agentId, engine: "openai-realtime", input_tokens: 3150, output_tokens: 10, cost_microcents: "168000" },
      ]);
      // Teste não é ligação.
      expect(await callsOf(lia.organizationId)).toBe(0);
    } finally {
      await voice.close();
    }
  });

  it("o teto da rodada: o `usage` acima do `cost_ceiling_cents` termina em error/cost_ceiling, e o turno seguinte não sai", async () => {
    const lia = await agentWithTest("agent-test-openai-ceiling", { costCeilingCents: 1 });
    const voice = await voiceServer();
    try {
      const started = await voice.run({ organizationId: lia.organizationId, testId: lia.testId });
      expect(started.status).toBe(200);
      await acceptSession();
      // A abertura gasta 0,04 centavo, abaixo do teto de 1: a rodada segue para o turno 1.
      await answerOpening({ input: 100, output: 0 });
      await fake.waitFor(userText);
      await fake.waitFor(ofType("response.create"));
      fake.send({ type: "response.created" });
      fake.send({ type: "response.output_text.done", text: "Claro, vou anotar para a recepção." });
      // 5 000 × US$ 4/M = 2 centavos, acima do teto de 1.
      fake.send({ type: "response.done", response: { output: [{ type: "message" }], usage: usage({ input: 5000, output: 0 }) } });

      const [row] = await waitFor(async () => {
        const runs = await runsOf(lia.organizationId);
        return runs[0]?.status === "running" ? undefined : runs;
      }, "the run to stop");
      expect(row).toMatchObject({ status: "error", error_code: "cost_ceiling" });
      expect(row?.turns.map((turn) => turn.user)).toEqual([TURNS[0]?.user]);
      // A fala do turno 2 nunca chegou ao provedor.
      expect(fake.hasUnread(userText)).toBe(false);
      expect(await ledgerOf(lia.organizationId)).toMatchObject([
        { source: "test", cost_microcents: "40000" },
        { source: "test", cost_microcents: "2000000" },
      ]);
    } finally {
      await voice.close();
    }
  });

  describe("as recusas de antes de começar: nenhuma cria rodada, nenhuma abre o motor", () => {
    it.each([
      ["spend_cap_reached", { cap: true }],
      ["engine_no_text_mode", { engine: "gemini-live" }],
      ["engine_not_configured", { key: false }],
      ["test_not_found", { unknownTest: true }],
      ["invalid_test", { turns: [] }],
    ] as const)("%s", async (code, options) => {
      const lia = await agentWithTest(`agent-test-refuse-${code}`, {
        ...("engine" in options && { engine: options.engine }),
        ...("key" in options && { key: options.key }),
        ...("turns" in options && { turns: options.turns }),
      });
      // Teto zero: qualquer gasto, nenhum inclusive, já alcança.
      if ("cap" in options) await withSystem(app, (q) => q.exec("insert into organization_limits (organization_id, monthly_spend_cap_cents) values ($1, 0)", [lia.organizationId]));
      const voice = await voiceServer();
      try {
        const testId = "unknownTest" in options ? "0c000000-0000-4000-8000-0000000000ff" : lia.testId;
        expect(await voice.run({ organizationId: lia.organizationId, testId })).toEqual({ status: 409, body: { code, message: expect.any(String) } });
        expect(await runsOf(lia.organizationId)).toEqual([]);
        expect(fake.connections()).toBe(0);
        expect(fakeGemini.connections()).toBe(0);
        expect(await ledgerOf(lia.organizationId)).toEqual([]);
      } finally {
        await voice.close();
      }
    });

    it("test_run_busy: com uma rodada `running` de 1 minuto atrás, recusa, e a de antes continua `running`", async () => {
      const lia = await agentWithTest("agent-test-refuse-busy");
      const voice = await voiceServer();
      try {
        const busy = await withOrg(app, lia.organizationId, (q) =>
          q.one<{ id: string }>("insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at) values ($1, $2, 'running', 'openai-realtime', 'x', $3) returning id", [
            lia.organizationId,
            lia.testId,
            new Date(voice.clock.now().getTime() - 60_000),
          ]),
        );
        expect(await voice.run({ organizationId: lia.organizationId, testId: lia.testId })).toEqual({ status: 409, body: { code: "test_run_busy", message: expect.any(String) } });
        expect((await runsOf(lia.organizationId)).map((row) => [row.id, row.status])).toEqual([[busy?.id, "running"]]);
        expect(fake.connections()).toBe(0);
      } finally {
        await voice.close();
      }
    });
  });

  it("a rodada `running` de 8 minutos atrás foi perdida: a rota aceita a nova e fecha a velha como process_restarted", async () => {
    expect(AGENT_TEST_STALE_MS).toBe(7 * 60_000);
    const lia = await agentWithTest("agent-test-stale");
    const voice = await voiceServer();
    try {
      const stale = await withOrg(app, lia.organizationId, (q) =>
        q.one<{ id: string }>("insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at) values ($1, $2, 'running', 'openai-realtime', 'x', $3) returning id", [
          lia.organizationId,
          lia.testId,
          new Date(voice.clock.now().getTime() - 8 * 60_000),
        ]),
      );
      const started = await voice.run({ organizationId: lia.organizationId, testId: lia.testId });
      expect(started.status).toBe(200);
      const runs = await runsOf(lia.organizationId);
      expect(runs.map((row) => [row.id, row.status, row.error_code])).toEqual([
        [stale?.id, "error", "process_restarted"],
        [started.body.runId, "running", null],
      ]);
      await acceptSession();
    } finally {
      await voice.close();
    }
  });
  it("a retenção apaga a rodada mais velha, e a linha dela no extrato fica, sem rodada, com o total do mês igual", async () => {
    const lia = await agentWithTest("agent-test-retention-ledger");
    const voice = await voiceServer();
    try {
      const now = voice.clock.now();
      const ids: string[] = [];
      for (let index = 0; index < AGENT_TEST_RUNS_KEPT; index += 1) {
        const started = new Date(now.getTime() - (AGENT_TEST_RUNS_KEPT - index) * 3_600_000);
        const run = await withOrg(app, lia.organizationId, (q) =>
          q.one<{ id: string }>(
            "insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at, finished_at) values ($1, $2, 'passed', 'openai-realtime', 'x', $3, $3) returning id",
            [lia.organizationId, lia.testId, started],
          ),
        );
        ids.push(run?.id ?? "");
      }
      // A rodada mais velha gastou 5 centavos.
      await withOrg(app, lia.organizationId, (q) =>
        q.exec(
          "insert into usage_ledger (organization_id, test_run_id, agent_id, engine, seconds, cost_cents, cost_microcents, source, at) values ($1, $2, $3, 'openai-realtime', 0, 5, 5000000, 'test', $4)",
          [lia.organizationId, ids[0], lia.agentId, now],
        ),
      );
      const day = now.toISOString().slice(0, 10);
      const month = () => withOrg(app, lia.organizationId, (q) => costTotal(q, { from: day, to: day }));
      expect((await month()).microcents).toBe(5_000_000);

      const started = await voice.run({ organizationId: lia.organizationId, testId: lia.testId });
      expect(started.status).toBe(200);
      const kept = (await runsOf(lia.organizationId)).map((row) => row.id);
      expect(kept).toHaveLength(AGENT_TEST_RUNS_KEPT);
      expect(kept).not.toContain(ids[0]);
      expect(await ledgerOf(lia.organizationId)).toMatchObject([{ source: "test", call_id: null, test_run_id: null, cost_microcents: "5000000" }]);
      expect((await month()).microcents).toBe(5_000_000);
      await acceptSession();
    } finally {
      await voice.close();
    }
  });
});
