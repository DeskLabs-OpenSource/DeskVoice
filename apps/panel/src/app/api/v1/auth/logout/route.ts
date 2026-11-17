import { Reply, handle, sessionCookie } from "../../../../../server/context";

export const POST = handle({ allowSuspended: true }, async ({ q, session, deps }) => {
  await q.exec("delete from sessions where id = $1", [session.id]);
  return new Reply(null, { "set-cookie": sessionCookie("", deps) });
});
