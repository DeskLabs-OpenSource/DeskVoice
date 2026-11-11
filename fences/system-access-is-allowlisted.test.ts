// dono: @DeskLabs-OpenSource/maintainers
// motivo: a cerca de SQL cru só barrava `pg` e `.query(`. Uma rota nova que chamasse `withSystem`
//   lia e gravava dados de todas as organizações e passava em tudo (achado da revisão fria de
//   2026-11-11). O acesso que atravessa organizações só vale em arquivo listado, com o motivo.
// revisar em: 2027-05-11
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";
import { SYSTEM_ACCESS_ALLOWLIST } from "./system-access-allowlist";

const USES_SYSTEM = /\bwithSystem\b/;
// Auxiliares de teste montam organizações inteiras: ficam fora, como os próprios testes.
const isTestSupport = (file: string): boolean => isTest(file) || /(^|\/)testing\//.test(file);

function check(root: string, allowlist: Record<string, string>): string[] {
  const violations: string[] = [];
  const files = [...listFiles(root, "packages", isSource), ...listFiles(root, "apps", isSource)].filter(
    (file) => !file.startsWith("packages/core/") && !isTestSupport(file),
  );
  const users = new Set(files.filter((file) => USES_SYSTEM.test(read(root, file))));
  for (const file of users) {
    if (!(file in allowlist)) violations.push(`${file}: usa \`withSystem\` e não está na lista`);
  }
  for (const [file, reason] of Object.entries(allowlist)) {
    if (!users.has(file)) violations.push(`${file}: está na lista e não usa mais \`withSystem\` (remova a linha)`);
    if (reason.trim().length < 15) violations.push(`${file}: o motivo na lista é curto demais para explicar o uso`);
  }
  return violations.sort();
}

describe("system-access-is-allowlisted", () => {
  it("fora de packages/core, `withSystem` só aparece em arquivo listado com motivo", () => {
    expectClean(
      check(REPO_ROOT, SYSTEM_ACCESS_ALLOWLIST),
      "`withSystem` atravessa organizações. Dentro de uma rota ou de uma ferramenta, use `withOrg` com a organização da sessão ou da chamada. Se a operação de fato atravessa organizações, prefira criar a função em packages/core, com teste de isolamento. Só em último caso acrescente o arquivo em fences/system-access-allowlist.ts, com o motivo, e explique no PR.",
    );
  });

  it("reprova arquivo fora da lista, entrada que sobrou na lista e motivo vazio", () => {
    const root = fixture("system-access-is-allowlisted");
    expect(check(root, { "apps/routines/src/runner.ts": "a fila atravessa organizações" })).toEqual([
      "apps/panel/src/app/api/v1/reports/route.ts: usa `withSystem` e não está na lista",
    ]);
    expect(check(root, { "apps/routines/src/runner.ts": "fila", "apps/voice/src/gone.ts": "arquivo que já não existe mais" })).toEqual([
      "apps/panel/src/app/api/v1/reports/route.ts: usa `withSystem` e não está na lista",
      "apps/routines/src/runner.ts: o motivo na lista é curto demais para explicar o uso",
      "apps/voice/src/gone.ts: está na lista e não usa mais `withSystem` (remova a linha)",
    ]);
  });
});
