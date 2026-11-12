import { PURGE_TRANSCRIPTS_TASK, TRANSCRIPT_RETENTION_SETTING, enqueueTask, recordOrgEvent, transcriptRetentionOf, transcriptRetentionSchema } from "@deskvoice/core";
import { z } from "zod";
import { handle } from "../../../../../server/context";

const body = z.object({ days: transcriptRetentionSchema.nullable() });

/**
 * Grava o prazo de guarda da transcrição (`null` = para sempre) e registra quem mudou, de quanto
 * para quanto. Com prazo, a rotina roda em seguida e se reagenda uma vez por dia. A confirmação
 * de quem reduz o prazo é da tela; aqui só passa o que está dentro do piso e do teto.
 */
export const PUT = handle({ body, configure: true }, async ({ q, body, session, deps }) => {
  const now = deps.clock.now();
  const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [TRANSCRIPT_RETENTION_SETTING]);
  const previous = transcriptRetentionOf(stored?.value);
  if (previous === body.days) return { days: previous };

  if (body.days === null) await q.exec("delete from settings where key = $1", [TRANSCRIPT_RETENTION_SETTING]);
  else
    await q.exec(
      `insert into settings (organization_id, key, value, secret, updated_at) values ($1, $2, $3, false, $4)
       on conflict (organization_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [q.organizationId, TRANSCRIPT_RETENTION_SETTING, JSON.stringify(body.days), now],
    );
  await recordOrgEvent(q, "transcript_retention_changed", { from: previous, to: body.days }, now, session.userId);
  if (body.days !== null) await enqueueTask(q, { kind: PURGE_TRANSCRIPTS_TASK, payload: {}, runAt: now });
  return { days: body.days };
});
