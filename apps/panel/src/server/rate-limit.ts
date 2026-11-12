const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Limite de tentativas por chave (no login: par e-mail + IP, IP e e-mail). Fica em memória:
 * basta nesta fundação, em que o painel é um processo só. Reiniciar o painel zera a contagem; com mais de um processo
 * ela precisa ir para o banco.
 *
 * A tentativa é RESERVADA antes de conferir a senha, num passo só (`take`). Conferir o limite,
 * verificar a senha (lento) e só depois contar a falha deixava N pedidos simultâneos passarem
 * todos pela conferência. Login certo devolve a reserva.
 */
export function createRateLimiter(defaultMax = MAX_ATTEMPTS, defaultWindowMs = WINDOW_MS) {
  const attempts = new Map<string, number[]>();
  return {
    /**
     * Reserva uma tentativa. `false` quando a chave já gastou o limite da janela. Uma chave usa
     * sempre o mesmo limite; o login passa os seus, um para cada tipo de chave.
     */
    take(key: string, now: Date, { max = defaultMax, windowMs = defaultWindowMs } = {}): boolean {
      const recent = (attempts.get(key) ?? []).filter((at) => now.getTime() - at < windowMs);
      if (recent.length >= max) {
        attempts.set(key, recent);
        return false;
      }
      attempts.set(key, [...recent, now.getTime()]);
      return true;
    },
    /** Devolve uma reserva feita em `now` (a do pedido que acabou de entrar com a senha certa). */
    release(key: string, now: Date): void {
      const list = attempts.get(key) ?? [];
      const index = list.lastIndexOf(now.getTime());
      if (index >= 0) attempts.set(key, list.toSpliced(index, 1));
    },
    clear(key?: string): void {
      if (key === undefined) attempts.clear();
      else attempts.delete(key);
    },
  };
}

export const loginLimiter = createRateLimiter();
