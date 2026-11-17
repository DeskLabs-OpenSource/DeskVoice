import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBrains } from "./brain-load";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const fixtureBrain = (id: string): string => `
export default {
  id: ${JSON.stringify(id)},
  label: "Cérebro de fixture",
  keyUrl: "https://example.invalid/keys",
  async listModels() { return { ok: true, models: [] }; },
  async completeJson() { return { ok: false, failure: "unreachable", status: null, model: "m", usage: {} }; },
};
`;

describe("loadBrains", () => {
  it("descobre os cérebros da pasta", async () => {
    const brains = await loadBrains();
    expect([...brains.keys()].sort()).toEqual(["anthropic", "deepseek", "gemini", "openai", "openrouter"]);
    for (const brain of brains.values()) expect(brain.keyUrl).toMatch(/^https:\/\//);
  });

  it("`chat` é opcional: OpenAI, OpenRouter, DeepSeek e Anthropic conversam; Gemini continua válido sem", async () => {
    const brains = await loadBrains();
    const talking = [...brains.values()].filter((brain) => typeof brain.chat === "function").map((brain) => brain.id);
    expect(talking.sort()).toEqual(["anthropic", "deepseek", "openai", "openrouter"]);
    expect(brains.get("gemini")?.chat).toBeUndefined();
  });

  it("recusa `chat` que não é função", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-brains-"));
    await writeFile(join(dir, "odd.ts"), fixtureBrain("odd").replace("export default {", 'export default { chat: "sim",'));
    await expect(loadBrains(dir)).rejects.toThrow(/odd\.ts/);
  });

  it("cérebro novo é só um arquivo novo na pasta; arquivo de teste é ignorado", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-brains-"));
    await writeFile(join(dir, "fixture.ts"), fixtureBrain("fixture"));
    await writeFile(join(dir, "fixture.test.ts"), "throw new Error('arquivo de teste não pode ser importado');");
    const brains = await loadBrains(dir);
    expect([...brains.keys()]).toEqual(["fixture"]);
    expect(brains.get("fixture")?.label).toBe("Cérebro de fixture");
  });

  it("recusa arquivo sem cérebro no export default e id repetido", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-brains-"));
    await writeFile(join(dir, "broken.ts"), "export default { id: 'broken', label: 'x' };");
    await expect(loadBrains(dir)).rejects.toThrow(/broken\.ts/);
    await rm(join(dir, "broken.ts"));
    await writeFile(join(dir, "first.ts"), fixtureBrain("same"));
    await writeFile(join(dir, "second.ts"), fixtureBrain("same"));
    await expect(loadBrains(dir)).rejects.toThrow(/repetido/);
  });
});
