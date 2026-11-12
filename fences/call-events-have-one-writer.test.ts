// dono: @DeskLabs-OpenSource/maintainers
// motivo: a regra 8 do AGENTS.md diz que o que acontece numa chamada vira `call_events` com um tipo
//   do vocabulário. O tipo só é validado dentro de `recordEvent`; um insert direto na tabela grava
//   qualquer texto e a linha do tempo da chamada passa a ter evento que nenhuma tela conhece.
// revisar em: 2027-05-12
import { describe, it, expect } from "vitest";
import { REPO_ROOT, exists, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

const WRITER = "packages/core/src/events.ts";
const INSERTS = /insert\s+into\s+call_events/i;
const VALIDATES = /CALL_EVENT_KINDS\.includes/;

/** Sem comentários: arquivo que só FALA do escritor não é o escritor. Guarda `[^:"']` protege `https://`. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

function check(root: string): string[] {
  const violations: string[] = [];
  const files = [...listFiles(root, "apps", isSource), ...listFiles(root, "packages", isSource)].filter((file) => !isTest(file));
  for (const file of files) {
    if (file === WRITER) continue;
    if (INSERTS.test(code(read(root, file)))) violations.push(`${file}: grava em \`call_events\` fora de \`recordEvent\``);
  }
  // O vocabulário é conferido em `recordEvent`; sem essa linha, o tipo vira texto livre. A fixture
  // traz só o arquivo infrator, então o escritor só é conferido quando existe.
  if (exists(root, WRITER)) {
    const writer = code(read(root, WRITER));
    if (INSERTS.test(writer) && !VALIDATES.test(writer)) {
      violations.push(`${WRITER}: grava em \`call_events\` sem conferir \`CALL_EVENT_KINDS\``);
    }
  }
  return violations;
}

describe("call-events-have-one-writer", () => {
  it("só recordEvent grava em call_events, e confere o vocabulário", () => {
    expectClean(
      check(REPO_ROOT),
      "Grave evento com `recordEvent(q, callId, kind, payload, at)` de @deskvoice/core: é ele que confere o tipo contra `CALL_EVENT_KINDS` e copia a organização da própria chamada.",
    );
  });

  it("reprova insert direto em call_events e aceita o escritor único", () => {
    expect(check(fixture("call-events-have-one-writer"))).toEqual([
      "apps/voice/src/grava.ts: grava em `call_events` fora de `recordEvent`",
    ]);
  });
});
