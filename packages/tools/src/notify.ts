import { enqueueTask } from "@deskvoice/core";
import { hasWhatsAppConnector } from "./connectors/whatsapp";
import type { ToolContext } from "./types";

/**
 * Cria os avisos para os humanos da organização e enfileira a entrega de cada um. O painel recebe
 * sempre; o WhatsApp, quando pedido, se houver conector e alguém com número cadastrado.
 * Devolve os canais usados.
 */
export async function notifyHumans(ctx: ToolContext, body: string, options: { whatsapp: boolean }): Promise<string[]> {
  const targets: { channel: "panel" | "whatsapp"; target: string | null }[] = [{ channel: "panel", target: null }];
  if (options.whatsapp && (await hasWhatsAppConnector(ctx.q))) {
    const users = await ctx.q.many<{ whatsapp_e164: string }>(
      "select distinct whatsapp_e164 from users where organization_id = $1 and whatsapp_e164 is not null order by whatsapp_e164",
      [ctx.organizationId],
    );
    for (const user of users) targets.push({ channel: "whatsapp", target: user.whatsapp_e164 });
  }

  for (const { channel, target } of targets) {
    const row = await ctx.q.one<{ id: string }>(
      "insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, $3, $4, $5, $6) returning id",
      [ctx.organizationId, ctx.callId, channel, target, body, ctx.clock.now()],
    );
    if (!row) throw new Error(`Notification (${channel}) was not created`);
    await enqueueTask(ctx.q, { kind: "deliver_notification", payload: { notificationId: row.id }, callId: ctx.callId, runAt: ctx.clock.now() });
  }
  return [...new Set(targets.map((entry) => entry.channel))];
}
