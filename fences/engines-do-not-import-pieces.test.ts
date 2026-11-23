// dono: @DeskLabs-OpenSource/maintainers
// motivo: o motor em pipeline (R5) costura transcritor, cérebro e voz, e a tentação é importar a
//   peça concreta. Motor que importa uma peça amarra a escolha do agente ao código: trocar de voz ou
//   de cérebro viraria PR no motor. Na revisão do #566 (DESA-417), uma sabotagem que fazia um motor
//   importar o transcritor passou por todas as cercas. As peças chegam injetadas; o motor só
//   conhece os contratos.
// revisar em: 2027-05-23
import path from "node:path";
import { describe, it, expect } from "vitest";
import { REPO_ROOT, expectClean, fixture, isSource, isTest, listFiles, read } from "./_lib";

const SRC = "packages/voice-engine/src";
/** Os motores: a pasta descoberta e o pipeline, que mora fora dela até a fatia 5. */
const ENGINE_DIR = `${SRC}/engines`;
const ENGINE_FILES = [`${SRC}/pipeline-engine.ts`];
const PIECE_DIRS = ["transcribers", "synthesizers", "brains"];
// `from "x"`, `import "x"`, `import("x")` e `require("x")`, inclusive `export … from "x"`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** A peça que o especificador alcança (`brains/openai`), ou `undefined`. O contrato `types` de cada pasta é livre. */
function pieceOf(file: string, specifier: string): string | undefined {
  let target: string;
  if (specifier.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  else {
    const inside = /(?:^|\/)voice-engine\/src\/(.+)$/.exec(specifier);
    if (!inside) return undefined;
    target = `${SRC}/${inside[1]}`;
  }
  for (const dir of PIECE_DIRS) {
    const prefix = `${SRC}/${dir}/`;
    if (!target.startsWith(prefix)) continue;
    const name = target.slice(prefix.length).replace(/\.[jt]s$/, "");
    return name === "types" ? undefined : `${dir}/${name}`;
  }
  return undefined;
}

function check(root: string): string[] {
  const files = [...listFiles(root, ENGINE_DIR, isSource), ...ENGINE_FILES.filter((file) => listFiles(root, path.posix.dirname(file)).includes(file))];
  const violations: string[] = [];
  for (const file of files.filter((f) => !isTest(f))) {
    const pieces = new Set<string>();
    for (const match of read(root, file).matchAll(SPECIFIER)) {
      const piece = pieceOf(file, match[1] ?? "");
      if (piece) pieces.add(piece);
    }
    for (const piece of [...pieces].sort()) violations.push(`${file}: importa a peça ${piece}`);
  }
  return violations;
}

describe("engines-do-not-import-pieces", () => {
  it("nenhum motor importa uma peça concreta de transcrição, cérebro ou voz", () => {
    expectClean(
      check(REPO_ROOT),
      "O motor recebe as peças prontas (`PipelineConnectOptions.pieces`) e só conhece os contratos (`types.ts`, `brain.ts`). Quem escolhe a peça é quem abre a ligação, pela pasta (`loadTranscribers()`, `loadBrains()`, `loadSynthesizers()`).",
    );
  });

  it("reprova import estático, dinâmico e reexportação de peça em engines/ e no pipeline, e deixa contratos e testes", () => {
    expect(check(fixture("engines-do-not-import-pieces"))).toEqual([
      "packages/voice-engine/src/engines/bad.ts: importa a peça brains/openai",
      "packages/voice-engine/src/engines/bad.ts: importa a peça synthesizers/elevenlabs",
      "packages/voice-engine/src/engines/bad.ts: importa a peça transcribers/simulated",
      "packages/voice-engine/src/engines/sneaky.ts: importa a peça synthesizers/simulated",
      "packages/voice-engine/src/pipeline-engine.ts: importa a peça brains/deepseek",
    ]);
  });
});
