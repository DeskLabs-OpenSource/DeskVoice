import { hashPassword } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../server/context";
import { loginLimiter } from "../../../../../server/rate-limit";
import { newPassword } from "../../../../../server/shapes";

const body = z.object({ current: z.string().min(1).max(1000), new: newPassword });

export const POST = handle({ body }, async ({ q, session, body, deps }) => {
  const now = deps.clock.now();
  // Mesmo limite do login: uma sessão roubada não vira tentativa ilimitada de adivinhar a senha.
  const key = `password:${session.userId}`;
  if (!loginLimiter.take(key, now)) throw new ApiError(429, "too_many_attempts", "Too many attempts. Wait a few minutes and try again.");

  const user = await q.one<{ passwordHash: string }>(`select password_hash as "passwordHash" from users where id = $1`, [session.userId]);
  if (!user) throw notFound();
  if (!(await deps.verifyPassword(body.current, user.passwordHash))) throw new ApiError(400, "wrong_password", "The current password is incorrect.");
  loginLimiter.clear(key);

  await q.exec("update users set password_hash = $2 where id = $1", [session.userId, await hashPassword(body.new)]);
  // Quem trocou a senha continua onde está; qualquer outro aparelho com a senha antiga cai.
  await q.exec("delete from sessions where user_id = $1 and id <> $2", [session.userId, session.id]);
  return null;
});
