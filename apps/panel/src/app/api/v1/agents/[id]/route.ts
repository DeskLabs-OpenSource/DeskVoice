import type { OrgQuery } from "@deskvoice/core";
import { ApiError, handle, notFound } from "../../../../../server/context";
import { AGENT_COLUMNS, agentPatch, requireActiveOwner, requireDropFollowUpMode, requireAnalysisBrain, requireAnalyst, requireHandoffTargets, type AgentValues } from "../../../../../server/shapes";
import { requirePipeline } from "../../../../../server/pipeline";
import { updateAgent } from "../store";

export const GET = handle({}, async ({ q, params }) => {
  const agent = await q.one(`select ${AGENT_COLUMNS} from agents where id = $1`, [params.id]);
  if (!agent) throw notFound();
  return agent;
});

export const PATCH = handle({ support: false, body: agentPatch, configure: true }, async ({ q, params, body, deps }) => {
  const current = await q.one<AgentValues>(`select ${AGENT_COLUMNS} from agents where id = $1`, [params.id]);
  if (!current) throw notFound();
  await requireActiveOwner(q, body.followUpOwnerUserId);
  await requireHandoffTargets(q, params.id ?? null, body.agentHandoffTargets);
  await requireDropFollowUpMode(q, body.dropFollowUp);
  await requireAnalyst(q, body.analystId);
  const { acceptUnmeasured, ...fields } = body;
  await requireAnalysisBrain(q, fields.analysisBrain, acceptUnmeasured);
  await requirePipeline(q, deps, fields.pipeline);
  return updateAgent(q, params.id ?? "", { ...current, ...fields }, deps.clock.now(), { analysisBrain: fields.analysisBrain !== undefined, pipeline: fields.pipeline !== undefined });
});

// O agente que é a ação de uma tecla do menu por teclas não sai (a chave é `on delete restrict`): o
// erro diz quais menus, para trocar a tecla antes. Se alguém puser o agente numa tecla entre a
// conferência e o apagamento, a chave recusa; o ponto de salvamento deixa a transação viva para
// responder a mesma recusa, com o nome do menu, em vez de um erro cru.
const menusUsing = async (q: OrgQuery, agentId: string | undefined): Promise<ApiError | null> => {
  const menus = await q.many<{ name: string }>("select distinct m.name from ivr_options o join ivr_menus m on m.id = o.menu_id where o.agent_id = $1 order by m.name", [agentId]);
  return menus.length > 0 ? new ApiError(409, "agent_in_ivr_menu", menus.map((menu) => menu.name).join(", ")) : null;
};

export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  const inUse = await menusUsing(q, params.id);
  if (inUse) throw inUse;
  await q.exec("savepoint delete_agent");
  let deleted: number;
  try {
    deleted = await q.exec("delete from agents where id = $1", [params.id]);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "23503")) throw error;
    await q.exec("rollback to savepoint delete_agent");
    throw (await menusUsing(q, params.id)) ?? error;
  }
  if (deleted === 0) throw notFound();
  return null;
});
