import { ApiError, handle, notFound } from "../../../../../server/context";
import { AGENT_COLUMNS, agentPatch, requireActiveOwner, requireDropFollowUpMode, requireAnalyst, requireHandoffTargets, type AgentValues } from "../../../../../server/shapes";
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
  return updateAgent(q, params.id ?? "", { ...current, ...body }, deps.clock.now());
});

// O agente que é a ação de uma tecla do menu por teclas não sai (a chave é `on delete restrict`): o
// erro diz quais menus, para trocar a tecla antes. A trava na linha do agente vem antes da conferência,
// e quem põe o agente numa tecla ao mesmo tempo espera.
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  if (!(await q.one("select id from agents where id = $1 for update", [params.id]))) throw notFound();
  const menus = await q.many<{ name: string }>("select distinct m.name from ivr_options o join ivr_menus m on m.id = o.menu_id where o.agent_id = $1 order by m.name", [params.id]);
  if (menus.length > 0) throw new ApiError(409, "agent_in_ivr_menu", menus.map((menu) => menu.name).join(", "));
  await q.exec("delete from agents where id = $1", [params.id]);
  return null;
});
