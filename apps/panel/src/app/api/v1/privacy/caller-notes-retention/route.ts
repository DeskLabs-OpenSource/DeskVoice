import { CALLER_NOTES_RETENTION_SETTING, PURGE_CALLER_NOTES_TASK, callerNotesRetention, callerNotesRetentionSchema, enqueueTask, recordOrgEvent } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../server/context";

const body = z.object({ days: callerNotesRetentionSchema }).strict();

/**
 * Grava o prazo da memória (decisão 2A, registro 0020): de 30 a 365 dias, nunca acima do prazo de
 * guarda da transcrição, quando ele existe. Registra quem mudou, de quanto para quanto (`from` nulo é
 * o de fábrica), sem texto livre. Se a organização tem nota, a rotina roda em seguida e se reagenda
 * uma vez por dia; sem nota, nada entra na fila.
 */
export const PUT = handle({ body, configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const current = await callerNotesRetention(q);
  if (current.transcriptDays !== null && body.days > current.transcriptDays) {
    throw new ApiError(400, "caller_notes_retention_above_transcripts", "The memory retention cannot be longer than the transcript retention.");
  }
  if (current.configured === body.days) return { ...current };

  await q.exec(
    `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, false, $4)
     on conflict (organization_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [q.organizationId, CALLER_NOTES_RETENTION_SETTING, JSON.stringify(body.days), now],
  );
  await recordOrgEvent(q, "caller_notes_retention_changed", { from: current.configured, to: body.days }, now, session.userId);
  // Um prazo menor apaga já, e não só amanhã. Sem nota, a corrente não começa.
  const hasNotes = await q.one("select 1 from caller_notes limit 1");
  if (hasNotes) await enqueueTask(q, { kind: PURGE_CALLER_NOTES_TASK, payload: {}, runAt: now });
  return { ...(await callerNotesRetention(q)) };
});
