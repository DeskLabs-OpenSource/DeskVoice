import { handle } from "../../../../server/context";

export const GET = handle({}, ({ q }) =>
  q.many(
    `select id, call_id as "callId", body, created_at as "createdAt", read_at as "readAt" from notifications
      where channel = 'panel' order by (read_at is null) desc, created_at desc limit 50`,
  ),
);
