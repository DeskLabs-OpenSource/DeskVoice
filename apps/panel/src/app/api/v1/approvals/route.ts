import { ApiError, handle } from "../../../../server/context";

const STATUSES = ["pending", "approved", "denied", "expired"];

export const GET = handle({}, ({ q, url }) => {
  const status = url.searchParams.get("status");
  if (status !== null && !STATUSES.includes(status)) throw new ApiError(400, "validation_error", `status: unknown approval status "${status}"`);
  return q.many(
    `select p.id, p.call_id as "callId", p.question, p.context, p.status, p.default_on_timeout as "defaultOnTimeout",
            p.expires_at as "expiresAt", p.decided_at as "decidedAt", u.name as "decidedByName", c.from_e164 as "from", a.name as "agentName"
       from approvals p join calls c on c.id = p.call_id
       left join agents a on a.id = c.agent_id left join users u on u.id = p.decided_by
      where ($1::text is null or p.status = $1) order by p.expires_at desc limit 100`,
    [status],
  );
});
