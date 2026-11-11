/**
 * Do efeito declarado ao número da versão. Ninguém digita o número.
 *
 * "Exige ação do operador" NÃO é o número: é um campo à parte (`requiresOperatorAction`), que a
 * nota de versão destaca. Major só sai por decisão explícita de quem corta (`--major`).
 */
import type { Fragment, Impact } from "./fragment";

export type Bump = "patch" | "minor" | "major";

/** Fonte única da régua. */
export const BUMP_BY_IMPACT = {
  nothing_changes: "patch",
  new_capability: "minor",
  operator_action: "minor",
} as const satisfies Record<Impact, Bump>;

export function computeBump(impacts: readonly Impact[], majorRequested = false): Bump {
  // Sem fragmento não há resposta: devolver `patch` seria inventar uma versão que ninguém descreveu.
  if (impacts.length === 0) throw new Error("nenhum fragmento em `.changes/`: não há versão a cortar");
  if (majorRequested) return "major";
  return impacts.some((impact) => BUMP_BY_IMPACT[impact] === "minor") ? "minor" : "patch";
}

export function nextVersion(current: string, bump: Bump): string {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
  if (!match) throw new Error(`versão base não é X.Y.Z: \`${current}\``);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function requiresOperatorAction(fragments: readonly Fragment[]): boolean {
  return fragments.some((fragment) => fragment.impact === "operator_action");
}
