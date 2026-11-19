import { END_SUPPORT_ACCESS_TASK, endSupportAccess } from "@deskvoice/core";
import { z } from "zod";
import type { Routine } from "../types";

const payloadSchema = z.object({ supportAccessId: z.uuid() });

/**
 * Encerra UM acesso de suporte da instalação na hora do prazo (seção 3.6 do desenho do R8): a
 * tarefa é enfileirada junto com o acesso, com `runAt = expires_at`, no molde de `expire_approval`.
 * Cobre o acesso de quem não fez mais nenhuma requisição depois do prazo. O acesso que já acabou
 * (encerrado, ou vencido na primeira requisição depois do prazo) não grava nada de novo.
 */
const routine: Routine = {
  kind: END_SUPPORT_ACCESS_TASK,
  async run(task, deps) {
    const { supportAccessId } = payloadSchema.parse(task.payload);
    await endSupportAccess(deps.db, supportAccessId, deps.clock.now(), "expired");
  },
};

export default routine;
