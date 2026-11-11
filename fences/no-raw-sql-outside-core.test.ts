// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm cada consulta filtrava a empresa à mão e as que esqueciam vazavam dado entre
//   empresas. Aqui `withOrg` (packages/core) é a única porta para o banco.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, listFiles, read } from "./_lib";

const IMPORTS_PG = /(?:from\s+|require\(\s*|import\(\s*)["']pg(?:-pool)?["']/;
const CALLS_QUERY = /\.query\s*\(/;

function check(root: string): string[] {
  const violations: string[] = [];
  const files = [...listFiles(root, "packages", isSource), ...listFiles(root, "apps", isSource)];
  for (const file of files.filter((f) => !f.startsWith("packages/core/"))) {
    const source = read(root, file);
    if (IMPORTS_PG.test(source)) violations.push(`${file}: importa \`pg\``);
    if (CALLS_QUERY.test(source)) violations.push(`${file}: chama \`.query(\``);
  }
  return violations;
}

describe("no-raw-sql-outside-core", () => {
  it("fora de packages/core ninguém fala direto com o Postgres", () => {
    expectClean(
      check(REPO_ROOT),
      "Use `withOrg(db, organizationId, (q) => q.many(...))` de @deskvoice/core. Se a operação atravessa organizações (login, fila, roteamento), a função nova nasce dentro de packages/core, com teste de isolamento.",
    );
  });

  it("reprova import de pg e pool.query fora do core, e aceita os dois dentro dele", () => {
    expect(check(fixture("no-raw-sql-outside-core"))).toEqual([
      "apps/voice/src/leak.ts: importa `pg`",
      "apps/voice/src/leak.ts: chama `.query(`",
    ]);
  });
});
