import type { Clock, Db } from "@deskvoice/core";
import type { Tool } from "@deskvoice/tools";
import type { VoiceEngine } from "@deskvoice/voice-engine";
import { createApprovalWaiter } from "./approvals";
import type { AriClient, AriEvent } from "./ari";
import { AsteriskCalls } from "./asterisk-transport";
import { startAudioSocketServer } from "./audiosocket";
import { startCallSession, type CallSession, type CallSessionDeps } from "./call-session";
import { handleInbound } from "./inbound";
import { startInternalApi } from "./internal-api";
import { messageOf, silentLogger, type Logger } from "./log";
import { startOutboundCall } from "./outbound";
import { closeOrphanCalls } from "./reconcile";
import { startSimulatedCall } from "./simulate";
import type { Schedule } from "./transport";
import { applyTrunks, checkTrunks, type TrunksDeps } from "./trunks";

export interface VoiceServerDeps {
  db: Db;
  clock: Clock;
  engines: Map<string, VoiceEngine>;
  tools: Map<string, Tool>;
  ari: AriClient;
  secretKey: Buffer;
  audioSocketPort: number;
  internalPort: number;
  internalToken: string | undefined;
  trunksFile: string;
  publicIp: string | null;
  /** Usuário do Asterisk, que precisa ler o arquivo de troncos. Sem ele, o dono do arquivo não é trocado. */
  trunksOwner?: { uid: number; gid: number };
  host?: string;
  schedule?: Schedule;
  /** Relógio monotônico da cadência de áudio, em ms. */
  now?: () => number;
  log?: Logger;
}

export interface VoiceServer {
  audioSocketPort: number;
  internalPort: number;
  /** As chamadas do Asterisk em curso; `inbound.ts` e `outbound.ts` registram nelas. */
  calls: AsteriskCalls;
  /** Encerra as chamadas em curso de forma limpa e solta portas e escutas. */
  close(): Promise<void>;
}

/** Sobe o processo de voz: AudioSocket, eventos da ARI e a API interna, costurados às conversas. */
export async function startVoiceServer(deps: VoiceServerDeps): Promise<VoiceServer> {
  const { db, clock, ari } = deps;
  const log = deps.log ?? silentLogger;
  // Antes de atender qualquer coisa: o que o processo anterior deixou aberto não é de ninguém.
  await closeOrphanCalls(db, clock, log);
  const approvals = await createApprovalWaiter(db, { schedule: deps.schedule, log });
  const sessionDeps: CallSessionDeps = { db, clock, engines: deps.engines, tools: deps.tools, secretKey: deps.secretKey, approvals, schedule: deps.schedule, log };
  const trunksDeps: TrunksDeps = { db, ari, clock, secretKey: deps.secretKey, file: deps.trunksFile, publicIp: deps.publicIp, owner: deps.trunksOwner, schedule: deps.schedule, log };
  const calls = new AsteriskCalls({ ari, db, clock, log });
  const sessions = new Set<CallSession>();

  const track = (session: CallSession): void => {
    sessions.add(session);
    void session.done.then((outcome) => {
      sessions.delete(session);
      log("info", "call ended", { ...outcome });
    });
  };

  const audioSocket = await startAudioSocketServer({
    port: deps.audioSocketPort,
    host: deps.host,
    schedule: deps.schedule,
    now: deps.now,
    log,
    onConnection(connection) {
      const attached = calls.attach(connection);
      if (!attached) {
        // Ninguém esperava esta chamada (o processo reiniciou no meio, ou não é o Asterisk).
        // Fechar devolve o canal à Stasis, que o desliga.
        log("error", "audiosocket connection for a call nobody expects; closing", { callId: connection.id });
        connection.close();
        return;
      }
      const { call, transport } = attached;
      track(startCallSession(sessionDeps, { organizationId: call.organizationId, callId: call.callId, agentId: call.agentId, transport }));
    },
  });

  const onEvent = async (event: AriEvent): Promise<void> => {
    const channel = event.channel;
    if (!channel) return;
    if (event.type === "ChannelDestroyed") return calls.channelDestroyed(channel.id, event.cause_txt);
    if (event.type !== "StasisStart") return;
    const [kind, detail] = event.args ?? [];
    if (kind === "inbound") return handleInbound({ db, ari, clock, calls, log }, channel);
    if (kind === "after-audio") return calls.afterAudio(channel.id);
    if (kind === "transfer-ended") return calls.transferEnded(channel.id, detail ?? "");
    // Canal na Stasis sem motivo conhecido ficaria pendurado para sempre.
    log("error", "channel entered the app with an unknown argument; hanging up", { channelId: channel.id, args: event.args });
    await ari.hangup(channel.id);
  };
  ari.onEvent((event) => void onEvent(event).catch((error: unknown) => log("error", "could not handle a telephony event", { type: event.type, error: messageOf(error) })));

  // Na partida e a cada reconexão: o Asterisk pode ter reiniciado sem os troncos carregados.
  const reapply = (): void =>
    void applyTrunks(trunksDeps).then(
      (result) => log(result.applied ? "info" : "error", "trunks applied", result),
      (error: unknown) => log("error", "could not apply the trunks", { error: messageOf(error) }),
    );
  ari.onConnected(reapply);
  reapply();

  const api = await startInternalApi({
    port: deps.internalPort,
    host: deps.host,
    token: deps.internalToken,
    log,
    handlers: {
      async health() {
        const status = ari.status();
        return { asterisk: { status: status.connected ? "ok" : "fail", detail: status.detail }, trunks: await checkTrunks(trunksDeps) };
      },
      // O arquivo é um só para a instalação: aplicar a linha de uma organização regrava todas.
      applyTrunks: () => applyTrunks(trunksDeps),
      outbound: (input) => startOutboundCall({ db, ari, clock, calls, log }, input),
      async simulate(input) {
        const started = await startSimulatedCall(sessionDeps, input);
        if (!("callId" in started)) return started;
        track(started.session);
        return { callId: started.callId };
      },
    },
  });

  return {
    audioSocketPort: audioSocket.port,
    internalPort: api.port,
    calls,
    async close() {
      ari.close();
      await api.close();
      for (const session of sessions) session.stop("shutdown");
      await Promise.all([...sessions].map((session) => session.done));
      await audioSocket.close();
      await approvals.close();
    },
  };
}
