import { acceptInvite, findInviteByToken, hashPassword, withOrg, type AcceptInviteResult } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, Reply, createSession, handlePublic, sessionCookie } from "../../../../../../server/context";
import { INVALID_INVITE, guardInviteAttempt } from "../../../../../../server/invite-guard";
import { reservePasswordAttempt } from "../../../../../../server/login-limit";
import { newPassword } from "../../../../../../server/shapes";

// A senha é a nova (conta nova) ou a que a conta já tem. A que já existe pode ser de antes da regra
// de senha nova, então só a nova passa por `newPassword`, depois de se saber qual é o caso.
const body = z.object({ name: z.string().trim().min(1).max(120), password: z.string().min(1).max(1000) });

const REFUSALS: Record<Exclude<AcceptInviteResult, { ok: true }>["reason"], () => ApiError> = {
  invalid: INVALID_INVITE,
  // O e-mail ganhou conta, ou a perdeu, desde que a página abriu: ela pergunta de novo e muda o formulário.
  existing_account: () => new ApiError(409, "existing_account", "This e-mail already has an account. Enter the password you already use."),
  no_account: () => new ApiError(409, "no_account", "This e-mail has no account anymore. Choose a new password."),
  invalid_credentials: () => new ApiError(401, "invalid_credentials", "E-mail or password is incorrect."),
  already_member: () => new ApiError(409, "already_member", "This account is already in this organization. If it was disabled, an owner or admin can enable it on the Team screen."),
};

export const POST = handlePublic({ body }, async ({ request, params, body, deps }) => {
  const forgive = guardInviteAttempt(request, deps);
  const now = deps.clock.now();
  const token = params.token ?? "";
  // Confere antes de calcular ou conferir o resumo da senha, que é caro de propósito: token
  // inválido não pode custar esse trabalho ao servidor.
  const invite = await findInviteByToken(deps.db, token, now);
  if (!invite) throw INVALID_INVITE();

  let accepted: AcceptInviteResult;
  if (invite.existingAccount) {
    // A senha de uma conta que já existe, conferida com o limite do login: as mesmas chaves e os
    // mesmos tetos. A falha conta para o login do mesmo e-mail, e o login cheio também trava aqui.
    const attempt = reservePasswordAttempt(invite.email, request, deps);
    try {
      accepted = await acceptInvite(deps.db, token, { account: "existing", name: body.name, password: body.password, verify: deps.verifyPassword }, now);
    } catch (error) {
      attempt.release();
      throw error;
    }
    if (accepted.ok || accepted.reason === "already_member") attempt.succeeded();
    else if (accepted.reason !== "invalid_credentials") attempt.release();
  } else {
    const password = newPassword.safeParse(body.password);
    if (!password.success) throw new ApiError(400, "validation_error", password.error.issues.map((issue) => `password: ${issue.message}`).join("; "));
    accepted = await acceptInvite(deps.db, token, { account: "new", name: body.name, passwordHash: await hashPassword(password.data) }, now);
  }
  if (!accepted.ok) throw REFUSALS[accepted.reason]();
  forgive();

  const sessionToken = await withOrg(deps.db, accepted.organizationId, (q) => createSession(q, { id: accepted.userId, organizationId: accepted.organizationId }, now));
  return new Reply({ name: body.name, email: invite.email, role: invite.role }, { "set-cookie": sessionCookie(sessionToken, deps) });
});
