// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm o isolamento entre empresas foi furado por tabelas que nasceram sem a coluna
//   de empresa e por caminhos que esqueciam o filtro. Aqui a coluna existe desde a primeira migration.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

// Tabelas da INSTALAÇÃO, que não pertencem a nenhuma organização (R8, seção 3.9 do desenho
// `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`). Cada isenção tem
// dono, motivo e data de revisão (antipadrão 11), cobrados pelo último teste deste arquivo. As três
// têm RLS forçado, sem policy, e nenhum direito para `deskvoice_app`: quem confere é o teste de
// isolamento gerado (`packages/core/test/isolation.db.test.ts`).
const INSTALLATION_TABLES: Record<string, { owner: string; reason: string; review: string }> = {
  accounts: {
    owner: "@DeskLabs-OpenSource/maintainers",
    reason: "a conta (e-mail e senha) é uma só para todas as organizações em que a pessoa entra",
    review: "2027-05-17",
  },
  installation_settings: {
    owner: "@DeskLabs-OpenSource/maintainers",
    reason: "o estado de quem administra a instalação e os padrões da instalação valem acima das organizações",
    review: "2027-05-17",
  },
  installation_events: {
    owner: "@DeskLabs-OpenSource/maintainers",
    reason: "a auditoria da instalação registra o que acontece acima das organizações, inclusive a exclusão de uma",
    review: "2027-05-17",
  },
};

const EXEMPT = new Set(["organizations", "schema_migrations", ...Object.keys(INSTALLATION_TABLES)]);

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
      "Acrescente `organization_id uuid not null references organizations(id)` à tabela. Só `organizations`, `schema_migrations` e as tabelas da instalação listadas em `INSTALLATION_TABLES` ficam de fora.",
    );
  });

  it("reprova tabela sem a coluna: citada só em comentário, só em restrição, ou aceitando nulo", () => {
    expect(check(fixture("every-table-has-organization-id"))).toEqual([
      "db/migrations/20260101T000000_bad.sql: tabela `notes` não declara a coluna `organization_id uuid not null`",
      "db/migrations/20260101T000000_bad.sql: tabela `sessions` não declara a coluna `organization_id uuid not null`",
      "db/migrations/20260101T000000_bad.sql: tabela `drafts` não declara a coluna `organization_id uuid not null`",
    ]);
  });

  it("cada tabela da instalação isenta tem dono, motivo e data de revisão", () => {
    for (const [table, exemption] of Object.entries(INSTALLATION_TABLES)) {
      expect(exemption.owner, table).toMatch(/^@\S+$/);
      expect(exemption.reason.trim(), table).not.toBe("");
      expect(exemption.review, table).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
