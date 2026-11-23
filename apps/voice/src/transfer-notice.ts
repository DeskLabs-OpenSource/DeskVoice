import { lockCall, type Clock, type OrgQuery } from "@deskvoice/core";
import { panelNotice } from "./panel-notice";

/** `DIALSTATUS` de quem ligou desistindo no meio: não foi a equipe que deixou de atender. */
export const CALLER_HANGUP = "CALLER_HANGUP";

/**
 * A transferência não completou e a ligação acaba ali: quem ligou ficou sem ninguém. Sem este aviso,
 * o painel mostraria mais uma chamada "transferida" — e o relatório mentiria para melhor, porque a
 * pessoa não falou com humano nenhum. O briefing vem do `transfer_started` que a ferramenta gravou.
 */
export async function noticeUnansweredTransfer(
  q: OrgQuery,
  call: { callId: string; transferTo?: string },
  dialStatus: string,
  clock: Clock,
  /** A ligação voltou para o agente, e o trecho de volta terminou sem ninguém ficar com o próximo passo. */
  returned = false,
): Promise<void> {
  // A chamada já tem `ended_at`: o titular pode ter pedido o apagamento. Com a linha travada, o
  // briefing abaixo já lê o que sobrou do apagamento (sem telefone, motivo nem resumo), ou o
  // apagamento espera este aviso e o alcança.
  await lockCall(q, call.callId);
  // Quem ligou desistiu por conta própria: o motivo do desligamento dele fica como está. Com a volta,
  // a ligação não acabou na transferência, e o motivo é o do fim do trecho de volta.
  if (dialStatus !== CALLER_HANGUP && !returned) await q.exec("update calls set end_reason = 'transfer_unanswered' where id = $1", [call.callId]);

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
  if (returned) lines.push("A ligação voltou para o agente, e ele não deixou recado nem pendência.");
  if (briefing?.from_e164) lines.push(`Quem ligou: ${briefing.from_e164}.`);
  if (briefing?.reason) lines.push(`Motivo: ${briefing.reason}`);
  if (briefing?.summary) lines.push(`O que já foi combinado: ${briefing.summary}`);
  lines.push("A pessoa ficou sem resposta: retorne a ligação.");
  await panelNotice(q, clock, call.callId, lines.join("\n"));
}
