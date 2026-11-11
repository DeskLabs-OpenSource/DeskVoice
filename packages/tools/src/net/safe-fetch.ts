import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Resolve um nome para todos os IPs dele. Injetável: teste não consulta DNS de verdade. */
export type HostLookup = (host: string) => Promise<string[]>;

export interface SafeFetchOptions {
  fetch?: typeof fetch;
  lookup?: HostLookup;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  body: string;
  /** A resposta passou do limite e foi cortada. */
  truncated: boolean;
}

/** O destino não é um endereço público da internet. */
export class UnsafeDestinationError extends Error {
  override name = "UnsafeDestinationError";
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 16 * 1024;
const MAX_REDIRECTS = 3;

// Tudo o que não é internet pública: rede interna, a própria máquina, link-local (onde moram os
// metadados de nuvem, 169.254.169.254 e fd00:ec2::254), CGNAT, multicast e faixas reservadas.
// IPv6 que embute IPv4 (::ffff:a.b.c.d) é conferido pela `BlockList` contra as regras de IPv4.
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

const systemLookup: HostLookup = async (host) => (await dnsLookup(host, { all: true })).map((entry) => entry.address);

async function assertPublicDestination(target: string, lookup: HostLookup): Promise<void> {
  if (!URL.canParse(target)) throw new UnsafeDestinationError("Destination is not a valid URL");
  const url = new URL(target);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeDestinationError(`Protocol ${url.protocol} is not allowed: only http and https`);
  // O parser de URL já normaliza as formas exóticas de IPv4 ("127.1", "0x7f000001", "2130706433").
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) !== 0 ? [host] : await lookup(host);
  if (addresses.length === 0) throw new UnsafeDestinationError(`Host ${host} does not resolve to any address`);
  // Basta um IP interno entre os resolvidos: quem conecta escolhe qualquer um deles.
  const internal = addresses.find((address) => !isPublicAddress(address));
  if (internal !== undefined) throw new UnsafeDestinationError(`Host ${host} points to a non-public address (${internal})`);
}

async function readLimited(response: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size <= maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const truncated = size > maxBytes;
  if (truncated) await reader.cancel();
  return { body: Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8"), truncated };
}

/**
 * `fetch` para destino que veio de configuração: só http/https, só endereço público, com tempo
 * limite e resposta limitada. Redirecionamento é seguido à mão para conferir cada salto.
 *
 * Teto conhecido: o IP é conferido antes de conectar e o `fetch` resolve o nome de novo, então um
 * DNS que troca a resposta entre as duas consultas (rebinding) ainda passa. Fechar isso pede fixar
 * o IP conferido na conexão (`undici.Agent` com `connect.lookup`).
 */
export async function safeFetch(target: string, request: SafeRequest = {}, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const doFetch = options.fetch ?? fetch;
  const lookup = options.lookup ?? systemLookup;
  // Um prazo só para a operação inteira, saltos e leitura do corpo incluídos.
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  let url = target;
  let { method = "GET", headers = {}, body } = request;

  for (let hop = 0; ; hop++) {
    await assertPublicDestination(url, lookup);
    const response = await doFetch(url, { method, headers, body, redirect: "manual", signal });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      return { status: response.status, ok: response.ok, ...(await readLimited(response, options.maxBytes ?? MAX_BYTES)) };
    }
    await response.body?.cancel();
    if (hop === MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
    const next = new URL(location, url);
    // Credencial não acompanha o redirecionamento para outra origem.
    if (next.origin !== new URL(url).origin) {
      headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"));
    }
    // Como no fetch padrão: só 307 e 308 repetem método e corpo.
    if (response.status !== 307 && response.status !== 308) {
      method = "GET";
      body = undefined;
    }
    url = next.href;
  }
}
