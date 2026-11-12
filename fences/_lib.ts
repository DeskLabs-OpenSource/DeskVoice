/**
 * Utilitários das cercas. Uma cerca é um teste que só lê o repositório: cada uma expõe um
 * `check(root)` que devolve a lista de violações, para rodar igual contra o repositório de
 * verdade e contra uma fixture que prova que ela reprova o caso ruim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, onTestFinished } from "vitest";
import { parse } from "yaml";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");

// Saída gerada fica de fora: o relatório dos testes de tela (`playwright-report`) é uma página de
// meio megabyte em base64, que uma busca por regex varre em tempo quadrático.
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".next", "dist", ".tsbuild", "coverage", "test-results", "playwright-report", "backups", "__fixtures__"]);

/** Arquivos sob `dir`, recursivo, como caminhos relativos a `root` com `/`. Pasta ausente devolve lista vazia. */
export function listFiles(root: string, dir: string, keep: (file: string) => boolean = () => true): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = rel === "." ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(child);
      } else if (entry.isFile() && keep(child)) {
        out.push(child);
      }
    }
  };
  walk(dir);
  return out.sort();
}

export function read(root: string, file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8");
}

export function exists(root: string, file: string): boolean {
  return fs.existsSync(path.join(root, file));
}

export const isSource = (file: string): boolean => /\.(ts|tsx|mts|js|mjs|jsx)$/.test(file);
export const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file) || /(^|\/)test\//.test(file);

/**
 * Copia `fences/__fixtures__/<name>` para uma pasta temporária e devolve o caminho, que serve de
 * `root` para o `check`. Arquivos terminados em `.fixture` perdem o sufixo na cópia: é assim que
 * uma fixture `.ts` ou `.tsx` propositalmente ruim fica fora do lint e do typecheck do repositório.
 */
export function fixture(name: string): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `deskvoice-fence-${name}-`));
  onTestFinished(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.cpSync(path.join(REPO_ROOT, "fences/__fixtures__", name), target, { recursive: true });
  for (const file of listFiles(target, ".", (f) => f.endsWith(".fixture"))) {
    fs.renameSync(path.join(target, file), path.join(target, file.replace(/\.fixture$/, "")));
  }
  return target;
}

export interface Workflow {
  file: string;
  doc: Record<string, unknown>;
}

export function loadWorkflows(root: string): Workflow[] {
  return listFiles(root, ".github/workflows", (f) => /\.ya?ml$/.test(f)).map((file) => ({
    file,
    doc: asRecord(parse(read(root, file))),
  }));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Nomes dos eventos de `on:`, que pode ser texto, lista ou mapa. */
export function triggers(doc: Record<string, unknown>): string[] {
  const on = doc.on;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  return Object.keys(asRecord(on));
}

export function jobs(doc: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  return Object.entries(asRecord(doc.jobs)).map(([name, job]) => [name, asRecord(job)]);
}

/** Falha listando cada violação e, na primeira linha, o que fazer para consertar. */
export function expectClean(violations: string[], howToFix: string): void {
  expect(violations, `${howToFix}\n\n${violations.map((v) => `  - ${v}`).join("\n")}\n`).toEqual([]);
}
