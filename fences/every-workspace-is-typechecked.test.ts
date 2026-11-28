// dono: @DeskLabs-OpenSource/maintainers
// motivo: o `tsconfig.json` da raiz exclui `apps/panel`, e o CI só roda o `pnpm typecheck` da raiz.
//   O `next build` confere os tipos pelo `tsconfig.build.json`, que deixa os testes de fora. Assim a
//   main ficou verde com um erro de tipo em `apps/panel/src/ui/timeline-webhook.test.ts` (DESA-389).
//   Conferir o texto do script não basta: `tsc -p tsconfig.build.json`, `||` no lugar de `&&` e um
//   `echo` na frente da chamada passavam com tudo verde (DESA-393). Por isso a cerca resolve os
//   tsconfigs que o `pnpm typecheck` da raiz de fato usa e confere arquivo por arquivo que todo
//   `src/**/*.ts(x)` de cada pacote, testes incluídos, está coberto.
// revisar em: 2027-05-27
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import { REPO_ROOT, asRecord, exists, expectClean, fixture, listFiles, read } from "./_lib";

const scriptsOf = (root: string, file: string): Record<string, unknown> => asRecord(asRecord(JSON.parse(read(root, file))).scripts);

const TSC = /^tsc(?: -p (\S+))?$/;
const FILTER = /^pnpm --filter \.\/((?:apps|packages)\/[^/\s]+) typecheck$/;

interface Steps {
  configs: string[];
  filtered: string[];
  bad: string[];
}

/**
 * Lê um script `typecheck` com gramática fechada: só `tsc -p <tsconfig>` e, na raiz,
 * `pnpm --filter ./<pacote> typecheck`, encadeados por `&&`. Qualquer outro trecho (`||`, `;`,
 * `echo`, aspas, um `tsc` com outras opções) volta em `bad`, porque a cerca não sabe o que ele cobre.
 */
function parseScript(script: string, allowFilter: boolean): Steps {
  const steps: Steps = { configs: [], filtered: [], bad: [] };
  for (const segment of script.split("&&").map((s) => s.trim())) {
    const tsc = TSC.exec(segment);
    const filter = allowFilter ? FILTER.exec(segment) : null;
    if (tsc) steps.configs.push(tsc[1] ?? "tsconfig.json");
    else if (filter?.[1]) steps.filtered.push(filter[1]);
    else steps.bad.push(segment);
  }
  return steps;
}

/** Arquivos que `tsc -p <config>` confere, relativos a `root`, com `include`, `exclude` e `extends` resolvidos. */
function filesOf(root: string, config: string): Set<string> | string {
  const abs = path.join(root, config);
  if (!exists(root, config)) return `${config} não existe`;
  const parsed = ts.readConfigFile(abs, ts.sys.readFile);
  if (parsed.error) return `${config} não abre: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, " ")}`;
  const content = ts.parseJsonConfigFileContent(parsed.config, ts.sys, path.dirname(abs), undefined, abs);
  return new Set(content.fileNames.map((f) => path.relative(root, f).split(path.sep).join("/")));
}

function check(root: string): string[] {
  const violations: string[] = [];
  const rootSteps = parseScript(String(scriptsOf(root, "package.json").typecheck ?? ""), true);
  for (const segment of rootSteps.bad) {
    violations.push(`package.json da raiz: o trecho \`${segment}\` do script \`typecheck\` não é \`tsc -p <tsconfig>\` nem \`pnpm --filter ./<pacote> typecheck\`; encadeie só com \`&&\`, sem \`||\`, \`;\`, \`echo\` nem aspas`);
  }

  const covered = new Set<string>();
  const addFiles = (config: string, who: string): void => {
    const files = filesOf(root, config);
    if (typeof files === "string") violations.push(`${who}: ${files}`);
    else for (const f of files) covered.add(f);
  };
  for (const config of rootSteps.configs) addFiles(config, "package.json da raiz");

  const workspaces = [...listFiles(root, "apps", (f) => /^apps\/[^/]+\/package\.json$/.test(f)), ...listFiles(root, "packages", (f) => /^packages\/[^/]+\/package\.json$/.test(f))].map((f) => f.replace(/\/package\.json$/, ""));
  const ownConfig = new Map<string, string[]>();
  for (const dir of rootSteps.filtered) {
    const own = scriptsOf(root, `${dir}/package.json`).typecheck;
    if (typeof own !== "string") {
      violations.push(`${dir}: o \`typecheck\` da raiz chama \`pnpm --filter ./${dir} typecheck\`, mas o pacote não tem script \`typecheck\``);
      continue;
    }
    const steps = parseScript(own, false);
    for (const segment of steps.bad) {
      violations.push(`${dir}: o trecho \`${segment}\` do script \`typecheck\` do pacote não é \`tsc -p <tsconfig>\`; encadeie só com \`&&\``);
    }
    const configs = steps.configs.map((c) => path.posix.join(dir, c));
    ownConfig.set(dir, configs);
    for (const config of configs) addFiles(config, dir);
  }

  for (const dir of workspaces) {
    const missing = listFiles(root, `${dir}/src`, (f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts")).filter((f) => !covered.has(f));
    if (missing.length === 0) continue;
    const tests = missing.filter((f) => /\.test\.tsx?$/.test(f));
    const sample = (tests[0] ?? missing[0]) as string;
    const what = tests.length > 0 ? `${missing.length} arquivo(s) de \`src\`, ${tests.length} de teste,` : `${missing.length} arquivo(s) de \`src\``;
    const configs = ownConfig.get(dir);
    const fix = configs
      ? `o \`typecheck\` do pacote usa ${configs.map((c) => `\`${c}\``).join(" e ")}, que deixa esses arquivos de fora: aponte o script para um tsconfig que inclua \`src\` com os testes (o \`tsconfig.build.json\` do painel exclui os testes)`
      : `inclua \`${dir}/src\` no tsconfig.json da raiz, ou acrescente \`&& pnpm --filter ./${dir} typecheck\` ao script \`typecheck\` da raiz, com um \`typecheck\` no pacote`;
    violations.push(`${dir}: ${what} fora do \`pnpm typecheck\` da raiz (ex.: \`${sample}\`); ${fix}`);
  }
  return violations;
}

/** Cópia da fixture boa com o script `typecheck` de um package.json trocado. */
function withScript(file: string, typecheck: string): string {
  const root = fixture("every-workspace-is-typechecked");
  const pkg = asRecord(JSON.parse(read(root, file)));
  fs.writeFileSync(path.join(root, file), JSON.stringify({ ...pkg, scripts: { ...asRecord(pkg.scripts), typecheck } }));
  return root;
}

describe("every-workspace-is-typechecked", () => {
  it("o pnpm typecheck da raiz confere os tipos de todo pacote, testes incluídos", () => {
    expectClean(check(REPO_ROOT), "Todo `src/**/*.ts(x)` de cada pacote, testes incluídos, tem de estar num tsconfig que o `pnpm typecheck` da raiz roda, encadeado só com `&&`.");
  });

  it("a fixture boa passa", () => {
    expect(check(fixture("every-workspace-is-typechecked"))).toEqual([]);
  });

  it("reprova o painel conferido pelo tsconfig.build.json, que exclui os testes (Q8)", () => {
    expect(check(withScript("apps/panel/package.json", "tsc -p tsconfig.build.json"))).toEqual([
      "apps/panel: 1 arquivo(s) de `src`, 1 de teste, fora do `pnpm typecheck` da raiz (ex.: `apps/panel/src/page.test.tsx`); o `typecheck` do pacote usa `apps/panel/tsconfig.build.json`, que deixa esses arquivos de fora: aponte o script para um tsconfig que inclua `src` com os testes (o `tsconfig.build.json` do painel exclui os testes)",
    ]);
  });

  it("reprova `||` no lugar de `&&` no script da raiz (Q9)", () => {
    const violations = check(withScript("package.json", "tsc -p tsconfig.json || pnpm --filter ./apps/panel typecheck"));
    expect(violations[0]).toMatch(/^package\.json da raiz: o trecho `tsc -p tsconfig\.json \|\| pnpm --filter \.\/apps\/panel typecheck`/);
    expect(violations.some((v) => v.startsWith("apps/panel: ") && v.includes("`&& pnpm --filter ./apps/panel typecheck`"))).toBe(true);
  });

  it("reprova a chamada do painel dentro de um `echo` (Q7)", () => {
    expect(check(withScript("package.json", "tsc -p tsconfig.json && echo pnpm --filter ./apps/panel typecheck"))).toEqual([
      "package.json da raiz: o trecho `echo pnpm --filter ./apps/panel typecheck` do script `typecheck` não é `tsc -p <tsconfig>` nem `pnpm --filter ./<pacote> typecheck`; encadeie só com `&&`, sem `||`, `;`, `echo` nem aspas",
      "apps/panel: 2 arquivo(s) de `src`, 1 de teste, fora do `pnpm typecheck` da raiz (ex.: `apps/panel/src/page.test.tsx`); inclua `apps/panel/src` no tsconfig.json da raiz, ou acrescente `&& pnpm --filter ./apps/panel typecheck` ao script `typecheck` da raiz, com um `typecheck` no pacote",
    ]);
  });

  it("reprova pacote fora do tsconfig da raiz sem chamada, e chamada a pacote sem typecheck", () => {
    const root = withScript("package.json", "tsc -p tsconfig.json && pnpm --filter ./apps/panel typecheck && pnpm --filter ./apps/orphan typecheck");
    fs.mkdirSync(path.join(root, "apps/orphan/src"));
    fs.writeFileSync(path.join(root, "apps/orphan/src/main.ts"), "export const x = 1;\n");
    expect(check(root)).toEqual([
      "apps/orphan: o `typecheck` da raiz chama `pnpm --filter ./apps/orphan typecheck`, mas o pacote não tem script `typecheck`",
      "apps/orphan: 1 arquivo(s) de `src` fora do `pnpm typecheck` da raiz (ex.: `apps/orphan/src/main.ts`); inclua `apps/orphan/src` no tsconfig.json da raiz, ou acrescente `&& pnpm --filter ./apps/orphan typecheck` ao script `typecheck` da raiz, com um `typecheck` no pacote",
    ]);
  });
});
