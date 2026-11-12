import type { Logger } from "./log";
import type { Schedule } from "./transport";
import {
  WacallsError,
  isPaired,
  listenWacalls,
  phoneOfJid,
  wacallsCreateSession,
  wacallsDeleteSession,
  wacallsListSessions,
  wacallsLogoutSession,
  wacallsSessionName,
  type WacallsEvents,
  type WacallsOptions,
  type WacallsSession,
} from "./wacalls-client";

/**
 * A ligação pelo WhatsApp, do lado do processo de voz. Nesta fatia: conectar o número por QR Code,
 * dizer o estado e desconectar. Nenhuma ligação é atendida ainda.
 *
 * Este processo não grava nada no banco: ele diz ao painel o que o WaCalls diz agora, e o painel
 * compara com o que tinha gravado e avisa, como faz com o WAHA. O QR Code só chega pelo SSE, então
 * é aqui que ele fica guardado, em memória, por sessão do WaCalls; o painel o pede pela API interna.
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

export function createWhatsAppCalls(options: WacallsOptions, deps: { schedule: Schedule; log: Logger }): WhatsAppCallsHandlers & { close(): void } {
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

    close() {
      events?.stop();
    },
  };
}
