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
