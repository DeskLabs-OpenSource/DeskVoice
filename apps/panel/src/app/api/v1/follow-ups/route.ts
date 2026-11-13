import { TRANSCRIPT_RETENTION_SETTING, transcriptRetentionOf } from "@deskvoice/core";
import { ApiError, handle } from "../../../../server/context";
import { followUpsFor } from "../../../../server/follow-ups";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = ["open", "mine", "overdue", "closed"] as const;
type View = (typeof VIEWS)[number];

// Cada vista: o filtro, a ordem e os parâmetros que ele usa.
const VIEW_QUERY: Record<View, (userId: string, now: Date) => [string, unknown[]]> = {
  open: () => ["f.status = 'open' order by f.due_at", []],
  mine: (userId) => ["f.status = 'open' and f.owner_user_id = $1 order by f.due_at", [userId]],
  overdue: (_userId, now) => ["f.status = 'open' and f.due_at <= $1 order by f.due_at", [now]],
  closed: () => ["f.status <> 'open' order by f.closed_at desc", []],
};

/**
 * As pendências da organização numa das vistas (abertas, minhas, vencidas, fechadas), ou todas as
 * de uma ligação (`callId`), que é como a linha do tempo lê o título pelo id. Junto vai o prazo de
 * guarda, para a tela marcar a aberta há mais tempo que ele.
 */
export const GET = handle({}, async ({ q, url, session, deps }) => {
  const callId = url.searchParams.get("callId");
  const view = (url.searchParams.get("view") ?? "open") as View;
  if (callId !== null && !UUID.test(callId)) throw new ApiError(400, "validation_error", "callId: must be a call id");
  if (!VIEWS.includes(view)) throw new ApiError(400, "validation_error", `view: unknown view "${view}"`);
  const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [TRANSCRIPT_RETENTION_SETTING]);
  const retentionDays = transcriptRetentionOf(stored?.value);
  if (callId === null) {
    const [where, params] = VIEW_QUERY[view](session.userId, deps.clock.now());
    return { items: await followUpsFor(q, session, `${where} limit 200`, params), retentionDays };
  }
  // A linha do tempo da ligação: as pendências dela e o nome de cada pessoa que os eventos citam
  // (dono em cada momento, quem fechou), inclusive quem já foi desativado.
  return {
    items: await followUpsFor(q, session, "f.call_id = $1 order by f.created_at", [callId]),
    retentionDays,
    people: await q.many(
      `select id, name from users where id in (
         select (payload ->> key)::uuid from call_events, unnest(array['ownerUserId', 'closedBy']) as key
          where call_id = $1 and kind in ('follow_up_created', 'follow_up_assigned', 'follow_up_closed') and payload ->> key is not null)`,
      [callId],
    ),
  };
});
