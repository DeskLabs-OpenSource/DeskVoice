import { hashPassword } from "@deskvoice/core";
import { UNKNOWN_IP, addressBucket, clientIp } from "./client-ip";
import { ApiError, type ServerDeps } from "./context";
import { loginLimiter } from "./rate-limit";

/**
 * O limite de quem confere a senha de uma conta pelo e-mail: o login e o aceite de convite com a
 * conta que já existe. Um lugar só, para o convite não virar uma porta lateral com outro teto.
 */

type RateLimit = { max: number; windowMs: number };
// Par e-mail + endereço: 5 falhas em 15 minutos, como era o limite por e-mail.
const PAIR_LIMIT: RateLimit = { max: 5, windowMs: 15 * 60 * 1000 };
// Endereço, qualquer e-mail: 20 em 15 minutos, para quem tenta muitas contas de um lugar só. Mais
// alto que o do par para que uma pessoa errando a própria senha não tranque o escritório (ou o
// túnel) inteiro; cada conta continua com 5 por endereço.
const ADDRESS_LIMIT: RateLimit = { max: 20, windowMs: 15 * 60 * 1000 };
// E-mail, de qualquer endereço: 50 em uma hora, contra quem distribui a tentativa por muitos
// endereços. Como cada endereço dá no máximo 20 por hora a um e-mail, chegar a 50 pede pelo menos
// 3 endereços a hora inteira (10 de uma vez; em IPv6, blocos /64); enquanto o teto está cheio, o
// dono também espera.
const ACCOUNT_LIMIT: RateLimit = { max: 50, windowMs: 60 * 60 * 1000 };

export interface PasswordAttempt {
  /** A senha conferiu: o par e o e-mail voltam a zero, e o endereço recebe de volta esta tentativa. */
  succeeded(): void;
  /** A senha nem chegou a ser conferida (o pedido parou antes): a tentativa não conta. */
  release(): void;
}

/**
 * Reserva uma tentativa de senha do e-mail, antes de qualquer `await`: de N pedidos simultâneos,
 * só os que cabem no limite seguem. Recusa com 429 quando alguma chave está cheia. A reserva que
 * ninguém devolve é a falha contada.
 */
export function reservePasswordAttempt(email: string, request: Request, deps: ServerDeps): PasswordAttempt {
  const now = deps.clock.now();
  const address = email.trim().toLowerCase();
  // O endereço como o limite o conta: IPv6 pelo /64, para quem tem um bloco inteiro não ganhar um
  // "endereço" novo a cada tentativa.
  const ip = addressBucket(clientIp(request.headers.get("x-forwarded-for"), deps.trustedProxyHops));
  // O bloqueio conta pelo par e-mail + endereço: errar a senha de alguém tranca só o endereço de
  // quem errou, para aquele e-mail, e o dono entra de outro lugar. Sem IP confiável o par vira
  // "e-mail + unknown", ou seja, o limite por e-mail de antes. Não há chave "ip:unknown": dividida
  // por todo mundo, deixaria cinco erros de um estranho trancarem a entrada da instalação inteira.
  const limits: Array<[string, RateLimit]> = [
    [`pair:${address}|${ip}`, PAIR_LIMIT],
    [`email:${address}`, ACCOUNT_LIMIT],
  ];
  if (ip !== UNKNOWN_IP) limits.push([`ip:${ip}`, ADDRESS_LIMIT]);
  const taken: string[] = [];
  for (const [key, limit] of limits) {
    if (!loginLimiter.take(key, now, limit)) {
      for (const reserved of taken) loginLimiter.release(reserved, now);
      throw new ApiError(429, "too_many_attempts", "Too many sign-in attempts. Wait a few minutes and try again.");
    }
    taken.push(key);
  }
  return {
    succeeded() {
      loginLimiter.clear(`pair:${address}|${ip}`);
      loginLimiter.clear(`email:${address}`);
      if (ip !== UNKNOWN_IP) loginLimiter.release(`ip:${ip}`, now);
    },
    release() {
      for (const key of taken) loginLimiter.release(key, now);
    },
  };
}

// Quando não há conta para conferir, a senha é conferida contra este hash: a resposta custa o mesmo
// resumo de senha que a de um e-mail cadastrado, e o tempo não entrega quem tem conta. Usado pelo
// login e pelo aceite de convite.
let decoy: Promise<string> | undefined;

/** O hash de isca, calculado uma vez por processo. */
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword("decoy");
  return decoy;
}
