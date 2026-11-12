// dono: @DeskLabs-OpenSource/maintainers
// motivo: a regra 6 do AGENTS.md diz que quem consome tarefa acorda por `listenTasks` e reivindica
//   com `claimTask`. Um consumidor que só reivindica vira laço de espera: a fila é consultada sem
//   parar, e a tarefa nova espera até o próximo ciclo. O código funciona e ninguém percebe.
// revisar em: 2027-05-12
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

const CLAIMS = /\bclaimTask\b/;
const LISTENS = /\blistenTasks\b/;

/** Sem comentários: arquivo que só FALA da regra não a cumpre. Guarda `[^:"']` protege `https://`. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

function check(root: string): string[] {
  const violations: string[] = [];
  const files = [...listFiles(root, "apps", isSource), ...listFiles(root, "packages", isSource)].filter((file) => !isTest(file));
  for (const file of files) {
    // `packages/core` é quem define as duas; a regra vale para quem consome.
    if (file.startsWith("packages/core/")) continue;
    const source = code(read(root, file));
    if (CLAIMS.test(source) && !LISTENS.test(source)) {
      violations.push(`${file}: reivindica tarefa sem \`listenTasks\``);
    }
  }
  return violations;
}

describe("queue-consumers-listen", () => {
  it("todo consumidor de tarefa acorda por listenTasks", () => {
    expectClean(
      check(REPO_ROOT),
      "Quem consome a fila importa `listenTasks` de @deskvoice/core e reivindica com `claimTask` quando acorda. Ver `apps/routines/src/runner.ts`.",
    );
  });

  it("reprova consumidor que só reivindica e aceita o que acorda", () => {
    expect(check(fixture("queue-consumers-listen"))).toEqual([
      "apps/routines/src/consumidor.ts: reivindica tarefa sem `listenTasks`",
    ]);
  });
});
