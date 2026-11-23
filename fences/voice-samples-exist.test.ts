// dono: @DeskLabs-OpenSource/maintainers
// motivo: o botão "Ouvir" da tela do agente toca o arquivo que a voz do motor cita em `sample`
//   (DESA-397, fatia 1a). Um caminho errado ou um arquivo apagado vira clique que só diz "não
//   tocou", e ninguém percebe até alguém apertar. Aqui todo `sample` dos motores aponta para um
//   arquivo que existe em `apps/panel/public/`.
// revisar em: 2027-05-23
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, exists, fixture, isTest, listFiles, read } from "./_lib";

const ENGINES = "packages/voice-engine/src/engines";
const PUBLIC = "apps/panel/public";
/** O objeto literal de `sample:`, numa linha ou em várias, sem chave aninhada. */
const SAMPLE = /\bsample\s*:\s*(\{[^{}]*\}|[^,}\n]*)/g;
/** Cada valor de idioma dentro do objeto: `"pt-BR": "voice-samples/…"`, `en: '…'`. */
const ENTRY = /(?:"[^"]+"|'[^']+'|[A-Za-z_]\w*)\s*:\s*(?:"([^"]*)"|'([^']*)'|(\S[^,}\n]*))/g;

function check(root: string): string[] {
  const violations: string[] = [];
  for (const file of listFiles(root, ENGINES, (f) => f.endsWith(".ts") && !isTest(f))) {
    for (const match of read(root, file).matchAll(SAMPLE)) {
      const body = match[1]?.trim() ?? "";
      // Só o literal é conferível aqui; uma variável no lugar dele esconderia o caminho da cerca.
      if (!body.startsWith("{")) {
        violations.push(`${file}: \`sample\` sem objeto literal (${body || "vazio"})`);
        continue;
      }
      for (const entry of body.matchAll(ENTRY)) {
        const src = entry[1] ?? entry[2];
        if (src === undefined) {
          violations.push(`${file}: \`sample\` com valor que não é texto literal (${entry[3]?.trim()})`);
        } else if (src.startsWith("/") || src.split("/").includes("..") || !exists(root, path.posix.join(PUBLIC, src))) {
          violations.push(`${file}: amostra sem arquivo em ${PUBLIC}/: ${src}`);
        }
      }
    }
  }
  return violations;
}

describe("voice-samples-exist", () => {
  it("todo `sample` dos motores aponta para um arquivo que existe", () => {
    expectClean(
      check(REPO_ROOT),
      `Grave o arquivo em ${PUBLIC}/voice-samples/<motor>/<voz>.<idioma>.mp3 (com a fonte em FONTES.md) ou tire o caminho do \`sample\`. O caminho é relativo a ${PUBLIC}/, sem "/" no começo nem "..".`,
    );
  });

  it("deixa passar a amostra que existe e reprova a que falta, a fora da pasta e a que não é literal", () => {
    expect(check(fixture("voice-samples-exist"))).toEqual([
      `${ENGINES}/broken.ts: amostra sem arquivo em ${PUBLIC}/: voice-samples/broken/Ana.en.mp3`,
      `${ENGINES}/broken.ts: amostra sem arquivo em ${PUBLIC}/: ../secret.mp3`,
      `${ENGINES}/broken.ts: \`sample\` com valor que não é texto literal (samplePath)`,
      `${ENGINES}/broken.ts: \`sample\` sem objeto literal (SAMPLES)`,
    ]);
  });

  it("reprova quando o arquivo de uma amostra que passava é apagado", () => {
    const root = fixture("voice-samples-exist");
    expect(check(root).filter((v) => v.includes("good.ts"))).toEqual([]);
    fs.rmSync(path.join(root, PUBLIC, "voice-samples/good/Bia.pt-BR.mp3"));
    expect(check(root).filter((v) => v.includes("good.ts"))).toEqual([`${ENGINES}/good.ts: amostra sem arquivo em ${PUBLIC}/: voice-samples/good/Bia.pt-BR.mp3`]);
  });
});
