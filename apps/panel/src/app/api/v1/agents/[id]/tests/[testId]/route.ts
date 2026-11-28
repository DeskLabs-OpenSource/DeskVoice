import { handle, notFound } from "../../../../../../../server/context";
import { agentTestBody, segmentId } from "../../../../../../../server/agent-tests";

export const PATCH = handle({ body: agentTestBody, configure: true }, async ({ q, params, body, deps }) => {
  const updated = await q.exec("update agent_tests set name = $3, turns = $4, updated_at = $5 where id = $1 and agent_id = $2", [
    segmentId(params.testId),
    params.id,
    body.name,
    JSON.stringify(body.turns),
    deps.clock.now(),
  ]);
  if (updated === 0) throw notFound();
  return null;
});

// As rodadas vão junto (`on delete cascade`); a linha do extrato fica, porque o dinheiro foi gasto.
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  const deleted = await q.exec("delete from agent_tests where id = $1 and agent_id = $2", [segmentId(params.testId), params.id]);
  if (deleted === 0) throw notFound();
  return null;
});
