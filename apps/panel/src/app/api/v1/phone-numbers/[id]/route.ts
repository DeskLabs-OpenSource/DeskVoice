import { z } from "zod";
import { handle, notFound } from "../../../../../server/context";

export const PATCH = handle({ body: z.object({ agentId: z.uuid().nullable() }), configure: true }, async ({ q, params, body }) => {
  const number = await q.one(`update phone_numbers set agent_id = $2 where id = $1 returning id, e164, trunk_id as "trunkId", agent_id as "agentId"`, [params.id, body.agentId]);
  if (!number) throw notFound();
  return number;
});
