// dono: @DeskLabs-OpenSource/maintainers
// motivo: a migration `20261123T120059_testes_do_agente_extrato.sql` (#552) entrou na `main` depois
//   que a 0.47.0 já tinha publicado a `20261123T120517_…`: quem atualizava da 0.47.0 recebia uma
//   migration com carimbo menor que o da última que já tinha aplicado. O job `db` do CI pega a ordem
//   numa atualização, mas não barrava o PR; a cerca barra no PR, antes do merge.
// revisar em: 2027-05-26
//
// Como confere: lê do git a maior tag `vX.Y.Z` (por semver, não por ordem alfabética: a v0.10.0
// vem depois da v0.9.0) e o maior carimbo de `db/migrations/` nela. Toda migration da árvore que
// não está nessa tag precisa de carimbo estritamente maior. A que já está na tag fica fora da
// conferência: migration publicada nunca é renomeada nem editada, então a 120059, publicada desde a
// 0.48.0, passa como está. Tag com sufixo (`v1.0.0-rc.1`) não conta como versão publicada.
//
// Sem tag não há o que comparar: clone raso, fork sem tags ou cópia sem `.git`. Fora do CI a cerca
// não diz "ok": ela pula o teste e diz por quê, e o pulo aparece no resumo do vitest. No CI
// (`GITHUB_ACTIONS` definido) a falta de tag reprova: o job `verify` busca as tags num passo próprio
// do `ci.yml`, e se alguém tirar esse passo o pulo passaria despercebido (ninguém lê skip) e a cerca
// deixaria de proteger em silêncio.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, onTestFinished } from "vitest";
import { REPO_ROOT, expectClean, listFiles } from "./_lib";

const STAMP = /^db\/migrations\/(\d{8}T\d{6})_[^/]*\.sql$/;
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

type Result = { skipped: string } | { failed: string } | { tag: string; maxStamp: string | null; violations: string[] };

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A maior tag `vX.Y.Z` por semver, ou `null` se não há nenhuma. */
function latestReleaseTag(tags: string[]): string | null {
  let best: { tag: string; parts: number[] } | null = null;
  for (const raw of tags) {
    const tag = raw.trim();
    const match = RELEASE_TAG.exec(tag);
    if (!match) continue;
    const parts = match.slice(1).map(Number);
    if (!best || compareParts(parts, best.parts) > 0) best = { tag, parts };
  }
  return best?.tag ?? null;
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function stampOf(file: string): string | null {
  return STAMP.exec(file)?.[1] ?? null;
}

/** No CI a falta de tag reprova; fora dele, pula com o motivo. */
function noTag(reason: string, env: NodeJS.ProcessEnv): Result {
  if (env.GITHUB_ACTIONS) {
    return {
      failed: `no CI (GITHUB_ACTIONS definido) a cerca precisa das tags \`vX.Y.Z\` e não achou nenhuma: ${reason}. Traga as tags no checkout do job (o passo "Buscar as tags" do \`ci.yml\`, \`git fetch origin '+refs/tags/v*:refs/tags/v*'\`, ou \`fetch-depth: 0\`); sem elas a cerca deixaria de proteger em silêncio`,
    };
  }
  return { skipped: reason };
}

function check(root: string, env: NodeJS.ProcessEnv): Result {
  let tags: string[];
  try {
    tags = git(root, ["tag", "--list", "v*"]).split("\n").filter(Boolean);
  } catch {
    return noTag("não é um repositório git (cópia sem `.git`), então não há tag para comparar", env);
  }
  const tag = latestReleaseTag(tags);
  if (!tag) {
    const shallow = git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
    return noTag(
      shallow
        ? "clone raso sem tags `vX.Y.Z`; rode `git fetch --tags --unshallow` para conferir"
        : "nenhuma tag `vX.Y.Z` neste repositório (fork sem tags?); rode `git fetch --tags` do repositório oficial para conferir",
      env,
    );
  }
  const published = new Set(git(root, ["ls-tree", "-r", "--name-only", tag, "--", "db/migrations/"]).split("\n").filter(Boolean));
  let maxStamp: string | null = null;
  for (const file of published) {
    const stamp = stampOf(file);
    if (stamp && (maxStamp === null || stamp > maxStamp)) maxStamp = stamp;
  }
  const violations: string[] = [];
  if (maxStamp !== null) {
    for (const file of listFiles(root, "db/migrations", (f) => f.endsWith(".sql"))) {
      if (published.has(file)) continue; // já publicada: nunca se renomeia
      const stamp = stampOf(file);
      if (!stamp) continue; // nome fora do padrão é da cerca migrations-are-timestamped-and-unique
      if (!(stamp > maxStamp)) {
        violations.push(`${file}: carimbo ${stamp} não é maior que ${maxStamp}, o maior carimbo da ${tag}; quem já instalou a ${tag} receberia esta migration fora de ordem`);
      }
    }
  }
  return { tag, maxStamp, violations };
}

/** Repositório git temporário: cada passo grava as migrations, faz um commit e, se pedir, põe a tag. */
function tempRepo(steps: { add: string[]; tag?: string }[], uncommitted: string[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deskvoice-fence-migrations-after-release-"));
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args: string[]): string => git(root, ["-c", "user.name=cerca", "-c", "user.email=cerca@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args]);
  const write = (name: string): void => {
    fs.mkdirSync(path.join(root, "db/migrations"), { recursive: true });
    fs.writeFileSync(path.join(root, "db/migrations", name), "select 1;\n");
  };
  run("init", "--quiet");
  for (const step of steps) {
    for (const name of step.add) write(name);
    run("add", "--all");
    run("commit", "--quiet", "--allow-empty", "-m", "passo");
    if (step.tag) run("tag", step.tag);
  }
  for (const name of uncommitted) write(name);
  return root;
}

describe("migrations-come-after-the-last-release", () => {
  it("toda migration nova tem carimbo maior que o maior da última versão publicada", (ctx) => {
    const result = check(REPO_ROOT, process.env);
    if ("failed" in result) expect.fail(result.failed);
    if ("skipped" in result) {
      process.stderr.write(`migrations-come-after-the-last-release NÃO conferiu: ${result.skipped}\n`);
      ctx.skip(`não conferiu: ${result.skipped}`);
      return;
    }
    expectClean(
      result.violations,
      `Gere um carimbo novo com \`date -u +%Y%m%dT%H%M%S\` e renomeie a migration (\`git mv\`) antes do merge: ela precisa vir depois de ${result.maxStamp ?? "nenhum"}, o maior carimbo da ${result.tag}. Só a migration do seu PR se renomeia; a que já saiu numa versão nunca muda de nome.`,
    );
  });

  it("reprova o carimbo abaixo e o igual ao máximo da maior tag por semver, ignora o que já está na tag e deixa passar o maior", () => {
    const root = tempRepo(
      [
        { add: ["20260101T000000_primeira.sql"], tag: "v0.9.0" },
        // A v0.10.0 é a maior por semver; por ordem alfabética seria a v0.9.0.
        { add: ["20260301T000000_publicada.sql"], tag: "v0.10.0" },
        // Uma prévia não é versão publicada: o carimbo dela não conta como máximo.
        { add: ["20260901T000000_da_previa.sql"], tag: "v0.11.0-rc.1" },
      ],
      ["20260201T000000_abaixo.sql", "20260301T000000_igual.sql", "20260401T000000_acima.sql"],
    );
    expect(check(root, {})).toEqual({
      tag: "v0.10.0",
      maxStamp: "20260301T000000",
      violations: [
        "db/migrations/20260201T000000_abaixo.sql: carimbo 20260201T000000 não é maior que 20260301T000000, o maior carimbo da v0.10.0; quem já instalou a v0.10.0 receberia esta migration fora de ordem",
        "db/migrations/20260301T000000_igual.sql: carimbo 20260301T000000 não é maior que 20260301T000000, o maior carimbo da v0.10.0; quem já instalou a v0.10.0 receberia esta migration fora de ordem",
      ],
    });
  });

  it("a migration de carimbo menor que já saiu numa tag (o caso da 120059) fica fora da conferência", () => {
    const root = tempRepo([
      { add: ["20261123T120517_ainda_esta_ai_chave_por_agente.sql"], tag: "v0.47.0" },
      { add: ["20261123T120059_testes_do_agente_extrato.sql"], tag: "v0.48.0" },
    ]);
    expect(check(root, {})).toEqual({ tag: "v0.48.0", maxStamp: "20261123T120517", violations: [] });
  });

  it("sem tag e fora do CI, diz por que não conferiu em vez de passar como ok", () => {
    const root = tempRepo([{ add: ["20260101T000000_primeira.sql"] }], ["20250101T000000_antiga.sql"]);
    expect(check(root, {})).toEqual({ skipped: expect.stringContaining("nenhuma tag `vX.Y.Z`") });

    const notGit = fs.mkdtempSync(path.join(os.tmpdir(), "deskvoice-fence-migrations-after-release-nogit-"));
    onTestFinished(() => fs.rmSync(notGit, { recursive: true, force: true }));
    expect(check(notGit, {})).toEqual({ skipped: expect.stringContaining("não é um repositório git") });
  });

  it("sem tag no CI (GITHUB_ACTIONS definido), reprova e diz para trazer as tags no checkout", () => {
    const ci = { GITHUB_ACTIONS: "true" };
    const root = tempRepo([{ add: ["20260101T000000_primeira.sql"] }]);
    const noTags = check(root, ci);
    expect(noTags).toEqual({ failed: expect.stringContaining("nenhuma tag `vX.Y.Z`") });
    expect(noTags).toEqual({ failed: expect.stringContaining("Traga as tags no checkout") });

    const notGit = fs.mkdtempSync(path.join(os.tmpdir(), "deskvoice-fence-migrations-after-release-nogit-"));
    onTestFinished(() => fs.rmSync(notGit, { recursive: true, force: true }));
    expect(check(notGit, ci)).toEqual({ failed: expect.stringContaining("Traga as tags no checkout") });

    // Com tag, o CI confere normalmente: a variável só muda o que acontece quando falta tag.
    const tagged = tempRepo([{ add: ["20260101T000000_primeira.sql"], tag: "v0.1.0" }], ["20260201T000000_nova.sql"]);
    expect(check(tagged, ci)).toEqual({ tag: "v0.1.0", maxStamp: "20260101T000000", violations: [] });
  });

  it("escolhe a maior tag por semver", () => {
    expect(latestReleaseTag(["v0.9.0", "v0.10.0", "v0.10.1-rc.1", "v1.0", "release-2"])).toBe("v0.10.0");
    expect(latestReleaseTag(["v1.2.3", "v1.10.0", "v1.9.9"])).toBe("v1.10.0");
    expect(latestReleaseTag(["v2.0.0", "v10.0.0"])).toBe("v10.0.0");
    expect(latestReleaseTag([])).toBeNull();
  });
});
