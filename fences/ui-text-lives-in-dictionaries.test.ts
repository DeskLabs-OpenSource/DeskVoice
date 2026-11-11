// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm frase em português escrita direto no componente chegava à tela de quem usa em
//   inglês ou espanhol, e o guardião de tradução era cego ao que não passava pelo dicionário.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

// Heurística conservadora, de propósito (prefere deixar passar a reprovar código certo):
//   1. texto com duas letras seguidas entre o fim de uma tag (ou de uma expressão) e uma tag de
//      fechamento: `<p>Chamadas</p>`, `{total} chamadas</span>`;
//   2. literal com letras nos atributos que viram texto para a pessoa.
// Teto conhecido: não vê texto seguido de tag de abertura (`Olá <b>…`), literal dentro de
// expressão (`{"Olá"}`) nem template string. Se isso virar caminho de fuga, troque por AST.
const JSX_TEXT = /[>}]([^<>{}=;()]*\p{L}{2,}[^<>{}=;()]*)<\//gu;
const TEXT_ATTRIBUTE = /\b(?:placeholder|title|alt|aria-label|label)=(?:"([^"]*\p{L}{2,}[^"]*)"|'([^']*\p{L}{2,}[^']*)')/gu;

/** Texto que é o mesmo em todo idioma. Mantenha curta: cada entrada é uma frase que não traduz. */
const ALLOWED_TEXT = new Set(["DeskVoice"]);

function check(root: string): string[] {
  const violations: string[] = [];
  const files = listFiles(root, "apps/panel/src", (f) => f.endsWith(".tsx") && !f.includes("/i18n/") && !f.endsWith(".test.tsx"));
  for (const file of files) {
    const source = read(root, file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of [...source.matchAll(JSX_TEXT), ...source.matchAll(TEXT_ATTRIBUTE)]) {
      const text = (match[1] ?? match[2] ?? "").trim().replace(/\s+/g, " ");
      if (!ALLOWED_TEXT.has(text)) violations.push(`${file}: texto visível fora de dicionário: "${text}"`);
    }
  }
  return violations;
}

describe("ui-text-lives-in-dictionaries", () => {
  it("nenhum texto visível do painel mora fora de dicionário", () => {
    expectClean(
      check(REPO_ROOT),
      "Mova a frase para `apps/panel/src/i18n/pt-BR/<feature>.ts` (e para `en` e `es`) e use a chave no componente. Se o texto é igual em todo idioma (uma marca), acrescente-o a ALLOWED_TEXT nesta cerca.",
    );
  });

  it("reprova texto em JSX e em atributo, e deixa passar chave de dicionário e marca", () => {
    expect(check(fixture("ui-text-lives-in-dictionaries"))).toEqual([
      'apps/panel/src/app/calls/page.tsx: texto visível fora de dicionário: "Chamadas ao vivo"',
      'apps/panel/src/app/calls/page.tsx: texto visível fora de dicionário: "em andamento"',
      'apps/panel/src/app/calls/page.tsx: texto visível fora de dicionário: "Buscar por número"',
    ]);
  });
});
