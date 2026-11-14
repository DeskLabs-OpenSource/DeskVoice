import { ERASE_RECORDINGS_TASK, removeErasedRecordings } from "@deskvoice/core";
import type { Routine } from "../types";

/**
 * Apaga os arquivos de gravação das chamadas apagadas a pedido do titular. Quem enfileira é o
 * próprio apagamento, na mesma transação: a tarefa só existe depois que o banco confirmou. O
 * arquivo que não sai fica contado no registro da organização (`caller_recordings_erased`), e a
 * tarefa falha para a fila tentar de novo; um novo pedido também enfileira outra passagem.
 */
const routine: Routine = {
  kind: ERASE_RECORDINGS_TASK,
  async run(task, deps) {
    if (!deps.recordingsDir) throw new Error("erase_recordings needs RECORDINGS_DIR: the recordings of erased calls were not removed");
    const result = await removeErasedRecordings(deps.db, { dir: deps.recordingsDir, organizationId: task.organizationId, now: deps.clock.now() });
    if (result.left > 0) throw new Error(`${result.left} recording(s) of erased calls were not removed: ${result.errors.join("; ")}`);
  },
};

export default routine;
