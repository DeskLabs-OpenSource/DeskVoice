import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEngines } from "./load";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const fixtureEngine = (id: string): string => `
export default {
  id: ${JSON.stringify(id)},
  label: "Motor de fixture",
  pricing: { checkedOn: "2026-11-10", source: "fixture" },
  async connect() { throw new Error("fixture"); },
  async checkKey() { return { result: "not_needed" }; },
};
`;

describe("loadEngines", () => {
  it("descobre os três motores da fundação", async () => {
    const engines = await loadEngines();
    expect([...engines.keys()].sort()).toEqual(["gemini-live", "openai-realtime", "simulated"]);
    expect(engines.get("simulated")?.keyless).toBe(true);
    for (const engine of engines.values()) expect(engine.pricing.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("motor novo é só um arquivo novo na pasta; arquivo de teste é ignorado", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-engines-"));
    await writeFile(join(dir, "fixture.ts"), fixtureEngine("fixture"));
    await writeFile(join(dir, "fixture.test.ts"), "throw new Error('arquivo de teste não pode ser importado');");
    const engines = await loadEngines(dir);
    expect([...engines.keys()]).toEqual(["fixture"]);
    expect(engines.get("fixture")?.label).toBe("Motor de fixture");
  });

  it("recusa arquivo sem motor no export default e id repetido", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-engines-"));
    await writeFile(join(dir, "broken.ts"), "export default { id: 'broken' };");
    await expect(loadEngines(dir)).rejects.toThrow(/broken\.ts/);
    await rm(join(dir, "broken.ts"));
    await writeFile(join(dir, "first.ts"), fixtureEngine("same"));
    await writeFile(join(dir, "second.ts"), fixtureEngine("same"));
    await expect(loadEngines(dir)).rejects.toThrow(/repetido/);
  });
});
