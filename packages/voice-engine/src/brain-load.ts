import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Brain } from "./brain";

const DEFAULT_DIR = fileURLToPath(new URL("./brains", import.meta.url));

function isBrain(value: unknown): value is Brain {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof Brain, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.keyUrl === "string" &&
    typeof candidate.listModels === "function" &&
    typeof candidate.completeJson === "function" &&
    // `chat` é opcional (R5, fatia 2): ausente vale; presente, tem de ser função.
    (candidate.chat === undefined || typeof candidate.chat === "function")
  );
}

/**
 * Descobre os cérebros pela pasta: cada arquivo exporta um `Brain` como `default`.
 * Não existe lista central; provedor novo é só um arquivo novo.
 */
export async function loadBrains(dir: string = DEFAULT_DIR): Promise<Map<string, Brain>> {
  const files = (await readdir(dir)).filter((name) => /\.(ts|js)$/.test(name) && !/\.(test|d)\.ts$/.test(name)).sort();
  const brains = new Map<string, Brain>();
  for (const file of files) {
    const module: { default?: unknown } = await import(pathToFileURL(join(dir, file)).href);
    const brain = module.default;
    // Falha alta: um provedor que some da lista em silêncio só seria notado na tela de cérebros vazia.
    if (!isBrain(brain)) throw new Error(`${file}: o export default não é um Brain`);
    if (brains.has(brain.id)) throw new Error(`${file}: id de cérebro repetido: ${brain.id}`);
    brains.set(brain.id, brain);
  }
  return brains;
}
