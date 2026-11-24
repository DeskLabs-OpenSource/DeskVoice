import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { isPublicAddress } from "@deskvoice/core";
import { Agent, fetch as undiciFetch } from "undici";

/** Resolve um nome para todos os IPs dele. Injetável: teste não consulta DNS de verdade. */
export type HostLookup = (host: string) => Promise<string[]>;

export interface SafeFetchOptions {
  fetch?: typeof fetch;
  lookup?: HostLookup;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * `"follow"` (o padrão): segue até três saltos, cada um conferido pela guarda. `"error"`: toda
   * resposta 3xx com `Location`, da mesma origem ou de outra, encerra com `SafeFetchRedirectError`, e
   * nenhum segundo pedido sai. O endereço chamado tem de ser o final.
   */
  redirect?: "follow" | "error";
  /**
   * Conferida a cada pedaço lido, com o corpo lido até ali. `true` encerra a leitura sem esperar o
   * destino fechar a resposta, e o que foi lido volta como corpo, sem corte. O teto de bytes e o
   * prazo valem antes dela: o pedaço que passa do teto vira corte, mesmo que ela dissesse `true`.
   * Ausente: lê até o fim, como sempre.
   */
  stopWhen?: (bodySoFar: string) => boolean;
  /**
   * Os cabeçalhos da resposta que voltam em `SafeResponse.headers` (nomes em minúsculas). Ausente:
   * a resposta não traz `headers`, como sempre.
   */
  responseHeaders?: readonly string[];
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
  /** Só os pedidos em `SafeFetchOptions.responseHeaders`, pelo nome em minúsculas; o ausente não entra. */
  headers?: Record<string, string>;
}

/** O destino não é um endereço público da internet. */
export class UnsafeDestinationError extends Error {
  override name = "UnsafeDestinationError";
}

/**
 * O destino não respondeu dentro do prazo. Não é erro do destino nem da rede: o pedido pode ter
 * chegado e sido registrado do outro lado, e quem chama não sabe. Por isso é uma classe à parte,
 * para quem chama não tratar o "não sei" como "falhou".
 */
export class SafeFetchTimeoutError extends Error {
  override name = "SafeFetchTimeoutError";
}

/** O destino respondeu com redirecionamento a um pedido feito com `redirect: "error"`. */
export class SafeFetchRedirectError extends Error {
  override name = "SafeFetchRedirectError";
  constructor(
    readonly status: number,
    /** O `Location` recebido, como veio. */
    readonly location: string,
  ) {
    super(`Destination answered ${status} with a redirect, and redirects are not followed for this request`);
  }
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 16 * 1024;
const MAX_REDIRECTS = 3;

// A lista do que não é internet pública mora em `@deskvoice/core`: a classificação do desfecho
// confere o endereço gravado com ela, e o pacote dos motores não alcança este.
export { isPublicAddress };

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

async function readLimited(response: Response, maxBytes: number, stopWhen?: (bodySoFar: string) => boolean): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (size <= maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (stopWhen === undefined || size > maxBytes) continue;
    text += decoder.decode(value, { stream: true });
    if (stopWhen(text)) {
      await reader.cancel();
      return { body: Buffer.concat(chunks).toString("utf8"), truncated: false };
    }
  }
  const truncated = size > maxBytes;
  if (truncated) await reader.cancel();
  return { body: Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8"), truncated };
}

function pickHeaders(response: Response, names: readonly string[] | undefined): { headers?: Record<string, string> } {
  if (names === undefined) return {};
  const headers: Record<string, string> = {};
  for (const name of names) {
    const value = response.headers.get(name);
    if (value !== null) headers[name.toLowerCase()] = value;
  }
  return { headers };
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
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await followWithin(target, request, doFetch, lookup, options, signal);
  } catch (error) {
    // Destino recusado pela guarda continua recusado, mesmo que o prazo tenha passado no meio.
    const unsafe = error instanceof UnsafeDestinationError || (error instanceof Error && error.cause instanceof UnsafeDestinationError);
    if (signal.aborted && !unsafe) throw new SafeFetchTimeoutError(`Destination did not answer within the timeout (${timeoutMs} ms)`, { cause: error });
    throw error;
  }
}

async function followWithin(target: string, request: SafeRequest, doFetch: Fetch, lookup: HostLookup, options: SafeFetchOptions, signal: AbortSignal): Promise<SafeResponse> {
  let url = target;
  let { method = "GET", headers = {}, body } = request;

  for (let hop = 0; ; hop++) {
    await assertPublicDestination(url, lookup);
    const response = await doFetch(url, { method, headers, body, redirect: "manual", signal });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      return { status: response.status, ok: response.ok, ...(await readLimited(response, options.maxBytes ?? MAX_BYTES, options.stopWhen)), ...pickHeaders(response, options.responseHeaders) };
    }
    await response.body?.cancel();
    if (options.redirect === "error") throw new SafeFetchRedirectError(response.status, location);
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
