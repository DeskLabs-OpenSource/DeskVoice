import { acceptInvite, findInviteByToken, hashPassword, withOrg, type AcceptInviteResult } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, Reply, createSession, handlePublic, sessionCookie } from "../../../../../../server/context";
import { INVALID_INVITE, guardInviteAttempt } from "../../../../../../server/invite-guard";
import { decoyHash, reservePasswordAttempt } from "../../../../../../server/login-limit";
import { newPassword } from "../../../../../../server/shapes";

// A senha é a nova (conta nova) ou a que a conta já tem. A que já existe pode ser de antes da regra
// de senha nova, então só a nova passa por `newPassword`, depois de se saber qual é o caso.
const body = z.object({ name: z.string().trim().min(1).max(120), password: z.string().min(1).max(1000) });

// Enquanto o convite não é aceito, a recusa da senha é a mesma para todo e-mail: o mesmo código, o
// mesmo texto e a mesma tentativa contada no limite do login.
const REFUSED_PASSWORD = (): ApiError =>
  new ApiError(401, "invite_password_refused", "If this e-mail already has an account, enter its password. If not, choose a new password with at least 10 characters.");

const REFUSALS: Record<Exclude<AcceptInviteResult, { ok: true }>["reason"], () => ApiError> = {
  invalid: INVALID_INVITE,
  // O e-mail ganhou conta, ou a perdeu, entre a leitura do convite e o aceite: a mesma recusa.
  existing_account: REFUSED_PASSWORD,
  no_account: REFUSED_PASSWORD,
  invalid_credentials: REFUSED_PASSWORD,
  already_member: () => new ApiError(409, "already_member", "This account is already in this organization. If it was disabled, an owner or admin can enable it on the Team screen."),
};

export const POST = handlePublic({ support: false, body }, async ({ request, params, body, deps }) => {
  const forgive = guardInviteAttempt(request, deps);
  const now = deps.clock.now();
  const token = params.token ?? "";
  // Confere antes de calcular ou conferir o resumo da senha, que é caro de propósito: token
  // inválido não pode custar esse trabalho ao servidor.
  const invite = await findInviteByToken(deps.db, token, now);
  if (!invite) throw INVALID_INVITE();

  // Uma tentativa de senha do e-mail, com o limite do login (as mesmas chaves e os mesmos tetos),
  // reservada antes de se saber se a conta existe. A recusa conta para o login do mesmo e-mail, e o
  // login cheio também trava aqui.
  const attempt = reservePasswordAttempt(invite.email, request, deps);
  let accepted: AcceptInviteResult;
  try {
    if (invite.existingAccount) {
      accepted = await acceptInvite(deps.db, token, { account: "existing", name: body.name, password: body.password, verify: deps.verifyPassword }, now);
    } else {
      const password = newPassword.safeParse(body.password);
      if (password.success) {
        accepted = await acceptInvite(deps.db, token, { account: "new", name: body.name, passwordHash: await hashPassword(password.data) }, now);
      } else {
        // A senha nova fora da regra custa o mesmo resumo de senha que a conferência de uma conta.
        await deps.verifyPassword(body.password, await decoyHash());
        accepted = { ok: false, reason: "invalid_credentials" };
      }
    }
  } catch (error) {
    attempt.release();
    throw error;
  }
  if (accepted.ok || accepted.reason === "already_member") attempt.succeeded();
  // O convite deixou de valer no meio do caminho: a senha não chegou a contar.
  else if (accepted.reason === "invalid") attempt.release();
  if (!accepted.ok) throw REFUSALS[accepted.reason]();
  forgive();

  const sessionToken = await withOrg(deps.db, accepted.organizationId, (q) => createSession(q, { id: accepted.userId, organizationId: accepted.organizationId }, now));
  return new Reply({ name: body.name, email: invite.email, role: invite.role }, { "set-cookie": sessionCookie(sessionToken, deps) });
});
