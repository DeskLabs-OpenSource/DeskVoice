import { isIP } from "node:net";

export const UNKNOWN_IP = "unknown";

/**
 * Quantos proxies confiáveis ficam à frente do painel.
 *
 * Padrão 0: sem saber que há um proxy nosso na frente, o cabeçalho é de quem chamou e não vale
 * nada. O instalador grava 1 quando sobe o Caddy da instalação ou quando o painel só é alcançável
 * por um proxy local; painel exposto direto fica em 0.
 */
export function trustedProxyHops(env: Record<string, string | undefined>): number {
  const raw = env.TRUSTED_PROXY_HOPS ?? "0";
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

/**
 * O endereço como o limite de tentativas o conta. IPv4 conta inteiro. IPv6 conta pelo prefixo /64:
 * quem tem uma VPS costuma receber um /64 inteiro, e contar o endereço inteiro daria a essa pessoa
 * 2^64 "endereços" de graça para fugir do limite. IPv4 escrito como IPv6 (`::ffff:a.b.c.d`) conta
 * como o IPv4. Qualquer coisa que não seja endereço volta como veio (é o caso de `unknown`).
 */
export function addressBucket(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1] && isIP(mapped[1]) === 4) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("%")[0]!.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = ip.includes("::") ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
