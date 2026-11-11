import { isIP } from "node:net";

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
