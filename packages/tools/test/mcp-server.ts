/**
 * Servidor MCP falso, em processo: um `fetch` que responde como um servidor Streamable HTTP, em
 * JSON ou em SSE. Cada teste troca só o pedaço que quer quebrar.
 */

export interface McpRpc {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface SeenRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  rpc: McpRpc;
}

export type Reply = { result: Record<string, unknown> } | { error: { code: number; message: string } } | Response;

export interface FakeMcpOptions {
  transport?: "json" | "sse";
  /** As páginas de `tools/list`; cada página leva `nextCursor` para a seguinte. */
  pages?: unknown[][];
  /** O resultado de `tools/call`. */
  call?: (name: string, args: unknown) => Record<string, unknown>;
  sessionId?: string | null;
  protocolVersion?: string;
  /** Antes do pedido normal: devolve uma resposta própria para quebrar o protocolo. */
  override?: (rpc: McpRpc, index: number, signal: AbortSignal | undefined) => Reply | undefined;
  /** SSE: eventos antes da resposta (notificação, `ping`). */
  before?: string[];
  /** SSE: a resposta vai, mas o fluxo não fecha. */
  keepOpen?: boolean;
}

export const tool = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `Descrição de ${name}`,
  inputSchema: { type: "object", properties: { pedido: { type: "string", description: "O número do pedido" } }, required: ["pedido"] },
  ...extra,
});

const encoder = new TextEncoder();

export const sseEvent = (message: unknown): string => `event: message\ndata: ${JSON.stringify(message)}\n\n`;

export interface FakeMcp {
  fetch: typeof fetch;
  requests: SeenRequest[];
  /** Fluxos SSE que o cliente cancelou ou que fecharam. */
  closedStreams: number;
  /** Fluxos SSE abertos. */
  openedStreams: number;
}

export function fakeMcp(options: FakeMcpOptions = {}): FakeMcp {
  const transport = options.transport ?? "json";
  const pages = options.pages ?? [[tool("consultar_pedido")]];
  const state: FakeMcp = { fetch: undefined as unknown as typeof fetch, requests: [], closedStreams: 0, openedStreams: 0 };

  const answer = (rpc: McpRpc): Exclude<Reply, Response> => {
    switch (rpc.method) {
      case "initialize":
        return { result: { protocolVersion: options.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "falso", version: "1" } } };
      case "tools/list": {
        const index = typeof rpc.params?.cursor === "string" ? Number(rpc.params.cursor) : 0;
        const next = index + 1 < pages.length ? { nextCursor: String(index + 1) } : {};
        return { result: { tools: pages[index] ?? [], ...next } };
      }
      case "tools/call": {
        const params = rpc.params as { name: string; arguments: unknown };
        return { result: options.call ? options.call(params.name, params.arguments) : { content: [{ type: "text", text: `ok ${params.name}` }] } };
      }
      default:
        return { error: { code: -32601, message: "Method not found" } };
    }
  };

  const encode = (rpc: McpRpc, reply: Exclude<Reply, Response>, signal: AbortSignal | undefined): Response => {
    const message = { jsonrpc: "2.0", id: rpc.id, ...reply };
    const headers: Record<string, string> = {};
    if (rpc.method === "initialize" && options.sessionId !== null) headers["mcp-session-id"] = options.sessionId ?? "sessao-1";
    if (transport === "json") return new Response(JSON.stringify(message), { status: 200, headers: { ...headers, "content-type": "application/json" } });
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          state.openedStreams += 1;
          signal?.addEventListener("abort", () => controller.error(signal.reason));
          for (const event of options.before ?? []) controller.enqueue(encoder.encode(event));
          controller.enqueue(encoder.encode(sseEvent(message)));
          if (!options.keepOpen) {
            state.closedStreams += 1;
            controller.close();
          }
        },
        cancel() {
          state.closedStreams += 1;
        },
      }),
      { status: 200, headers: { ...headers, "content-type": "text/event-stream" } },
    );
  };

  state.fetch = async (input, init) => {
    const rpc = JSON.parse(String(init?.body)) as McpRpc;
    const index = state.requests.length;
    state.requests.push({ url: String(input), method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), rpc });
    const custom = options.override?.(rpc, index, init?.signal ?? undefined);
    if (custom instanceof Response) return custom;
    if (custom === undefined && rpc.id === undefined) return new Response(null, { status: 202 });
    return encode(rpc, custom ?? answer(rpc), init?.signal ?? undefined);
  };
  return state;
}

/** Um fluxo SSE que só goteja `ping` (comentário e evento), sem nunca mandar a resposta. */
export function drippingPings(signal: AbortSignal | undefined | null, everyMs = 5): Response {
  let timer: ReturnType<typeof setInterval> | undefined;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => controller.enqueue(encoder.encode(": ping\n\nevent: ping\ndata: {}\n\n")), everyMs);
        signal?.addEventListener("abort", () => {
          clearInterval(timer);
          controller.error(signal.reason);
        });
      },
      cancel() {
        clearInterval(timer);
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
