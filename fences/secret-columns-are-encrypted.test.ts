// dono: @DeskLabs-OpenSource/maintainers
// motivo: a regra 12 do AGENTS.md diz que segredo é cifrado em repouso. Hoje a proteção está no
//   nome da coluna — `_enc` para o que é cifrado, `_hash` para o que é só conferido —, e é o nome
//   que lembra quem escreve a migration e quem lê o dump. Uma coluna `trunk_password text` passa
//   desapercebida e o segredo vai em claro para o backup.
// revisar em: 2027-05-12
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

const MIGRATIONS = "db/migrations";
const COLUMN = /^\s{2,}([a-z][a-z0-9_]*)\s+(text|bytea|varchar|jsonb|uuid)\b/;
const SECRET = /(^|_)(secret|token|password|senha|api_key|credential|private_key)(_|$)/;
const PROTECTED = /_(enc|hash)$/;
const isSql = (file: string): boolean => file.endsWith(".sql");

/** Sem comentários: `-- phone text` num comentário não é coluna. */
const code = (source: string): string => source.replace(/--[^\n]*/g, "");

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, MIGRATIONS, isSql)) {
    for (const line of code(read(root, file)).split("\n")) {
      const match = COLUMN.exec(line);
      if (!match) continue;
      const [, column] = match;
      if (SECRET.test(column) && !PROTECTED.test(column)) {
        violations.push(`${file}: coluna \`${column}\` guarda segredo sem \`_enc\` nem \`_hash\``);
      }
    }
  }
  return violations;
}

describe("secret-columns-are-encrypted", () => {
  it("coluna de segredo termina em _enc ou _hash", () => {
    expectClean(
      check(REPO_ROOT),
      "Cifre com `encryptSecret`/`decryptSecret` (packages/core/src/secrets.ts) e nomeie a coluna `*_enc`; para senha e token use hash e `*_hash`. O sufixo é o que protege o dump.",
    );
  });

  it("reprova segredo em claro e aceita _enc/_hash", () => {
    expect(check(fixture("secret-columns-are-encrypted"))).toEqual([
      "db/migrations/20260101T000000_trunk_password.sql: coluna `trunk_password` guarda segredo sem `_enc` nem `_hash`",
    ]);
  });
});
