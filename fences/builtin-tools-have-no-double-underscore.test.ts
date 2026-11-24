// dono: @DeskLabs-OpenSource/maintainers
// motivo: a ferramenta de um servidor MCP chega ao motor como `<slug>__<nome>`. Se uma ferramenta
//   da pasta tivesse `__` no nome, um servidor cadastrado com o slug certo poderia oferecer ao motor
//   uma ferramenta com o mesmo nome de uma nossa, e o modelo não saberia qual chama.
// teto: a cerca lê o nome escrito por extenso (`name: "…"`). Nome montado em código é reprovado,
//   para nenhum nome escapar da leitura.
// revisar em: 2027-05-23
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

const TOOLS_DIR = "packages/tools/src/tools";
const LITERAL_NAME = /^\s+name:\s*"([^"]*)"/gm;
// `name: z.string()` é um campo do esquema de entrada, e não o nome da ferramenta.
const COMPUTED_NAME = /^\s+name:\s*(?!"|z\.)\S/m;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, TOOLS_DIR, (f) => isSource(f) && !isTest(f) && !f.endsWith(".d.ts"))) {
    const source = read(root, file);
    const names = [...source.matchAll(LITERAL_NAME)].map((match) => match[1] ?? "");
    if (names.length === 0 || COMPUTED_NAME.test(source)) violations.push(`${file}: o nome da ferramenta não está escrito por extenso`);
    for (const name of names.filter((item) => item.includes("__"))) violations.push(`${file}: nome com \`__\` (${name})`);
  }
  return violations;
}

describe("builtin-tools-have-no-double-underscore", () => {
  it("nenhuma ferramenta da pasta tem `__` no nome", () => {
    expectClean(
      check(REPO_ROOT),
      "O `__` separa o servidor MCP da ferramenta dele (`<slug>__<nome>`): ferramenta nossa usa um `_` só, e o nome fica escrito por extenso (`name: \"minha_ferramenta\"`).",
    );
  });

  it("reprova nome com `__` e nome montado em código, e aceita o nome com um `_`", () => {
    expect(check(fixture("builtin-tools-have-no-double-underscore"))).toEqual([
      "packages/tools/src/tools/calculado.ts: o nome da ferramenta não está escrito por extenso",
      "packages/tools/src/tools/erp__consultar.ts: nome com `__` (erp__consultar)",
    ]);
  });
});
