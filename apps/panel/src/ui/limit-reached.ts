import { fill } from "../i18n/locales";
import type { CommonDictionary } from "../i18n/pt-BR/common";

/**
 * A recusa de criar além do limite da organização (seção 3.4 do desenho do R8), na língua da tela,
 * com a contagem e o limite que a API mandou em `detail`. Sem os números, `null`: a tela cai na frase
 * geral de `organization_limit_reached`.
 */
export function limitReachedText(code: string, detail: Record<string, string | number> | undefined, t: CommonDictionary["limitReached"]): string | null {
  const { kind, count, limit } = detail ?? {};
  if (code !== "organization_limit_reached" || (kind !== "trunks" && kind !== "agents") || typeof count !== "number" || typeof limit !== "number") return null;
  // Com 1, a frase no singular ("já tem 1 linha telefônica"); o `{limit}` não tem substantivo e não muda.
  if (count === 1) return fill(kind === "trunks" ? t.trunksOne : t.agentsOne, { limit });
  return fill(t[kind], { count, limit });
}
