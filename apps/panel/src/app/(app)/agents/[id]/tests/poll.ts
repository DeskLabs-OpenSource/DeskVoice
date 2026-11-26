// A consulta da rodada (fatia 7c): a tela pergunta pela rodada até ela acabar, como a ligação pelo
// navegador faz com a dela. Acabou é `passed`, `failed` ou `error` (inclusive `process_restarted`,
// a rodada que o processo de voz fechou ao reiniciar). A tela nunca fica girando: depois do teto de
// tempo de uma rodada no processo de voz (7 min) e mais uma folga, ela para e diz que não terminou.

export type RunStatus = "running" | "passed" | "failed" | "error";

/** De quanto em quanto tempo a tela pergunta. */
export const POLL_INTERVAL_MS = 1000;
/** Quando a tela desiste: o teto de uma rodada no processo de voz (`AGENT_TEST_STALE_MS`, 7 min) e mais 1 min. */
export const POLL_GIVE_UP_MS = 8 * 60_000;

export const runFinished = (status: RunStatus): boolean => status !== "running";

export type PollOutcome<T> = { finished: true; run: T } | { finished: false; run: T | undefined; reason: "gave_up" | "cancelled" };

/**
 * Pergunta pela rodada até ela acabar. `fetchRun` que lança (rodada apagada, rede) para a consulta e
 * repassa o erro: a tela mostra a frase dele e para de girar.
 */
export async function pollRun<T extends { status: RunStatus }>(
  fetchRun: () => Promise<T>,
  options: { sleep: (ms: number) => Promise<void>; cancelled?: () => boolean; intervalMs?: number; giveUpMs?: number },
): Promise<PollOutcome<T>> {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const attempts = Math.max(1, Math.ceil((options.giveUpMs ?? POLL_GIVE_UP_MS) / interval));
  let last: T | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.cancelled?.()) return { finished: false, run: last, reason: "cancelled" };
    last = await fetchRun();
    if (runFinished(last.status)) return { finished: true, run: last };
    await options.sleep(interval);
  }
  return { finished: false, run: last, reason: "gave_up" };
}
