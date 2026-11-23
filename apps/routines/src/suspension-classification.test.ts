import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TASK_KIND_ON_SUSPENSION } from "@deskvoice/core";
import { afterEach, describe, expect, it } from "vitest";
import { loadRoutines } from "./load";

/** As rotinas da pasta que não escolheram lado na suspensão (`TASK_KIND_ON_SUSPENSION`). */
async function unclassified(dir?: string): Promise<string[]> {
  return [...(await loadRoutines(dir)).keys()].filter((kind) => !Object.hasOwn(TASK_KIND_ON_SUSPENSION, kind));
}

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

// Seção 3.3 do desenho do R8 (fatia 4b): toda rotina de `src/routines` escolhe o lado dela quando a
// organização é suspensa. Ou continua rodando (guarda, apagamento, vencimento de pedido: não gasta
// nem fala com ninguém de fora), ou fica parada e é cancelada. Lê a pasta como o runner a lê.
// Importa a árvore inteira do pacote a frio, como `load.test.ts`: passa dos 5 s padrão em máquina carregada.
describe("routine classification on suspension", { timeout: 30_000 }, () => {
  it("every routine in src/routines is in TASK_KIND_ON_SUSPENSION", async () => {
    expect(await unclassified()).toEqual([]);
  });

  it("fails a new routine that is not classified", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-routines-"));
    await writeFile(join(dir, "send_survey.ts"), `export default { kind: "send_survey", async run() {} };`);
    await writeFile(join(dir, "purge_transcripts.ts"), `export default { kind: "purge_transcripts", async run() {} };`);
    expect(await unclassified(dir)).toEqual(["send_survey"]);
  });

  it("classifies only routines that exist, so a renamed one leaves no stale side behind", async () => {
    const kinds = new Set((await loadRoutines()).keys());
    expect(Object.keys(TASK_KIND_ON_SUSPENSION).filter((kind) => !kinds.has(kind))).toEqual([]);
  });

  it("keeps exactly the guard, erasure and approval-expiry routines running", () => {
    const running = Object.entries(TASK_KIND_ON_SUSPENSION)
      .filter(([, side]) => side === "keeps_running")
      .map(([kind]) => kind)
      .sort();
    expect(running).toEqual(["end_support_access", "erase_recordings", "expire_approval", "purge_caller_notes", "purge_transcripts"]);
  });
});
