import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { VoiceSession, VoiceSessionEvents } from "../types";

type Message = Record<string, unknown>;
type Waiter = { matches: (message: Message) => boolean; resolve: (message: Message) => void };

/**
 * Servidor WebSocket falso, em porta 0, que guarda o que o motor envia e deixa o teste responder.
 * `rejectUpgrade` recusa o aperto de mão com esse status HTTP, como o provedor que recusa a chave.
 */
export async function startFakeProvider(options: { rejectUpgrade?: number } = {}) {
  const server = new WebSocketServer({
    port: 0,
    host: "127.0.0.1",
    ...(options.rejectUpgrade !== undefined ? { verifyClient: (_info: unknown, done: (ok: boolean, code?: number) => void) => done(false, options.rejectUpgrade) } : {}),
  });
  await once(server, "listening");
  const unread: Message[] = [];
  const waiters: Waiter[] = [];
  let client: WebSocket | undefined;
  const request: { url: string; authorization: string; headers: Record<string, string | string[] | undefined> } = { url: "", authorization: "", headers: {} };

  server.on("connection", (socket, incoming) => {
    client = socket;
    request.url = incoming.url ?? "";
    request.authorization = incoming.headers.authorization ?? "";
    request.headers = incoming.headers;
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Message;
      const index = waiters.findIndex((waiter) => waiter.matches(message));
      if (index === -1) unread.push(message);
      else waiters.splice(index, 1)[0]?.resolve(message);
    });
  });

  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    request,
    /** Próxima mensagem do motor que satisfaz o predicado (inclusive as já recebidas e não lidas). */
    waitFor(matches: (message: Message) => boolean): Promise<Message> {
      const index = unread.findIndex(matches);
      if (index !== -1) return Promise.resolve(unread.splice(index, 1)[0] as Message);
      return new Promise((resolve) => waiters.push({ matches, resolve }));
    },
    send(message: unknown): void {
      client?.send(typeof message === "string" ? message : JSON.stringify(message));
    },
    /** Derruba a conexão sem aviso, como uma queda de rede. */
    drop(): void {
      client?.terminate();
    },
    /** Fecha a conexão com código e motivo, como o provedor faz ao recusar a sessão. */
    refuse(code: number, reason: string): void {
      client?.close(code, reason);
    },
    async stop(): Promise<void> {
      for (const socket of server.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function nextEvent<K extends keyof VoiceSessionEvents>(
  session: VoiceSession,
  event: K,
): Promise<Parameters<VoiceSessionEvents[K]>> {
  return new Promise((resolve) => {
    let seen = false;
    const handler = (...args: unknown[]): void => {
      if (seen) return;
      seen = true;
      resolve(args as Parameters<VoiceSessionEvents[K]>);
    };
    session.on(event, handler as VoiceSessionEvents[K]);
  });
}
