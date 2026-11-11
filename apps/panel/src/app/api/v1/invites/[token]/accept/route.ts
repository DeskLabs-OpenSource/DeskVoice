import { acceptInvite, findInviteByToken, hashPassword, withOrg } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, Reply, createSession, handlePublic, sessionCookie } from "../../../../../../server/context";
import { INVALID_INVITE, guardInviteAttempt } from "../../../../../../server/invite-guard";
import { newPassword } from "../../../../../../server/shapes";

const body = z.object({ name: z.string().trim().min(1).max(120), password: newPassword });

export const POST = handlePublic({ body }, async ({ request, params, body, deps }) => {
  const forgive = guardInviteAttempt(request, deps);
  const now = deps.clock.now();
  const token = params.token ?? "";
  // Confere antes de calcular o resumo da senha, que é caro de propósito: token inválido não
  // pode custar esse trabalho ao servidor.
  const invite = await findInviteByToken(deps.db, token, now);
  if (!invite) throw INVALID_INVITE();

  const accepted = await acceptInvite(deps.db, token, { name: body.name, passwordHash: await hashPassword(body.password) }, now);
  if (!accepted.ok) {
    if (accepted.reason === "email_taken") throw new ApiError(409, "email_taken", "This e-mail already has an account. Sign in, or ask for an invite to another e-mail.");
    throw INVALID_INVITE();
  }
  forgive();

  const sessionToken = await withOrg(deps.db, accepted.organizationId, (q) => createSession(q, { id: accepted.userId, organizationId: accepted.organizationId }, now));
  return new Reply({ name: body.name, email: invite.email, role: invite.role }, { "set-cookie": sessionCookie(sessionToken, deps) });
});
