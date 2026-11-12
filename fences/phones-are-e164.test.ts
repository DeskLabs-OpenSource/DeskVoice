// dono: @DeskLabs-OpenSource/maintainers
// motivo: a regra 13 do AGENTS.md diz que telefone é comparado em E.164. A normalização acontece
//   em `toE164` antes de gravar, e é o sufixo `_e164` que denuncia, no schema, a coluna que pulou
//   essa etapa — a mesma regra que mantém a lista de não ligar comparável.
// teto: nome em que a palavra de telefone não fecha (`phone_raw`) passa, e `rename column` também;
//   ficam com a revisão.
// revisar em: 2027-05-12
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

const MIGRATIONS = "db/migrations";
// A coluna nasce dentro de `create table` (linha recuada) ou por `alter table ... add column`.
const COLUMN = /^(?:\s{2,}|.*\badd\s+column\s+(?:if\s+not\s+exists\s+)?)([a-z][a-z0-9_]*)\s+(text|varchar)\b/i;
// A palavra de telefone fecha o nome: `whatsapp_service` guarda o estado do serviço, não um número.
const PHONE = /(^|_)(phone|whatsapp|celular|telefone|mobile|caller_id|number)(_e164)?$/;
const E164 = /_e164$/;
const isSql = (file: string): boolean => file.endsWith(".sql");

/** Sem comentários: `-- phone text` num comentário não é coluna. */
const code = (source: string): string => source.replace(/--[^\n]*/g, "");

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, MIGRATIONS, isSql)) {
    for (const line of code(read(root, file)).split("\n")) {
      const column = COLUMN.exec(line)?.[1];
      if (!column) continue;
      if (PHONE.test(column) && !E164.test(column)) {
        violations.push(`${file}: coluna \`${column}\` guarda telefone sem \`_e164\``);
      }
    }
  }
  return violations;
}

describe("phones-are-e164", () => {
  it("coluna de telefone termina em _e164", () => {
    expectClean(
      check(REPO_ROOT),
      "Normalize com `toE164` (packages/core) antes de gravar e nomeie a coluna `*_e164`. É o que faz a comparação com a lista de não ligar valer.",
    );
  });

  it("reprova telefone sem _e164 e aceita a coluna normalizada", () => {
    expect(check(fixture("phones-are-e164"))).toEqual([
      "db/migrations/20260101T000000_lead_phone.sql: coluna `phone` guarda telefone sem `_e164`",
      "db/migrations/20260101T000000_lead_phone.sql: coluna `caller_phone` guarda telefone sem `_e164`",
    ]);
  });
});
