// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm o isolamento entre empresas foi furado por tabelas que nasceram sem a coluna
//   de empresa e por caminhos que esqueciam o filtro. Aqui a coluna existe desde a primeira migration.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

const EXEMPT = new Set(["organizations", "schema_migrations"]);

/** Os itens (colunas e restrições) da lista que abre em `start`, separados na vírgula de fora. */
function definitions(sql: string, start: number): string[] {
  const items: string[] = [];
  let depth = 1;
  let from = start;
  let i = start;
  for (; i < sql.length && depth > 0; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === "," && depth === 1) {
      items.push(sql.slice(from, i));
      from = i + 1;
    }
  }
  items.push(sql.slice(from, i - 1));
  return items.map((item) => item.trim());
}

// A COLUNA, não uma menção: `foreign key (organization_id, ...)` sozinho não isola nada, e coluna
// que aceita nulo deixa linha sem dono (chave primária já implica not null).
const declaresOrganization = (item: string): boolean =>
  /^"?organization_id"?\s+uuid\b/i.test(item) && /\bnot\s+null\b|\bprimary\s+key\b/i.test(item);

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, "db/migrations", (f) => f.endsWith(".sql"))) {
    const sql = read(root, file).replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[\w"]+\.)?"?(\w+)"?\s*\(/gi)) {
      const table = (match[1] ?? "").toLowerCase();
      if (EXEMPT.has(table)) continue;
      if (!definitions(sql, match.index + match[0].length).some(declaresOrganization)) {
        violations.push(`${file}: tabela \`${table}\` não declara a coluna \`organization_id uuid not null\``);
      }
    }
  }
  return violations;
}

describe("every-table-has-organization-id", () => {
  it("toda tabela das migrations declara organization_id", () => {
    expectClean(
      check(REPO_ROOT),
      "Acrescente `organization_id uuid not null references organizations(id)` à tabela. Só `organizations` e `schema_migrations` ficam de fora.",
    );
  });

  it("reprova tabela sem a coluna: citada só em comentário, só em restrição, ou aceitando nulo", () => {
    expect(check(fixture("every-table-has-organization-id"))).toEqual([
      "db/migrations/20260101T000000_bad.sql: tabela `notes` não declara a coluna `organization_id uuid not null`",
      "db/migrations/20260101T000000_bad.sql: tabela `sessions` não declara a coluna `organization_id uuid not null`",
      "db/migrations/20260101T000000_bad.sql: tabela `drafts` não declara a coluna `organization_id uuid not null`",
    ]);
  });
});
