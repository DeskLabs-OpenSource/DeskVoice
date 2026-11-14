import { recordEvent, toE164, withOrg, type Clock, type Db } from "@deskvoice/core";
import type { PeerConfig } from "werift";
import { startCallSession, type CallSession, type CallSessionDeps } from "./call-session";
import { inboundLimitReached, limitNoticedLately } from "./inbound";
import { messageOf, type Logger } from "./log";
import { panelNotice } from "./panel-notice";
import type { Schedule } from "./transport";
import {
  WacallsError,
  isPaired,
  listenWacalls,
  organizationOfSession,
  phoneOfJid,
  wacallsAcceptCall,
  wacallsAttachPeer,
  wacallsEndCall,
  wacallsCreateSession,
  wacallsDeleteSession,
  wacallsListSessions,
  wacallsLogoutSession,
  wacallsSessionName,
  type WacallsEvent,
  type WacallsEvents,
  type WacallsOptions,
  type WacallsSession,
} from "./wacalls-client";
import { openWhatsAppTransport, type WhatsAppTransport } from "./whatsapp-transport";

/**
 * A ligação pelo WhatsApp, do lado do processo de voz: conectar o número por QR Code, dizer o estado,
 * desconectar e atender as ligações recebidas.
 *
 * O pareamento não grava nada no banco: este processo diz ao painel o que o WaCalls diz agora, e o
 * painel compara com o que tinha gravado e avisa, como faz com o WAHA. O QR Code só chega pelo SSE,
 * então é aqui que ele fica guardado, em memória, por sessão do WaCalls; o painel o pede pela API
 * interna. A ligação recebida, sim, vira linha em `calls`, como a que chega pela operadora.
 */
export type WhatsAppCallsStatus = "starting" | "qr" | "connected" | "logged_out";
export interface WhatsAppCallsState {
  /** `null`: não há sessão desta organização no WaCalls. */
  session: { id: string; status: WhatsAppCallsStatus; qr: string | null; phone: string | null } | null;
}
export type WhatsAppCallsRefusal = { code: "wacalls_not_configured" | "wacalls_unreachable" | "wacalls_refused"; message: string };

export interface WhatsAppCallsHandlers {
  state(input: { organizationId: string }): Promise<WhatsAppCallsState | WhatsAppCallsRefusal>;
  connect(input: { organizationId: string }): Promise<WhatsAppCallsState | WhatsAppCallsRefusal>;
  disconnect(input: { organizationId: string }): Promise<WhatsAppCallsState | WhatsAppCallsRefusal>;
}

/** Quanto `connect` espera o SSE abrir antes de criar a sessão, para o primeiro QR Code não se perder. */
const READY_WAIT_MS = 3000;

interface Pairing {
  qr: string | null;
  /** O WaCalls disse `logged_out`: o código venceu sem leitura, ou o aparelho foi desvinculado. */
  ended: boolean;
}

/** O que é preciso para atender. Sem isto (os testes do pareamento), nenhuma ligação é atendida. */
export interface WhatsAppAnswerDeps {
  db: Db;
  clock: Clock;
  /** Relógio monotônico em ms, para a cadência do áudio. */
  now: () => number;
  session: CallSessionDeps;
  /** Cada conversa iniciada, para o processo encerrá-la ao sair. */
  onSession(session: CallSession): void;
  /** Só para teste: o par WebRTC falso escuta no loopback. */
  peerConfig?: Partial<PeerConfig>;
}

export interface WhatsAppCalls extends WhatsAppCallsHandlers {
  /** Passa a ouvir o WaCalls já (na partida, quando alguma organização pediu o serviço). */
  listen(): void;
  close(): void;
}

export function createWhatsAppCalls(options: WacallsOptions, deps: { schedule: Schedule; log: Logger; answer?: WhatsAppAnswerDeps }): WhatsAppCalls {
  const answering = deps.answer ? createAnswering(options, deps.answer, deps.schedule, deps.log) : null;
  // Por id de sessão do WaCalls, de toda organização: o SSE é um só para a instalação. Quem lê só
  // recebe o da própria organização, porque a sessão é achada pelo nome com o id dela.
  const pairing = new Map<string, Pairing>();
  let events: WacallsEvents | null = null;

  // O SSE só abre quando alguém usa a ligação pelo WhatsApp: em instalação sem o serviço, um processo
  // tentando de 30 em 30 segundos falar com um contêiner que não existe só faria barulho no registro.
  const listening = (): WacallsEvents => {
    events ??= listenWacalls(
      options,
      (event) => {
        if (event.type !== "auth-state") return answering?.onEvent(event);
        if (event.paired) pairing.delete(event.sessionId);
        else if (event.state === "logged_out") pairing.set(event.sessionId, { qr: null, ended: true });
        else if (event.qr) pairing.set(event.sessionId, { qr: event.qr, ended: false });
      },
      deps,
    );
    return events;
  };

  const ours = async (organizationId: string): Promise<WacallsSession[]> => {
    const name = wacallsSessionName(organizationId);
    return (await wacallsListSessions(options)).filter((session) => session.name === name);
  };

  function stateOf(sessions: WacallsSession[]): WhatsAppCallsState {
    const session = sessions.find(isPaired) ?? sessions.at(-1);
    if (!session) return { session: null };
    if (isPaired(session)) return { session: { id: session.id, status: "connected", qr: null, phone: phoneOfJid(session.jid) } };
    const known = pairing.get(session.id);
    if (session.state === "logged_out" || known?.ended) return { session: { id: session.id, status: "logged_out", qr: null, phone: null } };
    return { session: { id: session.id, status: known?.qr ? "qr" : "starting", qr: known?.qr ?? null, phone: null } };
  }

  /** Falha do WaCalls como recusa que o painel sabe traduzir. Outro erro é defeito e sobe. */
  async function guarded(run: () => Promise<WhatsAppCallsState>): Promise<WhatsAppCallsState | WhatsAppCallsRefusal> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof WacallsError)) throw error;
      if (error.code === "not_configured") return { code: "wacalls_not_configured", message: error.message };
      if (error.code === "unreachable" || error.code === "timeout") return { code: "wacalls_unreachable", message: error.message };
      deps.log("error", "wacalls refused a request", { code: error.code, error: error.message });
      return { code: "wacalls_refused", message: error.message };
    }
  }

  return {
    state: ({ organizationId }) =>
      guarded(async () => {
        const sessions = await ours(organizationId);
        // Sessão em pareamento depois de este processo reiniciar: o código só chega pelo SSE.
        if (sessions.length > 0) listening();
        return stateOf(sessions);
      }),

    connect: ({ organizationId }) =>
      guarded(async () => {
        const current = await ours(organizationId);
        if (current.some(isPaired)) return stateOf(current);
        const ready = listening().ready();
        await new Promise<void>((resolve) => {
          const cancel = deps.schedule(resolve, READY_WAIT_MS);
          void ready.then(() => {
            cancel();
            resolve();
          });
        });
        // Sessão que nunca pareou (código vencido, tentativa anterior) é apagada e criada de novo.
        for (const stale of current) {
          await wacallsDeleteSession(options, stale.id);
          pairing.delete(stale.id);
        }
        await wacallsCreateSession(options, wacallsSessionName(organizationId));
        return stateOf(await ours(organizationId));
      }),

    disconnect: ({ organizationId }) =>
      guarded(async () => {
        for (const session of await ours(organizationId)) {
          // Nesta ordem, como no DeskcommCRM: sair com a sessão pareada é o que tira o aparelho do celular.
          if (isPaired(session)) await wacallsLogoutSession(options, session.id);
          await wacallsDeleteSession(options, session.id);
          pairing.delete(session.id);
        }
        return { session: null };
      }),

    listen() {
      if (options.token) listening();
    },

    close() {
      events?.stop();
    },
  };
}

type Refusal = "no_agent" | "agent_disabled" | "inbound_limit_reached";

const NOTICE: Record<Refusal, (from: string, to: string, limit: number) => string> = {
  no_agent: (from, to) =>
    `Uma ligação pelo WhatsApp de ${from} para ${to} não foi atendida pelo agente porque nenhum agente atende esse número. Ela continuou tocando no celular. Escolha o agente em Configurações → WhatsApp, no bloco Ligação pelo WhatsApp.`,
  agent_disabled: (from, to) =>
    `Uma ligação pelo WhatsApp de ${from} para ${to} não foi atendida pelo agente porque o agente desse número está desligado. Ela continuou tocando no celular. Ligue o agente ou escolha outro em Configurações → WhatsApp, no bloco Ligação pelo WhatsApp.`,
  inbound_limit_reached: (from, to, limit) =>
    `Uma ligação pelo WhatsApp de ${from} para ${to} não foi atendida pelo agente porque já havia ${limit} ligações recebidas em andamento, pela operadora e pelo WhatsApp, o limite definido em Configurações. Ela continuou tocando no celular. Outras pelo mesmo motivo nos próximos 10 minutos aparecem só em Chamadas.`,
};

/** O dono que este processo dá a cada ligação que atende: é por ele que reconhece as suas no `call-list`. */
const CLIENT_PREFIX = "deskvoice-call-";

/** O que este processo sabe de uma ligação do WaCalls que ele está atendendo. */
interface Live {
  transport: WhatsAppTransport | null;
  /** O WaCalls disse que ela acabou antes de o atendimento terminar. */
  ended: boolean;
}

/**
 * Atende as ligações recebidas pelo WhatsApp. O agente atende na hora (decisão 4A do desenho).
 *
 * A organização sai do nome da sessão no WaCalls (`deskvoice_<id da organização>`), que só este
 * processo cria, com o token: nada é procurado atravessando organizações. Agente ausente ou
 * desligado, ou teto de recebidas atingido: a chamada fica recusada na linha do tempo, o painel
 * recebe o aviso, e o WaCalls não é tocado. A ligação continua tocando no celular e nos aparelhos
 * de quem trabalha (recusar pelo aparelho vinculado poderia encerrá-la em todos; não medido).
 *
 * Atendendo: primeiro a troca de SDP, depois o atendimento, como o DeskcommCRM. Se o WaCalls recusar
 * uma das duas, nada foi atendido, e a ligação segue tocando no celular.
 */
function createAnswering(options: WacallsOptions, deps: WhatsAppAnswerDeps, schedule: Schedule, log: Logger) {
  const { db, clock } = deps;
  const live = new Map<string, Live>();

  /** A ligação que este processo criou e não chegou à conversa: fecha a linha, para ela não segurar vaga no teto. */
  async function closeUnanswered(organizationId: string, callId: string, reason: string, notice?: string): Promise<void> {
    await withOrg(db, organizationId, async (q) => {
      const closed = await q.exec("update calls set status = 'failed', end_reason = $2, ended_at = $3 where id = $1 and status = 'ringing'", [callId, reason, clock.now()]);
      if (closed === 1) await recordEvent(q, callId, "call_ended", { status: "failed", reason, channel: "whatsapp" }, clock.now());
      if (notice) await panelNotice(q, clock, callId, notice);
    });
  }

  /** Resolve `true` quando a conversa começou: dali em diante, quem tira a ligação de `live` é o fim dela. */
  async function take(event: { sessionId: string; id: string; peer: string; peerPhone?: string }, entry: Live): Promise<boolean> {
    const session = (await wacallsListSessions(options)).find((candidate) => candidate.id === event.sessionId);
    const organizationId = organizationOfSession(session?.name);
    // O número conectado é o destino: é por ele que a ligação conta no teto das recebidas.
    const to = phoneOfJid(session?.jid);
    if (!organizationId || !to) {
      log("error", "WhatsApp call on a session this installation did not create, or without its number; not answering", { wacallsSession: event.sessionId });
      return false;
    }
    // Com o número oculto (`@lid`), vale o telefone que a oferta informa. O WhatsApp não o confirma,
    // como a operadora não confirma o número de quem liga: os dois chegam ao mesmo `from_e164`.
    const callerPhone = phoneOfJid(event.peer) ?? phoneOfJid(event.peerPhone);
    const from = callerPhone ? toE164(callerPhone) : null;

    const outcome = await withOrg(db, organizationId, async (q) => {
      const chosen = await q.one<{ agent_id: string | null }>("select agent_id from whatsapp_call_sessions");
      const agentId = chosen?.agent_id ?? null;
      const agent = agentId ? await q.one<{ enabled: boolean }>("select enabled from agents where id = $1", [agentId]) : null;
      let refusal: Refusal | null = !agent ? "no_agent" : !agent.enabled ? "agent_disabled" : null;
      let limit = 0;
      if (!refusal) {
        const checked = await inboundLimitReached(q, clock);
        limit = checked.limit;
        if (checked.reached) refusal = "inbound_limit_reached";
      }
      const call = await q.one<{ id: string }>(
        `insert into calls (organization_id, agent_id, direction, channel, from_e164, to_e164, status, end_reason, started_at, ended_at)
         values ($1, $2, 'inbound', 'whatsapp', $3, $4, $5, $6, $7, $8) returning id`,
        [organizationId, agentId, from, to, refusal ? "refused" : "ringing", refusal, clock.now(), refusal ? clock.now() : null],
      );
      if (!call) throw new Error("WhatsApp call was not created");
      if (refusal) {
        const overLimit = refusal === "inbound_limit_reached";
        await recordEvent(q, call.id, "call_refused", { reason: refusal, from, to, channel: "whatsapp", ...(overLimit && { limit }) }, clock.now());
        if (!(overLimit && (await limitNoticedLately(q, clock)))) await panelNotice(q, clock, call.id, NOTICE[refusal](from ?? "um número que o WhatsApp não informou", to, limit));
      }
      return { callId: call.id, agentId, refusal };
    });
    if (outcome.refusal || !outcome.agentId) {
      log("info", "WhatsApp call not answered", { callId: outcome.callId, reason: outcome.refusal });
      return false;
    }
    const { callId, agentId } = outcome;

    // Um dono por ligação no WaCalls: com um id só para o processo, a segunda ligação ao mesmo tempo
    // receberia 409 (`handlers_call.go:113-116`).
    const clientId = `${CLIENT_PREFIX}${callId}`;
    let answered = false;
    let transport: WhatsAppTransport;
    try {
      transport = await openWhatsAppTransport(
        {
          exchange: (offer) => wacallsAttachPeer(options, event.sessionId, event.id, clientId, offer),
          // Sem atendimento não há o que desligar: a ligação segue tocando no celular.
          end: async () => {
            if (answered) await wacallsEndCall(options, event.sessionId, event.id);
          },
        },
        { schedule, now: deps.now, log, peerConfig: deps.peerConfig },
      );
      entry.transport = transport;
      if (entry.ended) throw new Error("the caller hung up before the call was answered");
      await wacallsAcceptCall(options, event.sessionId, event.id, clientId);
      answered = true;
    } catch (error) {
      await entry.transport?.close();
      const detail = messageOf(error);
      log("error", "could not answer a WhatsApp call", { callId, error: detail });
      await closeUnanswered(
        organizationId,
        callId,
        entry.ended ? "caller_hangup" : "whatsapp_answer_failed",
        entry.ended ? undefined : `Uma ligação pelo WhatsApp de ${from ?? "um número que o WhatsApp não informou"} não pôde ser atendida pelo agente: ${detail}. Ela continuou tocando no celular. Confira a linha Ligação pelo WhatsApp em Saúde.`,
      );
      return false;
    }
    const conversation = startCallSession(deps.session, { organizationId, callId, agentId, transport, started: { channel: "whatsapp" } });
    deps.onSession(conversation);
    void conversation.done.finally(() => live.delete(event.id));
    return true;
  }

  return {
    onEvent(event: Exclude<WacallsEvent, { type: "auth-state" }>): void {
      if (event.type === "call-list") {
        // Atendida por este processo antes de ele cair (o fim sem SIGTERM não desliga nada): o WaCalls
        // segura a ligação até a janela de volta vencer, e quem ligou ouve silêncio. A linha já foi
        // fechada como `process_restarted` na partida; aqui só se desliga no WhatsApp.
        for (const call of event.calls) {
          if (!call.owner?.startsWith(CLIENT_PREFIX) || call.status === "ended" || live.has(call.callId)) continue;
          log("info", "ending a WhatsApp call left by a previous voice process", { wacallsCall: call.callId });
          wacallsEndCall(options, call.sessionId, call.callId).catch((error: unknown) => {
            log("error", "could not end a WhatsApp call left by a previous voice process", { wacallsCall: call.callId, error: messageOf(error) });
          });
        }
        return;
      }
      if (event.type === "incoming") {
        // O mesmo `incoming` duas vezes não vira duas chamadas.
        if (live.has(event.id)) return;
        const entry: Live = { transport: null, ended: false };
        live.set(event.id, entry);
        take(event, entry).then(
          (started) => {
            if (!started) live.delete(event.id);
          },
          (error: unknown) => {
            live.delete(event.id);
            log("error", "could not handle a WhatsApp call", { wacallsCall: event.id, error: messageOf(error) });
          },
        );
        return;
      }
      const entry = live.get(event.id);
      if (!entry) return;
      if (event.type === "call-status" && event.status === "connected") entry.transport?.mediaConnected();
      if (event.type === "call-ended" || (event.type === "call-status" && event.status === "ended")) {
        entry.ended = true;
        entry.transport?.remoteEnded();
      }
    },
  };
}
