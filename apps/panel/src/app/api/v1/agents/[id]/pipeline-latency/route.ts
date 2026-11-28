import { handle, notFound } from "../../../../../../server/context";
import type { PipelineLatency, PipelineLatencyGroup } from "../../../../../../ui/types";

/** Quantas ligações entram na medida: as últimas do agente que tiveram turno respondido pelo pipeline. */
const LATENCY_RECENT_CALLS = 20;

/** A meta da mediana por turno sem ferramenta (seção 3.5 do desenho do pipeline: "Meta p50: 1 200 ms"). */
const LATENCY_P50_GOAL_MS = 1200;

/**
 * Quanto o pipeline leva para responder neste agente (fatia 5c): a mediana do `pipeline_turn_latency` das
 * últimas ligações, ao lado da escolha no bloco Pipeline. O turno com ferramenta (`tool: true`) fica à
 * parte, com a mediana dele: misturado, ele puxaria o número para cima sem dizer. O turno é do agente que
 * respondeu: depois de uma passagem, o evento leva o `agentId` do trecho; antes, é o agente da ligação.
 * Sem turno medido, os dois grupos vêm nulos, e a tela diz que não há medida ainda. A leitura não chama
 * fornecedor nenhum: são os números que a sessão gravou.
 */
export const GET = handle({}, async ({ q, params }): Promise<PipelineLatency> => {
  const agent = await q.one<{ id: string }>("select id from agents where id = $1", [params.id]);
  if (!agent) throw notFound();
  const rows = await q.many<{ tool: boolean; turns: number; calls: number; p50: number }>(
    `with mine as (
       select e.call_id, e.at, (e.payload->>'totalMs')::float8 as total, coalesce((e.payload->>'tool')::boolean, false) as tool
         from call_events e join calls c on c.id = e.call_id
        where e.kind = 'pipeline_turn_latency' and jsonb_typeof(e.payload->'totalMs') = 'number'
          and coalesce(e.payload->>'agentId', c.agent_id::text) = $1::text),
     recent as (select call_id from mine group by call_id order by max(at) desc limit ${LATENCY_RECENT_CALLS})
     select tool, count(*)::int as turns, count(distinct call_id)::int as calls, percentile_cont(0.5) within group (order by total) as p50
       from mine where call_id in (select call_id from recent) group by tool`,
    [agent.id],
  );
  const group = (tool: boolean): PipelineLatencyGroup | null => {
    const row = rows.find((each) => each.tool === tool);
    return row ? { turns: row.turns, calls: row.calls, p50Ms: Math.round(Number(row.p50)) } : null;
  };
  return { recentCalls: LATENCY_RECENT_CALLS, goalP50Ms: LATENCY_P50_GOAL_MS, withoutTool: group(false), withTool: group(true) };
});
