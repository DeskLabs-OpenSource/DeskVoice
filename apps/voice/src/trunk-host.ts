import { isIPv6 } from "node:net";

/**
 * O host de um tronco, lido de forma que dá para comparar com segurança.
 *
 * O Asterisk reconhece a chamada recebida (`identify`) pelo ENDEREÇO de origem, não pelo texto
 * que foi digitado. Por isso:
 *   - nome nunca vira `identify`: ele resolve para endereços que mudam e que não dá para comparar;
 *   - endereço é canonizado antes de comparar e antes de ir para o arquivo, para duas grafias do
 *     mesmo IP serem o mesmo IP, aqui e no Asterisk;
 *   - todo endereço vira uma faixa de 128 bits (IPv4 no espaço `::ffff:0:0/96`), e um bloco CIDR
 *     conflita com tudo o que ele contém ou que o contém.
 */
export type TrunkHost =
  | { kind: "name"; uri: string }
  | {
      kind: "address";
      /** O que vai depois de `sip:` (com porta, e colchetes no IPv6). `null` num bloco: bloco não é destino. */
      uri: string | null;
      /** Endereço ou bloco canônico, para o `match` do `identify` e para a comparação. */
      match: string;
      start: bigint;
      end: bigint;
    };

const V4_MAPPED = 0xffffn << 32n;
const ALL_ONES = (1n << 128n) - 1n;
// Rótulos de nome de host; o último começa com letra, o que deixa de fora tudo o que um resolvedor
// leria como número ("1.2.3", "0x7f.0.0.1").
const NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOTTED = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv4 em decimal, com ou sem zeros à esquerda. O arquivo recebe a forma sem zeros, que não é ambígua. */
function parseV4(text: string): bigint | null {
  const parts = DOTTED.exec(text)?.slice(1).map(Number);
  if (!parts || parts.some((part) => part > 255)) return null;
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function parseV6(text: string): bigint | null {
  if (!isIPv6(text) || text.includes("%")) return null;
  let address = text.toLowerCase();
  const tail = address.slice(address.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (v4 === null) return null;
    address = `${address.slice(0, address.lastIndexOf(":") + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = "", rest] = address.split("::");
  const before = head === "" ? [] : head.split(":");
  const after = rest === undefined || rest === "" ? [] : rest.split(":");
  const groups = rest === undefined ? before : [...before, ...new Array<string>(8 - before.length - after.length).fill("0"), ...after];
  if (groups.length !== 8) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

/** Um endereço no espaço de 128 bits; IPv4 e IPv4 mapeado em IPv6 caem no mesmo lugar. */
function parseAddress(text: string): bigint | null {
  const v4 = parseV4(text);
  return v4 !== null ? V4_MAPPED | v4 : parseV6(text);
}

const isV4 = (value: bigint): boolean => value >> 32n === 0xffffn;

function formatAddress(value: bigint, asV6 = false): string {
  if (isV4(value) && !asV6) return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 0xffn).toString()).join(".");
  const groups = Array.from({ length: 8 }, (_, index) => ((value >> BigInt(112 - index * 16)) & 0xffffn).toString(16));
  // Forma comprimida: a sequência mais longa de grupos zerados (duas ou mais) vira "::".
  let best = { at: -1, length: 1 };
  for (let at = 0; at < 8; at++) {
    let length = 0;
    while (groups[at + length] === "0") length += 1;
    if (length > best.length) best = { at, length };
  }
  if (best.at < 0) return groups.join(":");
  return `${groups.slice(0, best.at).join(":")}::${groups.slice(best.at + best.length).join(":")}`;
}

function parsePort(text: string): string | null {
  return /^\d{1,5}$/.test(text) && Number(text) >= 1 && Number(text) <= 65535 ? String(Number(text)) : null;
}

/** Lê o host de um tronco. Devolve `null` se não for nome, IP nem bloco CIDR bem formados. */
export function parseTrunkHost(input: string): TrunkHost | null {
  const text = input.trim().toLowerCase().replace(/\.$/, "");

  const slash = text.indexOf("/");
  if (slash >= 0) {
    const base = parseAddress(text.slice(0, slash));
    const length = text.slice(slash + 1);
    if (base === null || !/^\d{1,3}$/.test(length)) return null;
    // O tamanho do prefixo é o da grafia: /24 de um IPv4 são 96 + 24 bits no espaço de 128.
    const prefix = Number(length) + (parseV4(text.slice(0, slash)) !== null ? 96 : 0);
    if (prefix > 128) return null;
    const hostBits = BigInt(128 - prefix);
    const start = (base >> hostBits) << hostBits;
    const end = start | (ALL_ONES >> BigInt(prefix));
    if (start === end) return { kind: "address", uri: isV4(start) ? formatAddress(start) : `[${formatAddress(start)}]`, match: formatAddress(start), start, end };
    // Bloco dentro do espaço do IPv4 sai na grafia do IPv4; qualquer outro, na do IPv6.
    const match = isV4(start) && prefix >= 96 ? `${formatAddress(start)}/${prefix - 96}` : `${formatAddress(start, true)}/${prefix}`;
    return { kind: "address", uri: null, match, start, end };
  }

  // Formas: `[v6]`, `[v6]:porta`, `v6`, `v4`, `v4:porta`, `nome`, `nome:porta`.
  let host = text;
  let port: string | null = null;
  const bracketed = /^\[([^\]]+)\](?::(.+))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1] ?? "";
    if (bracketed[2] !== undefined && (port = parsePort(bracketed[2])) === null) return null;
    if (parseV6(host) === null) return null;
  } else if (!isIPv6(text) && text.includes(":")) {
    host = text.slice(0, text.lastIndexOf(":"));
    if ((port = parsePort(text.slice(text.lastIndexOf(":") + 1))) === null) return null;
  }
  const suffix = port === null ? "" : `:${port}`;

  const address = parseAddress(host);
  if (address !== null) {
    const canonical = formatAddress(address);
    return { kind: "address", uri: `${isV4(address) ? canonical : `[${canonical}]`}${suffix}`, match: canonical, start: address, end: address };
  }
  return NAME.test(host) ? { kind: "name", uri: `${host}${suffix}` } : null;
}

/** Dois endereços ou blocos se sobrepõem: um contém o outro, ou são o mesmo. */
export const hostsOverlap = (a: TrunkHost, b: TrunkHost): boolean => a.kind === "address" && b.kind === "address" && a.start <= b.end && b.start <= a.end;
