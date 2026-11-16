// arm-hooks.sh: os hooks armados não mudam com o ramo em que você está.
// Cada caso monta um repositório git descartável, sem rede, com a pasta de scripts da skill copiada
// da árvore de trabalho, e roda o script de verdade.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = ".agents/skills/deskvoice-contribuir/scripts";
const legacy = `${scripts}/hooks`;
const repoRoot = resolve(__dirname, "../..");

// Isola do git da máquina: sem config global ou de sistema, identidade fixa.
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Teste",
  GIT_AUTHOR_EMAIL: "teste@exemplo.org",
  GIT_COMMITTER_NAME: "Teste",
  GIT_COMMITTER_EMAIL: "teste@exemplo.org",
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "arm-hooks-")));
  dirs.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

function gitTry(cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, env, encoding: "utf8" });
}

function hooksPath(cwd: string): string {
  return gitTry(cwd, "config", "--get", "core.hooksPath").stdout.trim();
}

function arm(cwd: string, ...args: string[]) {
  return spawnSync("bash", [`${scripts}/arm-hooks.sh`, ...args], { cwd, env, encoding: "utf8" });
}

/** Repositório com a pasta de scripts da skill na main, com um commit. */
function repo(): string {
  const d = tmp();
  git(d, "init", "-q", "-b", "main");
  cpSync(join(repoRoot, scripts), join(d, scripts), { recursive: true });
  writeFileSync(join(d, "README.md"), "x\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "--no-verify", "-m", "base");
  return d;
}

function dest(d: string): string {
  return join(d, ".git", "deskvoice-hooks");
}

describe("arm-hooks.sh", () => {
  it("o hook armado é o da main mesmo num ramo que troca o pre-commit versionado", () => {
    const d = repo();
    expect(arm(d).status).toBe(0);
    expect(hooksPath(d)).toBe(dest(d));

    const marker = join(tmp(), "marcador");
    git(d, "switch", "-q", "-c", "troca-hook");
    writeFileSync(join(d, legacy, "pre-commit"), `#!/usr/bin/env bash\necho rodou > '${marker}'\nexit 1\n`);
    git(d, "commit", "-q", "--no-verify", "-am", "troca o pre-commit");
    git(d, "switch", "-q", "main");
    git(d, "switch", "-q", "troca-hook");

    writeFileSync(join(d, "a.txt"), "a\n");
    git(d, "add", "a.txt");
    const ok = gitTry(d, "commit", "-q", "-m", "commit comum");
    expect(ok.status).toBe(0);
    expect(existsSync(marker)).toBe(false);

    // E quem rodou foi o pre-commit da main: ele recusa o .env.
    writeFileSync(join(d, ".env"), "X=1\n");
    git(d, "add", "-f", ".env");
    const refused = gitTry(d, "commit", "-q", "-m", "com .env");
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("pre-commit BLOQUEADO");
    expect(existsSync(marker)).toBe(false);
  });

  it("migra o core.hooksPath relativo antigo para a cópia, com caminho absoluto", () => {
    const d = repo();
    git(d, "config", "core.hooksPath", legacy);
    const r = arm(d);
    expect(r.status).toBe(0);
    const now = hooksPath(d);
    expect(now).toBe(dest(d));
    expect(isAbsolute(now)).toBe(true);
    for (const f of ["pre-commit", "pre-push", "warn-identity.sh"]) expect(existsSync(join(now, f))).toBe(true);
    expect(existsSync(join(now, "session.sh"))).toBe(false);
  });

  it("rodar de novo atualiza a cópia", () => {
    const d = repo();
    expect(arm(d).status).toBe(0);
    writeFileSync(join(d, legacy, "pre-push"), "#!/usr/bin/env bash\n# novo\nexit 0\n");
    expect(arm(d).status).toBe(0);
    expect(readFileSync(join(dest(d), "pre-push"), "utf8")).toContain("# novo");
  });

  it("não mexe em core.hooksPath alheio", () => {
    const d = repo();
    git(d, "config", "core.hooksPath", "/outro/lugar");
    const r = arm(d);
    expect(r.status).toBe(2);
    expect(hooksPath(d)).toBe("/outro/lugar");
    expect(existsSync(dest(d))).toBe(false);
  });

  it("--disarm limpa o core.hooksPath e apaga só a cópia", () => {
    const d = repo();
    expect(arm(d).status).toBe(0);
    writeFileSync(join(d, ".git", "hooks", "proprio"), "x\n");
    const r = arm(d, "--disarm");
    expect(r.status).toBe(0);
    expect(hooksPath(d)).toBe("");
    expect(existsSync(dest(d))).toBe(false);
    expect(existsSync(join(d, ".git", "hooks", "proprio"))).toBe(true);
  });

  it("--disarm também desarma o caminho relativo antigo", () => {
    const d = repo();
    git(d, "config", "core.hooksPath", legacy);
    expect(arm(d, "--disarm").status).toBe(0);
    expect(hooksPath(d)).toBe("");
  });

  it("uma worktree vê os hooks armados (pasta comum)", () => {
    const d = repo();
    expect(arm(d).status).toBe(0);
    const wt = join(tmp(), "wt");
    git(d, "worktree", "add", "-q", "-b", "outro", wt);
    expect(hooksPath(wt)).toBe(dest(d));

    writeFileSync(join(wt, ".env"), "X=1\n");
    git(wt, "add", "-f", ".env");
    const refused = gitTry(wt, "commit", "-q", "-m", "com .env");
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("pre-commit BLOQUEADO");

    // Armar de dentro da worktree cai na mesma pasta.
    expect(arm(wt).status).toBe(0);
    expect(hooksPath(d)).toBe(dest(d));
  });
});
