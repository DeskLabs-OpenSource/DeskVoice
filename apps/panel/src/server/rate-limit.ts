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
/**
 * A cada quantas reservas o mapa é varrido. Sem a faxina, cada combinação e-mail × endereço vira uma
 * chave que só sai quando o painel reinicia, e quem troca de e-mail a cada pedido faz a memória
 * crescer sem teto (a chave é gravada antes da recusa). A varredura apaga a chave cujo último
 * registro já saiu da maior janela em uso.
 */
const SWEEP_EVERY = 256;

export function createRateLimiter(defaultMax = MAX_ATTEMPTS, defaultWindowMs = WINDOW_MS) {
  const attempts = new Map<string, number[]>();
  let longestWindowMs = defaultWindowMs;
  let sinceSweep = 0;
  const sweep = (now: number): void => {
    for (const [key, list] of attempts) {
      const last = list[list.length - 1];
      if (last === undefined || now - last >= longestWindowMs) attempts.delete(key);
    }
  };
  return {
    /**
     * Reserva uma tentativa. `false` quando a chave já gastou o limite da janela. Uma chave usa
     * sempre o mesmo limite; o login passa os seus, um para cada tipo de chave.
     */
    take(key: string, now: Date, { max = defaultMax, windowMs = defaultWindowMs } = {}): boolean {
      longestWindowMs = Math.max(longestWindowMs, windowMs);
      sinceSweep += 1;
      if (sinceSweep >= SWEEP_EVERY) {
        sinceSweep = 0;
        sweep(now.getTime());
      }
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
    /** Quantas chaves o mapa guarda agora (para teste). */
    size(): number {
      return attempts.size;
    },
    clear(key?: string): void {
      if (key === undefined) attempts.clear();
      else attempts.delete(key);
    },
  };
}

export const loginLimiter = createRateLimiter();
