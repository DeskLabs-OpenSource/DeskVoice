import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Tool } from "./types";

const DEFAULT_DIR = fileURLToPath(new URL("./tools", import.meta.url));

function isTool(value: unknown): value is Tool {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof Tool, unknown>>;
  return (
    typeof candidate.name === "string" &&
    candidate.name !== "" &&
    typeof candidate.description === "string" &&
    typeof candidate.parameters === "object" &&
    candidate.parameters !== null &&
    typeof (candidate.inputSchema as { safeParse?: unknown } | undefined)?.safeParse === "function" &&
    typeof candidate.run === "function"
  );
}

/**
 * Descobre as ferramentas pela pasta: cada arquivo exporta um `Tool` como `default`.
 * Não existe lista central; ferramenta nova é só um arquivo novo.
 */
export async function loadTools(dir: string = DEFAULT_DIR): Promise<Map<string, Tool>> {
  const files = (await readdir(dir)).filter((name) => /\.(ts|js)$/.test(name) && !/\.(test|d)\.ts$/.test(name)).sort();
  const tools = new Map<string, Tool>();
  for (const file of files) {
    const module: { default?: unknown } = await import(pathToFileURL(join(dir, file)).href);
    const tool = module.default;
    // Falha alta: ferramenta que some em silêncio só seria notada com o agente sem saber agir numa ligação.
    if (!isTool(tool)) throw new Error(`${file}: o export default não é um Tool`);
    if (tools.has(tool.name)) throw new Error(`${file}: nome de ferramenta repetido: ${tool.name}`);
    tools.set(tool.name, tool);
  }
  return tools;
}
