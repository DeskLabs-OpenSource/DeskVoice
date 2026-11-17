import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDecisionModels, loadEngines, loadSynthesizers } from "./load";

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

describe("loadDecisionModels", () => {
  it("descobre o Jev e o simulado pela pasta deciders/; só o simulado não tem chave", async () => {
    const models = await loadDecisionModels();
    expect([...models.keys()].sort()).toEqual(["jev", "simulated"]);
    expect(models.get("simulated")?.keyless).toBe(true);
    expect(models.get("jev")?.keyless).toBeFalsy();
    for (const model of models.values()) expect(model.pricing.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("recusa arquivo sem modelo no export default", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-deciders-"));
    await writeFile(join(dir, "broken.ts"), "export default { id: 'broken' };");
    await expect(loadDecisionModels(dir)).rejects.toThrow(/broken\.ts/);
  });
});

const fixtureSynthesizer = (id: string): string => `
export default {
  id: ${JSON.stringify(id)},
  label: "Voz de fixture",
  defaultModel: "m",
  pricing: { centsPerThousandCharacters: 1, checkedOn: "2026-11-17", source: "fixture" },
  pricingOf() { return undefined; },
  async listVoices() { return { ok: true, voices: [] }; },
  async checkKey() { return { result: "not_needed" }; },
  async speak() { throw new Error("fixture"); },
};
`;

describe("loadSynthesizers", () => {
  it("descobre a ElevenLabs e a simulada pela pasta synthesizers/; só a simulada não tem chave", async () => {
    const synthesizers = await loadSynthesizers();
    expect([...synthesizers.keys()].sort()).toEqual(["elevenlabs", "simulated"]);
    expect(synthesizers.get("simulated")?.keyless).toBe(true);
    expect(synthesizers.get("elevenlabs")?.keyless).toBeFalsy();
    for (const synthesizer of synthesizers.values()) {
      expect(synthesizer.pricing.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(synthesizer.pricing.source).not.toBe("");
      expect(synthesizer.pricingOf(synthesizer.defaultModel)).toEqual(synthesizer.pricing);
    }
  });

  it("voz nova é só um arquivo novo; recusa arquivo sem voz e id repetido", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-synthesizers-"));
    await writeFile(join(dir, "fixture.ts"), fixtureSynthesizer("fixture"));
    await writeFile(join(dir, "fixture.test.ts"), "throw new Error('arquivo de teste não pode ser importado');");
    expect([...(await loadSynthesizers(dir)).keys()]).toEqual(["fixture"]);
    await writeFile(join(dir, "broken.ts"), "export default { id: 'broken' };");
    await expect(loadSynthesizers(dir)).rejects.toThrow(/broken\.ts/);
    await rm(join(dir, "broken.ts"));
    await writeFile(join(dir, "second.ts"), fixtureSynthesizer("fixture"));
    await expect(loadSynthesizers(dir)).rejects.toThrow(/repetido/);
  });
});
