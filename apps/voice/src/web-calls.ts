import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { recordEvent, withOrg, type Clock, type Db } from "@deskvoice/core";
import { WebSocketServer, type WebSocket } from "ws";
import { engineKeySetting, startCallSession, type CallSession, type CallSessionDeps } from "./call-session";
import { messageOf, type Logger } from "./log";
import { realSchedule, type Schedule } from "./transport";
import { createWebTransport } from "./web-transport";

export const WEB_TOKEN_TTL_SECONDS = 60;
/**
 * Quanto tempo um convite vencido pelo prazo continua reconhecido. Dentro disso, quem recebeu o
 * convite e conecta tarde (aba suspensa, rede lenta) ainda ouve que ele venceu; depois, é só um
 * token que não vale.
 */
export const EXPIRED_INVITE_MEMORY_MS = 30 * 60 * 1000;
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

export type WebCallRefusalCode = "agent_not_found" | "agent_disabled" | "engine_not_configured" | "engine_not_installed" | "engine_simulated" | "too_many_web_calls";
/**
 * Chamadas pelo navegador ao mesmo tempo, por organização (as que esperam a conexão contam).
 * Cada chamada já tem teto de custo e de duração; sem este, um laço na tela abriria chamadas sem
 * fim e o gasto somado não teria limite.
 */
export const MAX_WEB_CALLS_PER_ORGANIZATION = 3;
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
  slot: Slot;
}

/** Uma vaga no teto de chamadas simultâneas da organização. Devolvida uma vez só. */
interface Slot {
  organizationId: string;
  released: boolean;
}

/** Um convite vencido pelo prazo: só o digest, sem token e sem chamada. */
interface Remembered {
  digest: Buffer;
  forget: () => void;
}

/**
 * Um token que bateu. Com `entry`, é um convite válido. Com `expired`, bateu num convite vencido,
 * cuja chamada já foi fechada.
 */
type Redeemed = { entry: Pending } | { expired: true };

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

/** Recusa o upgrade com uma resposta HTTP comum: sem convite válido, não há WebSocket. */
function refuseUpgrade(socket: Duplex, status: 401 | 404, reason: string): void {
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Chamada pelo navegador: a pessoa fala no microfone, pelo painel, com o agente. É uma chamada
 * como outra qualquer (mesma conversa, ferramentas, aviso de gravação, tetos e resumo); só o
 * transporte muda.
 *
 * O WebSocket é público e aceita qualquer `Origin`: o que protege é o token. Ele é emitido pela
 * API interna a pedido de uma sessão autenticada do painel, vale 60 s, serve uma vez, fica só na
 * memória deste processo e está preso a uma chamada já criada. O convite é conferido antes do
 * upgrade: sem convite válido, a resposta é HTTP comum (401 ou 404) e nenhum WebSocket abre.
 */
export async function startWebCalls(deps: WebCallsDeps): Promise<WebCalls> {
  const { db, clock, log } = deps;
  const schedule = deps.schedule ?? realSchedule;
  const now = deps.now ?? (() => performance.now());
  const pending = new Set<Pending>();
  const expired = new Set<Remembered>();
  // Vagas ocupadas por organização: pedidos esperando a conexão mais chamadas em andamento.
  const occupied = new Map<string, number>();
  const reserve = (organizationId: string): Slot | null => {
    const used = occupied.get(organizationId) ?? 0;
    if (used >= MAX_WEB_CALLS_PER_ORGANIZATION) return null;
    occupied.set(organizationId, used + 1);
    return { organizationId, released: false };
  };
  const release = (slot: Slot): void => {
    if (slot.released) return;
    slot.released = true;
    const left = (occupied.get(slot.organizationId) ?? 1) - 1;
    if (left > 0) occupied.set(slot.organizationId, left);
    else occupied.delete(slot.organizationId);
  };

  /** Gasta o token: devolve a chamada dele e o apaga. Depois disso ele não vale mais. */
  function redeem(token: string | null): Redeemed | null {
    if (!token) return null;
    const given = digestOf(token);
    let found: Pending | null = null;
    let stale: Remembered | null = null;
    // Compara com todos, em tempo constante: o tempo da resposta não diz quão perto o chute chegou.
    for (const entry of pending) if (timingSafeEqual(entry.digest, given)) found = entry;
    for (const entry of expired) if (timingSafeEqual(entry.digest, given)) stale = entry;
    if (stale) {
      // Vencido e lembrado: vale uma vez para dizer que venceu, depois é esquecido.
      expired.delete(stale);
      stale.forget();
      return { expired: true };
    }
    if (!found) return null;
    pending.delete(found);
    found.cancelExpiry();
    if (clock.now().getTime() < found.expiresAt) return { entry: found };
    // Vencido antes de o timer disparar: a chamada dele é fechada agora.
    closeNeverConnected(found);
    return { expired: true };
  }

  /** A tela pediu a chamada e nunca conectou: ela não fica "tocando" para sempre. */
  async function neverConnected(entry: Pending): Promise<void> {
    release(entry.slot);
    await withOrg(db, entry.organizationId, async (q) => {
      const closed = await q.exec("update calls set status = 'failed', end_reason = 'web_never_connected', ended_at = $2 where id = $1 and status = 'ringing'", [entry.callId, clock.now()]);
      if (closed === 1) await recordEvent(q, entry.callId, "call_ended", { status: "failed", reason: "web_never_connected", channel: "web" }, clock.now());
    });
  }

  const closeNeverConnected = (entry: Pending): void =>
    void neverConnected(entry).catch((error: unknown) => log("error", "could not close a web call that never connected", { callId: entry.callId, error: messageOf(error) }));

  const expire = (entry: Pending): void => {
    if (!pending.delete(entry)) return;
    closeNeverConnected(entry);
  };

  /** O prazo do convite venceu: a chamada fecha e o digest fica lembrado por um tempo. */
  const timedOut = (entry: Pending): void => {
    if (!pending.has(entry)) return;
    expire(entry);
    const remembered: Remembered = { digest: entry.digest, forget: () => undefined };
    remembered.forget = schedule(() => expired.delete(remembered), EXPIRED_INVITE_MEMORY_MS);
    expired.add(remembered);
  };

  const server = new WebSocketServer({ noServer: true, maxPayload: HARD_MESSAGE_BYTES });
  // Pedido HTTP sem upgrade: aqui só se fala WebSocket.
  const http = createServer((_request, response) => {
    response.writeHead(426, { Connection: "close", "Content-Length": "0" });
    response.end();
  });
  http.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", (error) => log("error", "web call socket error", { error: error.message }));
    const url = new URL(request.url ?? "/", "http://voice");
    // Caminho que não é o da chamada: o token nem é olhado.
    if (!PATHS.has(url.pathname)) return refuseUpgrade(socket, 404, "Not Found");
    // Token ausente, errado ou já usado: nada de WebSocket.
    const redeemed = redeem(url.searchParams.get("token"));
    if (!redeemed) return refuseUpgrade(socket, 401, "Unauthorized");
    // Vencido, mas de quem recebeu o convite: abre e fecha com 4401, para a tela dizer que o
    // convite venceu. A chamada dele já foi fechada; não há vaga nem chamada a devolver.
    if ("expired" in redeemed) return server.handleUpgrade(request, socket, head, (ws) => ws.close(CLOSE_UNAUTHORIZED));
    const { entry } = redeemed;
    // O token já foi gasto. Se o handshake não completa (cabeçalho inválido, socket caiu antes),
    // a chamada dele é fechada e a vaga volta, em vez de ficar tocando até ninguém.
    let connected = false;
    socket.once("close", () => {
      if (!connected) closeNeverConnected(entry);
    });
    server.handleUpgrade(request, socket, head, (ws) => {
      connected = true;
      onConnection(ws, entry);
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
    http.listen(deps.port, deps.host);
  });
  http.on("error", (error) => log("error", "web call server error", { error: error.message }));

  function onConnection(socket: WebSocket, entry: Pending): void {
    socket.on("error", (error) => log("error", "web call socket error", { error: error.message }));

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
    void session.done.then((outcome) => transport.end(outcome.status, outcome.endReason)).finally(() => release(entry.slot));
    socket.send(JSON.stringify({ type: "ready", callId: entry.callId }));
  }

  return {
    port: (http.address() as AddressInfo).port,

    async request(input) {
      const { engines } = deps.session;
      // Reserva a vaga antes de qualquer espera: dois pedidos simultâneos não passam os dois pelo teto.
      const slot = reserve(input.organizationId);
      if (!slot) {
        return { code: "too_many_web_calls", message: `This organization already has ${MAX_WEB_CALLS_PER_ORGANIZATION} browser calls at the same time. End one of them, or wait a minute, and call again.` };
      }
      const prepared = await withOrg(db, input.organizationId, async (q): Promise<{ callId: string } | { code: WebCallRefusalCode; message: string }> => {
        const agent = await q.one<{ enabled: boolean; engine: string }>("select enabled, engine from agents where id = $1", [input.agentId]);
        if (!agent) return { code: "agent_not_found", message: "This agent does not exist in this organization." };
        if (!agent.enabled) return { code: "agent_disabled", message: "This agent is turned off." };
        // Recusar aqui evita abrir o microfone de alguém para uma chamada que não vai conversar.
        if (agent.engine === "simulated") {
          return { code: "engine_simulated", message: "This agent uses the simulated engine, which follows a script and does not talk. Change the agent's voice engine to a real one to call it from the browser." };
        }
        const engine = engines.get(agent.engine);
        if (!engine) return { code: "engine_not_installed", message: `The voice engine "${agent.engine}" of this agent is not available in this installation. Choose another voice engine on the agent's screen.` };
        if (!engine.keyless) {
          const key = await q.one<{ value: unknown }>("select value from settings where organization_id = $1 and key = $2", [input.organizationId, engineKeySetting(agent.engine)]);
          if (typeof key?.value !== "string") return { code: "engine_not_configured", message: `No API key is saved for the voice engine ${engine.label}. Save it in the settings before calling.` };
        }
        const call = await q.one<{ id: string }>(
          "insert into calls (organization_id, agent_id, direction, channel, status, engine, started_at) values ($1, $2, 'inbound', 'web', 'ringing', $3, $4) returning id",
          [input.organizationId, input.agentId, agent.engine, clock.now()],
        );
        if (!call) throw new Error("Web call was not created");
        return { callId: call.id };
      }).catch((error: unknown) => {
        // O banco falhou antes de existir chamada: a vaga reservada não pode ficar presa.
        release(slot);
        throw error;
      });
      if (!("callId" in prepared)) {
        release(slot);
        return prepared;
      }

      const token = randomBytes(32).toString("base64url");
      const entry: Pending = {
        digest: digestOf(token),
        expiresAt: clock.now().getTime() + WEB_TOKEN_TTL_SECONDS * 1000,
        callId: prepared.callId,
        organizationId: input.organizationId,
        agentId: input.agentId,
        userId: input.userId,
        cancelExpiry: () => undefined,
        slot,
      };
      entry.cancelExpiry = schedule(() => timedOut(entry), WEB_TOKEN_TTL_SECONDS * 1000);
      pending.add(entry);
      return { callId: prepared.callId, token, expiresInSeconds: WEB_TOKEN_TTL_SECONDS };
    },

    health: () => ({ status: "ok", detail: `Listening for browser calls on port ${(http.address() as AddressInfo | null)?.port ?? deps.port}.` }),

    async close() {
      for (const entry of pending) entry.cancelExpiry();
      for (const entry of [...pending]) expire(entry);
      for (const remembered of expired) remembered.forget();
      expired.clear();
      // As conversas já foram encerradas por quem chama; o que sobrar aberto é derrubado.
      for (const client of server.clients) client.terminate();
      server.close();
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
