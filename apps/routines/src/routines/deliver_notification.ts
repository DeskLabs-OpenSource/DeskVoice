import { withOrg, type OrgQuery } from "@deskvoice/core";
import { loadAllowedWebhooks, loadWhatsAppConnector, postToWebhook, sendWhatsApp } from "@deskvoice/tools";
import { z } from "zod";
import type { Routine, RoutineDeps } from "../types";

const payloadSchema = z.object({ notificationId: z.uuid() });

interface NotificationRow {
  id: string;
  channel: "panel" | "whatsapp" | "webhook";
  target: string | null;
  body: string;
  call_id: string | null;
  status: string;
}

/** Fica em `notifications.error` de um aviso ENVIADO: a ressalva de como ele saiu. */
const UNVERIFIED_ADDRESS = "sent without the WhatsApp service confirming the address of the number (check-exists unavailable)";

/**
 * Lê do banco o que a entrega precisa e devolve o envio pronto, que responde uma ressalva ou
 * `null`. A chamada de rede fica fora da transação: destino lento não segura conexão do banco.
 */
async function prepare(q: OrgQuery, notification: NotificationRow, deps: RoutineDeps): Promise<() => Promise<string | null>> {
  const { channel, target } = notification;
  // O aviso de painel já está onde a tela lê; entregar é só marcar.
  if (channel === "panel") return async () => null;
  if (!target) throw new Error(`Notification ${notification.id} (${channel}) has no target`);

  if (channel === "whatsapp") {
    const connector = await loadWhatsAppConnector(q, deps.secretKey);
    if (!connector) throw new Error("WhatsApp connector is not configured (setting whatsapp.connector)");
    return async () => {
      const { addressVerified } = await sendWhatsApp(connector, { to: target, text: notification.body, callId: notification.call_id }, deps);
      return addressVerified ? null : UNVERIFIED_ADDRESS;
    };
  }

  // Canal `webhook`: `target` é o nome de um webhook cadastrado, nunca uma URL solta.
  const hook = (await loadAllowedWebhooks(q, deps.secretKey)).find((candidate) => candidate.name === target);
  if (!hook) throw new Error(`Webhook ${JSON.stringify(target)} is not registered (setting webhooks.allowed)`);
  return async () => {
    const response = await postToWebhook(hook, { notificationId: notification.id, callId: notification.call_id, body: notification.body }, deps);
    if (!response.ok) throw new Error(`Webhook ${hook.name} answered HTTP ${response.status}`);
    return null;
  };
}

const routine: Routine = {
  kind: "deliver_notification",
  async run(task, deps) {
    const { notificationId } = payloadSchema.parse(task.payload);
    const mark = (status: "sent" | "failed", error: string | null): Promise<number> =>
      withOrg(deps.db, task.organizationId, (q) => q.exec("update notifications set status = $2, error = $3 where id = $1", [notificationId, status, error]));

    const notification = await withOrg(deps.db, task.organizationId, (q) =>
      q.one<NotificationRow>("select id, channel, target, body, call_id, status from notifications where id = $1", [notificationId]),
    );
    if (!notification) throw new Error(`Notification ${notificationId} not found`);
    // Nova tentativa de uma tarefa cujo envio já tinha saído: não manda duas vezes.
    if (notification.status === "sent") return;

    let note: string | null;
    try {
      const send = await withOrg(deps.db, task.organizationId, (q) => prepare(q, notification, deps));
      note = await send();
    } catch (error) {
      await mark("failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
    await mark("sent", note);
  },
};

export default routine;
