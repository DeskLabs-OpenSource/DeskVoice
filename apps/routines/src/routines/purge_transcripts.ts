import { PURGE_TRANSCRIPTS_TASK, TRANSCRIPT_RETENTION_SETTING, enqueueTask, purgeRecordings, purgeTranscripts, recordOrgEvent, transcriptRetentionOf, withOrg } from "@deskvoice/core";
import type { Routine } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aplica o prazo de guarda da transcrição de UMA organização: troca o texto das falas mais antigas
 * que o prazo por um marcador, apaga as gravações de áudio da mesma idade e registra quantas saíram. Roda uma vez por dia, reagendando a si
 * mesma pela fila (`run_at`), sem timer nem polling. Quem começa a corrente é a tela, ao gravar
 * um prazo; sem prazo gravado, a corrente para e a transcrição fica para sempre, como antes.
 */
const routine: Routine = {
  kind: PURGE_TRANSCRIPTS_TASK,
  async run(task, deps) {
    const now = deps.clock.now();
    // A próxima passagem entra antes do expurgo, em transação própria: se o expurgo falhar até
    // esgotar as tentativas, a de amanhã continua de pé. Já havendo uma na fila (a tela enfileira
    // uma imediata ao gravar o prazo), não entra outra: a corrente é uma só por organização.
    const days = await withOrg(deps.db, task.organizationId, async (q) => {
      const stored = await q.one<{ value: unknown }>("select value from settings where key = $1", [TRANSCRIPT_RETENTION_SETTING]);
      const retention = transcriptRetentionOf(stored?.value);
      if (retention === null) return null;
      const queued = await q.one("select 1 from tasks where kind = $1 and status = 'queued'", [PURGE_TRANSCRIPTS_TASK]);
      if (!queued) await enqueueTask(q, { kind: PURGE_TRANSCRIPTS_TASK, payload: {}, runAt: new Date(now.getTime() + DAY_MS) });
      return retention;
    });
    if (days === null) return;

    const before = new Date(now.getTime() - days * DAY_MS);
    // A gravação é a mesma conversa em áudio: sai com o mesmo prazo que o texto dela.
    const recordings = deps.recordingsDir ? await purgeRecordings(deps.recordingsDir, task.organizationId, before) : 0;
    await withOrg(deps.db, task.organizationId, async (q) => {
      const count = await purgeTranscripts(q, before);
      // Passagem sem nada a apagar não grava evento: o registro diz o que saiu, não que a rotina passou.
      if (count > 0 || recordings > 0) {
        await recordOrgEvent(q, "transcripts_purged", { count, ...(recordings > 0 && { recordings }), retentionDays: days, before: before.toISOString() }, now);
      }
    });
  },
};

export default routine;
