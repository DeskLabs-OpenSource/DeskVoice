import { listen, type ApprovalOutcome, type ApprovalStatus, type Db } from "@deskvoice/core";
import { messageOf, silentLogger, type Logger } from "./log";
import { realSchedule, type Schedule } from "./transport";

export interface ApprovalWaiter {
  /**
   * Resolve quando a aprovação sai de `pending` ou quando o prazo vence (`expired`). `check` lê o
   * estado atual no banco, na organização da chamada. Rejeita se `signal` abortar (a chamada acabou).
   */
  wait(approvalId: string, timeoutMs: number, check: () => Promise<ApprovalStatus | null>, signal?: AbortSignal): Promise<ApprovalOutcome>;
  close(): Promise<void>;
}

const RELISTEN_MS = 1000;

/**
 * Uma escuta do canal `approvals` para o processo inteiro, repartida entre as chamadas: cada
 * escuta segura uma conexão do banco, e uma por chamada em espera esgotaria o pool.
 */
export async function createApprovalWaiter(db: Db, options: { schedule?: Schedule; log?: Logger } = {}): Promise<ApprovalWaiter> {
  const schedule = options.schedule ?? realSchedule;
  const log = options.log ?? silentLogger;
  const waiting = new Map<string, Set<() => void>>();
  let closed = false;
  let stop: (() => Promise<void>) | undefined;
  let cancelRelisten: (() => void) | undefined;

  const wake = (approvalId: string): void => {
    for (const recheck of waiting.get(approvalId) ?? []) recheck();
  };

  async function open(): Promise<void> {
    stop = await listen(db, "approvals", wake, (error) => {
      // A escuta caiu (o banco reiniciou). Quem espera continua protegido pelo prazo; a escuta
      // reabre e todo mundo confere de novo, porque uma decisão pode ter passado nesse intervalo.
      log("error", "approvals listener lost; reopening", { error: error.message });
      stop = undefined;
      reopen();
    });
    for (const approvalId of waiting.keys()) wake(approvalId);
  }

  function reopen(): void {
    if (closed) return;
    cancelRelisten = schedule(() => {
      open().catch((error: unknown) => {
        log("error", "could not reopen the approvals listener; will retry", { error: messageOf(error) });
        reopen();
      });
    }, RELISTEN_MS);
  }

  await open();

  return {
    wait(approvalId, timeoutMs, check, signal) {
      return new Promise<ApprovalOutcome>((resolve, reject) => {
        let settled = false;
        const settle = (finish: () => void): void => {
          if (settled) return;
          settled = true;
          cancelTimeout();
          signal?.removeEventListener("abort", onAbort);
          const set = waiting.get(approvalId);
          set?.delete(recheck);
          if (set?.size === 0) waiting.delete(approvalId);
          finish();
        };
        const recheck = (): void => {
          check().then(
            (status) => {
              if (status !== null && status !== "pending") settle(() => resolve(status));
            },
            // Leitura que falhou não decide nada: a espera segue até a próxima notificação ou o prazo.
            (error: unknown) => log("error", "could not read the approval status", { approvalId, error: messageOf(error) }),
          );
        };
        const onAbort = (): void => settle(() => reject(signal?.reason instanceof Error ? signal.reason : new Error("Approval wait aborted")));
        const cancelTimeout = schedule(() => settle(() => resolve("expired")), timeoutMs);

        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort);
        const set = waiting.get(approvalId) ?? new Set();
        set.add(recheck);
        waiting.set(approvalId, set);
        // A decisão pode ter chegado antes de a espera começar: a notificação já passou.
        recheck();
      });
    },
    async close() {
      closed = true;
      cancelRelisten?.();
      await stop?.();
    },
  };
}
