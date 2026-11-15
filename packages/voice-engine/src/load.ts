import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { StreamingTranscriber, VoiceEngine } from "./types";

const DEFAULT_DIR = fileURLToPath(new URL("./engines", import.meta.url));
const DEFAULT_TRANSCRIBERS_DIR = fileURLToPath(new URL("./transcribers", import.meta.url));

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

function isStreamingTranscriber(value: unknown): value is StreamingTranscriber {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof StreamingTranscriber, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.pricing === "object" &&
    typeof candidate.maxVocabulary === "number" &&
    typeof candidate.connect === "function"
  );
}

/** Importa cada arquivo da pasta e confere o export `default`. Falha alta: peça que some em silêncio só seria notada numa ligação. */
async function loadPieces<T extends { id: string }>(dir: string, is: (value: unknown) => value is T, what: string, noun: string): Promise<Map<string, T>> {
  const files = (await readdir(dir)).filter((name) => /\.(ts|js)$/.test(name) && !/\.(test|d)\.ts$/.test(name)).sort();
  const pieces = new Map<string, T>();
  for (const file of files) {
    const module: { default?: unknown } = await import(pathToFileURL(join(dir, file)).href);
    const piece = module.default;
    if (!is(piece)) throw new Error(`${file}: o export default não é um ${what}`);
    if (pieces.has(piece.id)) throw new Error(`${file}: id de ${noun} repetido: ${piece.id}`);
    pieces.set(piece.id, piece);
  }
  return pieces;
}

/**
 * Descobre os motores pela pasta: cada arquivo exporta um `VoiceEngine` como `default`.
 * Não existe lista central; motor novo é só um arquivo novo.
 */
export function loadEngines(dir: string = DEFAULT_DIR): Promise<Map<string, VoiceEngine>> {
  return loadPieces(dir, isVoiceEngine, "VoiceEngine", "motor");
}

/**
 * Descobre as peças de transcrição em streaming pela pasta `transcribers/`, como os motores: cada
 * arquivo exporta um `StreamingTranscriber` como `default`, e não existe lista central.
 */
export function loadTranscribers(dir: string = DEFAULT_TRANSCRIBERS_DIR): Promise<Map<string, StreamingTranscriber>> {
  return loadPieces(dir, isStreamingTranscriber, "StreamingTranscriber", "transcritor");
}
