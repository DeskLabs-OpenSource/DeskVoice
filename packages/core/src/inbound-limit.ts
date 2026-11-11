import { z } from "zod";

/**
 * Teto de ligações recebidas pela operadora ao mesmo tempo, por organização. O operador ajusta em
 * Configurações (chave `inbound.max_concurrent_calls` em `settings`); sem valor gravado, vale o de
 * fábrica. Chamadas pelo navegador e de saída têm os tetos delas e não entram nesta conta.
 */
export const INBOUND_LIMIT_SETTING = "inbound.max_concurrent_calls";
export const DEFAULT_INBOUND_LIMIT = 5;
export const inboundLimitSchema = z.number().int().min(1).max(50);

/** O teto que vale para um valor lido de `settings`: ausente ou fora da faixa cai no de fábrica. */
export function inboundLimitOf(stored: unknown): number {
  const parsed = inboundLimitSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_INBOUND_LIMIT;
}
