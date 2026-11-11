import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { recordEvent, withOrg, type Clock, type Db } from "@deskvoice/core";
import { WebSocketServer } from "ws";
import { engineKeySetting, startCallSession, type CallSession, type CallSessionDeps } from "./call-session";
import { messageOf, type Logger } from "./log";
import { realSchedule, type Schedule } from "./transport";
import { createWebTransport } from "./web-transport";

export const WEB_TOKEN_TTL_SECONDS = 60;
const MAX_MESSAGE_BYTES = 64 * 1024;
// Acima disto o `ws` derruba a conexão antes de a mensagem chegar inteira à memória.
const HARD_MESSAGE_BYTES = 1024 * 1024;
// PCM16 mono 8 kHz são 16 000 bytes por segundo. O navegador manda no tempo real; a folga cobre
// rajada de rede e relógio torto. Muito acima disso não é microfone.
const AUDIO_BYTES_PER_SECOND = 16_000;
const FLOOD_FACTOR = 2;
const FLOOD_BURST_SECONDS = 5;
const CLOSE_BAD_REQUEST = 4400;
const CLOSE_UNAUTHORIZED = 4401;
const PATHS = new Set(["/voice-ws", "/"]);

export type WebCallRefusalCode = "agent_not_found" | "agent_disabled" | "engine_not_configured" | "engine_simulated";
export type WebCallRequest = { callId: string; token: string; expiresInSeconds: number } | { code: WebCallRefusalCode; message: string };

export interface WebCallsDeps {
  db: Db;
  clock: Clock;
  session: CallSessionDeps;
  port: number;
  host?: string;
  schedule?: Schedule;
  /** Relógio monotônico em ms: cadência da fala e limite de enxurrada. */
  now?: () => number;
  log: Logger;
  /** Cada conversa iniciada, para o processo encerrá-la ao sair. */
  onSession(session: CallSession): void;
}

export interface WebCalls {
  port: number;
  request(input: { organizationId: string; agentId: string; userId: string }): Promise<WebCallRequest>;
  health(): { status: "ok" | "fail"; detail: string };
  close(): Promise<void>;
}

interface Pending {
  digest: Buffer;
  expiresAt: number;
  callId: string;
  organizationId: string;
  agentId: string;
  userId: string;
  cancelExpiry: () => void;
}

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

/**
 * Chamada pelo navegador: a pessoa fala no microfone, pelo painel, com o agente. É uma chamada
 * como outra qualquer (mesma conversa, ferramentas, aviso de gravação, tetos e resumo); só o
 * transporte muda.
 *
 * O WebSocket é público e aceita qualquer `Origin`: o que protege é o token. Ele é emitido pela
 * API interna a pedido de uma sessão autenticada do painel, vale 60 s, serve uma vez, fica só na
 * memória deste processo e está preso a uma chamada já criada.
 */
export async function startWebCalls(deps: WebCallsDeps): Promise<WebCalls> {
  const { db, clock, log } = deps;
  const schedule = deps.schedule ?? realSchedule;
  const now = deps.now ?? (() => performance.now());
  const pending = new Set<Pending>();

  /** Gasta o token: devolve a chamada dele e o apaga. Depois disso ele não vale mais. */
  function redeem(token: string | null): Pending | null {
    if (!token) return null;
    const given = digestOf(token);
    let found: Pending | null = null;
    // Compara com todos, em tempo constante: o tempo da resposta não diz quão perto o chute chegou.
    for (const entry of pending) if (timingSafeEqual(entry.digest, given)) found = entry;
    if (!found) return null;
    pending.delete(found);
    found.cancelExpiry();
    if (clock.now().getTime() < found.expiresAt) return found;
    // Vencido: a chamada dele é fechada agora, sem esperar o timer.
    closeNeverConnected(found);
    return null;
  }

  /** A tela pediu a chamada e nunca conectou: ela não fica "tocando" para sempre. */
  async function neverConnected(entry: Pending): Promise<void> {
    await withOrg(db, entry.organizationId, async (q) => {
      const closed = await q.exec("update calls set status = 'failed', end_reason = 'web_never_connected', ended_at = $2 where id = $1 and status = 'ringing'", [entry.callId, clock.now()]);
      if (closed === 1) await recordEvent(q, entry.callId, "call_ended", { status: "failed", reason: "web_never_connected", channel: "web" }, clock.now());
    });
  }

  const closeNeverConnected = (entry: Pending): void =>
    void neverConnected(entry).catch((error: unknown) => log("error", "could not close a web call that never connected", { callId: entry.callId, error: messageOf(error) }));

  const expire = (entry: Pending): void => {
    if (!pending.delete(entry)) return;
    neverConnected(entry).catch((error: unknown) => log("error", "could not close a web call that never connected", { callId: entry.callId, error: messageOf(error) }));
  };

  const server = new WebSocketServer({ port: deps.port, host: deps.host, maxPayload: HARD_MESSAGE_BYTES });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  server.on("error", (error) => log("error", "web call server error", { error: error.message }));

  server.on("connection", (socket, request) => {
    socket.on("error", (error) => log("error", "web call socket error", { error: error.message }));
    const url = new URL(request.url ?? "/", "http://voice");
    const entry = PATHS.has(url.pathname) ? redeem(url.searchParams.get("token")) : null;
    if (!entry) {
      // Token ausente, errado, vencido ou já usado: fecha e nada mais. Um token vencido cuja
      // chamada ainda está "tocando" é fechado aqui mesmo, sem esperar o prazo.
      socket.close(CLOSE_UNAUTHORIZED);
      return;
    }

    const transport = createWebTransport(socket, { schedule, now });
    const openedAt = now();
    let received = 0;
    const reject = (why: string): void => {
      log("error", "web call closed for breaking the protocol", { callId: entry.callId, why });
      socket.close(CLOSE_BAD_REQUEST);
      transport.callerLeft();
    };

    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (data.length > MAX_MESSAGE_BYTES) return reject("message over 64 KB");
      if (isBinary) {
        received += data.length;
        const allowed = ((now() - openedAt) / 1000 + FLOOD_BURST_SECONDS) * AUDIO_BYTES_PER_SECOND * FLOOD_FACTOR;
        if (received > allowed) return reject("audio far above real time");
        // Meia amostra no fim de um quadro não é áudio: o PCM16 tem dois bytes por amostra.
        if (data.length >= 2) transport.receiveAudio(data.subarray(0, data.length - (data.length % 2)));
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch (error) {
        return reject(`text that is not JSON (${messageOf(error)})`);
      }
      if (typeof message === "object" && message !== null && "type" in message && message.type === "hangup") transport.callerLeft();
      // Outros tipos: ignorados, para a tela poder ganhar mensagens sem quebrar um servidor antigo.
    });
    // Fechado pelo navegador sem `hangup` (aba fechada, rede caiu) vale como a pessoa desligando.
    socket.on("close", () => transport.callerLeft());

    const session = startCallSession(deps.session, {
      organizationId: entry.organizationId,
      callId: entry.callId,
      agentId: entry.agentId,
      transport,
      started: { channel: "web", userId: entry.userId },
    });
    deps.onSession(session);
    void session.done.then((outcome) => transport.end(outcome.status, outcome.endReason));
    socket.send(JSON.stringify({ type: "ready", callId: entry.callId }));
  });

  return {
    port: (server.address() as AddressInfo).port,

    async request(input) {
      const { engines } = deps.session;
      const prepared = await withOrg(db, input.organizationId, async (q): Promise<{ callId: string } | { code: WebCallRefusalCode; message: string }> => {
        const agent = await q.one<{ enabled: boolean; engine: string }>("select enabled, engine from agents where id = $1", [input.agentId]);
        if (!agent) return { code: "agent_not_found", message: "This agent does not exist in this organization." };
        if (!agent.enabled) return { code: "agent_disabled", message: "This agent is turned off." };
        // Recusar aqui evita abrir o microfone de alguém para uma chamada que não vai conversar.
        if (agent.engine === "simulated") {
          return { code: "engine_simulated", message: "This agent uses the simulated engine, which follows a script and does not talk. Change the agent's voice engine to a real one to call it from the browser." };
        }
        const engine = engines.get(agent.engine);
        if (!engine) return { code: "engine_not_configured", message: `The voice engine "${agent.engine}" of this agent is not installed.` };
        if (!engine.keyless) {
          const key = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [input.organizationId, engineKeySetting(agent.engine)]);
          if (typeof key?.value !== "string") return { code: "engine_not_configured", message: `No API key is saved for the voice engine ${engine.label}. Save it in the settings before calling.` };
        }
        const call = await q.one<{ id: string }>(
          "insert into calls (organization_id, agent_id, direction, status, engine, started_at) values ($1, $2, 'inbound', 'ringing', $3, $4) returning id",
          [input.organizationId, input.agentId, agent.engine, clock.now()],
        );
        if (!call) throw new Error("Web call was not created");
        return { callId: call.id };
      });
      if (!("callId" in prepared)) return prepared;

      const token = randomBytes(32).toString("base64url");
      const entry: Pending = {
        digest: digestOf(token),
        expiresAt: clock.now().getTime() + WEB_TOKEN_TTL_SECONDS * 1000,
        callId: prepared.callId,
        organizationId: input.organizationId,
        agentId: input.agentId,
        userId: input.userId,
        cancelExpiry: () => undefined,
      };
      entry.cancelExpiry = schedule(() => expire(entry), WEB_TOKEN_TTL_SECONDS * 1000);
      pending.add(entry);
      return { callId: prepared.callId, token, expiresInSeconds: WEB_TOKEN_TTL_SECONDS };
    },

    health: () => ({ status: "ok", detail: `Listening for browser calls on port ${(server.address() as AddressInfo | null)?.port ?? deps.port}.` }),

    async close() {
      for (const entry of pending) entry.cancelExpiry();
      for (const entry of [...pending]) expire(entry);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // As conversas já foram encerradas por quem chama; o que sobrar aberto é derrubado.
        for (const client of server.clients) client.terminate();
      });
    },
  };
}
