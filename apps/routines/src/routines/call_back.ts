import { CALL_BACK_TASK, CALL_BACKS_CHANNEL, withOrg } from "@deskvoice/core";
import { z } from "zod";
import type { Routine } from "../types";

const payloadSchema = z.object({ callBackId: z.uuid() });

/**
 * A hora da religação (desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.6, passo 2). A tarefa
 * nasce com a linha de `call_backs`, com `runAt = due_at`. Na hora marcada, ela confere se a linha
 * ainda está `scheduled` e se a ligação original ainda existe e não foi apagada a pedido do titular;
 * passa a linha a `due` e avisa o processo de voz no canal `call_backs`, na mesma transação (o aviso
 * só sai quando o banco confirma).
 *
 * **A rotina não disca**: quem fala com o Asterisk é o processo de voz, e só por `startOutboundCall`,
 * que confere a política de saída na hora de discar. Rodar de novo não muda nada: só a linha
 * `scheduled` avança.
 */
const routine: Routine = {
  kind: CALL_BACK_TASK,
  async run(task, deps) {
    const { callBackId } = payloadSchema.parse(task.payload);
    await withOrg(deps.db, task.organizationId, async (q) => {
      const row = await q.one<{ status: string; origin_erased: boolean | null }>(
        `select b.status, c.erased_at is not null as origin_erased
           from call_backs b left join calls c on c.id = b.origin_call_id
          where b.id = $1 for update of b`,
        [callBackId],
      );
      if (row?.status !== "scheduled") return;
      if (row.origin_erased !== false) {
        await q.exec("update call_backs set status = 'cancelled' where id = $1", [callBackId]);
        return;
      }
      await q.exec("update call_backs set status = 'due' where id = $1", [callBackId]);
      await q.exec("select pg_notify($1, $2)", [CALL_BACKS_CHANNEL, callBackId]);
    });
  },
};

export default routine;
