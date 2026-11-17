import { PURGE_CALLER_NOTES_TASK, callerNotesRetention, purgeCallerNotes, recordOrgEvent, scheduleCallerNotesPurge, withOrg } from "@deskvoice/core";
import type { Routine } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aplica o prazo da memória de UMA organização (decisão 2A, registro 0020): apaga as notas do agente
 * mais velhas que o prazo em vigor, que é o menor entre o da memória (90 dias se ninguém escolheu) e
 * o de guarda da transcrição, quando ele existe. Grava `caller_notes_purged` com a contagem.
 *
 * Roda uma vez por dia, reagendando a si mesma pela fila (`run_at`), sem timer nem polling. A corrente
 * começa na primeira nota da organização (`saveCallerNote`) ou na mudança do prazo, e para quando não
 * sobra nota: a organização sem nota não tem tarefa na fila.
 */
const routine: Routine = {
  kind: PURGE_CALLER_NOTES_TASK,
  async run(task, deps) {
    const now = deps.clock.now();
    // A próxima passagem entra antes do expurgo, em transação própria: se o expurgo falhar até esgotar
    // as tentativas, a de amanhã continua de pé. Só entra se alguma nota sobrevive a esta passagem.
    const days = await withOrg(deps.db, task.organizationId, async (q) => {
      const { effective } = await callerNotesRetention(q);
      const before = new Date(now.getTime() - effective * DAY_MS);
      const survivor = await q.one("select 1 from caller_notes where created_at >= $1 limit 1", [before]);
      if (survivor) await scheduleCallerNotesPurge(q, new Date(now.getTime() + DAY_MS));
      return effective;
    });

    const before = new Date(now.getTime() - days * DAY_MS);
    await withOrg(deps.db, task.organizationId, async (q) => {
      const count = await purgeCallerNotes(q, before);
      // Passagem sem nada a apagar não grava evento: o registro diz o que saiu, não que a rotina passou.
      if (count > 0) await recordOrgEvent(q, "caller_notes_purged", { count, retentionDays: days, before: before.toISOString() }, now);
    });
  },
};

export default routine;
