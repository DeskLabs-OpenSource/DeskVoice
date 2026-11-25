import { fill } from "../../../../../i18n/locales";
import type { AgentTestsDictionary } from "../../../../../i18n/pt-BR/agent-tests";
import { ApiFailure } from "../../../../../ui/api";

/** A frase de uma recusa: as do processo de voz e o teto de testes vêm deste dicionário; o resto, do comum. */
export function refusalText(error: unknown, t: AgentTestsDictionary, fallback: (error: unknown) => string): string {
  if (error instanceof ApiFailure) {
    if (Object.hasOwn(t.refusals, error.code)) return t.refusals[error.code as keyof AgentTestsDictionary["refusals"]];
    if (error.code === "agent_tests_limit") return fill(t.limitReached, { limit: error.detail?.limit ?? 20 });
  }
  return fallback(error);
}

