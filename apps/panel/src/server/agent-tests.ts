// Os testes do agente no painel (item 7 da pesquisa Vapi, fatia 7c, seção 5.6 de
// docs/specs/2026-11-21-testes-do-agente.md). O painel grava e lê os testes e as rodadas; quem roda
// é o processo de voz (`POST /agent-tests/run`), e quem diz o retrato da configuração de agora e se o
// motor roda teste também (`POST /agent-tests/state`): as ferramentas oferecidas ao motor moram lá.
import { agentTestTurns, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, notFound, type ServerDeps } from "./context";
import { voiceRequest } from "./voice";

/** Quantos testes cada agente tem, no máximo (seção 5.4). */
export const AGENT_TESTS_PER_AGENT = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id de um segmento da rota que o `handle` não confere (ele só olha `id`). Malformado é 404. */
export function segmentId(value: string | undefined): string {
  if (value === undefined || !UUID.test(value)) throw notFound();
  return value;
}

export const agentTestBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  turns: agentTestTurns,
});

export interface AgentTestRunSummary {
  id: string;
  status: "running" | "passed" | "failed" | "error";
  errorCode: string | null;
  configHash: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface AgentTestRunDetail extends AgentTestRunSummary {
  testId: string;
  engine: string;
  turns: unknown[];
}

const RUN_COLUMNS = `r.id, r.status, r.error_code as "errorCode", r.config_hash as "configHash", r.started_at as "startedAt", r.finished_at as "finishedAt"`;

export async function requireAgentTest(q: OrgQuery, agentId: string, testId: string): Promise<void> {
  if (!(await q.one("select 1 from agent_tests where id = $1 and agent_id = $2", [testId, agentId]))) throw notFound();
}

/** Os testes do agente, cada um com a última rodada. */
export async function listAgentTests(q: OrgQuery, agentId: string) {
  return q.many<{ id: string; name: string; turns: unknown; updatedAt: string; lastRun: AgentTestRunSummary | null }>(
    `select t.id, t.name, t.turns, t.updated_at as "updatedAt",
            (select row_to_json(last) from (
               select ${RUN_COLUMNS} from agent_test_runs r where r.test_id = t.id order by r.started_at desc, r.id desc limit 1
             ) last) as "lastRun"
       from agent_tests t where t.agent_id = $1 order by t.created_at, t.id`,
    [agentId],
  );
}

export async function agentTestRun(q: OrgQuery, testId: string, runId: string): Promise<AgentTestRunDetail> {
  const run = await q.one<AgentTestRunDetail>(`select ${RUN_COLUMNS}, r.test_id as "testId", r.engine, r.turns from agent_test_runs r where r.id = $1 and r.test_id = $2`, [runId, testId]);
  if (!run) throw notFound();
  return run;
}

const stateSchema = z.object({ textMode: z.boolean(), configHash: z.string().nullable() });

/**
 * O que o processo de voz diz do agente agora. Fora do ar, a tela ainda mostra os testes e os
 * resultados: `textMode` e `configHash` vêm nulos, e o aviso de configuração mudada não aparece.
 */
export async function agentTestState(deps: ServerDeps, organizationId: string, agentId: string): Promise<{ textMode: boolean | null; configHash: string | null }> {
  try {
    return await voiceRequest(deps, "POST", "/agent-tests/state", stateSchema, { organizationId, agentId });
  } catch (error) {
    if (error instanceof ApiError) return { textMode: null, configHash: null };
    throw error;
  }
}
