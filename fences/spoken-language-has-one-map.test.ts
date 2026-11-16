// dono: @DeskLabs-OpenSource/maintainers
// motivo: o aviso da caixa postal, a saudação da passagem entre agentes e as falas da agenda
//   escolhiam idioma por um mapa de três valores copiado em cada lugar, com a queda para o pt-BR
//   escrita à mão; `en-US` de agente configurado saía em português nas três (#348).
// revisar em: 2027-05-16
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, exists, fixture, isSource, isTest, listFiles, read } from "./_lib";

/** O único lugar que conhece a lista dos idiomas falados e o padrão do produto. */
const NORMALIZER = "packages/core/src/spoken-language.ts";
/** Os três pontos que escolhem o idioma de uma fala fixa. */
const CALL_SITES = ["packages/core/src/voicemail.ts", "packages/tools/src/agenda-speech.ts", "apps/voice/src/call-session.ts"];
/**
 * Onde a regra vale: quem fala. O painel fica de fora porque a lista dele é a dos dicionários de
 * tela (`apps/panel/src/i18n/locales.ts`), outro assunto: idioma da interface, não idioma falado.
 */
const SOURCES = ["packages", "apps/voice/src"];
/** A lista literal dos três idiomas, em qualquer ordem e espaçamento, numa linha. */
const LIST = /\[[^\]\n]{0,120}\]/;
/** Queda escrita à mão: `x ? y : "pt-BR"`, `x ?? "pt-BR"` ou o objeto indexado pela mesma ideia. */
const OWN_FALLBACK = /\?[^\n]*?:\s*["']pt-BR["']|\?\?\s*["']pt-BR["']/;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of SOURCES.flatMap((dir) => listFiles(root, dir, (f) => isSource(f) && !isTest(f)))) {
    const text = read(root, file);
    if (file !== NORMALIZER) {
      for (const match of text.matchAll(new RegExp(LIST, "g"))) {
        const list = match[0];
        if (!["pt-BR", "en", "es"].every((tag) => list.includes(`"${tag}"`) || list.includes(`'${tag}'`))) continue;
        violations.push(`${file}: lista de idiomas falados copiada; use \`spokenLanguageOf\` de \`@deskvoice/core\``);
        break;
      }
    }
    for (const line of text.split("\n")) {
      if (OWN_FALLBACK.test(line)) violations.push(`${file}: escolhe o idioma falado com queda própria para o pt-BR; use \`spokenLanguageOf\``);
    }
  }
  // Os três lugares têm de passar pelo normalizador: trocar a chamada por um mapa novo é o defeito
  // que esta cerca existe para pegar, e ele não deixa lista nem queda literal para as regras acima.
  for (const file of CALL_SITES) {
    if (!exists(root, file)) violations.push(`${file}: não existe`);
    else if (!read(root, file).includes("spokenLanguageOf(")) violations.push(`${file}: escolhe idioma falado sem passar por \`spokenLanguageOf\``);
  }
  return violations;
}

describe("spoken-language-has-one-map", () => {
  it("só o normalizador conhece a lista dos idiomas falados", () => {
    expectClean(
      check(REPO_ROOT),
      "O idioma de uma fala fixa se escolhe com `spokenLanguageOf(stored)` de `@deskvoice/core`: ele aceita `xx-YY` e `xx`, escolhe o idioma que as falas têm e cai no padrão do produto sem lançar. Não copie a lista para outro arquivo nem escreva a queda para o pt-BR à mão.",
    );
  });

  it("reprova lista copiada, queda própria e lugar que não chama o normalizador", () => {
    expect(check(fixture("spoken-language-has-one-map"))).toEqual([
      "packages/tools/src/agenda-speech.ts: lista de idiomas falados copiada; use `spokenLanguageOf` de `@deskvoice/core`",
      "packages/tools/src/agenda-speech.ts: escolhe o idioma falado com queda própria para o pt-BR; use `spokenLanguageOf`",
      "apps/voice/src/call-session.ts: escolhe o idioma falado com queda própria para o pt-BR; use `spokenLanguageOf`",
      "packages/tools/src/agenda-speech.ts: escolhe idioma falado sem passar por `spokenLanguageOf`",
      "apps/voice/src/call-session.ts: escolhe idioma falado sem passar por `spokenLanguageOf`",
    ]);
  });
});
