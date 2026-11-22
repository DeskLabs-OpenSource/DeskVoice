/**
 * `CallTransport` sobre o Asterisk: o áudio vai pelo AudioSocket e o canal é controlado pela ARI.
 *
 * O caminho de um canal (ver deploy/asterisk/extensions.conf):
 *   1. `Stasis(deskvoice,inbound)`: `inbound.ts` cria a chamada e manda o canal para
 *      `deskvoice-audio`, que atende e abre o AudioSocket com o id da chamada. Na chamada de
 *      saída o canal já nasce nesse contexto.
 *   2. Quando o processo fecha o AudioSocket, o dialplan devolve o canal à Stasis com
 *      `after-audio`. Aqui se decide: havendo transferência pedida, o canal vai para
 *      `deskvoice-transfer`; senão, desliga.
 *   3. `deskvoice-transfer` disca. Se ninguém atende, devolve o canal com `transfer-ended` e o
 *      estado da discagem. Com a volta pedida pela conversa (Vapi · fatia 5a), o canal ganha um
 *      `AUDIOSOCKET_UUID` novo e vai de novo para `deskvoice-audio`, e o AudioSocket que reconecta
 *      com ele passa a ser o áudio do mesmo transporte (`resume`); sem ela, desliga. Se atendem, o canal não volta: o Dial não tem a opção `g`, e mesmo com
 *      ela não voltaria quando é quem ligou que desliga. Quando a conversa com o humano acaba, o
 *      canal só morre (`ChannelDestroyed`). O que diz que houve atendimento é o evento `Dial` da
 *      ARI com `ANSWER`, que chega pela assinatura de todos os canais (`subscribeAll`). Com a volta
 *      ligada, a ligação termina nesse `ANSWER` (`transferDialed`); sem ela, no `ChannelDestroyed`.
 *
 * Lição do módulo de voz do DeskcommCRM (MIT, mesmo autor; ver CREDITS.md): a mídia nunca passa
 * por bridge + externalMedia. Por isso a transferência é do dialplan, e não uma bridge da ARI.
 */
import { enqueueTask, recordEvent, withOrg, type Clock, type Db } from "@deskvoice/core";
import { randomUUID } from "node:crypto";
import { trunkEndpointName, type AriClient } from "./ari";
import type { AudioSocketConnection } from "./audiosocket";
import { messageOf, type Logger } from "./log";
import { CALLER_HANGUP, noticeUnansweredTransfer } from "./transfer-notice";
import type { IvrJob } from "./ivr-session";
import { dtmfTones, realSchedule, RETURNABLE_DIAL_STATUSES, type KeypadTransport, type Schedule, type TransferOutcome } from "./transport";
import type { UnavailableJob } from "./unavailable";
import type { VoicemailJob } from "./voicemail";

export interface ExpectedCall {
  callId: string;
  /** Canal do Asterisk que carrega a chamada. */
  channelId: string;
  organizationId: string;
  /** Nulo quando a chamada não tem agente e vai para o recado (`voicemail`). */
  agentId: string | null;
  /** Tronco por onde a chamada chegou ou saiu; a transferência sai por ele. */
  trunkId: string;
  /**
   * A chamada não tem quem atenda: quem conecta o áudio atende a caixa postal em vez de abrir uma
   * conversa com o motor de voz.
   */
  voicemail?: VoicemailJob;
  /**
   * A organização está suspensa: quem conecta o áudio toca a fala de indisponível e desliga, sem
   * abrir o motor de voz (`unavailable.ts`). A chamada já está `refused`.
   */
  unavailable?: UnavailableJob;
  /**
   * O número atende pelo menu por teclas (`mode = 'ivr'`): quem conecta o áudio abre a URA
   * (`ivr-session.ts`) com o menu já lido, em vez da conversa. A chamada nasce sem agente; a opção
   * `agent` grava o dela.
   */
  ivr?: IvrJob;
}

interface TrackedCall extends ExpectedCall {
  attached: boolean;
  transferTo?: string;
  transferReported?: boolean;
  transferAnswered?: boolean;
  /** A ligação terminou no `ANSWER` do `Dial` (`transferDialed`): o `ChannelDestroyed` depois não grava nem entrega nada. */
  endedAtAnswer?: boolean;
  /** A conversa espera o fim da transferência (`transfer` com `returnIfUnanswered`). */
  transferWaiter?: { resolve(outcome: TransferOutcome): void; signal?: AbortSignal };
  /** O `AUDIOSOCKET_UUID` posto na volta: o AudioSocket que conectar com ele é a mesma ligação. */
  returnId?: string;
  /** O `DIALSTATUS` da transferência que voltou. */
  returnStatus?: string;
  /** Para onde foi a transferência que voltou (`transferTo` é apagado na volta): o aviso de `returnFailed` diz. */
  returnTo?: string;
  /** Resolve quando o `transfer_completed` da volta está gravado: o `transfer_returned`, e a conversa, só vêm depois. */
  returnRecorded?: Promise<void>;
  /** Desiste da volta se o AudioSocket não reconectar no prazo. */
  cancelReturnDeadline?: () => void;
  /** Põe o áudio do AudioSocket que reconectou na volta no lugar do antigo, no mesmo transporte. */
  swap?: (connection: AudioSocketConnection) => void;
}

/**
 * Quanto a volta espera o AudioSocket reconectar depois do `continue`. Na M5 (DESA-345, Asterisk
 * 20.20.1 do `deploy`) ele reconectou em 2 a 14 ms; o prazo só existe para ninguém ficar pendurado.
 */
const RETURN_CONNECT_MS = 5000;

export interface AsteriskCallsDeps {
  ari: AriClient;
  db: Db;
  clock: Clock;
  log: Logger;
  /** Injetável: teste não espera tempo real. */
  schedule?: Schedule;
  /** O `AUDIOSOCKET_UUID` da volta. Injetável para o teste saber qual conexão esperar. */
  newAudioId?: () => string;
}

/** As chamadas que o Asterisk tem em curso, do ponto de vista deste processo. */
export class AsteriskCalls {
  private readonly byCall = new Map<string, TrackedCall>();
  private readonly byChannel = new Map<string, TrackedCall>();

  constructor(private readonly deps: AsteriskCallsDeps) {}

  /** Uma chamada foi criada e o AudioSocket dela vai conectar. */
  expect(call: ExpectedCall): void {
    const tracked: TrackedCall = { ...call, attached: false };
    this.byCall.set(call.callId, tracked);
    this.byChannel.set(call.channelId, tracked);
  }

  /**
   * O AudioSocket que conectou é o da volta de uma transferência que ninguém atendeu: o áudio passa
   * para o transporte que a conversa já tem, e a espera dela resolve com `returned`. `false`: não é.
   */
  resume(connection: AudioSocketConnection): boolean {
    const call = this.byCall.get(connection.id);
    if (!call || call.returnId !== connection.id || !call.swap) return false;
    this.byCall.delete(connection.id);
    call.returnId = undefined;
    call.cancelReturnDeadline?.();
    call.swap(connection);
    const status = call.returnStatus ?? "UNKNOWN";
    // A ligação só voltou quando o áudio reconectou: o `transfer_returned` sai aqui, e não no `continue`
    // (Vapi · fatia 5a, ajuste 2). A linha do tempo diz que voltou antes de a conversa do trecho de
    // volta gravar qualquer coisa.
    void (call.returnRecorded ?? Promise.resolve())
      .then(() => this.recordReturned(call, status))
      .then(() => this.settle(call, { returned: true, status }));
    return true;
  }

  /** O AudioSocket conectou. Devolve o transporte da chamada, ou `null` se ninguém a esperava. */
  attach(connection: AudioSocketConnection): { call: ExpectedCall; transport: KeypadTransport & { drained(): Promise<void> } } | null {
    const call = this.byCall.get(connection.id);
    if (!call || call.attached) return null;
    call.attached = true;
    // O AudioSocket da volta é outro, e os handlers da conversa passam para ele (`swap`). O que tocou
    // antes da transferência continua somado em `playedMs`.
    let current = connection;
    let playedBefore = 0;
    let audioHandler: ((pcm: Buffer) => void) | undefined;
    let dtmfHandler: ((digit: string) => void) | undefined;
    const hangupHandlers: Array<() => void> = [];
    const watchClose = (on: AudioSocketConnection, handler: () => void): void =>
      on.onClose((reason) => {
        if (reason !== "local") handler();
      });
    call.swap = (next) => {
      playedBefore += current.spokenMs();
      current = next;
      if (audioHandler) next.onAudio(audioHandler);
      if (dtmfHandler) next.onDtmf(dtmfHandler);
      for (const handler of hangupHandlers) watchClose(next, handler);
    };
    const transport: KeypadTransport & { drained(): Promise<void> } = {
      // `true` mesmo com a chave do agente desligada: quem decide pedir a volta é a conversa.
      canReturnFromTransfer: true,
      onAudio: (handler) => {
        audioHandler = handler;
        current.onAudio(handler);
      },
      // A tecla chega em banda, pelo mesmo AudioSocket do áudio (a ARI não a entrega a canal fora da Stasis).
      onDtmf: (handler) => {
        dtmfHandler = handler;
        current.onDtmf(handler);
      },
      sendAudio: (pcm) => current.sendAudio(pcm),
      clearAudio: () => current.clearAudio(),
      playedMs: () => playedBefore + current.spokenMs(),
      drained: () => current.drained(),
      onHangup: (handler) => {
        hangupHandlers.push(handler);
        watchClose(current, handler);
      },
      // Fechar o AudioSocket devolve o canal à Stasis (`after-audio`), que desliga ou transfere.
      async hangup() {
        await current.drained();
        current.close();
      },
      async transfer(toE164, options) {
        call.transferTo = toE164;
        call.transferReported = false;
        call.transferAnswered = false;
        const outcome = options?.returnIfUnanswered ? new Promise<TransferOutcome>((resolve) => (call.transferWaiter = { resolve, signal: options.signal })) : undefined;
        await current.drained();
        current.close();
        return outcome;
      },
      // Tom em banda, pelo próprio AudioSocket: a ARI recusa DTMF a canal fora da Stasis (ver `dtmfTones`).
      sendDtmf: (digits) => current.sendTone(dtmfTones(digits)),
      async close() {
        current.close();
      },
    };
    return { call, transport };
  }

  /** O canal voltou do AudioSocket: transfere, se foi pedido, ou desliga. */
  async afterAudio(channelId: string): Promise<void> {
    const call = this.byChannel.get(channelId);
    if (!call?.transferTo) {
      this.forget(call);
      await this.deps.ari.hangup(channelId);
      return;
    }
    try {
      await this.deps.ari.setVariable(channelId, "DESKVOICE_TRANSFER_TO", call.transferTo.replace(/^\+/, ""));
      await this.deps.ari.setVariable(channelId, "DESKVOICE_TRUNK", trunkEndpointName(call.trunkId));
      await this.deps.ari.continueDialplan(channelId, "deskvoice-transfer", "s");
    } catch (error) {
      this.deps.log("error", "could not start the transfer", { callId: call.callId, error: messageOf(error) });
      await this.reportTransfer(call, "FAILED", { error: messageOf(error) });
      this.forget(call);
      this.settle(call, { returned: false, status: "FAILED" });
      await this.deps.ari.hangup(channelId);
    }
  }

  /** A discagem da transferência terminou; `dialStatus` é o `DIALSTATUS` do Asterisk (`ANSWER`, `BUSY`, `NOANSWER`...). */
  async transferEnded(channelId: string, dialStatus: string): Promise<void> {
    const call = this.byChannel.get(channelId);
    const status = dialStatus || "UNKNOWN";
    if (call && (await this.returnToAgent(call, status))) return;
    if (call) await this.reportTransfer(call, status);
    this.forget(call);
    if (call) this.settle(call, { returned: false, status });
    await this.deps.ari.hangup(channelId);
  }

  /**
   * Ninguém atendeu e a conversa pediu a volta (Vapi · fatia 5a): o canal ganha um `AUDIOSOCKET_UUID`
   * novo e volta para `deskvoice-audio`, que atende de novo (o `Answer()` num canal já atendido não
   * faz nada, medido na M5) e reabre o AudioSocket. O dialplan é o mesmo de antes. `false`: não volta,
   * e o canal segue o caminho de sempre.
   */
  private async returnToAgent(call: TrackedCall, status: string): Promise<boolean> {
    const waiter = call.transferWaiter;
    if (!waiter || waiter.signal?.aborted || !RETURNABLE_DIAL_STATUSES.has(status)) return false;
    const audioId = (this.deps.newAudioId ?? randomUUID)();
    call.returnId = audioId;
    call.returnStatus = status;
    call.returnTo = call.transferTo;
    let recorded: () => void = () => undefined;
    call.returnRecorded = new Promise<void>((resolve) => (recorded = resolve));
    this.byCall.set(audioId, call);
    try {
      await this.deps.ari.setVariable(call.channelId, "AUDIOSOCKET_UUID", audioId);
      await this.deps.ari.continueDialplan(call.channelId, "deskvoice-audio", "s");
    } catch (error) {
      this.deps.log("error", "could not send the channel back to the agent; hanging up as before", { callId: call.callId, error: messageOf(error) });
      this.byCall.delete(audioId);
      call.returnId = undefined;
      recorded();
      return false;
    }
    await this.reportTransfer(call, status, { returned: true });
    recorded();
    // Daqui em diante o canal é da conversa de novo: o próximo `after-audio` desliga, e não transfere.
    call.transferTo = undefined;
    // `resume` pode ter chegado durante a gravação acima; aí não há mais prazo a contar.
    if (call.returnId === audioId) {
      call.cancelReturnDeadline = (this.deps.schedule ?? realSchedule)(() => {
        if (call.returnId !== audioId) return;
        this.deps.log("error", "the audio did not reconnect after the transfer came back; hanging up", { callId: call.callId });
        this.forget(call);
        void this.returnFailed(call, status).finally(() => void this.deps.ari.hangup(call.channelId).catch(() => undefined));
      }, RETURN_CONNECT_MS);
    }
    return true;
  }

  /**
   * A volta foi pedida ao Asterisk, mas o áudio não reconectou (o prazo venceu, ou quem ligou desligou
   * antes): a ligação não voltou para o agente, e ninguém atendeu. O aviso "retorne a ligação" que
   * `reportTransfer` deixou para o trecho de volta sai aqui, uma vez, e a conversa recebe o
   * `DIALSTATUS` da discagem, para fechar a ligação como não atendida (Vapi · fatia 5a, ajuste 2).
   */
  private async returnFailed(call: TrackedCall, status: string): Promise<void> {
    await call.returnRecorded;
    try {
      await withOrg(this.deps.db, call.organizationId, (q) => noticeUnansweredTransfer(q, { callId: call.callId, transferTo: call.returnTo }, status, this.deps.clock));
    } catch (cause) {
      this.deps.log("error", "could not record the unanswered transfer", { callId: call.callId, dialStatus: status, error: messageOf(cause) });
    }
    this.settle(call, { returned: false, status });
  }

  /** O áudio reconectou na volta: a ligação voltou para o agente. */
  private async recordReturned(call: TrackedCall, status: string): Promise<void> {
    try {
      await withOrg(this.deps.db, call.organizationId, (q) => recordEvent(q, call.callId, "transfer_returned", { status }, this.deps.clock.now()));
    } catch (cause) {
      this.deps.log("error", "could not record transfer_returned", { callId: call.callId, error: messageOf(cause) });
    }
  }

  /**
   * A discagem da transferência mudou de estado (evento `Dial` da ARI, com o canal de quem ligou em `caller`).
   *
   * Com a conversa esperando a volta (`transferWaiter`), o `ANSWER` encerra a ligação aqui, no
   * atendimento (Vapi · fatia 5a, ajuste 1): grava `transfer_completed` e entrega o fim à conversa, que
   * fecha a ligação como `transferred`. Esperar o `ChannelDestroyed` deixaria a ligação `in_progress`
   * durante toda a conversa com a pessoa da equipe, ocupando vaga no limite de ligações simultâneas e
   * caindo em `reconcile` num reinício. Diferença aceita: sem a volta, o `ended_at` é o pedido da
   * transferência; com ela, é o atendimento (inclui o tempo tocando, com o motor fechado e sem custo).
   * Sem a volta, segue como antes: o `transfer_completed` sai no `ChannelDestroyed`.
   */
  async transferDialed(channelId: string, dialStatus: string): Promise<void> {
    const call = this.byChannel.get(channelId);
    if (!call?.transferTo || dialStatus !== "ANSWER" || call.transferAnswered) return;
    call.transferAnswered = true;
    if (!call.transferWaiter) return;
    call.endedAtAnswer = true;
    await this.reportTransfer(call, "ANSWER");
    this.settle(call, { returned: false, status: "ANSWER" });
  }

  /** O canal deixou de existir. */
  async channelDestroyed(channelId: string, cause: string | undefined): Promise<void> {
    const call = this.byChannel.get(channelId);
    if (!call) return;
    // A volta foi pedida e o áudio ainda não reconectou (`forget` abaixo apaga o sinal).
    const pendingReturn = call.returnId !== undefined;
    this.forget(call);
    const { db, clock } = this.deps;
    if (!call.attached) {
      // O áudio nunca conectou: chamada de saída que ninguém atendeu, ou quem ligou desistiu antes.
      await withOrg(db, call.organizationId, async (q) => {
        const ended = await q.exec("update calls set status = 'failed', end_reason = 'no_answer', ended_at = $2 where id = $1 and status = 'ringing'", [call.callId, clock.now()]);
        if (ended === 1) {
          await recordEvent(q, call.callId, "call_ended", { status: "failed", reason: "no_answer", cause: cause ?? null }, clock.now());
          // Este fim não passa por `finish`: a revisão é enfileirada aqui. Na religação, é ela quem grava
          // o "não atendida" na ligação original e decide a reserva; nas outras, não há caso a abrir.
          const reviewId = await enqueueTask(q, { kind: "review_call", payload: {}, callId: call.callId, runAt: clock.now() });
          await recordEvent(q, call.callId, "task_queued", { taskId: reviewId, kind: "review_call" }, clock.now());
        }
      });
    } else if (call.endedAtAnswer) {
      // A ligação já terminou no atendimento (`transferDialed`): aqui só se esquece o canal.
      return;
    } else if (call.transferTo) {
      // A transferência atendida termina assim, desligue quem desligar. Sem o atendimento, foi quem
      // ligou que desistiu enquanto tocava: o dialplan não chega a informar o estado da discagem.
      const status = call.transferAnswered ? "ANSWER" : CALLER_HANGUP;
      await this.reportTransfer(call, status);
      this.settle(call, { returned: false, status });
    } else if (pendingReturn && call.returnStatus !== undefined) {
      // Quem ligou desligou entre a volta e a reconexão do áudio: ninguém atendeu, e a ligação não voltou.
      await this.returnFailed(call, call.returnStatus);
    }
  }

  /** Entrega à conversa o fim da transferência que ela espera, uma vez só. */
  private settle(call: TrackedCall, outcome: TransferOutcome): void {
    const waiter = call.transferWaiter;
    if (!waiter) return;
    call.transferWaiter = undefined;
    waiter.resolve(outcome);
  }

  /**
   * `transfer_completed`, uma vez por transferência. Com `returned`, a volta foi pedida ao Asterisk: o
   * `transfer_returned` sai quando o áudio reconecta (`resume`), e o aviso "retorne a ligação" fica para
   * o fim do trecho de volta, que só o manda se ninguém ficou com o próximo passo (`call-session.ts`),
   * ou para `returnFailed`, se o áudio não reconectar.
   */
  private async reportTransfer(call: TrackedCall, dialStatus: string, options: { error?: string; returned?: boolean } = {}): Promise<void> {
    if (call.transferReported) return;
    call.transferReported = true;
    const { db, clock, log } = this.deps;
    const answered = dialStatus === "ANSWER";
    const { error, returned } = options;
    try {
      await withOrg(db, call.organizationId, async (q) => {
        await recordEvent(q, call.callId, "transfer_completed", { to: call.transferTo, status: dialStatus, answered, ...(error !== undefined && { error }) }, clock.now());
        if (!returned && !answered) await noticeUnansweredTransfer(q, call, dialStatus, clock);
      });
    } catch (cause) {
      log("error", "could not record transfer_completed", { callId: call.callId, dialStatus, error: messageOf(cause) });
    }
  }

  private forget(call: TrackedCall | undefined): void {
    if (!call) return;
    this.byCall.delete(call.callId);
    this.byChannel.delete(call.channelId);
    if (call.returnId !== undefined) this.byCall.delete(call.returnId);
    call.returnId = undefined;
    call.cancelReturnDeadline?.();
  }
}
