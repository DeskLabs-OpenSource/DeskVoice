// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm a migration era numerada em sequência e PRs paralelos disputavam o mesmo número
//   (renumeradas 11 vezes em dois meses). Carimbo de tempo não colide, desde que seja único e bem formado.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles } from "./_lib";

const NAME = /^(\d{4}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3])[0-5]\d[0-5]\d)_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

function check(root: string): string[] {
  const violations: string[] = [];
  const seen = new Map<string, string>();
  for (const file of listFiles(root, "db/migrations")) {
    const name = file.slice("db/migrations/".length);
    const stamp = NAME.exec(name)?.[1];
    if (!stamp) {
      violations.push(`${file}: nome fora do padrão AAAAMMDDTHHMMSS_slug.sql`);
      continue;
    }
    const other = seen.get(stamp);
    if (other) violations.push(`${file}: carimbo ${stamp} repetido (também em ${other})`);
    else seen.set(stamp, file);
  }
  return violations;
}

describe("migrations-are-timestamped-and-unique", () => {
  it("toda migration tem carimbo de tempo único", () => {
    expectClean(
      check(REPO_ROOT),
      'Renomeie para `db/migrations/$(date -u +%Y%m%dT%H%M%S)_o_que_muda.sql` (slug em minúsculas com `_`). Carimbo repetido: gere um novo para a migration mais recente.',
    );
  });

  it("reprova número sequencial, pasta e carimbo repetido", () => {
    expect(check(fixture("migrations-are-timestamped-and-unique"))).toEqual([
      "db/migrations/0002_sequential.sql: nome fora do padrão AAAAMMDDTHHMMSS_slug.sql",
      "db/migrations/20260101T000000_second.sql: carimbo 20260101T000000 repetido (também em db/migrations/20260101T000000_first.sql)",
      "db/migrations/20261340T000000_impossible_date.sql: nome fora do padrão AAAAMMDDTHHMMSS_slug.sql",
    ]);
  });
});
