import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Routine } from "./types";

const DEFAULT_DIR = fileURLToPath(new URL("./routines", import.meta.url));

function isRoutine(value: unknown): value is Routine {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof Routine, unknown>>;
  return typeof candidate.kind === "string" && candidate.kind !== "" && typeof candidate.run === "function" && (candidate.seed === undefined || typeof candidate.seed === "function");
}

/**
 * Descobre as rotinas pela pasta: cada arquivo exporta uma `Routine` como `default`.
 * Não existe lista central; rotina nova é só um arquivo novo.
 */
export async function loadRoutines(dir: string = DEFAULT_DIR): Promise<Map<string, Routine>> {
  const files = (await readdir(dir)).filter((name) => /\.(ts|js)$/.test(name) && !/\.(test|d)\.ts$/.test(name)).sort();
  const routines = new Map<string, Routine>();
  for (const file of files) {
    const module: { default?: unknown } = await import(pathToFileURL(join(dir, file)).href);
    const routine = module.default;
    // Falha alta: rotina que some em silêncio só seria notada com tarefas falhando na fila.
    if (!isRoutine(routine)) throw new Error(`${file}: o export default não é uma Routine`);
    if (routines.has(routine.kind)) throw new Error(`${file}: tipo de rotina repetido: ${routine.kind}`);
    routines.set(routine.kind, routine);
  }
  return routines;
}
