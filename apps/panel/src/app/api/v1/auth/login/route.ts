import { findLoginAccount, hashPassword, withOrg } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, Reply, createSession, handlePublic, sessionCookie } from "../../../../../server/context";
import { reservePasswordAttempt } from "../../../../../server/login-limit";

const body = z.object({ email: z.string().trim().toLowerCase().min(3).max(320), password: z.string().min(1).max(1000) });

// Quando o e-mail não existe, a senha é conferida contra este hash: a resposta demora o mesmo
// que a de um e-mail cadastrado, e o tempo não entrega quem tem conta.
let decoyHash: Promise<string> | undefined;

export const POST = handlePublic({ body }, async ({ request, body, deps }) => {
  const now = deps.clock.now();
  // Os tetos e as chaves moram em `server/login-limit.ts`, que o aceite de convite com a conta que
  // já existe também usa.
  const attempt = reservePasswordAttempt(body.email, request, deps);

  // A conta é achada pelo e-mail, e é ela que diz qual é a organização (packages/core/src/accounts.ts).
  const account = await findLoginAccount(deps.db, body.email);
  decoyHash ??= hashPassword("decoy");
  const valid = await deps.verifyPassword(body.password, account?.passwordHash ?? (await decoyHash));
  // Conta sem vínculo ativo (desativada) passa pela mesma conferência de senha e recebe a mesma
  // resposta de senha errada: nem o tempo nem o texto dizem que a conta existe.
  const user = account?.member;
  if (!user || !valid) {
    // A reserva fica: é ela que conta a falha. Uma mensagem só para e-mail e senha.
    throw new ApiError(401, "invalid_credentials", "E-mail or password is incorrect.");
  }
  // Entrou: o par e o e-mail voltam a zero e o IP recebe de volta a tentativa deste pedido.
  attempt.succeeded();

  const token = await withOrg(deps.db, user.organizationId, (q) => createSession(q, user, now));
  return new Reply({ name: user.name, email: body.email, role: user.role }, { "set-cookie": sessionCookie(token, deps) });
});
