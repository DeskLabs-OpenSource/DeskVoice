import { randomBytes } from "node:crypto";
import { hashToken } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../server/context";
import { roleName } from "../../../../../server/shapes";
import { requireOwnerToManage } from "../../../../../server/team";

const INVITE_DAYS = 7;
const body = z.object({ email: z.string().trim().toLowerCase().max(320).pipe(z.email()), name: z.string().trim().min(1).max(120), role: roleName });

export const POST = handle({ body, configure: true }, async ({ q, session, body, deps, url }) => {
  requireOwnerToManage(session, body.role);
  if (await q.one("select 1 from users where email = $1", [body.email])) throw new ApiError(400, "email_taken", "This e-mail already belongs to someone on the team.");

  const now = deps.clock.now();
  // Convidar de novo o mesmo e-mail invalida o link anterior: só o último vale.
  await q.exec("update invites set revoked_at = $2 where email = $1 and accepted_at is null and revoked_at is null", [body.email, now]);
  const token = randomBytes(32).toString("base64url");
  const invite = await q.one<{ id: string }>(
    `insert into invites (organization_id, email, name, role, token_hash, expires_at, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [q.organizationId, body.email, body.name, body.role, hashToken(token), new Date(now.getTime() + INVITE_DAYS * 86_400_000), session.userId],
  );

  // O link é o único lugar em que o token aparece, e só nesta resposta. O endereço é o público da
  // instalação; se a pessoa abriu o painel por outro (IP e porta, sem proxy), vale o que ela usou.
  const origin = url.host === new URL(deps.publicUrl).host ? new URL(deps.publicUrl).origin : url.origin;
  return { id: invite?.id, link: `${origin}/invite/${token}` };
});
