import { ANALYST_NO_OBJECTION } from "@deskvoice/core/analysts";

const KEY_MAX = 30;

/**
 * A chave de uma objeção nova, tirada do rótulo: sem acento, minúscula, com `_` no lugar do resto, até
 * 30 caracteres, diferente de `none` e das chaves já usadas na lista (desenho R6, seção 3.1). A chave é
 * o que os eventos guardam; por isso ela nasce uma vez e não muda quando o rótulo é editado.
 */
export function objectionKeyFor(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, KEY_MAX)
      .replace(/_+$/, "") || "objecao";
  const used = new Set([...taken, ANALYST_NO_OBJECTION]);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, KEY_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
