// dono: @DeskLabs-OpenSource/maintainers
// motivo: a linha do tempo mostra o motivo de fim ou de recusa da chamada pelo dicionário
//   `timeline.reasons`, e um código sem frase aparece cru para o operador (`whatsapp_answer_failed`,
//   `no_answer`). Os dicionários em inglês e espanhol seguem o tipo do português, então basta ele.
// teto: lê os códigos escritos como texto (`end_reason = '...'`, `endReason: "..."`, o `reason` dos
//   eventos `call_ended` e `call_refused`, o argumento de `.stop("...")`, os argumentos de
//   `closeUnanswered` e os tipos `OutboundRefusalCode` e `Refusal`). Código que chega por outro caminho, numa
//   variável, fica com a revisão.
// revisar em: 2027-05-14
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

const SOURCES = ["apps/voice/src", "packages/core/src"];
const DICTIONARY = "apps/panel/src/i18n/pt-BR/timeline.ts";
const CODE = /^[a-z]+(?:_[a-z]+)*$/;
const QUOTED = /"([a-z]+(?:_[a-z]+)+)"/g;
const WRITES = [
  /end_reason = '([a-z_]+)'/g,
  /endReason: "([a-z_]+)"/g,
  /"call_(?:ended|refused)", \{[^}]*?\breason: "([a-z_]+)"/g,
  /\.stop\("([a-z_]+)"\)/g,
];

function reasonsWritten(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const add = (code: string, file: string): void => {
    if (CODE.test(code) && !found.has(code)) found.set(code, file);
  };
  for (const dir of SOURCES) {
    for (const file of listFiles(root, dir, (f) => isSource(f) && !isTest(f) && !f.includes("/testing/"))) {
      const source = read(root, file);
      for (const pattern of WRITES) for (const match of source.matchAll(pattern)) add(match[1] ?? "", file);
      for (const call of source.matchAll(/await closeUnanswered\(([\s\S]*?)\);/g)) {
        for (const match of (call[1] ?? "").matchAll(QUOTED)) add(match[1] ?? "", file);
      }
      for (const union of source.matchAll(/type (?:OutboundRefusalCode|Refusal) = ([^;]+);/g)) {
        for (const match of (union[1] ?? "").matchAll(QUOTED)) add(match[1] ?? "", file);
      }
    }
  }
  return found;
}

function sentences(root: string): Set<string> {
  const source = read(root, DICTIONARY);
  const start = source.indexOf("\n  reasons: {");
  const block = start === -1 ? "" : source.slice(start, source.indexOf("\n  },", start));
  return new Set([...block.matchAll(/^\s+([a-z_]+):/gm)].map((match) => match[1] ?? ""));
}

function check(root: string): string[] {
  const known = sentences(root);
  return [...reasonsWritten(root)].filter(([code]) => !known.has(code)).map(([code, file]) => `${file}: motivo \`${code}\` sem frase em \`timeline.reasons\``);
}

describe("call-end-reasons-have-a-sentence", () => {
  it("todo motivo de fim ou de recusa gravado tem frase na linha do tempo", () => {
    expectClean(check(REPO_ROOT), `Acrescente a frase em \`reasons\` de ${DICTIONARY} e nos dicionários en e es.`);
  });

  it("reprova motivo sem frase e aceita o que tem", () => {
    expect(check(fixture("call-end-reasons-have-a-sentence")).sort()).toEqual([
      "apps/voice/src/a.ts: motivo `line_dropped` sem frase em `timeline.reasons`",
      "apps/voice/src/a.ts: motivo `ring_timeout` sem frase em `timeline.reasons`",
      "apps/voice/src/a.ts: motivo `server_going_down` sem frase em `timeline.reasons`",
      "apps/voice/src/a.ts: motivo `wa_failed` sem frase em `timeline.reasons`",
      "apps/voice/src/b.ts: motivo `after_hours` sem frase em `timeline.reasons`",
      "apps/voice/src/b.ts: motivo `number_blocked` sem frase em `timeline.reasons`",
      "packages/core/src/c.ts: motivo `engine_gone` sem frase em `timeline.reasons`",
    ]);
  });
});
