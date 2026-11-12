// dono: @DeskLabs-OpenSource/maintainers
// motivo: a regra 10 do AGENTS.md pede porta 0 em teste, mas nada cobrava: um `listen(3000)` novo
//   passaria despistado. Porta fixa faz dois testes paralelos (ou dois runs de CI na mesma máquina)
//   brigarem por um recurso que deveria ser descartável.
// revisar em: 2027-05-10
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isTest, listFiles, read } from "./_lib";

// `listen(3000)`, `listen({ port: 3000 })`, inclusive com quebra de linha entre a chamada e o número.
const PINNED_PORT = /\.listen\(\s*(?:\{\s*port:\s*)?(\d+)\b/g;

const ROOTS = ["packages", "apps", "scripts"];

function check(root: string): string[] {
  const violations: string[] = [];
  for (const dir of ROOTS) {
    for (const file of listFiles(root, dir, isTest)) {
      const content = read(root, file);
      for (const match of content.matchAll(PINNED_PORT)) {
        const port = Number(match[1]);
        if (port === 0) continue;
        const line = content.slice(0, match.index).split("\n").length;
        violations.push(`${file}:${line}: fixa a porta ${port}`);
      }
    }
  }
  return violations;
}

describe("tests-do-not-pin-the-port", () => {
  it("nenhum teste fixa a porta em que escuta", () => {
    expectClean(
      check(REPO_ROOT),
      'Abra porta 0 (`listen(0, "127.0.0.1", ...)`) e leia a porta que o sistema deu (`server.address().port`): porta fixa colide entre testes paralelos e entre runs de CI na mesma máquina.',
    );
  });

  it("reprova `listen(n)` e `listen({ port: n })`, e aceita porta 0 ou vinda de variável", () => {
    expect(check(fixture("tests-do-not-pin-the-port"))).toEqual([
      "packages/core/src/serve.test.ts:9: fixa a porta 3000",
      "packages/core/src/serve.test.ts:13: fixa a porta 8080",
    ]);
  });
});
