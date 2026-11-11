import { z } from "zod";
import { handle, notFound } from "../../../../../server/context";
import { phone } from "../../../../../server/shapes";
import { refusingDuplicates } from "../store";

const body = z.object({ agentId: z.uuid().nullable().optional(), number: phone.optional() });

// Troca quem atende e corrige o número digitado errado. Campo ausente fica como está.
export const PATCH = handle({ body, configure: true }, async ({ q, params, body }) => {
  const current = await q.one<{ e164: string; agentId: string | null }>(`select e164, agent_id as "agentId" from phone_numbers where id = $1`, [params.id]);
  if (!current) throw notFound();
  return refusingDuplicates(() =>
    q.one(`update phone_numbers set e164 = $2, agent_id = $3 where id = $1 returning id, e164, trunk_id as "trunkId", agent_id as "agentId"`, [
      params.id,
      body.number ?? current.e164,
      body.agentId === undefined ? current.agentId : body.agentId,
    ]),
  );
});

export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  if ((await q.exec("delete from phone_numbers where id = $1", [params.id])) === 0) throw notFound();
  return null;
});
