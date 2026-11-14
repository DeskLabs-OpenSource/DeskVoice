import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import type { WacallsOptions } from "../wacalls-client";
import { PEER_CONFIG } from "../whatsapp-transport";

/** Os dois pares do teste, o falso e o do processo de voz, conversam pelo loopback. */
export const LOOPBACK_PEER = { iceInterfaceAddresses: { udp4: "127.0.0.1" } } as const;

/** A perna WebRTC do lado do WaCalls: o par que responde à oferta e recebe o canal `pcm`. */
export interface FakeLeg {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  /** O que chegou pelo canal `pcm`, um item por mensagem. */
  received: Buffer[];
}

/**
 * Responde à oferta como o pion do WaCalls (`bridge.go:30-75`): só responde, espera a coleta de
 * candidatos terminar antes de devolver a resposta, e aceita o canal que o outro lado criar com o
 * rótulo `pcm`. Tudo que chega nele é PCM16 a 16 kHz; texto é ignorado.
 */
export async function answerLikeWacalls(offer: string): Promise<{ answer: string; leg: FakeLeg }> {
  const connection = new RTCPeerConnection({ ...PEER_CONFIG, ...LOOPBACK_PEER });
  const leg: FakeLeg = { connection, channel: null, received: [] };
  connection.onDataChannel.subscribe((channel) => {
    if (channel.label !== "pcm") return;
    leg.channel = channel;
    channel.onMessage.subscribe((data) => {
      if (typeof data !== "string") leg.received.push(Buffer.from(data));
    });
  });
  await connection.setRemoteDescription({ type: "offer", sdp: offer });
  await connection.setLocalDescription(await connection.createAnswer());
  const answer = connection.localDescription?.sdp;
  if (!answer) throw new Error("The fake WaCalls peer produced no answer");
  return { answer, leg };
}

export const WACALLS_TOKEN = "wacalls-test-token";

interface FakeSession {
  id: string;
  name: string;
  jid: string;
  state: string;
  paired: boolean;
  qrCount: number;
}

export interface FakeCall {
  id: string;
  sessionId: string;
  peer: string;
  /** `X-Client-Id` de quem atendeu. */
  owner: string | null;
  /** Os `X-Client-Id` de cada troca de SDP. */
  offers: string[];
  status: "ringing" | "connected" | "ended";
  endReason: string | null;
  leg: FakeLeg | null;
}

/**
 * WaCalls falso em porta 0, com os formatos lidos no código do ramo `develop` (`d16a076`) e nas
 * lições do DeskcommCRM:
 *
 * - toda rota `/api` exige `Authorization: Bearer <token>`; `/healthz` é aberta;
 * - `POST /api/sessions` já inicia o pareamento, e o primeiro QR Code sai no SSE ANTES da resposta
 *   que traz o id (é o que obriga a reconhecer a sessão pelo nome);
 * - `auth-state` com `state: "logged_out"` é código vencido ou aparelho desvinculado;
 * - `POST /api/sessions/{id}/pair` existe e responde: quem o chamar aparece em `requests`;
 * - a ligação recebida: `incoming` e `call-status` no SSE, a troca de SDP em `.../webrtc` com um par
 *   WebRTC de verdade (werift) no papel do pion do WaCalls, que só responde e recebe o canal `pcm`
 *   (`bridge.go`), o atendimento com dono por `X-Client-Id` (409 para o dono que já tem outra), e
 *   `call-ended` quando a ligação acaba de qualquer lado.
 *
 * O teste muda o estado pelos auxiliares (`scan`, `nextQr`, `expire`, `unlink`).
 */
export async function startFakeWacalls() {
  const sessions = new Map<string, FakeSession>();
  const requests: Array<{ method: string; path: string; query: string; authorization: string | undefined }> = [];
  const streams = new Set<ServerResponse>();
  const state = { down: false, nextId: 1, refuseAccept: false };
  const calls = new Map<string, FakeCall>();
  let nextCall = 1;

  // O retrato que o broker manda ao conectar (`broker.go:207`): só as vivas.
  const callList = () =>
    [...calls.values()]
      .filter((call) => call.status !== "ended")
      .map((call) => ({ sessionId: call.sessionId, callId: call.id, owner: call.owner, direction: "incoming", peer: call.peer, startedAt: 0, status: call.status }));
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
        response.write(`data: ${JSON.stringify({ type: "call-list", calls: callList() })}\n\n`);
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
      const callMatch = /^\/api\/sessions\/([^/]+)\/calls\/([^/]+)(?:\/(webrtc|accept))?$/.exec(url.pathname);
      if (callMatch) {
        const [, sid = "", id = "", action] = callMatch;
        if (!sessions.has(decodeURIComponent(sid))) return json(response, 404, { error: "no such session" });
        const found = calls.get(decodeURIComponent(id));
        const clientId = typeof request.headers["x-client-id"] === "string" ? request.headers["x-client-id"] : "";
        if (method === "DELETE" && !action) {
          if (found) end(found, "user_ended");
          response.writeHead(204);
          return response.end();
        }
        if (!found || found.status === "ended") return json(response, 404, { error: "no such call" });
        if (method === "POST" && action === "webrtc") {
          const offer = (body as { sdp_offer?: string } | undefined)?.sdp_offer;
          if (!offer) return json(response, 400, { error: "sdp_offer required" });
          found.offers.push(clientId);
          // Uma oferta nova substitui e fecha a perna anterior (`session.go:274-290`).
          void found.leg?.connection.close();
          const { answer, leg } = await answerLikeWacalls(offer);
          found.leg = leg;
          return json(response, 200, { sdp_answer: answer });
        }
        if (method === "POST" && action === "accept") {
          const busy = [...calls.values()].some((other) => other !== found && other.owner === clientId && other.status !== "ended");
          if (busy) return json(response, 409, { error: "operator already on a call" });
          if (state.refuseAccept) return json(response, 500, { error: "accept failed" });
          found.owner = clientId;
          return json(response, 200, { call: { callId: found.id } });
        }
        return json(response, 405, { error: "method not allowed" });
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
  const callStatus = (call: FakeCall): void => emit({ type: "call-status", sessionId: call.sessionId, id: call.id, owner: call.owner, status: call.status, peer: call.peer, startedAt: 0 });
  /** O fim, de qualquer lado: o WaCalls fecha a perna WebRTC e avisa no SSE (`session.go:140-144`). */
  function end(call: FakeCall, reason: string): void {
    if (call.status === "ended") return;
    call.status = "ended";
    call.endReason = reason;
    void call.leg?.connection.close();
    emit({ type: "call-ended", sessionId: call.sessionId, id: call.id, owner: call.owner, reason, endedAt: 0 });
  }

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
    calls,
    /** Uma sessão já pareada com o número `digits`, como se o QR Code tivesse sido lido. */
    paired(name: string, digits = "553133330000"): FakeSession {
      const session: FakeSession = { id: `s${state.nextId++}`, name, jid: `${digits}:7@s.whatsapp.net`, state: "open", paired: true, qrCount: 0 };
      sessions.set(session.id, session);
      return session;
    },
    /** Alguém liga para o número da sessão pelo WhatsApp. */
    ring(session: FakeSession, peer = "5531988887777@s.whatsapp.net", peerPhone?: string): FakeCall {
      const call: FakeCall = { id: `c${nextCall++}`, sessionId: session.id, peer, owner: null, offers: [], status: "ringing", endReason: null, leg: null };
      calls.set(call.id, call);
      emit({ type: "incoming", sessionId: session.id, id: call.id, peer, peerName: "", peerPhotoUrl: "", ...(peerPhone && { peerPhone }), offeredAt: 0 });
      callStatus(call);
      return call;
    },
    /** Uma ligação já atendida por `owner` (outro processo), sem evento: aparece só no `call-list` do próximo SSE. */
    answeredBy(session: FakeSession, owner: string): FakeCall {
      const call: FakeCall = { id: `c${nextCall++}`, sessionId: session.id, peer: "5531988887777@s.whatsapp.net", owner, offers: [], status: "connected", endReason: null, leg: null };
      calls.set(call.id, call);
      return call;
    },
    /** O áudio com o WhatsApp ficou de pé (`ACTIVE`). */
    connectMedia(call: FakeCall) {
      call.status = "connected";
      callStatus(call);
    },
    /** Quem ligou fala: PCM16 a 16 kHz, pelo canal `pcm`. */
    speak(call: FakeCall, pcm16k: Buffer) {
      call.leg?.channel?.send(pcm16k);
    },
    /** Quem ligou desliga (ou o WhatsApp encerra). */
    hangUp(call: FakeCall, reason = "user_ended") {
      end(call, reason);
    },
    /** Derruba as conexões de SSE abertas, como uma queda de rede. */
    dropStreams() {
      for (const stream of streams) stream.destroy();
      streams.clear();
    },
    async stop() {
      for (const call of calls.values()) await call.leg?.connection.close();
      for (const stream of streams) stream.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
