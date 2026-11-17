import type { Trunk } from "./types";

/**
 * O motivo gravado da última falha da linha, para a tela mostrar sem pedir um teste. Inclui a
 * linha que o processo de voz deixou de fora da configuração: ela fica "Com falha", e o motivo
 * diz o que corrigir.
 */
export function trunkFailure(trunk: Pick<Trunk, "status" | "lastError"> | null): string | null {
  if (trunk === null || (trunk.status !== "fail" && trunk.status !== "warn")) return null;
  return trunk.lastError || null;
}

/**
 * O começo do motivo da linha que o processo de voz deixou de fora do arquivo (`LEFT_OUT` em
 * `apps/voice/src/trunks.ts`; os dois mudam juntos). Só essa linha não aceita ligação nenhuma.
 */
const LEFT_OUT = "This line was left out of the telephony configuration";

/**
 * A linha está na central, mas sem filtro de entrada (R14, contrato 8): o conjunto liberado foi
 * calculado e ficou vazio, o que só acontece com nome no `host` que ainda não resolveu. Ela pode
 * estar "Com falha" por outro motivo (o provedor não responde) e mesmo assim aceitar ligação.
 * Antes da primeira aplicação (`unverified`) e na linha deixada de fora, não.
 */
export function filterOff(trunk: Pick<Trunk, "status" | "lastError" | "inboundAllowed">, hostIsName: boolean): boolean {
  if (!hostIsName || (trunk.inboundAllowed ?? []).length > 0) return false;
  if (trunk.status !== "warn" && trunk.status !== "fail" && trunk.status !== "ok") return false;
  return !(trunk.lastError ?? "").startsWith(LEFT_OUT);
}
