/**
 * Qual commit da main recebe a tag de uma versão. Roda a cada push na main (job `tag-release` de
 * `.github/workflows/release.yml`), e por isso decide pelo histórico, e não pelo último push:
 *
 *   - a versão é a mais nova do CHANGELOG.md no commit do push;
 *   - o commit marcado é o que TROUXE essa versão ao CHANGELOG na linha da main (primeiro pai),
 *     e não `HEAD`. Vale igual para merge, squash e rebase, para a reexecução e para o push
 *     seguinte que chega antes do corte terminar;
 *   - esse commit precisa ter apagado fragmentos e vir de um PR `release/<versão>` deste
 *     repositório. Versão já com tag não é marcada de novo.
 *
 * A decisão é pura sobre `ReleaseHistory`; `gitHistory` a lê de um clone de verdade.
 */
import { execFileSync } from "node:child_process";
import { latestVersion } from "./assemble";

export interface ReleaseHistory {
  /** Versão mais nova do CHANGELOG.md em `commit`, ou `null`. */
  versionAt(commit: string): string | null;
  /** Commits que mudaram o CHANGELOG.md, seguindo só o primeiro pai a partir de `head`, do mais novo ao mais velho. */
  changelogCommits(head: string): string[];
  /** Primeiro pai, ou `null` no commit raiz. */
  firstParent(commit: string): string | null;
  /** Quantos fragmentos `.changes/*.md` o commit apagou em relação ao primeiro pai. */
  deletedFragments(commit: string): number;
  tagExists(version: string): boolean;
  /** Ramos de origem dos PRs deste repositório (fork não conta) associados ao commit. */
  pullRequestBranches(commit: string): string[];
}

export type TagDecision =
  /** `notice`: a situação merece aviso no resumo da execução, e não só no log. */
  | { action: "skip"; reason: string; notice?: true }
  | { action: "tag"; version: string; commit: string }
  | { action: "refuse"; reason: string };

/** O commit da linha da main em que `version` passou a ser a mais nova do CHANGELOG. */
function commitThatIntroduced(history: ReleaseHistory, head: string, version: string): string | null {
  for (const commit of history.changelogCommits(head)) {
    const parent = history.firstParent(commit);
    if ((parent === null ? null : history.versionAt(parent)) !== version) return commit;
  }
  return null;
}

export function decideTag(history: ReleaseHistory, head: string): TagDecision {
  const version = history.versionAt(head);
  if (version === null) return { action: "skip", reason: "CHANGELOG.md ainda não tem versão: nada a marcar." };
  if (history.tagExists(version)) return { action: "skip", reason: `v${version} já existe: nada a marcar.` };

  const commit = commitThatIntroduced(history, head, version);
  if (commit === null) return { action: "refuse", reason: `O CHANGELOG anuncia ${version}, mas nenhum commit da main o trouxe (histórico raso?).` };

  const removed = history.deletedFragments(commit);
  if (removed === 0) {
    return { action: "skip", reason: `O CHANGELOG anuncia ${version} sem tag, mas o commit ${commit} que trouxe a versão não consumiu fragmento: não é um corte de release.`, notice: true };
  }
  const branches = history.pullRequestBranches(commit);
  if (!branches.includes(`release/${version}`)) {
    return {
      action: "refuse",
      reason: `O commit ${commit} apagou ${removed} fragmento(s) e trouxe ${version}, mas não veio de um PR release/${version} deste repositório (ramos de origem: ${branches.join(" ") || "nenhum"}). Tag NÃO criada: uma release sai do workflow 'release' (Run workflow), nunca de um PR comum. Para sair deste estado: reverta o commit ${commit} (os fragmentos voltam e o CHANGELOG perde a versão) e corte pelo workflow 'release'. Não crie a etiqueta à mão.`,
    };
  }
  return { action: "tag", version, commit };
}

/** O histórico lido de um clone. `pullRequestBranches` vem de fora: no CI, a API do GitHub. */
export function gitHistory(root: string, pullRequestBranches: (commit: string) => string[]): ReleaseHistory {
  const git = (...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  /** O objeto que `ref` nomeia, ou `null` se ele não existe (o único motivo de `--verify --quiet` sair com erro). */
  const resolve = (ref: string): string | null => {
    try {
      return execFileSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const firstParent = (commit: string): string | null => resolve(`${commit}^1`);
  return {
    versionAt: (commit) => (resolve(`${commit}:CHANGELOG.md`) === null ? null : latestVersion(git("show", `${commit}:CHANGELOG.md`))),
    changelogCommits: (head) => git("log", "--first-parent", "--format=%H", head, "--", "CHANGELOG.md").split("\n").filter(Boolean),
    firstParent,
    deletedFragments: (commit) => {
      const parent = firstParent(commit);
      if (parent === null) return 0;
      return git("diff", "--diff-filter=D", "--name-only", parent, commit, "--", ".changes/")
        .split("\n")
        .filter((file) => file.endsWith(".md") && file !== ".changes/README.md").length;
    },
    tagExists: (version) => resolve(`refs/tags/v${version}`) !== null,
    pullRequestBranches,
  };
}
