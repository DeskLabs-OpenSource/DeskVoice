/**
 * `pnpm skills:sync`: regrava `.claude/skills/<nome>/` a partir de `.agents/skills/<nome>/`.
 *
 * A fonte é sempre `.agents/skills` (o caminho que Codex, Cursor e Antigravity leem). O Claude Code
 * lê `.claude/skills`, e cópia em vez de link simbólico porque link não sobrevive a clone no Windows
 * nem a download em zip. A cerca `fences/skills-mirror-is-in-sync.test.ts` reprova espelho velho.
 *
 *   pnpm skills:sync            regrava os espelhos
 *   pnpm skills:sync --check    só lista as diferenças; sai com 1 se houver
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE = ".agents/skills";
const MIRROR = ".claude/skills";

function directories(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

export function listSkills(root: string): string[] {
  return directories(path.join(root, SOURCE));
}

/** Cada diferença entre a fonte e o espelho, numa frase. Lista vazia quer dizer espelho fiel. */
export function mirrorDifferences(root: string): string[] {
  const differences: string[] = [];
  const skills = listSkills(root);
  for (const skill of skills) {
    const source = path.join(root, SOURCE, skill);
    const mirror = path.join(root, MIRROR, skill);
    const sourceFiles = filesUnder(source);
    for (const file of sourceFiles) {
      if (!fs.existsSync(path.join(mirror, file))) differences.push(`${MIRROR}/${skill}/${file}: faltando no espelho`);
      else if (!fs.readFileSync(path.join(source, file)).equals(fs.readFileSync(path.join(mirror, file)))) differences.push(`${MIRROR}/${skill}/${file}: difere da fonte`);
    }
    for (const file of filesUnder(mirror).filter((name) => !sourceFiles.includes(name))) {
      differences.push(`${MIRROR}/${skill}/${file}: sobra no espelho (não existe na fonte)`);
    }
  }
  // Só o que é do projeto: skill pessoal de quem clonou pode morar em `.claude/skills` sem fonte.
  for (const skill of directories(path.join(root, MIRROR)).filter((name) => name.startsWith("deskvoice-") && !skills.includes(name))) {
    differences.push(`${MIRROR}/${skill}: skill no espelho sem fonte em ${SOURCE}`);
  }
  return differences;
}

export function syncSkills(root: string): void {
  const skills = listSkills(root);
  for (const skill of skills) {
    const mirror = path.join(root, MIRROR, skill);
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.cpSync(path.join(root, SOURCE, skill), mirror, { recursive: true });
  }
  for (const skill of directories(path.join(root, MIRROR)).filter((name) => name.startsWith("deskvoice-") && !skills.includes(name))) {
    fs.rmSync(path.join(root, MIRROR, skill), { recursive: true, force: true });
  }
}

function main(): number {
  const root = path.resolve(import.meta.dirname, "..");
  if (listSkills(root).length === 0) {
    process.stderr.write(`nenhuma skill em ${SOURCE}\n`);
    return 2;
  }
  const before = mirrorDifferences(root);
  if (process.argv.includes("--check")) {
    process.stdout.write(before.length === 0 ? "espelho fiel\n" : `${before.join("\n")}\nRode: pnpm skills:sync\n`);
    return before.length === 0 ? 0 : 1;
  }
  syncSkills(root);
  process.stdout.write(`${listSkills(root).length} skill(s) espelhadas em ${MIRROR} (${before.length} diferença(s) corrigida(s))\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
