import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRoutines } from "./load";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const fixtureRoutine = (kind: string): string => `export default { kind: ${JSON.stringify(kind)}, async run() {} };`;

// Estes testes importam a árvore inteira do pacote a frio; em máquina carregada isso passa dos 5 s padrão.
describe("loadRoutines", { timeout: 30_000 }, () => {
  it("descobre as rotinas da fundação", async () => {
    const routines = await loadRoutines();
    expect([...routines.keys()].sort()).toEqual(["classify_call_outcome", "deliver_notification", "deliver_webhook", "expire_approval", "follow_up", "purge_transcripts", "summarize_call"]);
  });

  it("rotina nova é só um arquivo novo na pasta; arquivo de teste é ignorado", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-routines-"));
    await writeFile(join(dir, "fixture.ts"), fixtureRoutine("fixture"));
    await writeFile(join(dir, "fixture.db.test.ts"), "throw new Error('arquivo de teste não pode ser importado');");
    expect([...(await loadRoutines(dir)).keys()]).toEqual(["fixture"]);
  });

  it("recusa arquivo sem rotina no export default e tipo repetido", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-routines-"));
    await writeFile(join(dir, "broken.ts"), "export default { kind: 'broken' };");
    await expect(loadRoutines(dir)).rejects.toThrow(/broken\.ts: o export default não é uma Routine/);
    await rm(join(dir, "broken.ts"));
    await writeFile(join(dir, "first.ts"), fixtureRoutine("same"));
    await writeFile(join(dir, "second.ts"), fixtureRoutine("same"));
    await expect(loadRoutines(dir)).rejects.toThrow(/second\.ts: tipo de rotina repetido: same/);
  });
});
