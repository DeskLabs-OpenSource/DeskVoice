import { UNKNOWN_IP, clientIp } from "./client-ip";
import { ApiError, type ServerDeps } from "./context";
import { loginLimiter } from "./rate-limit";

export const INVALID_INVITE = (): ApiError => new ApiError(404, "invite_invalid", "This invite is not valid. Ask whoever invited you for a new one.");

/**
 * Limite por IP nas rotas públicas de convite, com o limitador do login: sem ele, o link vira um
 * lugar para testar tokens à vontade. Devolve a função que desfaz a reserva quando o pedido era
 * legítimo (convite válido), para que só os erros contem.
 */
export function guardInviteAttempt(request: Request, deps: ServerDeps): () => void {
  const ip = clientIp(request.headers.get("x-forwarded-for"), deps.trustedProxyHops);
  // Sem endereço confiável não há chave por IP (mesma razão do login).
  if (ip === UNKNOWN_IP) return () => undefined;
  const key = `invite:${ip}`;
  const now = deps.clock.now();
  if (!loginLimiter.take(key, now)) throw new ApiError(429, "too_many_attempts", "Too many attempts. Wait a few minutes and try again.");
  return () => loginLimiter.release(key, now);
}
