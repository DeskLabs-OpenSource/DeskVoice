import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { WacallsOptions } from "../wacalls-client";

export const WACALLS_TOKEN = "wacalls-test-token";

interface FakeSession {
  id: string;
  name: string;
  jid: string;
  state: string;
  paired: boolean;
  qrCount: number;
}

/**
 * WaCalls falso em porta 0, com os formatos lidos no código do ramo `develop` (`d16a076`) e nas
 * lições do DeskcommCRM:
 *
 * - toda rota `/api` exige `Authorization: Bearer <token>`; `/healthz` é aberta;
 * - `POST /api/sessions` já inicia o pareamento, e o primeiro QR Code sai no SSE ANTES da resposta
 *   que traz o id (é o que obriga a reconhecer a sessão pelo nome);
 * - `auth-state` com `state: "logged_out"` é código vencido ou aparelho desvinculado;
 * - `POST /api/sessions/{id}/pair` existe e responde: quem o chamar aparece em `requests`.
 *
 * O teste muda o estado pelos auxiliares (`scan`, `nextQr`, `expire`, `unlink`).
 */
export async function startFakeWacalls() {
  const sessions = new Map<string, FakeSession>();
  const requests: Array<{ method: string; path: string; query: string; authorization: string | undefined }> = [];
  const streams = new Set<ServerResponse>();
  const state = { down: false, nextId: 1 };

  const listOf = () => [...sessions.values()].map(({ id, name, jid, state: s, paired }) => ({ id, name, jid, state: s, paired }));
  const emit = (event: object): void => {
    for (const stream of streams) stream.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const authState = (session: FakeSession, extra: object = {}): void => emit({ type: "auth-state", sessionId: session.id, state: session.state, paired: session.paired, ...extra });
  const qr = (session: FakeSession): void => {
    session.qrCount += 1;
    // `session-list` antes de cada código, com o nome: é assim que o broker do WaCalls faz.
    emit({ type: "session-list", sessions: listOf() });
    authState(session, { qr: `QR-${session.id}-${session.qrCount}` });
  };

  const read = async (incoming: IncomingMessage): Promise<unknown> => {
    let raw = "";
    for await (const chunk of incoming) raw += String(chunk);
    return raw === "" ? undefined : JSON.parse(raw);
  };
  const json = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://wacalls");
      const method = request.method ?? "GET";
      requests.push({ method, path: url.pathname, query: url.search, authorization: request.headers.authorization });
      if (state.down) return json(response, 503, { error: "down" });
      if (url.pathname === "/healthz") return json(response, 200, { ok: true });
      if (request.headers.authorization !== `Bearer ${WACALLS_TOKEN}`) return json(response, 401, { error: "unauthorized" });
      const body = (await read(request)) as { name?: string } | undefined;

      if (method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ type: "session-list", sessions: listOf() })}\n\n`);
        streams.add(response);
        response.on("close", () => streams.delete(response));
        return;
      }
      if (method === "GET" && url.pathname === "/api/sessions") return json(response, 200, { sessions: listOf() });
      if (method === "POST" && url.pathname === "/api/sessions") {
        const session: FakeSession = { id: `s${state.nextId++}`, name: body?.name ?? "", jid: "", state: "qr", paired: false, qrCount: 0 };
        sessions.set(session.id, session);
        qr(session);
        // O id só chega depois do primeiro código, como no WaCalls de verdade.
        await new Promise((resolve) => setImmediate(resolve));
        return json(response, 201, { id: session.id, name: session.name });
      }
      const match = /^\/api\/sessions\/([^/]+)(?:\/(logout|pair))?$/.exec(url.pathname);
      const session = match ? sessions.get(decodeURIComponent(match[1] ?? "")) : undefined;
      if (!match || !session) return json(response, 404, { error: `no session ${match?.[1] ?? ""}` });
      if (method === "DELETE" && !match[2]) {
        sessions.delete(session.id);
        emit({ type: "session-list", sessions: listOf() });
        return json(response, 200, { ok: true });
      }
      if (method === "POST" && match[2] === "logout") {
        session.paired = false;
        session.jid = "";
        session.state = "logged_out";
        authState(session);
        return json(response, 200, { ok: true });
      }
      if (method === "POST" && match[2] === "pair") return json(response, 200, { ok: true });
      return json(response, 405, { error: "method not allowed" });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const byName = (name: string): FakeSession | undefined => [...sessions.values()].find((session) => session.name === name);

  return {
    options: { token: WACALLS_TOKEN, baseUrl: `http://127.0.0.1:${port}` } satisfies WacallsOptions,
    sessions,
    requests,
    state,
    byName,
    /** Quantas conexões de SSE estão abertas agora. */
    streams: () => streams.size,
    /** O WhatsApp troca o código. */
    nextQr: (session: FakeSession) => qr(session),
    /** A pessoa lê o código com o celular do número. */
    scan(session: FakeSession, digits = "553133330000") {
      session.paired = true;
      session.jid = `${digits}:7@s.whatsapp.net`;
      session.state = "open";
      authState(session);
    },
    /** O código vence sem leitura. */
    expire(session: FakeSession) {
      session.state = "logged_out";
      authState(session);
    },
    /** Alguém desvincula o aparelho pelo celular (ou o WhatsApp o derruba). */
    unlink(session: FakeSession) {
      session.paired = false;
      session.state = "logged_out";
      authState(session);
    },
    /** Derruba as conexões de SSE abertas, como uma queda de rede. */
    dropStreams() {
      for (const stream of streams) stream.destroy();
      streams.clear();
    },
    async stop() {
      for (const stream of streams) stream.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
