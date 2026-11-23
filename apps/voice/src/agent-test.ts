// O executor do teste do agente (item 7 da pesquisa Vapi, seção 5.4 de
// docs/specs/2026-11-21-testes-do-agente.md), fatia 7a: só motor com `textMode` e sem chave (o
// simulado). A rota interna, os motores reais e o custo no extrato são da 7b.
//
// Nenhuma ferramenta roda num teste. Este arquivo não importa `runTool` (a cerca
// `fences/agent-test-runs-no-tool.test.ts` confere): no pedido de ferramenta, ele grava a chamada no
// turno e devolve ao modelo o `result` escrito no teste. Teste não é ligação: nada vai para `calls`
// nem para `call_events`.
import {
  agentTestTurns,
  configHash,
  judgeTurn,
  withOrg,
  type AgentTestTurn,
  type Clock,
  type Db,
  type HappenedTurn,
  type ToolExpectation,
  type TurnVerdict,
} from "@deskvoice/core";
import { toSpec, type Tool } from "@deskvoice/tools";
import type { VoiceEngine, VoiceSession, VoiceSessionConfig } from "@deskvoice/voice-engine";
import { messageOf, silentLogger, type Logger } from "./log";
import { realSchedule, type Schedule } from "./transport";

/** Quanto um turno espera a resposta do agente terminar. Estourou: `error`, `turn_timeout`. */
export const AGENT_TEST_TURN_TIMEOUT_MS = 30_000;
/** Quantos pedidos de ferramenta cabem num turno. Passou: `error`, `tool_loop`. */
export const AGENT_TEST_MAX_TOOL_CALLS_PER_TURN = 8;
/** Quantas rodadas cada teste guarda. A gravação de uma rodada nova apaga as mais velhas. */
export const AGENT_TEST_RUNS_KEPT = 20;

/** O que o modelo recebe quando pede uma ferramenta sem resposta escrita no teste. */
export const NO_WRITTEN_RESULT = { ok: false, message: "Em teste: esta ferramenta não tem resposta escrita no teste." } as const;

export type AgentTestErrorCode = "turn_timeout" | "tool_loop" | "engine_failed";
export type AgentTestStatus = "passed" | "failed" | "error";

export interface AgentTestDeps {
  db: Db;
  clock: Clock;
  engines: Map<string, VoiceEngine>;
  tools: Map<string, Tool>;
  schedule?: Schedule;
  log?: Logger;
}

/** Um turno da rodada, como fica gravado em `agent_test_runs.turns`. */
export interface AgentTestRunTurn {
  user: string;
  says: string;
  tools: { name: string; args: unknown; result: unknown }[];
  verdict: TurnVerdict;
}

export interface AgentTestOutcome {
  status: AgentTestStatus;
  errorCode: AgentTestErrorCode | null;
  turns: AgentTestRunTurn[];
}

export type StartedAgentTest = { runId: string; configHash: string; done: Promise<AgentTestOutcome> } | { code: "test_not_found" | "engine_no_text_mode" | "engine_not_configured" | "invalid_test"; message: string };

interface TestRow {
  agent_id: string;
  turns: unknown;
  instructions: string;
  greeting: string | null;
  engine: string;
  language: string;
  agent_tools: string[];
}

/**
 * As ferramentas que o motor recebe no teste: as marcadas no agente, sem as que não estão
 * instaladas ou não têm a peça de que dependem. A passagem entre agentes não entra: o teste não
 * troca de agente. A 7b passa a montar isto pelo mesmo arquivo da ligação (`session-config.ts`).
 */
function offeredTools(names: readonly string[], installed: Map<string, Tool>): Tool[] {
  return names.flatMap((name) => {
    const tool = installed.get(name);
    return tool && tool.available !== false && tool.offeredBySession !== true ? [tool] : [];
  });
}

/**
 * Começa uma rodada do teste e devolve assim que ela está gravada como `running`; a conversa segue
 * em segundo plano (`done`). As recusas de antes de começar não criam rodada.
 *
 * `overrides.instructions` troca as instruções do agente, como a chamada simulada faz com o roteiro
 * (`SIMULATED_PREFIX`). O retrato (`config_hash`) é do que o motor recebeu de fato.
 */
export async function startAgentTest(
  deps: AgentTestDeps,
  input: { organizationId: string; testId: string; requestedBy?: string | null },
  overrides: { instructions?: string } = {},
): Promise<StartedAgentTest> {
  const { db, clock } = deps;
  const { organizationId } = input;
  const log = deps.log ?? silentLogger;
  const schedule = deps.schedule ?? realSchedule;

  const row = await withOrg(db, organizationId, (q) =>
    q.one<TestRow>(
      `select t.agent_id, t.turns, a.instructions, a.greeting, a.engine, a.language, a.tools as agent_tools
         from agent_tests t join agents a on a.organization_id = t.organization_id and a.id = t.agent_id
        where t.id = $1`,
      [input.testId],
    ),
  );
  if (!row) return { code: "test_not_found", message: "This test does not exist in this organization." };
  const parsed = agentTestTurns.safeParse(row.turns);
  if (!parsed.success) return { code: "invalid_test", message: `The saved test is not valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}` };
  const engine = deps.engines.get(row.engine);
  if (!engine?.textMode) return { code: "engine_no_text_mode", message: `The voice engine "${row.engine}" does not run tests yet.` };
  // Fatia 7a: só motor sem chave. Ler a chave da organização e medir o custo é da 7b.
  if (!engine.keyless) return { code: "engine_not_configured", message: `The voice engine "${row.engine}" needs a key, and tests with a key are not available yet.` };

  const instructions = overrides.instructions ?? row.instructions;
  const tools = offeredTools(row.agent_tools, deps.tools).map(toSpec);
  const config: VoiceSessionConfig = { instructions, greeting: row.greeting ?? undefined, language: row.language, tools, mode: "text" };
  const hash = configHash({ instructions, tools, engine: engine.id, model: null, language: row.language });

  const runId = await withOrg(db, organizationId, async (q) => {
    const run = await q.one<{ id: string }>(
      "insert into agent_test_runs (organization_id, test_id, status, engine, model, config_hash, requested_by, started_at) values ($1, $2, 'running', $3, null, $4, $5, $6) returning id",
      [organizationId, input.testId, engine.id, hash, input.requestedBy ?? null, clock.now()],
    );
    if (!run) throw new Error("Agent test run was not created");
    // A retenção: ficam as rodadas mais novas do teste, a de agora entre elas.
    await q.exec(
      `delete from agent_test_runs where test_id = $1 and id not in (
         select id from agent_test_runs where test_id = $1 order by started_at desc, id desc limit $2)`,
      [input.testId, AGENT_TEST_RUNS_KEPT],
    );
    return run.id;
  });

  const done = converse(engine, config, parsed.data, schedule)
    .catch((error: unknown): AgentTestOutcome => {
      log("error", "agent test run failed", { runId, error: messageOf(error) });
      return { status: "error", errorCode: "engine_failed", turns: [] };
    })
    .then(async (outcome) => {
      await withOrg(db, organizationId, (q) =>
        q.exec("update agent_test_runs set status = $2, error_code = $3, turns = $4, finished_at = $5 where id = $1 and status = 'running'", [
          runId,
          outcome.status,
          outcome.errorCode,
          JSON.stringify(outcome.turns),
          clock.now(),
        ]),
      );
      return outcome;
    });
  return { runId, configHash: hash, done };
}

/** A conversa do teste, turno a turno, contra a sessão em modo texto. Nunca roda ferramenta. */
async function converse(engine: VoiceEngine, config: VoiceSessionConfig, turns: AgentTestTurn[], schedule: Schedule): Promise<AgentTestOutcome> {
  const voice: VoiceSession = await engine.connect(config, "");
  const recorded: AgentTestRunTurn[] = [];
  // O que o agente faz entre o texto de quem liga e o `turnDone`. Antes do primeiro texto, vale a
  // abertura: a fala dela não é julgada, mas a ferramenta pedida nela conta no primeiro turno.
  let bucket: { says: string[]; tools: AgentTestRunTurn["tools"] } = { says: [], tools: [] };
  let expectations: ToolExpectation[] = [];
  let used = new Set<ToolExpectation>();
  let waiter: ((ended: "done" | "closed" | "tool_loop") => void) | undefined;
  let closed = false;
  let failed = false;
  const settle = (ended: "done" | "closed" | "tool_loop"): void => {
    const resolve = waiter;
    waiter = undefined;
    resolve?.(ended);
  };

  voice.on("transcript", (turn) => {
    if (turn.speaker === "agent") bucket.says.push(turn.text);
  });
  voice.on("toolCall", (call) => {
    // Casa pelo nome com uma resposta escrita ainda não usada neste turno.
    const written = expectations.find((expectation) => expectation.tool === call.name && !used.has(expectation));
    if (written) used.add(written);
    const result = written ? written.result : NO_WRITTEN_RESULT;
    bucket.tools.push({ name: call.name, args: call.args, result });
    if (bucket.tools.length > AGENT_TEST_MAX_TOOL_CALLS_PER_TURN) {
      settle("tool_loop");
      return;
    }
    voice.sendToolResult(call.id, result);
  });
  voice.on("turnDone", () => settle("done"));
  voice.on("error", () => {
    failed = true;
  });
  voice.on("closed", () => {
    closed = true;
    settle("closed");
  });

  const wait = (): Promise<"done" | "closed" | "tool_loop" | "timeout"> =>
    new Promise((resolve) => {
      if (closed) return resolve("closed");
      const cancel = schedule(() => {
        waiter = undefined;
        resolve("timeout");
      }, AGENT_TEST_TURN_TIMEOUT_MS);
      waiter = (ended) => {
        cancel();
        resolve(ended);
      };
    });

  const finish = async (outcome: AgentTestOutcome): Promise<AgentTestOutcome> => {
    await voice.close();
    return outcome;
  };
  const verdicts = (): AgentTestStatus => (recorded.every((turn) => turn.verdict.passed) ? "passed" : "failed");

  try {
    // Com saudação, o agente fala primeiro, como na ligação: o turno 1 começa depois da abertura.
    if (config.greeting) {
      const opened = await wait();
      if (opened === "timeout") return await finish({ status: "error", errorCode: "turn_timeout", turns: recorded });
      if (opened === "tool_loop") return await finish({ status: "error", errorCode: "tool_loop", turns: recorded });
      if (opened === "closed") return await finish({ status: "error", errorCode: "engine_failed", turns: recorded });
    }
    for (const [index, turn] of turns.entries()) {
      bucket = { says: [], tools: index === 0 ? bucket.tools : [] };
      expectations = turn.expect?.tools ?? [];
      used = new Set();
      if (closed) return await finish({ status: "error", errorCode: "engine_failed", turns: recorded });
      const ended = wait();
      voice.sendUserText?.(turn.user);
      const how = await ended;
      const happened: HappenedTurn = { tools: bucket.tools.map(({ name, args }) => ({ name, args })), says: bucket.says.join(" ") };
      const record: AgentTestRunTurn = { user: turn.user, says: happened.says, tools: bucket.tools, verdict: judgeTurn(turn.expect, happened) };
      if (how === "timeout") return await finish({ status: "error", errorCode: "turn_timeout", turns: [...recorded, record] });
      if (how === "tool_loop") return await finish({ status: "error", errorCode: "tool_loop", turns: [...recorded, record] });
      recorded.push(record);
      // A sessão caiu: com erro do motor, ou antes do último turno, a rodada não terminou.
      if (how === "closed" && (failed || index < turns.length - 1)) return await finish({ status: "error", errorCode: "engine_failed", turns: recorded });
    }
    return await finish({ status: verdicts(), errorCode: null, turns: recorded });
  } catch (error) {
    await voice.close().catch(() => undefined);
    throw error;
  }
}
