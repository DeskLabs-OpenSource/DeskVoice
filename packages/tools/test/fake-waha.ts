import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { WahaOptions } from "../src/connectors/waha";

export const WAHA_KEY = "waha-test-key";
// PNG de 1x1: o que importa ao teste é que a imagem atravesse intacta.
export const QR_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

interface FakeSession {
  status: string;
  me: { id: string } | null;
  config: Record<string, unknown>;
}
interface Reply {
  status: number;
  body: unknown;
}

/**
 * WAHA falso em porta 0, com o comportamento que a documentação descreve: chave no cabeçalho,
 * sessões com estado, QR só em `SCAN_QR_CODE`, `check-exists` e `sendText`. O teste muda o estado
 * (`sessions`, `contacts`) e pode trocar uma resposta inteira com `override`.
 */
export async function startFakeWaha() {
  const sessions = new Map<string, FakeSession>();
  /** Dígitos do telefone → endereço canônico. Número fora daqui não tem WhatsApp. */
  const contacts = new Map<string, string>();
  const sent: { session: string; chatId: string; text: string }[] = [];
  const requests: { method: string; path: string; key: string | undefined; body: unknown }[] = [];
  const overrides = new Map<string, Reply | "hang">();

  const read = async (incoming: IncomingMessage): Promise<unknown> => {
    let raw = "";
    for await (const chunk of incoming) raw += String(chunk);
    return raw === "" ? undefined : JSON.parse(raw);
  };

  function route(method: string, url: URL, body: unknown): Reply {
    const path = url.pathname;
    const record = body as { name?: string; config?: Record<string, unknown>; session?: string; chatId?: string; text?: string } | undefined;
    if (method === "POST" && path === "/api/sessions") {
      const name = record?.name ?? "";
      if (sessions.has(name)) return { status: 422, body: { message: "Session already exists" } };
      sessions.set(name, { status: "STOPPED", me: null, config: record?.config ?? {} });
      return { status: 201, body: { name, status: "STOPPED" } };
    }
    const lifecycle = /^\/api\/sessions\/([^/]+)(?:\/(start|stop|logout))?$/.exec(path);
    if (lifecycle) {
      const name = decodeURIComponent(lifecycle[1] ?? "");
      const session = sessions.get(name);
      if (!session) return { status: 404, body: { message: "Session not found" } };
      const action = lifecycle[2];
      if (method === "GET" && !action) return { status: 200, body: { name, ...session } };
      if (method === "PUT" && !action) {
        session.config = record?.config ?? {};
        return { status: 200, body: { name, ...session } };
      }
      if (method === "POST" && action === "start") session.status = session.me ? "WORKING" : "SCAN_QR_CODE";
      else if (method === "POST" && action === "stop") session.status = "STOPPED";
      else if (method === "POST" && action === "logout") {
        // Como no WAHA: sessão rodando que perde o pareamento recomeça pedindo o QR.
        session.me = null;
        if (session.status !== "STOPPED") session.status = "SCAN_QR_CODE";
      } else return { status: 405, body: { message: "Method not allowed" } };
      return { status: 201, body: { name, ...session } };
    }
    const qr = /^\/api\/([^/]+)\/auth\/qr$/.exec(path);
    if (method === "GET" && qr) {
      const session = sessions.get(decodeURIComponent(qr[1] ?? ""));
      if (!session) return { status: 404, body: { message: "Session not found" } };
      if (session.status !== "SCAN_QR_CODE") return { status: 422, body: { message: "Session is not waiting for a QR code" } };
      return { status: 200, body: { mimetype: "image/png", data: QR_PNG } };
    }
    if (method === "GET" && path === "/api/contacts/check-exists") {
      const chatId = contacts.get(url.searchParams.get("phone") ?? "");
      return { status: 200, body: chatId ? { numberExists: true, chatId } : { numberExists: false } };
    }
    if (method === "POST" && path === "/api/sendText") {
      sent.push({ session: record?.session ?? "", chatId: record?.chatId ?? "", text: record?.text ?? "" });
      return { status: 201, body: { id: "true_x_ABC" } };
    }
    return { status: 404, body: { message: "Not found" } };
  }

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? "/", "http://waha.test");
      const method = incoming.method ?? "GET";
      const key = typeof incoming.headers["x-api-key"] === "string" ? incoming.headers["x-api-key"] : undefined;
      const body = await read(incoming);
      requests.push({ method, path: `${url.pathname}${url.search}`, key, body });
      const override = overrides.get(`${method} ${url.pathname}`);
      // Sem resposta: o cliente tem de desistir sozinho.
      if (override === "hang") return;
      const reply = key !== WAHA_KEY ? { status: 401, body: { message: "Unauthorized", statusCode: 401 } } : (override ?? route(method, url, body));
      outgoing.writeHead(reply.status, { "content-type": "application/json" });
      outgoing.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    })();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    baseUrl,
    options: { apiKey: WAHA_KEY, baseUrl } satisfies WahaOptions,
    sessions,
    contacts,
    sent,
    requests,
    /** Troca a resposta de `"MÉTODO /caminho"` (sem a query), ou a deixa sem resposta com `"hang"`. */
    override(route: string, reply: Reply | "hang" | undefined): void {
      if (reply === undefined) overrides.delete(route);
      else overrides.set(route, reply);
    },
    /** Uma sessão já pareada e conectada com o número dado (só dígitos). */
    connect(name: string, digits: string): void {
      sessions.set(name, { status: "WORKING", me: { id: `${digits}@c.us` }, config: sessions.get(name)?.config ?? {} });
    },
    async stop(): Promise<void> {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export type FakeWaha = Awaited<ReturnType<typeof startFakeWaha>>;
