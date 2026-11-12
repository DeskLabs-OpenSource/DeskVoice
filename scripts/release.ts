/**
 * Release por fragmentos. Casca de linha de comando; a decisão mora em `scripts/release/`.
 *
 *   pnpm release:check                                valida `.changes/` e diz que versão sairia
 *   pnpm exec tsx scripts/release.ts cut [--major] [--date AAAA-MM-DD]
 *                                                     escreve o CHANGELOG.md e apaga os fragmentos
 *   pnpm exec tsx scripts/release.ts current          imprime a versão mais nova do CHANGELOG.md
 *   pnpm exec tsx scripts/release.ts notes <X.Y.Z>    imprime a nota dessa versão
 *   pnpm exec tsx scripts/release.ts tag-target <sha> qual commit recebe a tag (job tag-release)
 *
 * A tag não nasce aqui: nasce no CI, do merge do PR de release na main (.github/workflows/release.yml).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyToChangelog, assembleSection, extractSection, latestVersion } from "./release/assemble";
import { type Fragment, parseFragment } from "./release/fragment";
import { decideTag, gitHistory } from "./release/tag-target";
import { computeBump, nextVersion, requiresOperatorAction } from "./release/version";

const ROOT = path.resolve(import.meta.dirname, "..");
const FRAGMENTS_DIR = path.join(ROOT, ".changes");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");
/** Antes da primeira versão não há seção no CHANGELOG: a base é zero. */
const INITIAL_VERSION = "0.0.0";

const print = (line: string): void => void process.stdout.write(`${line}\n`);

function readFragments(): Fragment[] {
  const files = fs.existsSync(FRAGMENTS_DIR) ? fs.readdirSync(FRAGMENTS_DIR).filter((name) => name.endsWith(".md") && name !== "README.md").sort() : [];
  const problems: string[] = [];
  const fragments: Fragment[] = [];
  for (const file of files) {
    try {
      fragments.push(parseFragment(file, fs.readFileSync(path.join(FRAGMENTS_DIR, file), "utf8")));
    } catch (error) {
      problems.push(`  .changes/${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (problems.length > 0) throw new Error(`fragmento(s) inválido(s):\n${problems.join("\n")}\nO formato está em .changes/README.md.`);
  return fragments;
}

const readChangelog = (): string => (fs.existsSync(CHANGELOG) ? fs.readFileSync(CHANGELOG, "utf8") : "");

/** Data local de quem corta: a nota é lida no Brasil, e UTC viraria o dia às 21h. */
function localDate(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function plan(fragments: Fragment[], major: boolean): string {
  const base = latestVersion(readChangelog()) ?? INITIAL_VERSION;
  const bump = computeBump(fragments.map((fragment) => fragment.impact), major);
  const version = nextVersion(base, bump);
  print(`${base} + ${bump} = ${version} (${fragments.length} fragmento(s))`);
  for (const fragment of fragments) print(`  ${fragment.impact.padEnd(16)} ${fragment.section.padEnd(8)} ${fragment.title}`);
  print(`exige ação do operador: ${requiresOperatorAction(fragments) ? "sim" : "não"}`);
  return version;
}

/** Ramos `head` dos PRs deste repositório associados ao commit, pela API do GitHub (só no CI). */
function pullRequestBranches(commit: string): string[] {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY não definido: a origem do commit só se confere no CI");
  const jq = "[.[] | select(.head.repo.full_name == env.GITHUB_REPOSITORY) | .head.ref] | .[]";
  return execFileSync("gh", ["api", `repos/${repository}/commits/${commit}/pulls`, "--jq", jq], { encoding: "utf8" }).split("\n").filter(Boolean);
}

function main(argv: string[]): number {
  const [command, ...args] = argv;
  const major = args.includes("--major");
  const dateAt = args.indexOf("--date");
  const date = dateAt === -1 ? localDate() : (args[dateAt + 1] ?? "");

  switch (command) {
    case "check": {
      const fragments = readFragments();
      if (fragments.length === 0) print("nenhum fragmento em .changes/: nada a validar e nenhuma versão a cortar");
      else plan(fragments, major);
      return 0;
    }
    case "cut": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("`--date` espera AAAA-MM-DD");
      const fragments = readFragments();
      const version = plan(fragments, major);
      fs.writeFileSync(CHANGELOG, applyToChangelog(readChangelog(), assembleSection(fragments, version, date)));
      for (const fragment of fragments) fs.rmSync(path.join(FRAGMENTS_DIR, fragment.file));
      print(`CHANGELOG.md atualizado; ${fragments.length} fragmento(s) consumido(s). A tag v${version} nasce no merge do PR de release.`);
      return 0;
    }
    case "current": {
      const version = latestVersion(readChangelog());
      if (!version) throw new Error("CHANGELOG.md ainda não tem nenhuma versão");
      print(version);
      return 0;
    }
    case "notes": {
      const notes = extractSection(readChangelog(), args[0] ?? "");
      if (notes === null) throw new Error(`CHANGELOG.md não tem a versão \`${args[0] ?? ""}\``);
      print(notes);
      return 0;
    }
    case "tag-target": {
      // Imprime `version=` e `commit=` (para o GITHUB_OUTPUT) só quando há tag a criar.
      const decision = decideTag(gitHistory(ROOT, pullRequestBranches), args[0] ?? "HEAD");
      // Pela saída padrão: é dela que o runner lê os comandos `::error::` e `::notice::`.
      if (decision.action === "refuse") {
        print(`::error::${decision.reason}`);
        return 1;
      }
      if (decision.action === "skip") print(decision.notice ? `::notice::${decision.reason}` : decision.reason);
      else print(`version=${decision.version}\ncommit=${decision.commit}`);
      return 0;
    }
    default:
      process.stderr.write("uso: tsx scripts/release.ts check | cut [--major] [--date AAAA-MM-DD] | current | notes <X.Y.Z> | tag-target <sha>\n");
      return 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
