import { handle, notFound } from "../../../../../../server/context";

export const GET = handle({}, async ({ q, params, url }) => {
  if (!(await q.one("select 1 from calls where id = $1", [params.id]))) throw notFound();
  const after = url.searchParams.get("after") ?? "";
  return q.many("select id, at, kind, payload from call_events where call_id = $1 and id > $2 order by id", [params.id, /^\d+$/.test(after) ? after : "0"]);
});
