import { hashPassword, verifyPassword, withOrg, withSystem } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, Reply, createSession, handlePublic, sessionCookie } from "../../../../../server/context";
import { loginLimiter } from "../../../../../server/rate-limit";

const body = z.object({ email: z.string().trim().toLowerCase().min(3).max(320), password: z.string().min(1).max(1000) });

// Quando o e-mail não existe, a senha é conferida contra este hash: a resposta demora o mesmo
// que a de um e-mail cadastrado, e o tempo não entrega quem tem conta.
let decoyHash: Promise<string> | undefined;

export const POST = handlePublic({ body }, async ({ request, body, deps }) => {
  const now = deps.clock.now();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const keys = [`email:${body.email}`, `ip:${ip}`];
  if (keys.some((key) => loginLimiter.blocked(key, now))) {
    throw new ApiError(429, "too_many_attempts", "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  // Único uso de `withSystem` aqui: o e-mail é o que diz qual é a organização.
  const user = await withSystem(deps.db, (q) =>
    q.one<{ id: string; organizationId: string; passwordHash: string; name: string; role: string }>(
      `select id, organization_id as "organizationId", password_hash as "passwordHash", name, role from users where email = $1`,
      [body.email],
    ),
  );
  decoyHash ??= hashPassword("decoy");
  const valid = await verifyPassword(body.password, user?.passwordHash ?? (await decoyHash));
  if (!user || !valid) {
    for (const key of keys) loginLimiter.hit(key, now);
    // Uma mensagem só para e-mail e senha: não confirma se o e-mail existe.
    throw new ApiError(401, "invalid_credentials", "E-mail or password is incorrect.");
  }
  loginLimiter.clear(keys[0] ?? "");

  const token = await withOrg(deps.db, user.organizationId, (q) => createSession(q, user, now));
  return new Reply({ name: user.name, email: body.email, role: user.role }, { "set-cookie": sessionCookie(token, deps) });
});
