import { CALL_RECORDING_SETTING, MAX_TRANSCRIPT_RETENTION_DAYS, MIN_TRANSCRIPT_RETENTION_DAYS, ORG_EVENT_KINDS, TRANSCRIPT_RETENTION_SETTING, callRecordingOf, transcriptRetentionOf } from "@deskvoice/core";
import { handle } from "../../../../server/context";

const HISTORY_LIMIT = 50;

// Só dono ou administrador: o registro diz de quais telefones os dados foram exportados.
export const GET = handle({ configure: true }, async ({ q }) => {
  const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [TRANSCRIPT_RETENTION_SETTING]);
  const recording = await q.one<{ value: unknown }>("select value from settings where key = $1", [CALL_RECORDING_SETTING]);
  const history = await q.many(
    `select e.id, e.at, e.kind, e.payload, u.name as "actorName"
       from organization_events e left join users u on u.id = e.actor_user_id
      where e.kind = any($1) order by e.at desc, e.id desc limit $2`,
    [ORG_EVENT_KINDS, HISTORY_LIMIT],
  );
  return { retentionDays: transcriptRetentionOf(stored?.value), recording: callRecordingOf(recording?.value), minDays: MIN_TRANSCRIPT_RETENTION_DAYS, maxDays: MAX_TRANSCRIPT_RETENTION_DAYS, history };
});
