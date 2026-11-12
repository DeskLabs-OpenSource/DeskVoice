// dono: @DeskLabs-OpenSource/maintainers
// motivo: com `next/font/google`, a construção da imagem do painel baixa as fontes na hora, e sem
//   acesso ao serviço de fontes ela para (medição de 12/11, item 4.5). As fontes moram em
//   `apps/panel/src/app/fonts/` e entram por `next/font/local`.
// revisar em: 2027-05-12
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, listFiles, read } from "./_lib";

const REMOTE_FONT = /["']next\/font\/google["']/;

function check(root: string): string[] {
  return listFiles(root, "apps", isSource)
    .filter((file) => REMOTE_FONT.test(read(root, file)))
    .map((file) => `${file}: fonte baixada na construção (next/font/google)`);
}

describe("fonts-are-vendored", () => {
  it("nenhuma tela baixa fonte na construção", () => {
    expectClean(check(REPO_ROOT), "Versione os arquivos .woff2 em apps/panel/src/app/fonts/, com a licença ao lado, e use next/font/local.");
  });

  it("reprova next/font/google", () => {
    expect(check(fixture("fonts-are-vendored"))).toEqual(["apps/panel/src/app/layout.tsx: fonte baixada na construção (next/font/google)"]);
  });
});
