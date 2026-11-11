import { ApiError, handle } from "../../../../server/context";
import { CALL_COLUMNS, CALL_STATUSES } from "../../../../server/shapes";

export const GET = handle({}, ({ q, url }) => {
  const statuses = url.searchParams.get("status")?.split(",").filter(Boolean) ?? [];
  const unknown = statuses.find((status) => !(CALL_STATUSES as readonly string[]).includes(status));
  if (unknown) throw new ApiError(400, "validation_error", `status: unknown call status "${unknown}"`);
  return q.many(
    `select ${CALL_COLUMNS} from calls c left join agents a on a.id = c.agent_id
      where ($1::text[] is null or c.status = any($1)) order by c.started_at desc limit 200`,
    [statuses.length > 0 ? statuses : null],
  );
});
