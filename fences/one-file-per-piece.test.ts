// dono: @DeskLabs-OpenSource/maintainers
// motivo: no Deskcomm toda peça nova era registrada num arquivo-índice, e PRs paralelos colidiam
//   sempre na mesma lista. Aqui ferramenta, motor e rotina são descobertos por pasta.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

const PIECE_DIRS = ["packages/tools/src/tools", "packages/voice-engine/src/engines", "apps/routines/src/routines"];
// Import estático de uma peça pelo nome: `./tools/end_call`, `../engines/simulated`, `…/src/routines/x`.
const PIECE_IMPORT = /(?:from|import)\s+["'](?:[^"']*\/)?(?:\.{1,2}|src)\/(tools|engines|routines)\/([\w-]+)(?:\.[jt]s)?["']/g;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const dir of PIECE_DIRS) {
    for (const file of listFiles(root, dir, (f) => /\/index\.[jt]sx?$/.test(f))) {
      violations.push(`${file}: índice dentro de pasta de peças`);
    }
  }
  const inPieceDir = (file: string): boolean => PIECE_DIRS.some((dir) => file.startsWith(`${dir}/`));
  const files = [...listFiles(root, "packages", isSource), ...listFiles(root, "apps", isSource)];
  for (const file of files.filter((f) => !isTest(f) && !inPieceDir(f))) {
    const pieces = new Set([...read(root, file).matchAll(PIECE_IMPORT)].map((match) => `${match[1]}/${match[2]}`));
    // Uma peça importada pode ser um caso especial legítimo; duas ou mais já é uma lista.
    if (pieces.size >= 2) violations.push(`${file}: importa ${pieces.size} peças pelo nome (${[...pieces].sort().join(", ")})`);
  }
  return violations;
}

describe("one-file-per-piece", () => {
  it("nenhuma lista central de ferramentas, motores ou rotinas", () => {
    expectClean(
      check(REPO_ROOT),
      "Peça nova é um arquivo novo na pasta dela, e mais nada: `loadTools()`, `loadEngines()` e o runner de rotinas descobrem por pasta. Apague a lista e use o carregador.",
    );
  });

  it("reprova índice na pasta de peças e arquivo que importa cada peça pelo nome", () => {
    expect(check(fixture("one-file-per-piece"))).toEqual([
      "packages/tools/src/tools/index.ts: índice dentro de pasta de peças",
      "packages/tools/src/registry.ts: importa 2 peças pelo nome (tools/end_call, tools/notify_human)",
    ]);
  });
});
