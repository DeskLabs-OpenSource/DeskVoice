import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeReply {
  status: number;
  /** Objeto vira JSON; texto vai como está. */
  body?: unknown;
  /** Não responde nunca: o pedido só termina pelo prazo de quem chamou. */
  hang?: boolean;
}

/** Servidor HTTP falso, em porta 0, que guarda o pedido e devolve o que o teste mandar. */
export async function startFakeHttp() {
  let reply: FakeReply = { status: 200, body: {} };
  const requests: Array<{ method: string; url: string; headers: IncomingHttpHeaders }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers });
    if (reply.hang) return;
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    response.writeHead(reply.status, { "content-type": "application/json" }).end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    respond(next: FakeReply): void {
      reply = next;
    },
    async stop(): Promise<void> {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Agendador que dispara o prazo na hora: o teste do tempo limite não espera relógio nenhum. */
export const expireAtOnce = (fn: () => void): (() => void) => {
  queueMicrotask(fn);
  return () => undefined;
};
