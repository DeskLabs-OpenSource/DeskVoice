import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { decideTag, gitHistory } from "./tag-target";

// Repositórios de verdade, numa pasta temporária: o que se prova é o histórico que cada jeito de
// merge deixa na main, e isso só o git sabe. Data fixa, sem configuração da máquina.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "teste",
  GIT_AUTHOR_EMAIL: "teste@example.invalid",
  GIT_COMMITTER_NAME: "teste",
  GIT_COMMITTER_EMAIL: "teste@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

const changelog = (...versions: string[]): string => `# Changelog\n\n${versions.map((v) => `## [${v}] - 2026-01-01\n\n- item\n`).join("\n")}`;

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskvoice-tag-target-"));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: ENV }).trim();
  const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const commit = (message: string): string => {
    git("add", "-A");
    git("commit", "--quiet", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  /** O que o workflow `release` faz no ramo: escreve a versão e apaga os fragmentos. */
  const cut = (...versions: string[]): void => {
    write("CHANGELOG.md", changelog(...versions));
    for (const file of fs.readdirSync(path.join(root, ".changes"))) if (file !== "README.md") fs.rmSync(path.join(root, ".changes", file));
  };

  git("init", "--quiet", "-b", "main");
  write(".changes/README.md", "formato\n");
  write("CHANGELOG.md", changelog("0.1.0"));
  commit("chore(release): 0.1.0");
  git("tag", "v0.1.0");
  write(".changes/a.md", "fragmento\n");
  write(".changes/b.md", "fragmento\n");
  commit("feat: a e b");
  return { root, git, write, commit, cut };
}

/** Ramos de PR por commit, como a API do GitHub os devolveria. */
const decide = (root: string, head: string, prs: Record<string, string[]> = {}) => decideTag(gitHistory(root, (commit) => prs[commit] ?? []), head);

describe("decideTag", () => {
  it("merge: marca o commit de merge, mesmo com outro push na main depois", () => {
    const { root, git, write, commit, cut } = repo();
    git("switch", "--quiet", "-c", "release/0.2.0");
    cut("0.2.0", "0.1.0");
    commit("chore(release): 0.2.0");
    git("switch", "--quiet", "main");
    write("outro.txt", "mudança que entrou enquanto o PR de versão esperava\n");
    commit("fix: outro");
    git("merge", "--quiet", "--no-ff", "-m", "Merge pull request #15 from release/0.2.0", "release/0.2.0");
    const merge = git("rev-parse", "HEAD");
    write("depois.txt", "push seguinte\n");
    const next = commit("docs: push seguinte");

    expect(decide(root, merge, { [merge]: ["release/0.2.0"] })).toEqual({ action: "tag", version: "0.2.0", commit: merge });
    expect(decide(root, next, { [merge]: ["release/0.2.0"] })).toEqual({ action: "tag", version: "0.2.0", commit: merge });
  });

  it("squash: marca o commit da versão, e não o push seguinte", () => {
    const { root, write, commit, cut } = repo();
    cut("0.2.0", "0.1.0");
    const release = commit("chore(release): 0.2.0 (#15)");
    write("depois.txt", "push seguinte\n");
    const next = commit("docs: push seguinte");

    expect(decide(root, release, { [release]: ["release/0.2.0"] })).toEqual({ action: "tag", version: "0.2.0", commit: release });
    expect(decide(root, next, { [release]: ["release/0.2.0"] })).toEqual({ action: "tag", version: "0.2.0", commit: release });
  });

  it("rebase de dois commits: marca o que trouxe a versão, e não o último, que só acertou o texto", () => {
    const { root, write, commit, cut } = repo();
    cut("0.2.0", "0.1.0");
    const release = commit("chore(release): 0.2.0");
    write("CHANGELOG.md", changelog("0.2.0", "0.1.0").replace("- item", "- item corrigido"));
    const fix = commit("docs: acerta o texto da nota");

    expect(decide(root, fix, { [release]: ["release/0.2.0"], [fix]: ["release/0.2.0"] })).toEqual({ action: "tag", version: "0.2.0", commit: release });
  });

  it("versão já marcada: não marca de novo (reexecução, ou o push seguinte depois do corte)", () => {
    const { root, git, cut, commit } = repo();
    cut("0.2.0", "0.1.0");
    const release = commit("chore(release): 0.2.0 (#15)");
    git("tag", "v0.2.0", release);

    expect(decide(root, release, { [release]: ["release/0.2.0"] })).toEqual({ action: "skip", reason: "v0.2.0 já existe: nada a marcar." });
  });

  it("recusa o commit que trouxe a versão e apagou fragmentos fora de um PR release/<versão>", () => {
    const { root, cut, commit } = repo();
    cut("0.2.0", "0.1.0");
    const release = commit("feat: corte feito à mão");

    expect(decide(root, release, { [release]: ["feature/qualquer"] })).toMatchObject({ action: "refuse" });
    expect(decide(root, release, { [release]: ["release/0.3.0"] })).toMatchObject({ action: "refuse" });
    expect(decide(root, release)).toMatchObject({ action: "refuse" });
    expect(decide(root, release, { [release]: ["feature/qualquer"] })).toMatchObject({ reason: expect.stringContaining(`reverta o commit ${release}`) as string });
  });

  it("depois de reverter o corte feito à mão, a decisão volta a ser não marcar nada", () => {
    const { root, cut, commit, git } = repo();
    cut("0.2.0", "0.1.0");
    const rogue = commit("feat: corte feito à mão");
    git("revert", "--no-edit", rogue);
    const reverted = git("rev-parse", "HEAD");

    expect(decide(root, reverted, { [rogue]: ["feature/qualquer"] })).toMatchObject({ action: "skip" });
  });

  it("não marca versão escrita no CHANGELOG sem consumir fragmento", () => {
    const { root, write, commit } = repo();
    write("CHANGELOG.md", changelog("0.2.0", "0.1.0"));
    const edit = commit("docs: CHANGELOG editado à mão");

    expect(decide(root, edit, { [edit]: ["release/0.2.0"] })).toMatchObject({ action: "skip", notice: true });
  });

  it("sem versão no CHANGELOG, nada a marcar", () => {
    const { root, git, write, commit } = repo();
    write("CHANGELOG.md", "# Changelog\n");
    commit("docs: zera");
    expect(decide(root, git("rev-parse", "HEAD"))).toMatchObject({ action: "skip" });
  });
});
