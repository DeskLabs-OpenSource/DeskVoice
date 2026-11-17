import { changeMemberPassword, checkMemberPassword, hashPassword } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../server/context";
import { loginLimiter } from "../../../../../server/rate-limit";
import { newPassword } from "../../../../../server/shapes";

const body = z.object({ current: z.string().min(1).max(1000), new: newPassword });

export const POST = handle({ body, allowSuspended: true }, async ({ session, body, deps }) => {
  const now = deps.clock.now();
  // Mesmo limite do login: uma sessão roubada não vira tentativa ilimitada de adivinhar a senha.
  const key = `password:${session.userId}`;
  if (!loginLimiter.take(key, now)) throw new ApiError(429, "too_many_attempts", "Too many attempts. Wait a few minutes and try again.");

  // A senha é da conta, que só o papel de sistema lê (packages/core/src/accounts.ts).
  const valid = await checkMemberPassword(deps.db, session.userId, body.current, deps.verifyPassword);
  if (valid === null) throw notFound();
  if (!valid) throw new ApiError(400, "wrong_password", "The current password is incorrect.");
  loginLimiter.clear(key);

  // Quem trocou a senha continua onde está; qualquer outro aparelho com a senha antiga cai.
  if ((await changeMemberPassword(deps.db, session.userId, await hashPassword(body.new), session.id)) === null) throw notFound();
  return null;
});
