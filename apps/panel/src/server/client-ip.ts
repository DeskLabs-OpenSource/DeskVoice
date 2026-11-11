import { isIP } from "node:net";

export const UNKNOWN_IP = "unknown";

/** Quantos proxies confiáveis ficam à frente do painel. Padrão 1: o Caddy da própria instalação. */
export function trustedProxyHops(env: Record<string, string | undefined>): number {
  const raw = env.TRUSTED_PROXY_HOPS ?? "1";
  // Valor que não é um inteiro pequeno vira 0: na dúvida, não confiar em cabeçalho nenhum.
  return /^\d$/.test(raw) ? Number(raw) : 0;
}

/**
 * O endereço de quem chamou, a partir de `x-forwarded-for`.
 *
 * O cliente escreve o que quiser nesse cabeçalho; cada proxy só ACRESCENTA, no fim, o endereço de
 * quem falou com ele. Então o único item confiável é o que o nosso proxy mais externo escreveu:
 * o `hops`-ésimo contado da direita. Ler o primeiro item deixava qualquer um trocar de "IP" a
 * cada tentativa de login e escapar do limite.
 *
 * Sem proxy confiável, sem cabeçalho, com menos itens do que saltos ou com item que não é um
 * endereço, devolve `unknown` em vez de confiar no que veio.
 */
export function clientIp(forwardedFor: string | null, hops: number): string {
  if (hops < 1 || !forwardedFor) return UNKNOWN_IP;
  const items = forwardedFor.split(",").map((item) => item.trim());
  const candidate = items[items.length - hops];
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : UNKNOWN_IP;
}
