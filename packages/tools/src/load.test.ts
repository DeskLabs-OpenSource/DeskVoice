import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTools } from "./load";
import { toSpec } from "./to-spec";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const fixtureTool = (name: string): string => `
export default {
  name: ${JSON.stringify(name)},
  description: "Ferramenta de fixture",
  parameters: { type: "object", properties: {} },
  inputSchema: { safeParse: (value) => ({ success: true, data: value }) },
  async run() { return { ok: true, message: "fixture" }; },
};
`;

// Estes testes importam a árvore inteira do pacote a frio; em máquina carregada isso passa dos 5 s padrão.
describe("loadTools", { timeout: 30_000 }, () => {
  it("descobre as sete ferramentas da fundação, cada uma com o nome do próprio arquivo", async () => {
    const tools = await loadTools();
    expect([...tools.keys()].sort()).toEqual(["call_webhook", "create_task", "end_call", "notify_human", "request_approval", "send_dtmf", "send_whatsapp", "transfer_to_human"]);
  });

  it("toda ferramenta entrega ao motor um JSON Schema de objeto e uma descrição que diz quando NÃO usar", async () => {
    for (const tool of (await loadTools()).values()) {
      const spec = toSpec(tool);
      expect(spec).toEqual({ name: tool.name, description: tool.description, parameters: tool.parameters });
      expect(spec.parameters).toMatchObject({ type: "object" });
      expect(spec.parameters).not.toHaveProperty("$schema");
      expect(spec.description, tool.name).toMatch(/NÃO use/);
    }
  });

  it("campo opcional ou com padrão não é obrigatório para o modelo", async () => {
    const approval = (await loadTools()).get("request_approval");
    expect(approval?.parameters.required).toEqual(["question", "context"]);
    // O que vale sem resposta é do operador: o modelo nem enxerga esse campo.
    expect(Object.keys(approval?.parameters.properties as object)).toEqual(["question", "context", "timeout_seconds"]);
    expect((await loadTools()).get("notify_human")?.parameters.required).toEqual(["message"]);
  });

  it("ferramenta nova é só um arquivo novo na pasta; arquivo de teste é ignorado", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-tools-"));
    await writeFile(join(dir, "fixture.ts"), fixtureTool("fixture"));
    await writeFile(join(dir, "fixture.test.ts"), "throw new Error('arquivo de teste não pode ser importado');");
    await writeFile(join(dir, "fixture.db.test.ts"), "throw new Error('arquivo de teste não pode ser importado');");
    const tools = await loadTools(dir);
    expect([...tools.keys()]).toEqual(["fixture"]);
    expect(await tools.get("fixture")?.run({}, {} as never)).toEqual({ ok: true, message: "fixture" });
  });

  it("recusa arquivo sem ferramenta no export default e nome repetido", async () => {
    dir = await mkdtemp(join(tmpdir(), "deskvoice-tools-"));
    await writeFile(join(dir, "broken.ts"), "export default { name: 'broken' };");
    await expect(loadTools(dir)).rejects.toThrow(/broken\.ts: o export default não é um Tool/);
    await rm(join(dir, "broken.ts"));
    await writeFile(join(dir, "helper.ts"), "export const notATool = 1;");
    await expect(loadTools(dir)).rejects.toThrow(/helper\.ts/);
    await rm(join(dir, "helper.ts"));
    await writeFile(join(dir, "first.ts"), fixtureTool("same"));
    await writeFile(join(dir, "second.ts"), fixtureTool("same"));
    await expect(loadTools(dir)).rejects.toThrow(/second\.ts: nome de ferramenta repetido: same/);
  });
});
