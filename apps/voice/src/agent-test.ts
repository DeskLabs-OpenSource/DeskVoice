// O executor do teste do agente (item 7 da pesquisa Vapi, seções 5.4 e 5.5 de
// docs/specs/2026-11-21-testes-do-agente.md). A 7a trouxe o motor simulado; a 7b, o motor com chave
// (OpenAI Realtime em texto), a rota interna (`POST /agent-tests/run`), as recusas de antes de
// começar, o custo no extrato (`usage_ledger`, `source = 'test'`) e o teto da rodada.
//
// Nenhuma ferramenta roda num teste. Este arquivo não importa `runTool` (a cerca
// `fences/agent-test-runs-no-tool.test.ts` confere): no pedido de ferramenta, ele grava a chamada no
// turno e devolve ao modelo o `result` escrito no teste. Teste não é ligação: nada vai para `calls`
// nem para `call_events`.
import {
  agentTestTurns,
  configHash,
  decryptSecret,
  judgeTurn,
  SPEND_CAP_REACHED,
  spendCapReached,
  withOrg,
  type AgentTestTurn,
  type Clock,
  type Db,
  type HappenedTurn,
  type OrgQuery,
  type ToolExpectation,
  type TurnVerdict,
} from "@deskvoice/core";
import { handoffTargetsOf, type Tool } from "@deskvoice/tools";
import { estimateCostMicrocents, MICROCENTS_PER_CENT, type Usage, type VoiceEngine, type VoiceSession, type VoiceSessionConfig } from "@deskvoice/voice-engine";
import { messageOf, silentLogger, type Logger } from "./log";
import { composeInstructions, enabledToolsFor, engineKeySetting, inboundOpening, RECORDING_NOTICE_SETTING, recordingNoticeOf, sessionConfig, type SessionAgent } from "./session-config";
import { realSchedule, type Schedule } from "./transport";

/** Quanto um turno espera a resposta do agente terminar. Estourou: `error`, `turn_timeout`. */
export const AGENT_TEST_TURN_TIMEOUT_MS = 30_000;
/** Quantos pedidos de ferramenta cabem num turno. Passou: `error`, `tool_loop`. */
export const AGENT_TEST_MAX_TOOL_CALLS_PER_TURN = 8;
/** Quantas rodadas cada teste guarda. A gravação de uma rodada nova apaga as mais velhas. */
export const AGENT_TEST_RUNS_KEPT = 20;
/** Quantos turnos cabem num teste (o mesmo teto de `agentTestTurns`). */
const AGENT_TEST_MAX_TURNS = 12;
/**
 * O teto de tempo de uma rodada: 12 turnos de 30 s, mais 60 s de folga (7 min). A rodada `running`
 * mais velha que isto foi perdida (o processo reiniciou, ou uma exceção escapou): ela não conta para
 * `test_run_busy` e é fechada como `process_restarted` antes de a nova começar.
 */
export const AGENT_TEST_STALE_MS = AGENT_TEST_MAX_TURNS * AGENT_TEST_TURN_TIMEOUT_MS + 60_000;

/** O que o modelo recebe quando pede uma ferramenta sem resposta escrita no teste. */
export const NO_WRITTEN_RESULT = { ok: false, message: "Em teste: esta ferramenta não tem resposta escrita no teste." } as const;

export type AgentTestErrorCode = "turn_timeout" | "tool_loop" | "cost_ceiling" | "engine_failed";
export type AgentTestStatus = "passed" | "failed" | "error";

export interface AgentTestDeps {
  db: Db;
  clock: Clock;
  engines: Map<string, VoiceEngine>;
  tools: Map<string, Tool>;
  /** A chave que abre os segredos da organização (a chave do motor). Sem ela, só motor sem chave roda. */
  secretKey?: Buffer;
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

/**
 * Por que a rodada não começou. Nenhuma recusa cria rodada nem abre o motor. `test_not_found` cobre
 * também o agente que não existe: o teste é apagado junto com o agente (`on delete cascade`).
 */
export type AgentTestRefusalCode = "test_not_found" | "invalid_test" | typeof SPEND_CAP_REACHED | "test_run_busy" | "engine_no_text_mode" | "engine_not_configured";

export type StartedAgentTest = { runId: string; configHash: string; done: Promise<AgentTestOutcome> } | { code: AgentTestRefusalCode; message: string };

interface TestRow extends SessionAgent {
  agent_id: string;
  turns: unknown;
  instructions: string;
  greeting: string | null;
  engine: string;
  agent_tools: string[];
  cost_ceiling_cents: number;
}

type Refusal = { code: AgentTestRefusalCode; message: string };

/** O que a montagem da sessão do teste lê do agente. */
interface AssembledAgent extends SessionAgent {
  instructions: string;
  greeting: string | null;
  agent_tools: string[];
}

/**
 * A sessão do teste e o retrato dela (`configHash`). A rodada e o estado que a tela lê
 * (`agentTestState`) montam por aqui, e então o retrato de agora é o mesmo que a próxima rodada grava.
 *
 * É a mesma montagem da ligação recebida (`session-config.ts`), em texto: as mesmas instruções, com
 * os destinos da passagem; as mesmas ferramentas, `transfer_to_agent` inclusive; e a mesma abertura,
 * com o aviso de gravação na frente da saudação. A memória do número não entra: teste não tem número.
 * O teste não troca de agente: o pedido de passagem é respondido pelo `result` escrito, como os outros.
 */
async function assemble(
  q: OrgQuery,
  deps: Pick<AgentTestDeps, "tools" | "log">,
  organizationId: string,
  agentId: string,
  agent: AssembledAgent,
  engine: VoiceEngine,
  instructionsOverride: string | undefined,
): Promise<{ config: VoiceSessionConfig; hash: string }> {
  const { targets } = await handoffTargetsOf(q, agentId);
  const instructions = composeInstructions(instructionsOverride ?? agent.instructions, targets);
  const enabled = enabledToolsFor({ installed: deps.tools, names: agent.agent_tools, targets, canTransfer: true, returned: false, log: deps.log ?? silentLogger });
  const notice = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, RECORDING_NOTICE_SETTING]);
  const config = sessionConfig(agent, instructions, inboundOpening(recordingNoticeOf(notice?.value), agent.greeting), enabled, "text");
  return { config, hash: configHash({ instructions, tools: config.tools, engine: engine.id, model: null, language: agent.language }) };
}

/** O que a tela dos testes lê do processo de voz (fatia 7c). */
export type AgentTestState = { textMode: boolean; configHash: string | null } | { code: "agent_not_found"; message: string };

/**
 * Se o motor do agente roda teste e o retrato da configuração de agora. Só lê: não grava rodada,
 * não abre o motor e não lê a chave. Motor sem `textMode` não tem retrato (`configHash: null`).
 */
export async function agentTestState(deps: Pick<AgentTestDeps, "db" | "engines" | "tools" | "log">, input: { organizationId: string; agentId: string }): Promise<AgentTestState> {
  return withOrg(deps.db, input.organizationId, async (q) => {
    const agent = await q.one<AssembledAgent & { engine: string }>(
      `select instructions, greeting, engine, language, tools as agent_tools, voice_id, vocabulary, listening_environment from agents where id = $1`,
      [input.agentId],
    );
    if (!agent) return { code: "agent_not_found", message: "This agent does not exist in this organization." };
    const engine = deps.engines.get(agent.engine);
    if (!engine?.textMode) return { textMode: false, configHash: null };
    const { hash } = await assemble(q, deps, input.organizationId, input.agentId, agent, engine, undefined);
    return { textMode: true, configHash: hash };
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

  // As recusas e a gravação da rodada numa transação só, presa por organização: dois pedidos ao
  // mesmo tempo não começam duas rodadas, e a recusa vê o que a outra acabou de gravar.
  const prepared = await withOrg(db, organizationId, async (q): Promise<Refusal | { runId: string; row: TestRow; turns: AgentTestTurn[]; engine: VoiceEngine; apiKey: string; config: VoiceSessionConfig; hash: string }> => {
    await q.exec("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`agent_test_runs:${organizationId}`]);
    const row = await q.one<TestRow>(
      `select t.agent_id, t.turns, a.instructions, a.greeting, a.engine, a.language, a.tools as agent_tools, a.voice_id, a.vocabulary,
              a.listening_environment, a.cost_ceiling_cents
         from agent_tests t join agents a on a.organization_id = t.organization_id and a.id = t.agent_id
        where t.id = $1`,
      [input.testId],
    );
    if (!row) return { code: "test_not_found", message: "This test does not exist in this organization." };
    const parsed = agentTestTurns.safeParse(row.turns);
    if (!parsed.success) return { code: "invalid_test", message: `The saved test is not valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}` };
    // O teto do mês: o custo do teste entra nele como o de toda ligação.
    if ((await spendCapReached(q, clock.now())).reached) {
      return { code: SPEND_CAP_REACHED, message: "This organization reached its monthly spending cap. The installation administration can change the cap." };
    }
    // Uma rodada de cada vez na organização. A que passou do teto de tempo foi perdida: ela fecha
    // aqui, como na partida do processo (`closeOrphanTestRuns`), e não trava os testes.
    const now = clock.now();
    await q.exec(
      "update agent_test_runs set status = 'error', error_code = 'process_restarted', finished_at = $1 where status = 'running' and started_at <= $2",
      [now, new Date(now.getTime() - AGENT_TEST_STALE_MS)],
    );
    if (await q.one("select 1 from agent_test_runs where status = 'running' limit 1")) {
      return { code: "test_run_busy", message: "Another test of this organization is running. Wait for it to finish, and run again." };
    }
    const engine = deps.engines.get(row.engine);
    if (!engine?.textMode) return { code: "engine_no_text_mode", message: `The voice engine "${row.engine}" does not run tests yet.` };
    let apiKey = "";
    if (!engine.keyless) {
      const stored = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [organizationId, engineKeySetting(engine.id)]);
      if (typeof stored?.value !== "string" || !deps.secretKey) return { code: "engine_not_configured", message: `No API key is saved for the voice engine "${engine.label}".` };
      try {
        apiKey = decryptSecret(stored.value, deps.secretKey);
      } catch (error) {
        return { code: "engine_not_configured", message: `The saved API key of the voice engine "${engine.label}" cannot be read (${messageOf(error)}).` };
      }
    }

    const { config, hash } = await assemble(q, deps, organizationId, row.agent_id, row, engine, overrides.instructions);

    const run = await q.one<{ id: string }>(
      "insert into agent_test_runs (organization_id, test_id, status, engine, model, config_hash, requested_by, started_at) values ($1, $2, 'running', $3, null, $4, $5, $6) returning id",
      [organizationId, input.testId, engine.id, hash, input.requestedBy ?? null, now],
    );
    if (!run) throw new Error("Agent test run was not created");
    // A retenção: ficam as rodadas mais novas do teste, a de agora entre elas. A linha do extrato
    // da rodada apagada fica, sem a rodada (`on delete set null (test_run_id)`).
    await q.exec(
      `delete from agent_test_runs where test_id = $1 and id not in (
         select id from agent_test_runs where test_id = $1 order by started_at desc, id desc limit $2)`,
      [input.testId, AGENT_TEST_RUNS_KEPT],
    );
    return { runId: run.id, row, turns: parsed.data, engine, apiKey, config, hash };
  });
  if ("code" in prepared) return prepared;
  const { runId, row, engine, apiKey, config, hash } = prepared;

  // Cada `usage` do motor vira uma linha do extrato, com o custo pelo preço dele, na ordem em que
  // chegou. O teto da rodada é o da ligação do agente (`cost_ceiling_cents`, zero é "sem teto").
  let spentMicrocents = 0;
  let ledger: Promise<unknown> = Promise.resolve();
  const meter = (usage: Usage): boolean => {
    const microcents = estimateCostMicrocents(engine.pricing, usage);
    spentMicrocents += microcents;
    const at = clock.now();
    ledger = ledger.then(() =>
      withOrg(db, organizationId, (q) =>
        q.exec(
          `insert into usage_ledger (organization_id, test_run_id, engine, agent_id, seconds, input_tokens, output_tokens, cost_cents, cost_microcents, source, at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'test', $10)`,
          [
            organizationId,
            runId,
            engine.id,
            row.agent_id,
            Math.round(usage.seconds ?? 0),
            (usage.inputTokens ?? 0) + (usage.textInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
            (usage.outputTokens ?? 0) + (usage.textOutputTokens ?? 0),
            Math.round(microcents / MICROCENTS_PER_CENT),
            microcents,
            at,
          ],
        ),
      ).catch((error: unknown) => log("error", "could not record the cost of an agent test", { runId, error: messageOf(error) })),
    );
    return row.cost_ceiling_cents > 0 && spentMicrocents >= row.cost_ceiling_cents * MICROCENTS_PER_CENT;
  };

  const done = converse(engine, apiKey, config, prepared.turns, schedule, meter)
    .catch((error: unknown): AgentTestOutcome => {
      log("error", "agent test run failed", { runId, error: messageOf(error) });
      return { status: "error", errorCode: "engine_failed", turns: [] };
    })
    .then(async (outcome) => {
      await ledger;
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

/**
 * A conversa do teste, turno a turno, contra a sessão em modo texto. Nunca roda ferramenta. `meter`
 * grava cada `usage` e diz se o teto da rodada foi alcançado: alcançado, o turno seguinte não sai.
 */
async function converse(
  engine: VoiceEngine,
  apiKey: string,
  config: VoiceSessionConfig,
  turns: AgentTestTurn[],
  schedule: Schedule,
  meter: (usage: Usage) => boolean,
): Promise<AgentTestOutcome> {
  const voice: VoiceSession = await engine.connect(config, apiKey);
  const recorded: AgentTestRunTurn[] = [];
  // O que o agente faz entre o texto de quem liga e o `turnDone`. Antes do primeiro texto, vale a
  // abertura: a fala dela não é julgada, mas a ferramenta pedida nela conta no primeiro turno.
  let bucket: { says: string[]; tools: AgentTestRunTurn["tools"] } = { says: [], tools: [] };
  let expectations: ToolExpectation[] = [];
  let used = new Set<ToolExpectation>();
  type Ended = "done" | "closed" | "tool_loop" | "cost_ceiling";
  let waiter: ((ended: Ended) => void) | undefined;
  let closed = false;
  let failed = false;
  // A conversa acabou (ou o teto foi alcançado): o que o motor emitir depois não é mais da rodada.
  let finished = false;
  let ceiling = false;
  const settle = (ended: Ended): void => {
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
  // O custo de cada resposta, na hora em que o motor o declara (o OpenAI, em cada `response.done`,
  // antes do fim do turno). O consumo que o simulado declara ao fechar não é de resposta nenhuma.
  voice.on("usage", (usage) => {
    if (finished) return;
    if (meter(usage) && !ceiling) {
      ceiling = true;
      settle("cost_ceiling");
    }
  });
  voice.on("error", () => {
    failed = true;
  });
  voice.on("closed", () => {
    closed = true;
    settle("closed");
  });

  const wait = (): Promise<Ended | "timeout"> =>
    new Promise((resolve) => {
      if (ceiling) return resolve("cost_ceiling");
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
    finished = true;
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
      if (opened === "cost_ceiling") return await finish({ status: "error", errorCode: "cost_ceiling", turns: recorded });
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
      // O teto da rodada: o turno que o alcançou fica gravado, e o seguinte não sai.
      if (how === "cost_ceiling") return await finish({ status: "error", errorCode: "cost_ceiling", turns: [...recorded, record] });
      recorded.push(record);
      // A sessão caiu: com erro do motor, ou antes do último turno, a rodada não terminou.
      if (how === "closed" && (failed || index < turns.length - 1)) return await finish({ status: "error", errorCode: "engine_failed", turns: recorded });
    }
    return await finish({ status: verdicts(), errorCode: null, turns: recorded });
  } catch (error) {
    finished = true;
    await voice.close().catch(() => undefined);
    throw error;
  }
}
