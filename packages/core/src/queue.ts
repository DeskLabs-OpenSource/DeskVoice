import { listen } from "./db";
import type { ClaimedTask, Db, OrgQuery } from "./types";
import { withSystem } from "./with-org";

/** Uma tarefa roda no máximo este número de vezes; depois fica `failed`. */
export const MAX_TASK_ATTEMPTS = 3;
// Recuo entre tentativas: 30 s depois da primeira falha, 2 min depois da segunda.
const RETRY_BASE_SECONDS = 30;
const RETRY_FACTOR = 4;

/** Enfileira uma tarefa na organização da transação. Sem `runAt`, fica elegível na hora. */
export async function enqueueTask(q: OrgQuery, task: { kind: string; payload: object; callId?: string; runAt?: Date }): Promise<string> {
  const row = await q.one<{ id: string }>(
    "insert into tasks (organization_id, call_id, kind, payload, run_at) values ($1, $2, $3, $4, coalesce($5::timestamptz, now())) returning id",
    [q.organizationId, task.callId ?? null, task.kind, JSON.stringify(task.payload), task.runAt ?? null],
  );
  if (!row) throw new Error(`Task ${task.kind} was not enqueued`);
  return row.id;
}

/**
 * Reivindica a tarefa elegível mais antiga de qualquer organização, ou devolve `null`.
 * `skip locked` garante que dois processos nunca recebem a mesma.
 */
export async function claimTask(db: Db, now: Date): Promise<ClaimedTask | null> {
  const row = await withSystem(db, (q) =>
    q.one<{ id: string; organization_id: string; call_id: string | null; kind: string; payload: Record<string, unknown>; attempts: number }>(
      `update tasks set status = 'running', attempts = attempts + 1
        where id = (select id from tasks where status = 'queued' and run_at <= $1
                     order by run_at, created_at for update skip locked limit 1)
        returning id, organization_id, call_id, kind, payload, attempts`,
      [now],
    ),
  );
  return row && { id: row.id, organizationId: row.organization_id, callId: row.call_id, kind: row.kind, payload: row.payload, attempts: row.attempts };
}

export async function completeTask(db: Db, taskId: string): Promise<void> {
  const updated = await withSystem(db, (q) => q.exec("update tasks set status = 'done', last_error = null where id = $1 and status = 'running'", [taskId]));
  if (updated !== 1) throw new Error(`Task ${taskId} is not running: cannot complete it`);
}

/**
 * Registra a falha de uma tarefa reivindicada. Enquanto houver tentativa, ela volta para a fila
 * com recuo e o `runAt` devolvido diz quando acordar (reagendar não dispara notificação);
 * esgotadas as tentativas, fica `failed`.
 */
export async function failTask(db: Db, taskId: string, error: string, now: Date): Promise<{ status: "queued" | "failed"; runAt: Date }> {
  const row = await withSystem(db, (q) =>
    q.one<{ status: "queued" | "failed"; run_at: Date }>(
      `update tasks set last_error = $2,
              status = case when attempts >= $3 then 'failed' else 'queued' end,
              run_at = case when attempts >= $3 then run_at
                            else $4::timestamptz + make_interval(secs => $5 * power($6::int, attempts - 1)) end
        where id = $1 and status = 'running'
        returning status, run_at`,
      [taskId, error, MAX_TASK_ATTEMPTS, now, RETRY_BASE_SECONDS, RETRY_FACTOR],
    ),
  );
  if (!row) throw new Error(`Task ${taskId} is not running: cannot fail it`);
  return { status: row.status, runAt: row.run_at };
}

/** Acorda `onWake` a cada tarefa enfileirada. Devolve a função que encerra a escuta. */
export function listenTasks(db: Db, onWake: () => void, onError?: (error: Error) => void): Promise<() => Promise<void>> {
  return listen(db, "tasks", () => onWake(), onError);
}
