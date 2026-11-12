// dono: @DeskLabs-OpenSource/maintainers
// motivo: originar chamada é a única ação que gasta dinheiro de quem opera e incomoda quem não
//   pediu para ser ligado. Teto, janela de horário e lista de não ligar moram todos em
//   `checkOutboundAllowed`; um caminho novo que chame `.originate(` direto passa pelo review sem
//   ninguém notar e a política deixa de valer só naquele caminho.
// revisar em: 2027-05-12
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

const ORIGINATES = /\.originate\s*\(/;
const CHECKS_POLICY = /\bcheckOutboundAllowed\b/;

/**
 * Sem comentários: a própria documentação cita `checkOutboundAllowed` e `.originate(`, e um
 * arquivo que só FALA da política não a confere. O guarda `[^:"']` protege `https://` e `"//"`.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

function check(root: string): string[] {
  const violations: string[] = [];
  const files = [...listFiles(root, "apps", isSource), ...listFiles(root, "packages", isSource)].filter((file) => !isTest(file));
  for (const file of files) {
    const source = code(read(root, file));
    if (ORIGINATES.test(source) && !CHECKS_POLICY.test(source)) {
      violations.push(`${file}: origina chamada sem \`checkOutboundAllowed\``);
    }
  }
  return violations;
}

describe("outbound-requires-policy", () => {
  it("nenhuma chamada de saída nasce fora de checkOutboundAllowed", () => {
    expectClean(
      check(REPO_ROOT),
      "Origine a chamada por `startOutboundCall` (apps/voice/src/outbound.ts), que confere `checkOutboundAllowed` antes de falar com o Asterisk. A recusa também precisa ficar gravada, como chamada `refused` com o evento `call_refused`.",
    );
  });

  it("reprova origem de chamada sem a política e aceita o caminho que a confere", () => {
    expect(check(fixture("outbound-requires-policy"))).toEqual([
      "apps/voice/src/leak.ts: origina chamada sem `checkOutboundAllowed`",
    ]);
  });
});
