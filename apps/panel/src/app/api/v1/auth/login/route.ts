import { hashPassword, withOrg, withSystem } from "@deskvoice/core";
import { z } from "zod";
import { UNKNOWN_IP, clientIp } from "../../../../../server/client-ip";
import { ApiError, Reply, createSession, handlePublic, sessionCookie } from "../../../../../server/context";
import { loginLimiter } from "../../../../../server/rate-limit";

const body = z.object({ email: z.string().trim().toLowerCase().min(3).max(320), password: z.string().min(1).max(1000) });

// Quando o e-mail não existe, a senha é conferida contra este hash: a resposta demora o mesmo
// que a de um e-mail cadastrado, e o tempo não entrega quem tem conta.
let decoyHash: Promise<string> | undefined;

type RateLimit = { max: number; windowMs: number };
// Par e-mail + endereço: 5 falhas em 15 minutos, como era o limite por e-mail.
const PAIR_LIMIT: RateLimit = { max: 5, windowMs: 15 * 60 * 1000 };
// Endereço, qualquer e-mail: 20 em 15 minutos, para quem tenta muitas contas de um lugar só. Mais
// alto que o do par para que uma pessoa errando a própria senha não tranque o escritório (ou o
// túnel) inteiro; cada conta continua com 5 por endereço.
const ADDRESS_LIMIT: RateLimit = { max: 20, windowMs: 15 * 60 * 1000 };
// E-mail, de qualquer endereço: 50 em uma hora, contra quem distribui a tentativa por muitos
// endereços. Como cada endereço dá no máximo 20 por hora a um e-mail, chegar a 50 pede pelo menos
// 3 endereços a hora inteira (10 de uma vez); enquanto o teto está cheio, o dono também espera.
const ACCOUNT_LIMIT: RateLimit = { max: 50, windowMs: 60 * 60 * 1000 };

export const POST = handlePublic({ body }, async ({ request, body, deps }) => {
  const now = deps.clock.now();
  const ip = clientIp(request.headers.get("x-forwarded-for"), deps.trustedProxyHops);
  // O bloqueio conta pelo par e-mail + endereço: errar a senha de alguém tranca só o endereço de
  // quem errou, para aquele e-mail, e o dono entra de outro lugar. Sem IP confiável o par vira
  // "e-mail + unknown", ou seja, o limite por e-mail de antes. Não há chave "ip:unknown": dividida
  // por todo mundo, deixaria cinco erros de um estranho trancarem a entrada da instalação inteira.
  const limits: Array<[string, RateLimit]> = [
    [`pair:${body.email}|${ip}`, PAIR_LIMIT],
    [`email:${body.email}`, ACCOUNT_LIMIT],
  ];
  if (ip !== UNKNOWN_IP) limits.push([`ip:${ip}`, ADDRESS_LIMIT]);
  // Reserva antes de qualquer `await`: de N pedidos simultâneos, só os que cabem no limite seguem.
  const taken: string[] = [];
  for (const [key, limit] of limits) {
    if (!loginLimiter.take(key, now, limit)) {
      for (const reserved of taken) loginLimiter.release(reserved, now);
      throw new ApiError(429, "too_many_attempts", "Too many sign-in attempts. Wait a few minutes and try again.");
    }
    taken.push(key);
  }

  // Único uso de `withSystem` aqui: o e-mail é o que diz qual é a organização.
  const user = await withSystem(deps.db, (q) =>
    q.one<{ id: string; organizationId: string; passwordHash: string; name: string; role: string; disabled: boolean }>(
      `select id, organization_id as "organizationId", password_hash as "passwordHash", name, role, disabled_at is not null as disabled from users where email = $1`,
      [body.email],
    ),
  );
  decoyHash ??= hashPassword("decoy");
  const valid = await deps.verifyPassword(body.password, user?.passwordHash ?? (await decoyHash));
  // Conta desativada passa pela mesma conferência de senha e recebe a mesma resposta de senha
  // errada: nem o tempo nem o texto dizem que a conta existe.
  if (!user || !valid || user.disabled) {
    // A reserva fica: é ela que conta a falha. Uma mensagem só para e-mail e senha.
    throw new ApiError(401, "invalid_credentials", "E-mail or password is incorrect.");
  }
  // Entrou: o par e o e-mail voltam a zero e o IP recebe de volta a tentativa deste pedido.
  loginLimiter.clear(`pair:${body.email}|${ip}`);
  loginLimiter.clear(`email:${body.email}`);
  if (ip !== UNKNOWN_IP) loginLimiter.release(`ip:${ip}`, now);

  const token = await withOrg(deps.db, user.organizationId, (q) => createSession(q, user, now));
  return new Reply({ name: user.name, email: body.email, role: user.role }, { "set-cookie": sessionCookie(token, deps) });
});
