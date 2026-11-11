import WebSocket from "ws";
import type { SessionEmitter } from "./emitter";

export interface ProviderSocket {
  send(message: object): void;
  close(): Promise<void>;
}

interface ProviderSocketOptions {
  url: string;
  headers?: Record<string, string>;
  /** Nome do provedor nas mensagens de erro. */
  label: string;
  emitter: SessionEmitter;
  /** Recebe cada mensagem já decodificada de JSON; validar o formato é de quem chama. */
  onMessage(message: unknown): void;
  onClosed?(): void;
}

/**
 * Abre o WebSocket do provedor e garante o contrato de fechamento da sessão: fechamento que
 * ninguém pediu vira `error` + `closed`; `close()` é idempotente e emite `closed("client")`.
 */
export function openProviderSocket(options: ProviderSocketOptions): Promise<ProviderSocket> {
  const { label, emitter } = options;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(options.url, { headers: options.headers });
    let opened = false;
    let closedByClient = false;
    let lastError: Error | undefined;
    let markClosed: () => void = () => undefined;
    const closed = new Promise<void>((done) => (markClosed = done));

    const socket: ProviderSocket = {
      send(message) {
        // Áudio ainda chegando da ponte depois do fechamento é esperado; não há a quem entregar.
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      },
      close() {
        if (!closedByClient) {
          closedByClient = true;
          ws.close();
        }
        return closed;
      },
    };

    ws.on("open", () => {
      opened = true;
      resolve(socket);
    });
    ws.on("error", (error) => {
      lastError = error;
    });
    ws.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return; // quadro que não é JSON não faz parte de nenhum dos protocolos: ignorado
      }
      options.onMessage(message);
    });
    ws.on("close", (code, reason) => {
      markClosed();
      const detail = [lastError?.message, `código ${code}`, reason.toString()].filter(Boolean).join("; ");
      if (!opened) {
        reject(new Error(`${label}: não foi possível conectar (${detail})`));
        return;
      }
      options.onClosed?.();
      if (closedByClient) {
        emitter.emit("closed", "client");
        return;
      }
      emitter.emit("error", new Error(`${label}: a conexão caiu (${detail})`));
      emitter.emit("closed", "socket_closed");
    });
  });
}
