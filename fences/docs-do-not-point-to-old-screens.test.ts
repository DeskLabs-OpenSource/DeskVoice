// dono: @DeskLabs-OpenSource/maintainers
// motivo: depois da central de configuração (parte 8) não há mais "Configurações → Sistema", e o
//   aviso, o guia, os READMEs e a skill seguiram mandando a pessoa para lá até o ajuste do #518; o
//   texto quebrado em duas linhas escapava de uma busca linha a linha.
// revisar em: 2027-05-23
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, listFiles, read } from "./_lib";

/** Telas de Configurações que não existem mais, nos três idiomas: o nome de cada uma, palavra por palavra. */
const OLD_SCREENS = [
  ["Sistema"],
  ["System"],
  ["Chaves"],
  ["Keys"],
  ["Claves"],
  ["Versão", "e", "atualização"],
  ["Version", "and", "update"],
  ["Versión", "y", "actualización"],
];
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Entre as palavras, `\s+`: a quebra de linha do Markdown no meio do caminho continua sendo o caminho.
const OLD_PATH = new RegExp(
  `(?:Configurações|Settings|Configuración)\\s*[→›>]\\s*(?:${OLD_SCREENS.map((words) => words.map(escape).join("\\s+")).join("|")})(?![\\p{L}\\p{N}])`,
  "gu",
);

// Os registros da fundação copiam o que a tela dizia no dia: são prova, e não guia.
const isGuide = (file: string): boolean => file.endsWith(".md") && !file.startsWith("docs/fundacao/registros/");
const GUIDES = (root: string): string[] => [
  ...listFiles(root, ".", (file) => /^README[^/]*\.md$/.test(file)),
  ...listFiles(root, "docs", isGuide),
  ...listFiles(root, ".agents/skills", isGuide),
  ...listFiles(root, ".claude/skills", isGuide),
];

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of GUIDES(root)) {
    const text = read(root, file);
    for (const match of text.matchAll(OLD_PATH)) {
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(`${file}:${line}: \`${match[0].replace(/\s+/g, " ")}\` é uma tela que não existe mais`);
    }
  }
  return violations;
}

describe("docs-do-not-point-to-old-screens", () => {
  it("nenhum README, documento ou skill manda a pessoa para uma tela antiga de Configurações", () => {
    expectClean(
      check(REPO_ROOT),
      "Aponte para onde a tela mora hoje: a atualização fica em Administrar a instalação → Atualização, e as chaves dos motores em Configurações → Inteligência artificial.",
    );
  });

  it("reprova a tela antiga numa linha só, com quebra de linha no meio e em qualquer dos três idiomas, e deixa os registros e a tela nova", () => {
    expect(check(fixture("docs-do-not-point-to-old-screens"))).toEqual([
      "README.en.md:3: `Settings → Version and update` é uma tela que não existe mais",
      "README.md:3: `Configurações → Sistema` é uma tela que não existe mais",
      "README.md:4: `Configurações → Chaves` é uma tela que não existe mais",
      "docs/guia.md:3: `Configurações → Versão e atualização` é uma tela que não existe mais",
      "docs/guia.md:6: `Configuración › Sistema` é uma tela que não existe mais",
      ".agents/skills/exemplo/SKILL.md:4: `Settings → Keys` é uma tela que não existe mais",
    ]);
  });
});
