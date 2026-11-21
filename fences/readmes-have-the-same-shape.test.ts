// dono: @DeskLabs-OpenSource/maintainers
// motivo: o README.en.md e o README.es.md ficaram 15 linhas de tabela atrás do README.md, porque
//   cada versão nova mudava só o português. A cerca confere só a forma (títulos, tabelas por seção
//   e linhas por tabela), nunca o texto: a tradução fiel continua sendo leitura de quem revisa.
// revisar em: 2027-05-21
import path from "node:path";
import { describe, it, expect } from "vitest";
import { REPO_ROOT, exists, expectClean, fixture, read } from "./_lib";

const SOURCE = "README.md";
const TRANSLATIONS = ["README.en.md", "README.es.md"];

interface Section {
  /** O título como está no arquivo, sem os `#`; a seção 0 é o que vem antes do primeiro título. */
  title: string;
  level: number;
  /** Linhas que começam com `|` em cada tabela da seção, na ordem. */
  tables: number[];
}

/** Divide o markdown nos títulos (`^#{1,6} `), fora de bloco de código. */
function shape(text: string): Section[] {
  const sections: Section[] = [{ title: "(antes do primeiro título)", level: 0, tables: [] }];
  let inCode = false;
  let inTable = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      inTable = false;
      continue;
    }
    if (inCode) continue;
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    const current = sections[sections.length - 1]!;
    if (heading) {
      sections.push({ title: heading[2]!.trim(), level: heading[1]!.length, tables: [] });
      inTable = false;
    } else if (line.startsWith("|")) {
      if (!inTable) current.tables.push(0);
      current.tables[current.tables.length - 1]! += 1;
      inTable = true;
    } else {
      inTable = false;
    }
  }
  return sections;
}

function check(root: string): string[] {
  if (!exists(root, SOURCE)) return [`${SOURCE}: não existe`];
  const source = shape(read(root, SOURCE));
  const violations: string[] = [];
  for (const file of TRANSLATIONS) {
    if (!exists(root, file)) {
      violations.push(`${file}: não existe`);
      continue;
    }
    const translated = shape(read(root, file));
    // Seção 0 não é título; os números da mensagem contam só os títulos.
    if (translated.length !== source.length) {
      violations.push(`${file}: ${translated.length - 1} títulos, ${SOURCE} tem ${source.length - 1}`);
      continue;
    }
    translated.forEach((section, index) => {
      const original = source[index]!;
      const where = `${file}: seção ${index} "${section.title}" ≠ "${original.title}"`;
      if (section.level !== original.level) {
        violations.push(`${where}: título de nível ${section.level}, ${SOURCE} tem ${original.level}`);
      }
      if (section.tables.length !== original.tables.length) {
        violations.push(`${where}: ${section.tables.length} tabela(s), ${SOURCE} tem ${original.tables.length}`);
        return;
      }
      section.tables.forEach((rows, table) => {
        const expected = original.tables[table]!;
        if (rows !== expected) violations.push(`${where}: tabela ${table + 1} com ${rows} linhas, ${SOURCE} tem ${expected}`);
      });
    });
  }
  return violations;
}

describe("readmes-have-the-same-shape", () => {
  it("README.en.md e README.es.md têm os títulos, as tabelas e as linhas do README.md", () => {
    expectClean(
      check(REPO_ROOT),
      "Traduza a linha que falta do README.md para os outros dois, na mesma posição; os três mudam na mesma PR.",
    );
  });

  it("passa quando os três têm a mesma forma, mesmo com texto diferente e `|` e `#` dentro de bloco de código", () => {
    expect(check(path.join(fixture("readmes-have-the-same-shape"), "passa"))).toEqual([]);
  });

  it("reprova nível de título, número de tabelas na seção e número de linhas na tabela", () => {
    expect(check(path.join(fixture("readmes-have-the-same-shape"), "reprova"))).toEqual([
      'README.en.md: seção 2 "Install" ≠ "Instalar": título de nível 3, README.md tem 2',
      'README.en.md: seção 3 "What it does today" ≠ "O que ele faz hoje": tabela 1 com 3 linhas, README.md tem 4',
      'README.es.md: seção 3 "Lo que hace hoy" ≠ "O que ele faz hoje": 1 tabela(s), README.md tem 2',
    ]);
  });

  it("reprova título a menos e arquivo ausente", () => {
    expect(check(path.join(fixture("readmes-have-the-same-shape"), "faltam-titulos"))).toEqual([
      "README.en.md: 2 títulos, README.md tem 3",
      "README.es.md: não existe",
    ]);
  });
});
