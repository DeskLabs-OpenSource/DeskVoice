import { z } from "zod";
import { ApiError, handle } from "../../../../server/context";
import { phone } from "../../../../server/shapes";

const NUMBER_COLUMNS = `n.id, n.e164, n.trunk_id as "trunkId", n.agent_id as "agentId", a.name as "agentName"`;

export const GET = handle({}, ({ q }) => q.many(`select ${NUMBER_COLUMNS} from phone_numbers n left join agents a on a.id = n.agent_id order by n.e164`));

const body = z.object({ trunkId: z.uuid(), number: phone, agentId: z.uuid().nullable().optional() });

export const POST = handle({ body, configure: true }, async ({ q, body }) => {
  try {
    return await q.one(`insert into phone_numbers (organization_id, trunk_id, e164, agent_id) values ($1, $2, $3, $4) returning id, e164, trunk_id as "trunkId", agent_id as "agentId"`, [
      q.organizationId,
      body.trunkId,
      body.number,
      body.agentId ?? null,
    ]);
  } catch (error) {
    // Número repetido na organização é erro de quem digitou, não conflito de servidor.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new ApiError(400, "number_already_registered", "This number is already registered.");
    }
    throw error;
  }
});
