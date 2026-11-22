import { enqueueTask, recordEvent, withOrg, withSystem, type Clock, type Db } from "@deskvoice/core";
import { messageOf, type Logger } from "./log";

/**
 * Roda na partida do processo de voz. Toda chamada ainda `ringing` ou `in_progress` ficou órfã:
 * quem a conduzia era o processo anterior, que caiu ou foi reiniciado. Sem isto ela apareceria
 * "ao vivo" no painel para sempre. Cada uma é fechada como falha, com `call_ended`, a tarefa de
 * resumo e as aprovações pendentes vencidas. A troca de estado é condicional, então rodar duas
 * vezes não grava nada em dobro.
 */
export async function closeOrphanCalls(db: Db, clock: Clock, log: Logger): Promise<number> {
  const orphans = await withSystem(db, (q) => q.many<{ id: string; organization_id: string }>("select id, organization_id from calls where status in ('ringing', 'in_progress') order by started_at"));
  let closed = 0;
  for (const orphan of orphans) {
    try {
      const done = await withOrg(db, orphan.organization_id, async (q) => {
        const now = clock.now();
        const updated = await q.exec(
          "update calls set status = 'failed', end_reason = 'process_restarted', ended_at = $2 where id = $1 and status in ('ringing', 'in_progress')",
          [orphan.id, now],
        );
        if (updated !== 1) return false;
        await q.exec("update approvals set status = 'expired', decided_at = $2 where call_id = $1 and status = 'pending'", [orphan.id, now]);
        await recordEvent(q, orphan.id, "call_ended", { status: "failed", reason: "process_restarted" }, now);
        const taskId = await enqueueTask(q, { kind: "summarize_call", payload: {}, callId: orphan.id, runAt: now });
        await recordEvent(q, orphan.id, "task_queued", { taskId, kind: "summarize_call" }, now);
        const reviewId = await enqueueTask(q, { kind: "review_call", payload: {}, callId: orphan.id, runAt: now });
        await recordEvent(q, orphan.id, "task_queued", { taskId: reviewId, kind: "review_call" }, now);
        return true;
      });
      if (done) closed += 1;
    } catch (error) {
      log("error", "could not close an orphan call", { callId: orphan.id, error: messageOf(error) });
    }
  }
  if (closed > 0) log("info", "calls left open by the previous process were closed", { count: closed });
  return closed;
}

/**
 * Roda na partida, logo depois de `closeOrphanCalls`, e com a mesma forma. Toda rodada de teste do
 * agente ainda `running` ficou órfã: quem a conduzia era o processo anterior. Sem isto, ela ficaria
 * "rodando" para sempre na tela. Cada uma vira `error`/`process_restarted`. A troca é condicional,
 * então rodar duas vezes não muda nada, e a rodada que já terminou fica como está.
 */
export async function closeOrphanTestRuns(db: Db, clock: Clock, log: Logger): Promise<number> {
  const orphans = await withSystem(db, (q) => q.many<{ id: string; organization_id: string }>("select id, organization_id from agent_test_runs where status = 'running' order by started_at"));
  let closed = 0;
  for (const orphan of orphans) {
    try {
      const updated = await withOrg(db, orphan.organization_id, (q) =>
        q.exec("update agent_test_runs set status = 'error', error_code = 'process_restarted', finished_at = $2 where id = $1 and status = 'running'", [orphan.id, clock.now()]),
      );
      if (updated === 1) closed += 1;
    } catch (error) {
      log("error", "could not close an orphan agent test run", { runId: orphan.id, error: messageOf(error) });
    }
  }
  if (closed > 0) log("info", "agent test runs left open by the previous process were closed", { count: closed });
  return closed;
}
