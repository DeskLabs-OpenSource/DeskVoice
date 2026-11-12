// dono: @DeskLabs-OpenSource/maintainers
// motivo: cor escrita como valor numa tela fica fora de `apps/panel/src/design/tokens.css`, a
//   fonte única dos dois temas, e ninguém a vê: o `#fff` do QR Code do WhatsApp entrou assim no
//   PR #25 (medição de 12/11, itens 4.2 e 4.3). Cor nova vira token, e a tela usa o nome.
// revisar em: 2027-05-12
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

// `#` seguido de 3, 4, 6 ou 8 dígitos hexadecimais como palavra inteira, ou função de cor.
const LITERAL_COLOR = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab)\(/i;
// Linha de comentário pode citar um número de PR (`#25`) sem ser cor.
const COMMENT = /^\s*(?:\/\/|\/\*|\*|\{\/\*)/;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, "apps/panel/src", (f) => /\.tsx?$/.test(f))) {
    read(root, file)
      .split("\n")
      .forEach((line, index) => {
        if (!COMMENT.test(line) && LITERAL_COLOR.test(line)) violations.push(`${file}:${index + 1}: cor literal`);
      });
  }
  return violations;
}

describe("panel-colors-come-from-tokens", () => {
  it("nenhuma tela do painel escreve cor como valor", () => {
    expectClean(
      check(REPO_ROOT),
      "Use um token: crie `--dv-<nome>` em apps/panel/src/design/tokens.css (com `light-dark()`, mesmo valor dos dois lados se a cor é fixa), a ponte `--color-<nome>` em globals.css, e a classe `bg-<nome>`/`text-<nome>` na tela. Direção: docs/design/direcao-do-painel.md.",
    );
  });

  it("reprova hex, rgb, hsl e oklch, e ignora âncora, entidade e comentário", () => {
    expect(check(fixture("panel-colors-come-from-tokens"))).toEqual([
      "apps/panel/src/ui/qr.tsx:4: cor literal",
      "apps/panel/src/ui/qr.tsx:5: cor literal",
      "apps/panel/src/ui/qr.tsx:6: cor literal",
      "apps/panel/src/ui/qr.tsx:7: cor literal",
      "apps/panel/src/ui/qr.tsx:8: cor literal",
    ]);
  });
});
