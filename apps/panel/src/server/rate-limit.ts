const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

/**
 * Limite de tentativas de login por chave (e-mail e IP). Fica em memória: basta nesta fundação,
 * em que o painel é um processo só. Reiniciar o painel zera a contagem; com mais de um processo
 * ela precisa ir para o banco.
 */
export function createRateLimiter(max = MAX_FAILURES, windowMs = WINDOW_MS) {
  const failures = new Map<string, number[]>();
  const recent = (key: string, now: Date): number[] => (failures.get(key) ?? []).filter((at) => now.getTime() - at < windowMs);
  return {
    blocked: (key: string, now: Date): boolean => recent(key, now).length >= max,
    hit(key: string, now: Date): void {
      failures.set(key, [...recent(key, now), now.getTime()]);
    },
    clear(key?: string): void {
      if (key === undefined) failures.clear();
      else failures.delete(key);
    },
  };
}

export const loginLimiter = createRateLimiter();
