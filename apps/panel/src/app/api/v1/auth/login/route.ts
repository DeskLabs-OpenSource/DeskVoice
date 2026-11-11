import { hashPassword, withOrg, withSystem } from "@deskvoice/core";
import { z } from "zod";
import { UNKNOWN_IP, clientIp } from "../../../../../server/client-ip";
import { ApiError, Reply, createSession, handlePublic, sessionCookie } from "../../../../../server/context";
import { loginLimiter } from "../../../../../server/rate-limit";

const body = z.object({ email: z.string().trim().toLowerCase().min(3).max(320), password: z.string().min(1).max(1000) });

// Quando o e-mail não existe, a senha é conferida contra este hash: a resposta demora o mesmo
// que a de um e-mail cadastrado, e o tempo não entrega quem tem conta.
let decoyHash: Promise<string> | undefined;

export const POST = handlePublic({ body }, async ({ request, body, deps }) => {
  const now = deps.clock.now();
  const ip = clientIp(request.headers.get("x-forwarded-for"), deps.trustedProxyHops);
  // Sem IP confiável não há chave por IP: uma chave "unknown" dividida por todo mundo deixaria
  // cinco erros de um estranho trancarem a entrada da instalação inteira. Fica o limite por e-mail.
  const keys = [`email:${body.email}`, ...(ip === UNKNOWN_IP ? [] : [`ip:${ip}`])];
  // Reserva antes de qualquer `await`: de N pedidos simultâneos, só os que cabem no limite seguem.
  const taken: string[] = [];
  for (const key of keys) {
    if (!loginLimiter.take(key, now)) {
      for (const reserved of taken) loginLimiter.release(reserved, now);
      throw new ApiError(429, "too_many_attempts", "Too many sign-in attempts. Wait a few minutes and try again.");
    }
    taken.push(key);
  }

  // Único uso de `withSystem` aqui: o e-mail é o que diz qual é a organização.
  const user = await withSystem(deps.db, (q) =>
    q.one<{ id: string; organizationId: string; passwordHash: string; name: string; role: string }>(
      `select id, organization_id as "organizationId", password_hash as "passwordHash", name, role from users where email = $1`,
      [body.email],
    ),
  );
  decoyHash ??= hashPassword("decoy");
  const valid = await deps.verifyPassword(body.password, user?.passwordHash ?? (await decoyHash));
  if (!user || !valid) {
    // A reserva fica: é ela que conta a falha. Uma mensagem só para e-mail e senha.
    throw new ApiError(401, "invalid_credentials", "E-mail or password is incorrect.");
  }
  // Entrou: o e-mail volta a zero e o IP recebe de volta a tentativa deste pedido.
  loginLimiter.clear(`email:${body.email}`);
  if (ip !== UNKNOWN_IP) loginLimiter.release(`ip:${ip}`, now);

  const token = await withOrg(deps.db, user.organizationId, (q) => createSession(q, user, now));
  return new Reply({ name: user.name, email: body.email, role: user.role }, { "set-cookie": sessionCookie(token, deps) });
});
