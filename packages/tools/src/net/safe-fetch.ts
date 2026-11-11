import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

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
 * `lookup` do socket: resolve o nome e só entrega à conexão endereços públicos. É aqui que a
 * guarda vale de fato, porque este é o endereço em que a conexão é aberta; conferir antes e
 * deixar o cliente resolver de novo abriria espaço para um DNS que troca a resposta (rebinding).
 */
function guardedLookup(lookup: HostLookup): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname).then(
      (addresses) => {
        const safe = addresses.filter(isPublicAddress).map((address) => ({ address, family: isIP(address) }));
        const first = safe[0];
        if (!first) {
          callback(new UnsafeDestinationError(`Host ${hostname} points to a non-public address`), "", 0);
        } else if (options.all) {
          callback(null, safe);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), "", 0),
    );
  };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: "manual"; signal: AbortSignal }) => Promise<Response>;

/**
 * `fetch` para destino que veio de configuração: só http/https, só endereço público, com tempo
 * limite e resposta limitada. Redirecionamento é seguido à mão, e cada salto passa pela guarda.
 *
 * A conexão é presa ao endereço conferido: o agente do `undici` resolve o nome pelo
 * `guardedLookup`, então não existe segunda resolução fora da guarda. A conferência anterior à
 * conexão continua porque IP literal não passa por `lookup` nenhum.
 * Com um `fetch` injetado (teste) não há agente: vale só a conferência anterior.
 */
export async function safeFetch(target: string, request: SafeRequest = {}, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const lookup = options.lookup ?? systemLookup;
  const agent = options.fetch ? undefined : new Agent({ connect: { lookup: guardedLookup(lookup) } });
  // O `Response` do undici tem a mesma forma do global nas partes usadas aqui.
  const doFetch: Fetch = options.fetch ?? ((url, init) => undiciFetch(url, { ...init, dispatcher: agent }) as unknown as Promise<Response>);
  try {
    return await follow(target, request, doFetch, lookup, options);
  } catch (error) {
    // O undici embrulha a falha de conexão em "fetch failed"; quem chama precisa do motivo real.
    if (error instanceof Error && error.cause instanceof UnsafeDestinationError) throw error.cause;
    throw error;
  } finally {
    await agent?.destroy();
  }
}

async function follow(target: string, request: SafeRequest, doFetch: Fetch, lookup: HostLookup, options: SafeFetchOptions): Promise<SafeResponse> {
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
