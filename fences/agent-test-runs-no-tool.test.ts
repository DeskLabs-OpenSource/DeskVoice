// dono: @DeskLabs-OpenSource/maintainers
// motivo: o teste do agente (docs/specs/2026-11-21-testes-do-agente.md, 5.4) promete que nenhuma
//   ferramenta roda: nenhum webhook, aviso ou transferência sai. Na Retell, a ferramenta sem mock vai
//   ao endpoint de produção. Aqui, o executor nem importa quem roda ferramenta.
// teto: confere o import e o nome `runTool` no próprio executor. Import indireto (um arquivo que o
//   executor importa e que importa `runTool`) fica com a revisão.
// revisar em: 2027-05-21
import { describe, it, expect } from "vitest";
import { REPO_ROOT, exists, expectClean, fixture, read } from "./_lib";

const EXECUTOR = "apps/voice/src/agent-test.ts";
const RUNS_TOOLS = [
  { pattern: /\brunTool\b/, what: "usa `runTool`" },
  { pattern: /["'][^"']*run-tool(?:\.[jt]s)?["']/, what: "importa `run-tool`" },
];

/** Sem comentários: o executor que só FALA de `runTool` não o importa. Guarda `[^:"']` protege `https://`. */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

function check(root: string): string[] {
  if (!exists(root, EXECUTOR)) return [`${EXECUTOR}: o executor do teste do agente sumiu; mudou de lugar? Atualize a cerca.`];
  const source = code(read(root, EXECUTOR));
  return RUNS_TOOLS.filter(({ pattern }) => pattern.test(source)).map(({ what }) => `${EXECUTOR}: ${what}`);
}

describe("agent-test-runs-no-tool", () => {
  it("o executor do teste do agente não roda ferramenta", () => {
    expectClean(
      check(REPO_ROOT),
      "No teste do agente, nenhuma ferramenta roda: o executor devolve ao modelo o `result` escrito no teste. Não importe `runTool` nem `@deskvoice/tools/run-tool` em apps/voice/src/agent-test.ts.",
    );
  });

  it("reprova o executor que importa runTool ou run-tool, e aceita o que só fala dele em comentário", () => {
    expect(check(fixture("agent-test-runs-no-tool"))).toEqual([`${EXECUTOR}: usa \`runTool\``, `${EXECUTOR}: importa \`run-tool\``]);
  });
});
