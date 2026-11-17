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

/** O que entra no lugar do número de quem ligou no texto de erro da mensagem para ele. */
export const CALLER_NUMBER_MARK = "[number]";

/**
 * O texto de erro da mensagem para quem ligou sem o número dele, nas duas formas em que um conector o
 * repete (`+5531...` e só os dígitos, como no `chatId` do WAHA). O erro vai para `notifications.error`,
 * `tasks.last_error`, o evento `task_finished` e o log; o apagamento a pedido do titular também limpa
 * os três primeiros, e isto é a defesa a mais. O aviso à equipe guarda o erro como sempre.
 */
export function withoutCallerNumber(message: string, target: string | null): string {
  if (!target) return message;
  const digits = target.replace(/\D/g, "");
  return [target, digits].filter((form) => form.length > 0).reduce((text, form) => text.split(form).join(CALLER_NUMBER_MARK), message);
}

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
      const message = error instanceof Error ? error.message : String(error);
      if (notification.audience !== "caller") {
        await mark("failed", message);
        throw error;
      }
      // Sem `cause`: o runner grava só a mensagem, mas o log pode ler a causa, e ela traz o número.
      const hidden = withoutCallerNumber(message, notification.target);
      await mark("failed", hidden);
      throw new Error(hidden);
    }
    await mark("sent", note);
  },
};

export default routine;
