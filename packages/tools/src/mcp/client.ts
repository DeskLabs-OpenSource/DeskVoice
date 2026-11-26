import { createHash } from "node:crypto";
import { webhookTimeoutMs } from "../connectors/webhook";
import { safeFetch, SafeFetchRedirectError, SafeFetchTimeoutError, type SafeFetchOptions } from "../net/safe-fetch";
import { canonicalJson } from "../tools/call_webhook";
import {
  MCP_PROTOCOL_VERSIONS,
  initializeResultSchema,
  inputSchemaToZod,
  isSupportedToolName,
  listedToolSchema,
  rpcResponseSchema,
  toolsCallResultSchema,
  toolsListResultSchema,
} from "./schema";
import { MCP_DEFAULT_HEADER, type RegisteredMcpServer } from "./servers";

/**
 * Cliente MCP mínimo, por Streamable HTTP: `initialize`, `notifications/initialized`, `tools/list`
 * e `tools/call`, e mais nada. Cada chamada abre a própria sessão, e a sessão inteira cabe num prazo
 * só (o `timeoutSeconds` do servidor), conexão, cabeçalhos e leitura do corpo incluídos. Todo pedido
 * sai pela `safeFetch`, sem seguir redirecionamento, com teto de tamanho.
 */

/** O servidor como o cliente o usa. */
export type McpEndpoint = Pick<RegisteredMcpServer, "slug" | "url" | "headerName" | "secret" | "timeoutSeconds">;

/** O que o cliente aceita de fora: em teste, `fetch`, `lookup` e o prazo falsos. */
export type McpNet = Pick<SafeFetchOptions, "fetch" | "lookup" | "timeoutMs">;

/** O teto de bytes de `tools/list`, somado em todas as páginas. */
export const MCP_LIST_MAX_BYTES = 256 * 1024;
/** Quantas ferramentas entram no retrato; da seguinte em diante, só a contagem. */
export const MCP_LIST_MAX_TOOLS = 100;
/** Quantas páginas de `tools/list` são lidas. */
export const MCP_LIST_MAX_PAGES = 5;
/** Até quanto da descrição de uma ferramenta entra no retrato. */
export const MCP_TOOL_DESCRIPTION_MAX = 1000;

/**
 * O servidor respondeu fora do protocolo: JSON inválido ou fora da forma, resposta cortada pelo
 * teto, erro JSON-RPC, ou um pedido de outro endereço (`location`, quando veio).
 */
export class McpProtocolError extends Error {
  override name = "McpProtocolError";
  constructor(
    message: string,
    readonly location?: string,
  ) {
    super(message);
  }
}

/** O servidor respondeu com HTTP de erro. */
export class McpHttpError extends Error {
  override name = "McpHttpError";
  constructor(readonly status: number) {
    super(`MCP server answered HTTP ${status}`);
  }
}

/** Uma ferramenta como a busca a encontrou, antes das marcas do operador. */
export interface DiscoveredTool {
  name: string;
  /** Cortada em `MCP_TOOL_DESCRIPTION_MAX`. */
  description: string;
  inputSchema: Record<string, unknown>;
  fingerprint: string;
  /** `false`: o esquema ou o nome saem do subconjunto, e a ferramenta não pode ser marcada. */
  supported: boolean;
  /** A dica `readOnlyHint` do servidor, só para a tela mostrar. Nunca decide `writes`. */
  readOnlyHint?: boolean;
}

export interface McpToolList {
  tools: DiscoveredTool[];
  /** Ferramentas listadas além de `MCP_LIST_MAX_TOOLS`, que não entraram. */
  omitted: number;
  /** Havia página depois da última lida (`MCP_LIST_MAX_PAGES`). */
  incomplete: boolean;
}

export interface McpCallResult {
  isError: boolean;
  /** Os itens `text` do `content`, juntos por quebra de linha. */
  text: string;
  /** Itens do `content` que não são texto, descartados. */
  dropped: number;
}

/** A impressão digital de uma ferramenta: o sha256 do JSON canônico de `{ name, description, inputSchema }`. */
export function mcpToolFingerprint(tool: Pick<DiscoveredTool, "name" | "description" | "inputSchema">): string {
  return createHash("sha256").update(canonicalJson({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })).digest("hex");
}

type Rpc = { id: number | string; result: Record<string, unknown> } | { id: number | string | null; error: { code: number; message: string } };

/** O JSON de uma mensagem SSE, ou `undefined` se ela não é JSON. */
function eventData(event: string): unknown {
  const data = event
    .split("\n")
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (data === "") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/**
 * A resposta ao pedido `id` dentro de um fluxo SSE. Só conta evento completo (fechado por linha em
 * branco); com `ended`, o último também vale, mesmo sem a linha em branco. Notificação, `ping` e
 * pedido do servidor ficam de fora.
 */
function findSseResponse(body: string, id: number, ended: boolean): unknown {
  const events = body.replace(/\r\n?/g, "\n").split("\n\n");
  if (!ended) events.pop();
  for (const event of events) {
    const message = eventData(event);
    if (typeof message === "object" && message !== null && !Array.isArray(message) && !("method" in message) && (message as { id?: unknown }).id === id) return message;
  }
  return undefined;
}

/** O corpo é SSE, e não JSON: o JSON começa por `{` ou `[`. */
const looksLikeSse = (body: string): boolean => !/^﻿?\s*[[{]/.test(body) && body.trim() !== "";

const SESSION_ID = /^[\x21-\x7E]{1,256}$/;

class Session {
  private nextId = 1;
  private sessionId: string | undefined;
  private protocolVersion: string | undefined;
  private readonly deadline: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly server: McpEndpoint,
    private readonly net: McpNet,
    private readonly extraHeaders: Readonly<Record<string, string>> = {},
  ) {
    this.timeoutMs = webhookTimeoutMs(server, net);
    this.deadline = performance.now() + this.timeoutMs;
  }

  private headers(): Record<string, string> {
    // Os cabeçalhos de quem chama vêm antes: nenhum deles troca o segredo, a sessão ou o protocolo.
    return {
      ...this.extraHeaders,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.server.secret !== undefined && { [this.server.headerName ?? MCP_DEFAULT_HEADER]: this.server.secret }),
      ...(this.sessionId !== undefined && { "Mcp-Session-Id": this.sessionId }),
      ...(this.protocolVersion !== undefined && { "MCP-Protocol-Version": this.protocolVersion }),
    };
  }

  /** O que sobra do prazo da sessão. Acabou: tempo esgotado, como na `safeFetch`. */
  private remainingMs(): number {
    const remaining = Math.ceil(this.deadline - performance.now());
    if (remaining <= 0) throw new SafeFetchTimeoutError(`MCP server did not answer within the timeout (${this.timeoutMs} ms)`);
    return remaining;
  }

  private async post(message: Record<string, unknown>, maxBytes: number | undefined, id: number | undefined) {
    try {
      return await safeFetch(
        this.server.url,
        { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", ...message }) },
        {
          ...this.net,
          timeoutMs: this.remainingMs(),
          ...(maxBytes !== undefined && { maxBytes }),
          redirect: "error",
          responseHeaders: ["content-type", "mcp-session-id"],
          ...(id !== undefined && { stopWhen: (body: string) => looksLikeSse(body) && findSseResponse(body, id, false) !== undefined }),
        },
      );
    } catch (error) {
      if (error instanceof SafeFetchRedirectError) throw new McpProtocolError(`MCP server answered ${error.status} pointing to another address`, error.location);
      throw error;
    }
  }

  /** Um pedido com resposta. Devolve o `result` e quantos bytes a resposta ocupou. */
  async request(method: string, params: Record<string, unknown>, maxBytes?: number): Promise<{ result: Record<string, unknown>; bytes: number; sessionId?: string }> {
    const id = this.nextId++;
    const response = await this.post({ id, method, params }, maxBytes, id);
    if (!response.ok) throw new McpHttpError(response.status);
    // Nunca se lê JSON pela metade.
    if (response.truncated) throw new McpProtocolError(`MCP response to ${method} is larger than the limit`);
    const sse = (response.headers?.["content-type"] ?? "").toLowerCase().startsWith("text/event-stream");
    let raw: unknown;
    if (sse) {
      raw = findSseResponse(response.body, id, true);
      if (raw === undefined) throw new McpProtocolError(`MCP event stream for ${method} ended without the response`);
    } else {
      try {
        raw = JSON.parse(response.body);
      } catch {
        throw new McpProtocolError(`MCP response to ${method} is not JSON`);
      }
    }
    const parsed = rpcResponseSchema.safeParse(raw);
    if (!parsed.success) throw new McpProtocolError(`MCP response to ${method} is not a JSON-RPC response`);
    const rpc: Rpc = parsed.data;
    if (rpc.id !== id) throw new McpProtocolError(`MCP response to ${method} answers another request`);
    if ("error" in rpc) throw new McpProtocolError(`MCP server answered ${method} with error ${rpc.error.code}: ${rpc.error.message.slice(0, 200)}`);
    return { result: rpc.result, bytes: Buffer.byteLength(response.body), sessionId: response.headers?.["mcp-session-id"] };
  }

  /** `initialize` e `notifications/initialized`: a sessão fica pronta para o pedido. */
  async open(): Promise<void> {
    const { result, sessionId } = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSIONS[0],
      capabilities: {},
      clientInfo: { name: "DeskVoice", version: "1" },
    });
    const init = initializeResultSchema.safeParse(result);
    if (!init.success) throw new McpProtocolError("MCP initialize result is out of the protocol (or the protocol version is not supported)");
    if (sessionId !== undefined && !SESSION_ID.test(sessionId)) throw new McpProtocolError("MCP session id has invalid characters");
    this.sessionId = sessionId;
    this.protocolVersion = init.data.protocolVersion;
    const response = await this.post({ method: "notifications/initialized" }, undefined, undefined);
    if (!response.ok) throw new McpHttpError(response.status);
  }
}

/**
 * Lista as ferramentas do servidor: até `MCP_LIST_MAX_PAGES` páginas e `MCP_LIST_MAX_BYTES` somados,
 * no mesmo prazo. Guarda até `MCP_LIST_MAX_TOOLS`, com a impressão digital e se cabe no subconjunto.
 */
export async function listTools(server: McpEndpoint, net: McpNet = {}): Promise<McpToolList> {
  const session = new Session(server, net);
  await session.open();
  const tools: DiscoveredTool[] = [];
  let omitted = 0;
  let used = 0;
  let cursor: string | undefined;
  for (let page = 1; ; page++) {
    const left = MCP_LIST_MAX_BYTES - used;
    if (left <= 0) throw new McpProtocolError("MCP tools/list is larger than the limit");
    const { result, bytes } = await session.request("tools/list", cursor === undefined ? {} : { cursor }, left);
    used += bytes;
    const list = toolsListResultSchema.safeParse(result);
    if (!list.success) throw new McpProtocolError("MCP tools/list result is out of the protocol");
    for (const item of list.data.tools) {
      if (tools.length >= MCP_LIST_MAX_TOOLS) {
        omitted += 1;
        continue;
      }
      const listed = listedToolSchema.safeParse(item);
      if (!listed.success) throw new McpProtocolError("MCP tools/list has a tool out of the protocol");
      const { name, inputSchema, annotations } = listed.data;
      const description = (listed.data.description ?? "").slice(0, MCP_TOOL_DESCRIPTION_MAX);
      tools.push({
        name,
        description,
        inputSchema,
        fingerprint: mcpToolFingerprint({ name, description, inputSchema }),
        supported: isSupportedToolName(server.slug, name) && inputSchemaToZod(inputSchema) !== null,
        ...(annotations?.readOnlyHint !== undefined && { readOnlyHint: annotations.readOnlyHint }),
      });
    }
    cursor = list.data.nextCursor;
    if (cursor === undefined) return { tools, omitted, incomplete: false };
    if (page === MCP_LIST_MAX_PAGES) return { tools, omitted, incomplete: true };
  }
}

/**
 * Chama uma ferramenta do servidor numa sessão nova. `headers` vão em todos os pedidos da sessão (a
 * `Idempotency-Key` de uma marcação) e não trocam os que o cliente põe.
 */
export async function callTool(
  server: McpEndpoint,
  name: string,
  args: Record<string, unknown>,
  net: McpNet = {},
  headers: Readonly<Record<string, string>> = {},
): Promise<McpCallResult> {
  const session = new Session(server, net, headers);
  await session.open();
  const { result } = await session.request("tools/call", { name, arguments: args });
  const call = toolsCallResultSchema.safeParse(result);
  if (!call.success) throw new McpProtocolError("MCP tools/call result is out of the protocol");
  const texts = call.data.content.flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []));
  return { isError: call.data.isError === true, text: texts.join("\n"), dropped: call.data.content.length - texts.length };
}
