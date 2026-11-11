import { withOrg } from "@deskvoice/core";
import { z } from "zod";
import type { Routine } from "../types";

const payloadSchema = z.object({ approvalId: z.uuid() });

/**
 * Vence UM pedido de aprovação, na hora em que o prazo dele acaba: a tarefa é enfileirada junto
 * com o pedido, com `runAt = expires_at`. Cobre a chamada que caiu antes de a ferramenta vencer o
 * pedido ela mesma. Só toca o que ainda está `pending`; rodar de novo não muda nada.
 */
const routine: Routine = {
  kind: "expire_approval",
  async run(task, deps) {
    const { approvalId } = payloadSchema.parse(task.payload);
    const now = deps.clock.now();
    await withOrg(deps.db, task.organizationId, (q) =>
      q.exec("update approvals set status = 'expired', decided_at = $2 where id = $1 and status = 'pending' and expires_at <= $2", [approvalId, now]),
    );
  },
};

export default routine;
