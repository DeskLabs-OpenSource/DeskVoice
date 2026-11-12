// dono: @DeskLabs-OpenSource/maintainers
// motivo: a regra 10 do AGENTS.md pede que o teste receba um `Clock` em vez de ler a hora, mas
//   nenhuma cerca a cobrava. Quatro linhas de teste já liam o relógio da máquina — inclusive a que
//   compara `run_at` com `Date.now()`, que fica mais frágil a cada dia que o CI roda.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isTest, listFiles, read } from "./_lib";

// Relógio da máquina dentro de teste: `new Date()` sem argumento e `Date.now()`.
// Montado a partir de texto para que esta cerca não case com a própria descrição.
const REAL_CLOCK = new RegExp(String.raw`\bnew\s+Date\(\s*\)|\bDate\.now\(\s*\)`, "g");

// As próprias cercas citam os padrões em texto (mensagem de erro, comentário), então ficam fora do
// escopo: aqui interessa código de teste que roda, não o texto que descreve a regra.
const ROOTS = ["packages", "apps", "scripts"];

function check(root: string): string[] {
  const violations: string[] = [];
  for (const dir of ROOTS) {
    for (const file of listFiles(root, dir, isTest)) {
      read(root, file)
        .split("\n")
        .forEach((line, index) => {
          REAL_CLOCK.lastIndex = 0;
          const found = REAL_CLOCK.exec(line);
          if (found) violations.push(`${file}:${index + 1}: lê o relógio da máquina (${found[0].replace(/\s+/g, "")})`);
        });
    }
  }
  return violations;
}

describe("tests-do-not-read-the-real-clock", () => {
  it("nenhum teste lê o relógio da máquina", () => {
    expectClean(
      check(REPO_ROOT),
      "Receba um `Clock` (ou uma data) por parâmetro em vez de `Date.now()`/`new Date()` vazio: teste que lê o relógio muda de resultado conforme o dia em que roda. Data fixa escrita por extenso (`new Date(\"2030-05-10T12:00:00Z\")`) é permitida — ela não muda.",
    );
  });

  it("reprova `new Date()` vazio e `Date.now()`, e aceita data fixa", () => {
    expect(check(fixture("tests-do-not-read-the-real-clock"))).toEqual([
      "packages/core/src/expiry.test.ts:5: lê o relógio da máquina (newDate())",
      "packages/core/src/expiry.test.ts:6: lê o relógio da máquina (Date.now())",
    ]);
  });
});
