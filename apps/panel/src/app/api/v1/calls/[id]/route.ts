import { handle, notFound } from "../../../../../server/context";
import { CALL_COLUMNS } from "../../../../../server/shapes";

export const GET = handle({}, async ({ q, params }) => {
  const call = await q.one(`select ${CALL_COLUMNS}, a.max_call_seconds as "maxCallSeconds", a.cost_ceiling_cents as "costCeilingCents"
                              from calls c left join agents a on a.id = c.agent_id where c.id = $1`, [params.id]);
  if (!call) throw notFound();
  return call;
});
