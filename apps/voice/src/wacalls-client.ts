import { z } from "zod";
import { realSchedule, type Schedule } from "./transport";
import { messageOf, silentLogger, type Logger } from "./log";

/**
 * Cliente do WaCalls, o serviço da própria instalação que conecta o número como aparelho vinculado
 * e entrega as ligações do WhatsApp (github.com/JotaDev66/WaCalls, MIT). Só o processo de voz fala
 * com ele: o painel pede a este processo, e o token fica num lugar só.
 *
 * O endereço é fixo, como o do WAHA: o serviço só existe na rede interna do Compose, e um endereço
 * vindo de configuração faria o processo mandar o token para onde alguém quisesse. `baseUrl` existe
 * só para o teste apontar para um servidor falso.
 *
 * O token vai SEMPRE no cabeçalho `Authorization`. O WaCalls também o aceita em `?access_token=`,
 * e este cliente nunca usa essa forma: endereço vai para log de proxy e de servidor, cabeçalho não.
 *
 * Contrato lido no código do ramo `develop` (commit `d16a076`, o da imagem fixada), em 12/11/2026,
 * e nas lições do DeskcommCRM, que roda a mesma imagem: `docs/specs/2026-11-12-ligacao-pelo-whatsapp.md`,
 * seções 2 e 8. Nada daqui foi medido contra o WaCalls rodando.
 */
export const WACALLS_URL = "http://wacalls:8080";
const TIMEOUT_MS = 10_000;

export type WacallsErrorCode =
  /** Este processo não recebeu o token (instalação atualizada por um atualizador antigo, ou desenvolvimento). */
  | "not_configured"
  /** O WaCalls recusou o token. */
  | "unauthorized"
  | "unreachable"
  | "timeout"
  /** Respondeu com um código HTTP de erro sem tradução acima. */
  | "rejected"
  /** A resposta não tem a forma lida no código do WaCalls. */
  | "invalid_response";

export class WacallsError extends Error {
  override name = "WacallsError";
  constructor(
    readonly code: WacallsErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface WacallsOptions {
  /** `WACALLS_API_TOKEN`, gerado pelo instalador. Vazio = a ligação pelo WhatsApp não existe aqui. */
  token: string;
  /** Só para teste. Em produção vale `WACALLS_URL`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const wacallsFromEnv = (): WacallsOptions => ({ token: process.env.WACALLS_API_TOKEN ?? "" });

/**
 * O nome da sessão no WaCalls: o id INTEIRO da organização. O primeiro QR Code sai no SSE antes de a
 * criação devolver o id, e é pelo nome que a sessão é reconhecida; com só um pedaço do id, duas
 * organizações com o mesmo prefixo veriam o código uma da outra (medido no DeskcommCRM).
 */
export const wacallsSessionName = (organizationId: string): string => `deskvoice_${organizationId}`;

const sessionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  jid: z.string().nullish(),
  state: z.string().nullish(),
  paired: z.boolean().nullish(),
});
export type WacallsSession = z.output<typeof sessionSchema>;
const sessionListSchema = z.object({ sessions: z.array(sessionSchema) });
const createdSchema = z.object({ id: z.string().min(1) });
const anything = z.unknown();

/** `5531999998888:12@s.whatsapp.net` → `+5531999998888`. O `@lid` (número oculto) não é telefone. */
export function phoneOfJid(jid: string | null | undefined): string | null {
  const match = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid ?? "");
  return match ? `+${match[1]}` : null;
}

/**
 * Conectada é a sessão pareada. O DeskcommCRM mediu que `paired` pode demorar a subir com o JID já
 * presente; depois de `logged_out`, o JID que tenha ficado não conta.
 */
export const isPaired = (session: WacallsSession): boolean => session.paired === true || (Boolean(session.jid) && session.state !== "logged_out");

interface Call {
  method?: string;
  body?: unknown;
  /** Códigos HTTP que, nesta chamada, significam "já está assim". */
  tolerate?: number[];
}

function authorized(options: WacallsOptions): Record<string, string> {
  if (!options.token) throw new WacallsError("not_configured", "This voice process has no WaCalls token (WACALLS_API_TOKEN): WhatsApp calls are not available");
  return { Authorization: `Bearer ${options.token}` };
}

async function call<T>(options: WacallsOptions, path: string, schema: z.ZodType<T>, { method = "GET", body, tolerate = [] }: Call = {}): Promise<T | null> {
  const headers = authorized(options);
  let response: Response;
  let text: string;
  try {
    response = await (options.fetch ?? fetch)(`${options.baseUrl ?? WACALLS_URL}${path}`, {
      method,
      headers: { ...headers, Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      // O token não acompanha redirecionamento nenhum.
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw timedOut ? new WacallsError("timeout", `WaCalls did not answer ${method} ${path} in time`) : new WacallsError("unreachable", `Could not reach WaCalls (${method} ${path})`);
  }
  if (tolerate.includes(response.status)) return null;
  if (response.status === 401 || response.status === 403) throw new WacallsError("unauthorized", "WaCalls refused the installation token", response.status);
  if (!response.ok) throw new WacallsError("rejected", `WaCalls answered HTTP ${response.status} to ${method} ${path}: ${text.slice(0, 200)}`, response.status);
  let json: unknown = undefined;
  if (text !== "") {
    try {
      json = JSON.parse(text);
    } catch {
      throw new WacallsError("invalid_response", `WaCalls answered ${method} ${path} with something that is not JSON`);
    }
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new WacallsError("invalid_response", `WaCalls answered ${method} ${path} outside the contract read in its code`);
  return parsed.data;
}

const sessionPath = (id: string): string => `/api/sessions/${encodeURIComponent(id)}`;

export async function wacallsListSessions(options: WacallsOptions): Promise<WacallsSession[]> {
  return (await call(options, "/api/sessions", sessionListSchema))?.sessions ?? [];
}

/**
 * Cria a sessão, e o WaCalls já começa o pareamento: o QR Code sai no SSE, às vezes antes desta
 * resposta. Não existe método para `POST /api/sessions/{id}/pair`, e a ausência é deliberada: ele
 * troca o cliente do WhatsApp e deixa o subsistema de chamadas preso ao antigo (medido no
 * DeskcommCRM em 15/09/2026; só reiniciar o contêiner resolvia). Parear de novo é apagar e criar.
 */
export async function wacallsCreateSession(options: WacallsOptions, name: string): Promise<string> {
  const created = await call(options, "/api/sessions", createdSchema, { method: "POST", body: { name } });
  if (!created) throw new WacallsError("invalid_response", "WaCalls answered the session creation with nothing");
  return created.id;
}

/** Desvincula o aparelho: ele some de "Aparelhos conectados" no celular. */
export async function wacallsLogoutSession(options: WacallsOptions, id: string): Promise<void> {
  await call(options, `${sessionPath(id)}/logout`, anything, { method: "POST" });
}

/** Apaga a sessão. A que o WaCalls já esqueceu (ele descarta, ao subir, sessão sem pareamento) já está apagada. */
export async function wacallsDeleteSession(options: WacallsOptions, id: string): Promise<void> {
  await call(options, sessionPath(id), anything, { method: "DELETE", tolerate: [404] });
}

/** O que interessa do SSE nesta fatia: o estado do pareamento de cada sessão. */
const authStateSchema = z.object({
  type: z.literal("auth-state"),
  sessionId: z.string().min(1),
  state: z.string().nullish(),
  qr: z.string().min(1).nullish(),
  paired: z.boolean().nullish(),
});
export type WacallsAuthState = z.output<typeof authStateSchema>;

export interface WacallsEvents {
  /** Resolve quando a conexão está aberta (na primeira vez, ou na volta de uma queda). */
  ready(): Promise<void>;
  stop(): void;
}

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Mantém o SSE do WaCalls (`GET /api/events`) aberto, com o token no cabeçalho, e volta a abrir
 * depois de uma queda com espera crescente (1 s, 2 s, 4 s... até 30 s). Evento fora da forma é
 * ignorado; o que não é `auth-state` não interessa a esta fatia. O registro diz só quando a
 * conexão cai e quando volta, nunca a cada tentativa.
 */
export function listenWacalls(options: WacallsOptions, onAuthState: (event: WacallsAuthState) => void, deps: { schedule?: Schedule; log?: Logger } = {}): WacallsEvents {
  const schedule = deps.schedule ?? realSchedule;
  const log = deps.log ?? silentLogger;
  let stopped = false;
  let controller: AbortController | null = null;
  let cancelRetry: (() => void) | null = null;
  let delay = RETRY_FIRST_MS;
  let open = false;
  let lost = false;
  let waiting: Array<() => void> = [];

  const opened = (): void => {
    open = true;
    delay = RETRY_FIRST_MS;
    if (lost) log("info", "wacalls events connected again");
    lost = false;
    for (const wake of waiting) wake();
    waiting = [];
  };

  const dispatch = (line: string): void => {
    if (!line.startsWith("data:")) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line.slice(5).trim());
    } catch {
      return;
    }
    const event = authStateSchema.safeParse(raw);
    if (event.success) onAuthState(event.data);
  };

  async function connect(): Promise<void> {
    controller = new AbortController();
    const response = await (options.fetch ?? fetch)(`${options.baseUrl ?? WACALLS_URL}/api/events`, {
      headers: { ...authorized(options), Accept: "text/event-stream", "X-Client-Id": "deskvoice-voice" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new WacallsError(response.status === 401 || response.status === 403 ? "unauthorized" : "rejected", `WaCalls answered HTTP ${response.status} to the events stream`, response.status);
    opened();
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) dispatch(line);
    }
  }

  function run(): void {
    if (stopped) return;
    cancelRetry = null;
    connect().then(
      () => retry("the events stream ended"),
      (error: unknown) => retry(messageOf(error)),
    );
  }

  function retry(reason: string): void {
    open = false;
    if (stopped) return;
    if (!lost) log("error", "wacalls events lost; reconnecting", { reason });
    lost = true;
    cancelRetry = schedule(run, delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  }

  run();
  return {
    ready: () => (open ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve))),
    stop() {
      stopped = true;
      cancelRetry?.();
      controller?.abort();
      for (const wake of waiting) wake();
      waiting = [];
    },
  };
}
