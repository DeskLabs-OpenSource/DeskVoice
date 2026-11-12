import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { VoiceEngine } from "./types";

const DEFAULT_DIR = fileURLToPath(new URL("./engines", import.meta.url));

function isVoiceEngine(value: unknown): value is VoiceEngine {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof VoiceEngine, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.pricing === "object" &&
    typeof candidate.connect === "function" &&
    typeof candidate.checkKey === "function"
  );
}

/**
 * Descobre os motores pela pasta: cada arquivo exporta um `VoiceEngine` como `default`.
 * Não existe lista central; motor novo é só um arquivo novo.
 */
export async function loadEngines(dir: string = DEFAULT_DIR): Promise<Map<string, VoiceEngine>> {
  const files = (await readdir(dir)).filter((name) => /\.(ts|js)$/.test(name) && !/\.(test|d)\.ts$/.test(name)).sort();
  const engines = new Map<string, VoiceEngine>();
  for (const file of files) {
    const module: { default?: unknown } = await import(pathToFileURL(join(dir, file)).href);
    const engine = module.default;
    // Falha alta: um motor que some da lista em silêncio só seria notado numa ligação muda.
    if (!isVoiceEngine(engine)) throw new Error(`${file}: o export default não é um VoiceEngine`);
    if (engines.has(engine.id)) throw new Error(`${file}: id de motor repetido: ${engine.id}`);
    engines.set(engine.id, engine);
  }
  return engines;
}
