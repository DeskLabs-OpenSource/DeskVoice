// dono: @DeskLabs-OpenSource/maintainers
// motivo: marcador de conflito esquecido em arquivo que nenhum compilador lê (markdown, shell, yaml,
//   sql) chega à main sem ninguém ver; no Deskcomm um instalador foi publicado assim.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|gz|zip|wav|mp3|ogg|ulaw|sln)$/i;
// `=======` sozinho fica de fora: é sublinhado de título válido em markdown.
const MARKER = /^(?:<{7}|>{7}|\|{7}) /;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, ".", (f) => !BINARY.test(f))) {
    read(root, file)
      .split("\n")
      .forEach((line, index) => {
        if (MARKER.test(line)) violations.push(`${file}:${index + 1}: marcador de conflito`);
      });
  }
  return violations;
}

describe("no-conflict-markers", () => {
  it("nenhum arquivo carrega marcador de conflito", () => {
    expectClean(check(REPO_ROOT), "Resolva o conflito lendo os dois lados e apague as linhas `<<<<<<<`, `=======` e `>>>>>>>`.");
  });

  it("reprova os marcadores de abertura e de fechamento", () => {
    expect(check(fixture("no-conflict-markers"))).toEqual([
      "docs/merged.md:3: marcador de conflito",
      "docs/merged.md:7: marcador de conflito",
    ]);
  });
});
