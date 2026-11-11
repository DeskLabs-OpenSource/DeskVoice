import { handle, notFound } from "../../../../../server/context";
import { AGENT_COLUMNS, agentPatch, type AgentValues } from "../../../../../server/shapes";
import { updateAgent } from "../store";

export const GET = handle({}, async ({ q, params }) => {
  const agent = await q.one(`select ${AGENT_COLUMNS} from agents where id = $1`, [params.id]);
  if (!agent) throw notFound();
  return agent;
});

export const PATCH = handle({ body: agentPatch, configure: true }, async ({ q, params, body, deps }) => {
  const current = await q.one<AgentValues>(`select ${AGENT_COLUMNS} from agents where id = $1`, [params.id]);
  if (!current) throw notFound();
  return updateAgent(q, params.id ?? "", { ...current, ...body }, deps.clock.now());
});

export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  if ((await q.exec("delete from agents where id = $1", [params.id])) === 0) throw notFound();
  return null;
});
