import { FOLLOW_UP_OVERDUE_AFTER_MS, FOLLOW_UP_TASK, enqueueTask, withOrg, type FollowUpStage, type OrgQuery } from "@deskvoice/core";
import { hasWhatsAppConnector } from "@deskvoice/tools";
import { z } from "zod";
import type { Routine } from "../types";

// Corpo fixo: o título da pendência é texto sobre quem ligou, e o corpo de um aviso não sai por
// prazo nenhum. O sino mostra o título lendo a pendência pelo `follow_up_id`.
export const PANEL_BODY: Record<FollowUpStage, string> = { due: "Pendência para agora", overdue: "Pendência vencida" };
// O WhatsApp é um canal fora da instalação: só a contagem, nunca o título.
export const WHATSAPP_BODY: Record<FollowUpStage, string> = {
  due: "Você tem 1 pendência vencendo agora no painel do DeskVoice",
  overdue: "Você tem 1 pendência vencida no painel do DeskVoice",
};

const reminderSchema = z.object({ followUpId: z.uuid(), stage: z.enum(["due", "overdue"]) });
// A tarefa enfileirada antes da atualização (payload só com título e detalhes) continua criando o
// aviso de antes: quem atualiza não perde pendência.
const legacySchema = z.object({ title: z.string().min(1), details: z.string().default("") });

async function notify(q: OrgQuery, row: { id: string; call_id: string | null; whatsapp: string | null }, stage: FollowUpStage, now: Date): Promise<void> {
  await q.exec("insert into notifications (organization_id, call_id, follow_up_id, channel, body, status, created_at) values ($1, $2, $3, 'panel', $4, 'sent', $5)", [
    q.organizationId,
    row.call_id,
    row.id,
    PANEL_BODY[stage],
    now,
  ]);
  if (!row.whatsapp || !(await hasWhatsAppConnector(q))) return;
  const sent = await q.one<{ id: string }>(
    "insert into notifications (organization_id, call_id, follow_up_id, channel, target, body, created_at) values ($1, $2, $3, 'whatsapp', $4, $5, $6) returning id",
    [q.organizationId, row.call_id, row.id, row.whatsapp, WHATSAPP_BODY[stage], now],
  );
  if (!sent) throw new Error(`WhatsApp notice for follow-up ${row.id} was not created`);
  await enqueueTask(q, { kind: "deliver_notification", payload: { notificationId: sent.id }, ...(row.call_id && { callId: row.call_id }), runAt: now });
}

/**
 * O lembrete da pendência: na hora marcada avisa o dono (pelo painel e, se ele cadastrou WhatsApp e
 * há conector, por WhatsApp) e marca o aviso de vencida para um dia depois do prazo. Pendência já
 * fechada, ou apagada pelo prazo, não avisa nada. O aviso e a próxima tarefa entram na mesma
 * transação: repetir a tarefa depois de uma falha não avisa duas vezes.
 */
const routine: Routine = {
  kind: FOLLOW_UP_TASK,
  async run(task, deps) {
    const now = deps.clock.now();
    const reminder = reminderSchema.safeParse(task.payload);
    if (!reminder.success) {
      const { title, details } = legacySchema.parse(task.payload);
      await withOrg(deps.db, task.organizationId, (q) =>
        q.exec("insert into notifications (organization_id, call_id, channel, body, status, created_at) values ($1, $2, 'panel', $3, 'sent', $4)", [
          task.organizationId,
          task.callId,
          details ? `Pendência: ${title}\n\n${details}` : `Pendência: ${title}`,
          now,
        ]),
      );
      return;
    }

    const { followUpId, stage } = reminder.data;
    await withOrg(deps.db, task.organizationId, async (q) => {
      const row = await q.one<{ id: string; call_id: string | null; status: string; due_at: Date; whatsapp: string | null }>(
        `select f.id, f.call_id, f.status, f.due_at, u.whatsapp_e164 as whatsapp
           from follow_ups f left join users u on u.id = f.owner_user_id and u.disabled_at is null
          where f.id = $1 for update of f`,
        [followUpId],
      );
      if (!row || row.status !== "open") return;
      await notify(q, row, stage, now);
      if (stage === "due") {
        await enqueueTask(q, {
          kind: FOLLOW_UP_TASK,
          payload: { followUpId, stage: "overdue" satisfies FollowUpStage },
          ...(row.call_id && { callId: row.call_id }),
          runAt: new Date(row.due_at.getTime() + FOLLOW_UP_OVERDUE_AFTER_MS),
        });
      }
    });
  },
};

export default routine;
