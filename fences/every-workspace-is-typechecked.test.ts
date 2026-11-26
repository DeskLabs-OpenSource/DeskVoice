// dono: @DeskLabs-OpenSource/maintainers
// motivo: o `tsconfig.json` da raiz exclui `apps/panel`, e o CI só roda o `pnpm typecheck` da raiz.
//   O `next build` confere os tipos pelo `tsconfig.build.json`, que deixa os testes de fora. Assim a
//   main ficou verde com um erro de tipo em `apps/panel/src/ui/timeline-webhook.test.ts` (DESA-389).
//   Todo pacote do monorepo tem os tipos conferidos pelo `pnpm typecheck` da raiz: ou o
//   `tsconfig.json` da raiz inclui o `src` dele, ou o script da raiz chama o `typecheck` dele.
// revisar em: 2027-05-23
import { describe, it, expect } from "vitest";
import { REPO_ROOT, asRecord, exists, expectClean, fixture, listFiles, read } from "./_lib";

const scriptsOf = (root: string, file: string): Record<string, unknown> => asRecord(asRecord(JSON.parse(read(root, file))).scripts);

function check(root: string): string[] {
  const tsconfig = asRecord(JSON.parse(read(root, "tsconfig.json")));
  const include = Array.isArray(tsconfig.include) ? tsconfig.include.map(String) : [];
  const rootTypecheck = String(scriptsOf(root, "package.json").typecheck ?? "");
  const workspaces = [...listFiles(root, "apps", (f) => /^apps\/[^/]+\/package\.json$/.test(f)), ...listFiles(root, "packages", (f) => /^packages\/[^/]+\/package\.json$/.test(f))].map((f) => f.replace(/\/package\.json$/, ""));
  const violations: string[] = [];
  for (const dir of workspaces) {
    const coveredByRoot = include.some((glob) => glob === `${dir}/src` || glob === `${dir.split("/")[0]}/*/src`);
    if (coveredByRoot) continue;
    const own = scriptsOf(root, `${dir}/package.json`).typecheck;
    if (typeof own !== "string" || !exists(root, `${dir}/tsconfig.json`)) {
      violations.push(`${dir}: fora do tsconfig.json da raiz e sem script \`typecheck\` próprio com tsconfig.json`);
      continue;
    }
    if (!rootTypecheck.includes(`pnpm --filter ./${dir} typecheck`)) {
      violations.push(`${dir}: fora do tsconfig.json da raiz, e o \`typecheck\` da raiz não chama \`pnpm --filter ./${dir} typecheck\``);
    }
  }
  return violations;
}

describe("every-workspace-is-typechecked", () => {
  it("o pnpm typecheck da raiz confere os tipos de todo pacote, testes incluídos", () => {
    expectClean(check(REPO_ROOT), "Inclua o `src` do pacote no tsconfig.json da raiz, ou acrescente `&& pnpm --filter ./<pacote> typecheck` ao script `typecheck` do package.json da raiz.");
  });

  it("reprova pacote fora do tsconfig da raiz que o typecheck da raiz não chama, e pacote sem typecheck nenhum", () => {
    expect(check(fixture("every-workspace-is-typechecked"))).toEqual([
      "apps/orphan: fora do tsconfig.json da raiz e sem script `typecheck` próprio com tsconfig.json",
      "apps/panel: fora do tsconfig.json da raiz, e o `typecheck` da raiz não chama `pnpm --filter ./apps/panel typecheck`",
    ]);
  });
});
