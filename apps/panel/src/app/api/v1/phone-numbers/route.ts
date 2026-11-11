import { z } from "zod";
import { handle } from "../../../../server/context";
import { phone } from "../../../../server/shapes";
import { refusingDuplicates } from "./store";

const NUMBER_COLUMNS = `n.id, n.e164, n.trunk_id as "trunkId", n.agent_id as "agentId", a.name as "agentName"`;

export const GET = handle({}, ({ q }) => q.many(`select ${NUMBER_COLUMNS} from phone_numbers n left join agents a on a.id = n.agent_id order by n.e164`));

const body = z.object({ trunkId: z.uuid(), number: phone, agentId: z.uuid().nullable().optional() });

export const POST = handle({ body, configure: true }, ({ q, body }) =>
  refusingDuplicates(() =>
    q.one(`insert into phone_numbers (organization_id, trunk_id, e164, agent_id) values ($1, $2, $3, $4) returning id, e164, trunk_id as "trunkId", agent_id as "agentId"`, [
      q.organizationId,
      body.trunkId,
      body.number,
      body.agentId ?? null,
    ]),
  ),
);
