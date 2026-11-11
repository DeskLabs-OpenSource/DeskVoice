import { claimTask, completeTask, failTask, listenTasks, recordEvent, withOrg, withSystem, type ClaimedTask } from "@deskvoice/core";
import type { Logger } from "./log";
import type { Routine, RoutineDeps } from "./types";

/** Agenda `fn` para daqui a `delayMs` e devolve como cancelar. Injetável: teste não espera tempo real. */
export type Schedule = (fn: () => void, delayMs: number) => () => void;

export interface RunnerOptions extends RoutineDeps {
  routines: Map<string, Routine>;
  schedule?: Schedule;
  log?: Logger;
  /** A escuta da fila caiu e o runner não acorda mais sozinho. Sem isto, o erro derruba o processo. */
  onFatal?: (error: Error) => void;
}

export interface Runner {
  /** Para de reivindicar, espera a tarefa em curso terminar e não deixa timer vivo. */
  close(): Promise<void>;
}

const STALE_RUNNING_MINUTES = 10;
const RETRY_AFTER_ERROR_MS = 5000;
// Maior atraso que `setTimeout` aceita; tarefa mais distante que isso só rearma o timer.
const MAX_TIMER_MS = 2 ** 31 - 1;

const realSchedule: Schedule = (fn, delayMs) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Consome a fila: acorda quando uma tarefa entra (NOTIFY) e quando chega a hora da próxima
 * agendada (timer), nunca por polling. Executa uma tarefa de cada vez.
 */
export async function startRunner(options: RunnerOptions): Promise<Runner> {
  const { db, clock, routines } = options;
  const schedule = options.schedule ?? realSchedule;
  const log: Logger = options.log ?? (() => undefined);
  let closed = false;
  let wakeRequested = false;
  let draining: Promise<void> | undefined;
  let cancelTimer: (() => void) | undefined;

  const arm = (delayMs: number | undefined): void => {
    cancelTimer?.();
    cancelTimer = undefined;
    if (delayMs === undefined || closed) return;
    cancelTimer = schedule(wake, Math.min(Math.max(delayMs, 0), MAX_TIMER_MS));
  };

  async function execute(task: ClaimedTask): Promise<void> {
    let error: string | undefined;
    try {
      const routine = routines.get(task.kind);
      if (!routine) throw new Error(`Unknown task kind ${JSON.stringify(task.kind)}: no file in src/routines handles it`);
      await routine.run(task, options);
    } catch (cause) {
      error = messageOf(cause);
    }

    let outcome: "done" | "retrying" | "failed" = "done";
    if (error === undefined) await completeTask(db, task.id);
    else outcome = (await failTask(db, task.id, error, clock.now())).status === "queued" ? "retrying" : "failed";
    log(error === undefined ? "info" : "error", "task finished", { taskId: task.id, kind: task.kind, attempt: task.attempts, outcome, error });

    const { callId } = task;
    if (callId === null) return;
    try {
      await withOrg(db, task.organizationId, (q) =>
        recordEvent(q, callId, "task_finished", { taskId: task.id, kind: task.kind, outcome, attempt: task.attempts, ...(error !== undefined && { error }) }, clock.now()),
      );
    } catch (cause) {
      // A tarefa já tem o desfecho gravado; a linha do tempo incompleta não justifica repeti-la.
      log("error", "could not record task_finished", { taskId: task.id, error: messageOf(cause) });
    }
  }

  async function drain(): Promise<void> {
    while (wakeRequested && !closed) {
      wakeRequested = false;
      try {
        for (let task = await claimTask(db, clock.now()); task !== null && !closed; task = await claimTask(db, clock.now())) {
          await execute(task);
        }
        // Tarefa agendada e tarefa reagendada depois de falha não avisam quando a hora chega:
        // o runner dorme até a mais próxima.
        const next = await withSystem(db, (q) => q.one<{ run_at: Date | null }>("select min(run_at) as run_at from tasks where status = 'queued'"));
        arm(next?.run_at ? next.run_at.getTime() - clock.now().getTime() : undefined);
      } catch (cause) {
        log("error", "queue pass failed; will retry", { error: messageOf(cause) });
        arm(RETRY_AFTER_ERROR_MS);
      }
    }
  }

  function wake(): void {
    if (closed) return;
    wakeRequested = true;
    draining ??= drain().finally(() => {
      draining = undefined;
    });
  }

  // Tarefa que ficou `running` porque o processo morreu no meio volta para a fila.
  // Teto conhecido: `tasks` não guarda quando a tarefa foi reivindicada, então a idade é medida
  // pelo `run_at`. Uma tarefa atrasada há mais de 10 minutos que outro runner acabou de pegar
  // seria devolvida e rodaria duas vezes; por isso toda rotina precisa ser segura de repetir.
  // O conserto de verdade é uma coluna `claimed_at` gravada pelo `claimTask`.
  const recovered = await withSystem(db, (q) =>
    q.exec(`update tasks set status = 'queued', run_at = $1 where status = 'running' and run_at < $1::timestamptz - make_interval(mins => $2)`, [clock.now(), STALE_RUNNING_MINUTES]),
  );
  if (recovered > 0) log("info", "stale running tasks returned to the queue", { count: recovered });

  for (const routine of routines.values()) await routine.seed?.(options);

  const stopListening = await listenTasks(db, wake, options.onFatal);
  wake();

  return {
    async close() {
      closed = true;
      arm(undefined);
      await stopListening();
      await draining;
    },
  };
}
