import { BlockList, isIP } from "node:net";

const NAME_OR_IPV4 = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?(?::\d{1,5})?$/;
const BRACKETED_IPV6 = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/;
const CIDR = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/;

/**
 * O endereço do provedor acaba dentro da configuração gerada do Asterisk, então a lista é do que
 * PODE entrar, não do que não pode: nome de host ou IPv4 (com porta opcional), IPv6 (solto ou
 * entre colchetes, com porta) e bloco CIDR, que o modo por IP usa. Qualquer outra coisa (espaço,
 * quebra de linha, `;`, colchete fora do IPv6) é recusada.
 */
export function isTrunkHost(value: string): boolean {
  if (value.length > 260) return false;
  if (NAME_OR_IPV4.test(value)) return true;
  if (isIP(value) === 6) return true;
  const bracketed = BRACKETED_IPV6.exec(value);
  if (bracketed) return isIP(bracketed[1] ?? "") === 6;
  const block = CIDR.exec(value);
  if (!block) return false;
  const family = isIP(block[1] ?? "");
  return family !== 0 && Number(block[2]) <= (family === 4 ? 32 : 128);
}

const DOTTED = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const V4_SPACE = new BlockList();
V4_SPACE.addSubnet("::ffff:0:0", 96, "ipv6");

/** 4 ou 6 para um IP, 0 para o resto. IPv4 com zeros à esquerda conta, como no processo de voz. */
function ipFamily(text: string): 0 | 4 | 6 {
  if (DOTTED.test(text)) return text.split(".").every((part) => Number(part) <= 255) ? 4 : 0;
  return isIP(text) === 6 ? 6 : 0;
}

/**
 * O que impede um valor já aceito por `isTrunkHost` de reconhecer a linha por IP: nome (a entrada
 * é só numérica) ou bloco largo demais (mais que /16 no IPv4 ou /32 no IPv6). Um bloco escrito em
 * IPv6 que alcança o espaço do IPv4 obedece o piso do IPv4, como no processo de voz.
 */
export function inboundAddressProblem(value: string): "name" | "too_wide" | null {
  const block = CIDR.exec(value);
  if (block) {
    const base = block[1] ?? "";
    const prefix = Number(block[2]);
    const family = ipFamily(base);
    if (family === 0) return "name";
    if (family === 4) return prefix < 16 ? "too_wide" : null;
    if (prefix < 32) return "too_wide";
    const range = new BlockList();
    range.addSubnet(base, prefix, "ipv6");
    return prefix < 112 && (range.check("::ffff:0:0", "ipv6") || V4_SPACE.check(base, "ipv6")) ? "too_wide" : null;
  }
  const host = /^\[(.+)\](?::\d+)?$/.exec(value)?.[1] ?? (ipFamily(value) === 6 ? value : value.replace(/:\d+$/, ""));
  return ipFamily(host) === 0 ? "name" : null;
}
