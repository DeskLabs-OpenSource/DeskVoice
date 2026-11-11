import { enqueueTask, type Clock, type OrgQuery } from "@deskvoice/core";

/**
 * Deixa um aviso no painel da organização e enfileira a entrega, no mesmo formato que as
 * ferramentas usam (`notifyHumans`, em @deskvoice/tools). É por aqui que uma falha que quem ligou
 * não tem como ver chega a quem opera.
 */
export async function panelNotice(q: OrgQuery, clock: Clock, callId: string | null, body: string): Promise<void> {
  const row = await q.one<{ id: string }>(
    "insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, 'panel', null, $3, $4) returning id",
    [q.organizationId, callId, body, clock.now()],
  );
  if (!row) throw new Error("Panel notification was not created");
  await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: row.id }, callId: callId ?? undefined, runAt: clock.now() });
}
