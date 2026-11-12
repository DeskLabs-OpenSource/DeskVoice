import { recordOrgEvent } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../server/context";
import { phone } from "../../../../../server/shapes";

// Tudo o que a organização guarda sobre um telefone, uma linha por registro: as chamadas em que ele
// é origem ou destino, os eventos delas (a fala expurgada sai com o marcador `{ "purged": true }`)
// e a entrada na lista de não ligar. Base: a consulta de @webtecnica no PR #66. Sem filtro de
// organização à mão: `withOrg` só deixa ver a da sessão, e é isso que impede a ficha de levar o
// que a pessoa disse a outra empresa da mesma instalação.
const RECORD_SQL = `
  with record as (
    select c.started_at as sort_at, c.id as call_id, 0 as rank, 0::bigint as seq,
           json_build_object(
             'type', 'call', 'call', c.id, 'direction', c.direction, 'from', c.from_e164, 'to', c.to_e164,
             'status', c.status, 'endReason', c.end_reason, 'engine', c.engine, 'startedAt', c.started_at,
             'answeredAt', c.answered_at, 'endedAt', c.ended_at, 'costCents', c.cost_cents, 'summary', c.summary
           ) as line
      from calls c
     where $1 in (c.from_e164, c.to_e164)
    union all
    select c.started_at, c.id, 1, e.id,
           json_build_object('type', 'event', 'call', e.call_id, 'at', e.at, 'kind', e.kind, 'payload', e.payload)
      from call_events e join calls c on c.id = e.call_id and c.organization_id = e.organization_id
     where $1 in (c.from_e164, c.to_e164)
    union all
    select d.created_at, null, 2, 0, json_build_object('type', 'do_not_call', 'phone', d.e164, 'reason', d.reason, 'since', d.created_at)
      from do_not_call d
     where d.e164 = $1
  )
  select line from record order by sort_at, call_id nulls last, rank, seq`;

type Line = { type: "call" | "event" | "do_not_call" } & Record<string, unknown>;

/**
 * Exporta a ficha de um telefone como NDJSON e registra quem exportou, de qual telefone e quando,
 * mesmo quando nada foi achado: a consulta em si já é um acesso ao dado. O telefone não vai para
 * o log do processo; só para o registro da organização, que só dono ou administrador lê.
 */
export const POST = handle({ body: z.object({ phone }), configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const lines = (await q.many<{ line: Line }>(RECORD_SQL, [body.phone])).map((row) => row.line);
  const count = (type: Line["type"]): number => lines.filter((line) => line.type === type).length;
  const counts = { calls: count("call"), events: count("event"), doNotCall: count("do_not_call") > 0 };
  await recordOrgEvent(q, "caller_data_exported", { phone: body.phone, ...counts }, now, session.userId);
  return { phone: body.phone, exportedAt: now, counts, content: lines.map((line) => `${JSON.stringify(line)}\n`).join("") };
});
