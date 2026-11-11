import { handle, notFound, type Role } from "../../../../../../server/context";
import { requireOwnerToManage } from "../../../../../../server/team";

export const DELETE = handle({ configure: true }, async ({ q, session, params, deps }) => {
  const invite = await q.one<{ role: Role }>("select role from invites where id = $1 and accepted_at is null and revoked_at is null for update", [params.id]);
  if (!invite) throw notFound();
  requireOwnerToManage(session, invite.role);
  await q.exec("update invites set revoked_at = $2 where id = $1", [params.id, deps.clock.now()]);
  return null;
});
