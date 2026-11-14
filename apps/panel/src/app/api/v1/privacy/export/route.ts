import { access } from "node:fs/promises";
import { callerSideSql, recordOrgEvent, recordingPath } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../server/context";
import { phone } from "../../../../../server/shapes";

// Tudo o que a organização guarda sobre um telefone, uma linha por registro: as chamadas em que ele
// é o outro lado (quem ligou, na recebida; quem recebeu, na feita), com o mesmo critério do
// apagamento (`callerSideSql`), para a linha da empresa nunca devolver as chamadas de todo mundo.
// Vão o desfecho e a fala que o sustenta, a análise (inteira, ou a expurgada depois do prazo de
// guarda) e a nota, o pedido para parar a gravação (quando, por quem e o motivo, enquanto o prazo de
// guarda não o apaga), os eventos delas (a fala expurgada sai com o marcador `{ "purged": true }`),
// a entrada na lista de não ligar e as pendências do número, abertas e fechadas, com título,
// detalhes e nota de fechamento. Base: a consulta de @webtecnica no PR #66. Sem filtro de
// organização à mão: `withOrg` só deixa ver a da sessão, e é isso que impede a ficha de levar o
// que a pessoa disse a outra empresa da mesma instalação. Cada chamada diz se tem gravação
// (`recording`), sem o áudio: ele sai pela tela da chamada, e embutido em base64 faria o arquivo
// de texto crescer cerca de 2,5 MB por minuto de conversa (registro 0016).
const RECORD_SQL = `
  with record as (
    select c.started_at as sort_at, c.id as call_id, 0 as rank, 0::bigint as seq,
           json_build_object(
             'type', 'call', 'call', c.id, 'direction', c.direction, 'from', c.from_e164, 'to', c.to_e164,
             'status', c.status, 'endReason', c.end_reason, 'engine', c.engine, 'startedAt', c.started_at,
             'answeredAt', c.answered_at, 'endedAt', c.ended_at, 'costCents', c.cost_cents, 'summary', c.summary,
             'outcome', c.outcome, 'outcomeConfidence', c.outcome_confidence, 'outcomeEvidence', c.outcome_evidence,
             'analysis', c.analysis, 'analysisScore', c.analysis_score,
             'recordingPausedAt', c.recording_paused_at, 'recordingPausedBy', c.recording_paused_by,
             'recordingPauseReason', c.recording_pause_reason
           ) as line
      from calls c
     where ${callerSideSql("c.")}
    union all
    select c.started_at, c.id, 1, e.id,
           json_build_object('type', 'event', 'call', e.call_id, 'at', e.at, 'kind', e.kind, 'payload', e.payload)
      from call_events e join calls c on c.id = e.call_id and c.organization_id = e.organization_id
     where ${callerSideSql("c.")}
    union all
    select d.created_at, null, 2, 0, json_build_object('type', 'do_not_call', 'phone', d.e164, 'reason', d.reason, 'since', d.created_at)
      from do_not_call d
     where d.e164 = $1
    union all
    select f.created_at, f.call_id, 3, 0,
           json_build_object(
             'type', 'follow_up', 'followUp', f.id, 'call', f.call_id, 'phone', f.caller_e164, 'title', f.title,
             'details', f.details, 'status', f.status, 'dueAt', f.due_at, 'createdAt', f.created_at,
             'closedAt', f.closed_at, 'closingNote', f.closing_note
           )
      from follow_ups f
     where f.caller_e164 = $1
  )
  select line from record order by sort_at, call_id nulls last, rank, seq`;

type Line = { type: "call" | "event" | "do_not_call" | "follow_up" } & Record<string, unknown>;

/**
 * Exporta a ficha de um telefone como NDJSON e registra quem exportou, de qual telefone e quando,
 * mesmo quando nada foi achado: a consulta em si já é um acesso ao dado. O telefone não vai para
 * o log do processo; só para o registro da organização, que só dono ou administrador lê.
 */
export const POST = handle({ body: z.object({ phone }), configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const lines = (await q.many<{ line: Line }>(RECORD_SQL, [body.phone])).map((row) => row.line);
  // O que vale é o arquivo no disco, e não se a gravação estava ligada: o prazo de guarda já pode tê-lo apagado.
  for (const line of lines) {
    if (line.type === "call") line.recording = await access(recordingPath(deps.recordingsDir, q.organizationId, String(line.call))).then(() => true, () => false);
  }
  const count = (type: Line["type"]): number => lines.filter((line) => line.type === type).length;
  const counts = { calls: count("call"), events: count("event"), doNotCall: count("do_not_call") > 0, followUps: count("follow_up") };
  await recordOrgEvent(q, "caller_data_exported", { phone: body.phone, ...counts }, now, session.userId);
  return { phone: body.phone, exportedAt: now, counts, content: lines.map((line) => `${JSON.stringify(line)}\n`).join("") };
});
