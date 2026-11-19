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
 *      estado da discagem. Se atendem, o canal não volta: o Dial não tem a opção `g`, e mesmo com
 *      ela não voltaria quando é quem ligou que desliga. Quando a conversa com o humano acaba, o
 *      canal só morre (`ChannelDestroyed`). O que diz que houve atendimento é o evento `Dial` da
 *      ARI com `ANSWER`, que chega pela assinatura de todos os canais (`subscribeAll`).
 *
 * Lição do módulo de voz do DeskcommCRM (MIT, mesmo autor; ver CREDITS.md): a mídia nunca passa
 * por bridge + externalMedia. Por isso a transferência é do dialplan, e não uma bridge da ARI.
 */
import { enqueueTask, lockCall, recordEvent, withOrg, type Clock, type Db, type OrgQuery } from "@deskvoice/core";
import { trunkEndpointName, type AriClient } from "./ari";
import type { AudioSocketConnection } from "./audiosocket";
import { messageOf, type Logger } from "./log";
import { panelNotice } from "./panel-notice";
import type { IvrJob } from "./ivr-session";
import { dtmfTones, type KeypadTransport } from "./transport";
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
}

export interface AsteriskCallsDeps {
  ari: AriClient;
  db: Db;
  clock: Clock;
  log: Logger;
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

  /** O AudioSocket conectou. Devolve o transporte da chamada, ou `null` se ninguém a esperava. */
  attach(connection: AudioSocketConnection): { call: ExpectedCall; transport: KeypadTransport & { drained(): Promise<void> } } | null {
    const call = this.byCall.get(connection.id);
    if (!call || call.attached) return null;
    call.attached = true;
    const transport: KeypadTransport & { drained(): Promise<void> } = {
      onAudio: (handler) => connection.onAudio(handler),
      // A tecla chega em banda, pelo mesmo AudioSocket do áudio (a ARI não a entrega a canal fora da Stasis).
      onDtmf: (handler) => connection.onDtmf(handler),
      sendAudio: (pcm) => connection.sendAudio(pcm),
      clearAudio: () => connection.clearAudio(),
      drained: () => connection.drained(),
      onHangup: (handler) =>
        connection.onClose((reason) => {
          if (reason !== "local") handler();
        }),
      // Fechar o AudioSocket devolve o canal à Stasis (`after-audio`), que desliga ou transfere.
      async hangup() {
        await connection.drained();
        connection.close();
      },
      async transfer(toE164) {
        call.transferTo = toE164;
        await connection.drained();
        connection.close();
      },
      // Tom em banda, pelo próprio AudioSocket: a ARI recusa DTMF a canal fora da Stasis (ver `dtmfTones`).
      sendDtmf: (digits) => connection.sendTone(dtmfTones(digits)),
      async close() {
        connection.close();
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
      await this.reportTransfer(call, "FAILED", messageOf(error));
      this.forget(call);
      await this.deps.ari.hangup(channelId);
    }
  }

  /** A discagem da transferência terminou; `dialStatus` é o `DIALSTATUS` do Asterisk (`ANSWER`, `BUSY`, `NOANSWER`...). */
  async transferEnded(channelId: string, dialStatus: string): Promise<void> {
    const call = this.byChannel.get(channelId);
    if (call) await this.reportTransfer(call, dialStatus || "UNKNOWN");
    this.forget(call);
    await this.deps.ari.hangup(channelId);
  }

  /** A discagem da transferência mudou de estado (evento `Dial` da ARI, com o canal de quem ligou em `caller`). */
  transferDialed(channelId: string, dialStatus: string): void {
    const call = this.byChannel.get(channelId);
    if (call?.transferTo && dialStatus === "ANSWER") call.transferAnswered = true;
  }

  /** O canal deixou de existir. */
  async channelDestroyed(channelId: string, cause: string | undefined): Promise<void> {
    const call = this.byChannel.get(channelId);
    if (!call) return;
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
    } else if (call.transferTo) {
      // A transferência atendida termina assim, desligue quem desligar. Sem o atendimento, foi quem
      // ligou que desistiu enquanto tocava: o dialplan não chega a informar o estado da discagem.
      await this.reportTransfer(call, call.transferAnswered ? "ANSWER" : "CALLER_HANGUP");
    }
  }

  private async reportTransfer(call: TrackedCall, dialStatus: string, error?: string): Promise<void> {
    if (call.transferReported) return;
    call.transferReported = true;
    const { db, clock, log } = this.deps;
    const answered = dialStatus === "ANSWER";
    try {
      await withOrg(db, call.organizationId, async (q) => {
        await recordEvent(q, call.callId, "transfer_completed", { to: call.transferTo, status: dialStatus, answered, ...(error !== undefined && { error }) }, clock.now());
        if (!answered) await noticeUnansweredTransfer(q, call, dialStatus, clock);
      });
    } catch (cause) {
      log("error", "could not record transfer_completed", { callId: call.callId, dialStatus, error: messageOf(cause) });
    }
  }

  private forget(call: TrackedCall | undefined): void {
    if (!call) return;
    this.byCall.delete(call.callId);
    this.byChannel.delete(call.channelId);
  }
}

/** `DIALSTATUS` de quem ligou desistindo no meio: não foi a equipe que deixou de atender. */
const CALLER_HANGUP = "CALLER_HANGUP";

/**
 * A transferência não completou e a ligação acaba ali: quem ligou ficou sem ninguém. Sem este aviso,
 * o painel mostraria mais uma chamada "transferida" — e o relatório mentiria para melhor, porque a
 * pessoa não falou com humano nenhum. O briefing vem do `transfer_started` que a ferramenta gravou.
 */
async function noticeUnansweredTransfer(q: OrgQuery, call: TrackedCall, dialStatus: string, clock: Clock): Promise<void> {
  // A chamada já tem `ended_at`: o titular pode ter pedido o apagamento. Com a linha travada, o
  // briefing abaixo já lê o que sobrou do apagamento (sem telefone, motivo nem resumo), ou o
  // apagamento espera este aviso e o alcança.
  await lockCall(q, call.callId);
  // Quem ligou desistiu por conta própria: o motivo do desligamento dele fica como está.
  if (dialStatus !== CALLER_HANGUP) await q.exec("update calls set end_reason = 'transfer_unanswered' where id = $1", [call.callId]);

  const briefing = await q.one<{ from_e164: string | null; reason: string | null; summary: string | null }>(
    `select c.from_e164, e.payload->>'reason' as reason, e.payload->>'summary' as summary
       from calls c
       left join lateral (
         select payload from call_events where call_id = c.id and kind = 'transfer_started' order by id desc limit 1
       ) e on true
      where c.id = $1`,
    [call.callId],
  );
  const lines = [
    dialStatus === CALLER_HANGUP
      ? `Quem ligou desligou antes de a transferência para ${call.transferTo} completar.`
      : `Ninguém atendeu a transferência para ${call.transferTo} (${dialStatus}).`,
  ];
  if (briefing?.from_e164) lines.push(`Quem ligou: ${briefing.from_e164}.`);
  if (briefing?.reason) lines.push(`Motivo: ${briefing.reason}`);
  if (briefing?.summary) lines.push(`O que já foi combinado: ${briefing.summary}`);
  lines.push("A pessoa ficou sem resposta: retorne a ligação.");
  await panelNotice(q, clock, call.callId, lines.join("\n"));
}
