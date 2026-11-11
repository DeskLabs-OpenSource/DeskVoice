import WebSocket from "ws";
import type { SessionEmitter } from "./emitter";
import { EngineTimeoutError, type ConnectOptions } from "./types";

export const READY_TIMEOUT_MS = 10_000;

const timer = (options: Pick<ConnectOptions, "schedule">, fn: () => void, delayMs: number): (() => void) => {
  if (options.schedule) return options.schedule(fn, delayMs);
  const handle = setTimeout(fn, delayMs);
  return () => clearTimeout(handle);
};

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
  /** Prazo para a conexão abrir, e o agendador dele. */
  timeout?: Pick<ConnectOptions, "readyTimeoutMs" | "schedule">;
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
    let timedOut = false;
    let closedByClient = false;
    // Sem prazo, um provedor que aceita a conexão TCP e não completa o handshake deixaria quem
    // ligou em silêncio para sempre.
    const timeoutMs = options.timeout?.readyTimeoutMs ?? READY_TIMEOUT_MS;
    const cancelTimeout = timer(options.timeout ?? {}, () => {
      if (opened) return;
      timedOut = true;
      ws.terminate();
      reject(new EngineTimeoutError(`${label}: o provedor não respondeu em ${timeoutMs / 1000} s ao abrir a conexão`));
    }, timeoutMs);
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
      cancelTimeout();
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
      cancelTimeout();
      if (timedOut) return;
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

/**
 * Espera o provedor confirmar a sessão, com prazo. Se ele aceitou a conexão e ficou mudo, a
 * sessão é fechada (`error` + `closed`) e o `connect` rejeita com `EngineTimeoutError`.
 */
export async function awaitSessionReady(
  ready: Promise<void>,
  socket: ProviderSocket,
  options: { label: string; emitter: SessionEmitter; timeout: Pick<ConnectOptions, "readyTimeoutMs" | "schedule"> },
): Promise<void> {
  const timeoutMs = options.timeout.readyTimeoutMs ?? READY_TIMEOUT_MS;
  let cancel: () => void = () => undefined;
  const expired = new Promise<never>((_, reject) => {
    cancel = timer(options.timeout, () => reject(new EngineTimeoutError(`${options.label}: o provedor não confirmou a sessão em ${timeoutMs / 1000} s`)), timeoutMs);
  });
  try {
    await Promise.race([ready, expired]);
  } catch (error) {
    if (error instanceof EngineTimeoutError) options.emitter.emit("error", error);
    await socket.close();
    throw error;
  } finally {
    cancel();
    // A sessão que perdeu a corrida ainda pode rejeitar quando o socket fechar; já foi tratada.
    ready.catch(() => undefined);
  }
}
