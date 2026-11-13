/**
 * Cliente mínimo da ARI (Asterisk REST Interface): só o que o processo de voz usa.
 *
 * O protocolo e as lições vêm do módulo de voz do DeskcommCRM (lib/voip/ariClient.ts; MIT, mesmo
 * autor; ver CREDITS.md):
 *
 * - A ARI só controla o canal. Mídia nunca passa por bridge + externalMedia (o Asterisk não
 *   devolve ao tronco o áudio injetado, só silêncio): vai por AudioSocket, no dialplan.
 * - Na chamada de saída o id do canal é escolhido por quem origina, para não haver intervalo
 *   entre a criação do canal e o registro da chamada.
 * - O `+` do E.164 não vai na URI SIP (o PJSIP recusa), e o destino tem a forma
 *   `PJSIP/<número>@<endpoint>`.
 */
import WebSocket from "ws";
import { z } from "zod";
import { messageOf, silentLogger, type Logger } from "./log";
import { realSchedule, type Schedule } from "./transport";

const eventSchema = z.object({
  type: z.string(),
  args: z.array(z.string()).optional(),
  channel: z
    .object({
      id: z.string(),
      name: z.string().optional(),
      caller: z.object({ number: z.string().optional() }).optional(),
      dialplan: z.object({ exten: z.string().optional() }).optional(),
    })
    .optional(),
  cause_txt: z.string().optional(),
  // Evento `Dial`: o canal que disca vem em `caller`, não em `channel`.
  caller: z.object({ id: z.string() }).optional(),
  dialstatus: z.string().optional(),
});
export type AriEvent = z.infer<typeof eventSchema>;
export type AriChannel = NonNullable<AriEvent["channel"]>;

const endpointsSchema = z.array(z.object({ resource: z.string(), state: z.string().optional() }));
export type AriEndpoint = z.infer<typeof endpointsSchema>[number];

export interface OriginateParams {
  /** Ex.: `PJSIP/5531999998888@trunk-<id>`. */
  endpoint: string;
  context: string;
  extension: string;
  channelId: string;
  callerId?: string;
  variables: Record<string, string>;
  timeoutSeconds?: number;
}

export interface AriClient {
  /** `busy` faz quem ligou receber sinal de ocupado em vez de um desligamento comum. */
  hangup(channelId: string, reason?: "busy"): Promise<void>;
  setVariable(channelId: string, name: string, value: string): Promise<void>;
  /** Devolve ao dialplan um canal que está na Stasis. */
  continueDialplan(channelId: string, context: string, extension: string, priority?: number): Promise<void>;
  originate(params: OriginateParams): Promise<void>;
  reloadModule(name: string): Promise<void>;
  listEndpoints(technology: string): Promise<AriEndpoint[]>;
  /** Situação da escuta de eventos: é o que a saúde informa sobre o Asterisk. */
  status(): { connected: boolean; detail: string };
  onEvent(handler: (event: AriEvent) => void): void;
  /** Dispara a cada conexão da escuta de eventos, inclusive nas reconexões. */
  onConnected(handler: () => void): void;
  /** Abre a escuta de eventos e a mantém: se cair ou o Asterisk não estiver no ar, tenta de novo. */
  start(): void;
  close(): void;
}

export interface AriClientOptions {
  url: string;
  app: string;
  username: string;
  password: string;
  fetch?: typeof fetch;
  schedule?: Schedule;
  log?: Logger;
}

const REQUEST_TIMEOUT_MS = 5000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export function createAriClient(options: AriClientOptions): AriClient {
  const doFetch = options.fetch ?? fetch;
  const schedule = options.schedule ?? realSchedule;
  const log = options.log ?? silentLogger;
  const base = options.url.replace(/\/+$/, "");
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`;

  const eventHandlers: Array<(event: AriEvent) => void> = [];
  const connectedHandlers: Array<() => void> = [];
  let socket: WebSocket | undefined;
  let connected = false;
  let detail = "Not connected to the telephony server yet.";
  let closed = false;
  let retryMs = RECONNECT_MIN_MS;
  let cancelRetry: (() => void) | undefined;

  async function request(method: string, path: string, search: Record<string, string> = {}, body?: object): Promise<unknown> {
    const query = new URLSearchParams(search).toString();
    const response = await doFetch(`${base}/ari${path}${query ? `?${query}` : ""}`, {
      method,
      headers: { authorization, ...(body && { "content-type": "application/json" }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new AriError(response.status, `ARI ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
    return text === "" ? null : JSON.parse(text);
  }

  function connect(): void {
    if (closed) return;
    const url = new URL(`${base.replace(/^http/, "ws")}/ari/events`);
    url.search = new URLSearchParams({ app: options.app, api_key: `${options.username}:${options.password}`, subscribeAll: "true" }).toString();
    const ws = new WebSocket(url);
    socket = ws;
    let lastError: string | undefined;

    ws.on("open", () => {
      connected = true;
      detail = "Connected.";
      retryMs = RECONNECT_MIN_MS;
      log("info", "ari events connected");
      for (const handler of connectedHandlers) handler();
    });
    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch (error) {
        log("error", "ari sent an event that is not JSON", { error: messageOf(error) });
        return;
      }
      const parsed = eventSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const handler of eventHandlers) handler(parsed.data);
    });
    ws.on("error", (error) => {
      lastError = error.message;
    });
    ws.on("unexpected-response", (_request, response) => {
      lastError = `HTTP ${response.statusCode}${response.statusCode === 401 ? " (ARI user or password refused)" : ""}`;
      ws.terminate();
    });
    ws.on("close", (code) => {
      if (socket === ws) socket = undefined;
      connected = false;
      if (closed) return;
      detail = `The telephony server (Asterisk) is not reachable at ${base}: ${lastError ?? `connection closed (code ${code})`}. Retrying.`;
      log("error", "ari events disconnected; will retry", { error: lastError, code, retryMs });
      cancelRetry = schedule(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    });
  }

  return {
    async hangup(channelId, reason) {
      try {
        await request("DELETE", `/channels/${encodeURIComponent(channelId)}`, reason ? { reason } : {});
      } catch (error) {
        // Canal que já não existe está desligado: era o que se queria.
        if (!(error instanceof AriError && error.status === 404)) throw error;
      }
    },
    async setVariable(channelId, name, value) {
      await request("POST", `/channels/${encodeURIComponent(channelId)}/variable`, { variable: name, value });
    },
    async continueDialplan(channelId, context, extension, priority = 1) {
      await request("POST", `/channels/${encodeURIComponent(channelId)}/continue`, {}, { context, extension, priority });
    },
    async originate(params) {
      await request(
        "POST",
        "/channels",
        {},
        {
          endpoint: params.endpoint,
          context: params.context,
          extension: params.extension,
          priority: 1,
          channelId: params.channelId,
          callerId: params.callerId,
          timeout: params.timeoutSeconds ?? 45,
          variables: params.variables,
        },
      );
    },
    async reloadModule(name) {
      await request("PUT", `/asterisk/modules/${encodeURIComponent(name)}`);
    },
    async listEndpoints(technology) {
      return endpointsSchema.parse(await request("GET", `/endpoints/${encodeURIComponent(technology)}`));
    },
    status: () => ({ connected, detail }),
    onEvent: (handler) => void eventHandlers.push(handler),
    onConnected: (handler) => void connectedHandlers.push(handler),
    start: connect,
    close() {
      closed = true;
      cancelRetry?.();
      socket?.terminate();
    },
  };
}

export class AriError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** O `+` do E.164 não vai na URI SIP: o PJSIP recusa ("Could not create dialog to invalid URI"). */
export const dialString = (toE164: string, trunkId: string): string => `PJSIP/${toE164.replace(/^\+/, "")}@${trunkEndpointName(trunkId)}`;

/** Nome do endpoint PJSIP de um tronco. `trunks.ts` gera com este nome e `inbound.ts` lê de volta. */
export const trunkEndpointName = (trunkId: string): string => `trunk-${trunkId}`;
