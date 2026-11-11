// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm guias e skills seguiam apontando para arquivos renomeados ou apagados, e o
//   assistente do contribuidor obedecia a um documento que não existia mais.
// revisar em: 2027-05-10
import path from "node:path";
import { describe, it, expect } from "vitest";
import { REPO_ROOT, exists, expectClean, fixture, listFiles, read } from "./_lib";

const LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const isMarkdown = (file: string): boolean => file.endsWith(".md");

function check(root: string): string[] {
  const violations: string[] = [];
  const files = [
    ...listFiles(root, ".", isMarkdown).filter((file) => !file.includes("/")),
    ...listFiles(root, "docs", isMarkdown),
    ...listFiles(root, ".agents", isMarkdown),
  ];
  for (const file of files) {
    // Bloco e trecho de código não são link: é onde os documentos mostram exemplos.
    const prose = read(root, file).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    for (const match of prose.matchAll(LINK)) {
      const raw = match[1] ?? "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) continue;
      const target = decodeURIComponent(raw.replace(/[#?].*$/, ""));
      const resolved = target.startsWith("/") ? target.slice(1) : path.posix.join(path.posix.dirname(file), target);
      if (resolved.startsWith("..") || !exists(root, resolved)) violations.push(`${file}: link para \`${raw}\`, que não existe`);
    }
  }
  return violations;
}

describe("docs-point-to-existing-files", () => {
  it("todo link relativo dos documentos aponta para algo que existe", () => {
    expectClean(
      check(REPO_ROOT),
      "Corrija o caminho do link (ele é relativo ao arquivo que o contém) ou remova-o. Renomeou um arquivo? Atualize quem aponta para ele na mesma mudança.",
    );
  });

  it("reprova link quebrado e ignora URL, âncora e exemplo em código", () => {
    expect(check(fixture("docs-point-to-existing-files"))).toEqual([
      "docs/guide.md: link para `./missing.md`, que não existe",
      "docs/guide.md: link para `../README.md#instalar`, que não existe",
    ]);
  });
});
