import { MAX_TASK_ATTEMPTS, withOrg, type NotificationAudience, type OrgQuery } from "@deskvoice/core";
import { loadAllowedWebhooks, loadWhatsAppConnector, postToWebhook, sendWhatsApp } from "@deskvoice/tools";
import { z } from "zod";
import type { Routine, RoutineDeps } from "../types";
import { recordCallerMessageResult } from "./review_call";

const payloadSchema = z.object({ notificationId: z.uuid() });

interface NotificationRow {
  id: string;
  channel: "panel" | "whatsapp" | "webhook";
  target: string | null;
  body: string;
  call_id: string | null;
  status: string;
  audience: NotificationAudience;
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
      const { addressVerified } = await sendWhatsApp(
        connector,
        { to: target, text: notification.body, callId: notification.call_id, idempotencyKey: notification.id },
        deps,
      );
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
    const notification = await withOrg(deps.db, task.organizationId, (q) =>
      q.one<NotificationRow>("select id, channel, target, body, call_id, status, audience from notifications where id = $1", [notificationId]),
    );
    if (!notification) throw new Error(`Notification ${notificationId} not found`);
    // A mensagem para quem ligou, quando a ligação caiu (desenho 2026-11-16-follow-up-da-ligacao-que-caiu,
    // seção 3.5): o resultado vai para a linha do tempo da ligação original, e a que não saiu abre a
    // pendência de reserva. "Não saiu" é a última tentativa da fila falhar: antes dela, a fila tenta de novo.
    const callerCall = notification.audience === "caller" ? notification.call_id : null;
    const mark = (status: "sent" | "failed", error: string | null): Promise<void> =>
      withOrg(deps.db, task.organizationId, async (q) => {
        await q.exec("update notifications set status = $2, error = $3 where id = $1", [notificationId, status, error]);
        if (callerCall === null) return;
        if (status === "sent") await recordCallerMessageResult(q, callerCall, "whatsapp_sent", deps.clock.now());
        else if (task.attempts >= MAX_TASK_ATTEMPTS) await recordCallerMessageResult(q, callerCall, "whatsapp_failed", deps.clock.now());
      });
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
