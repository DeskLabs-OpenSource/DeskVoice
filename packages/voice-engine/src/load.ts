import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DecisionModel, SpeechSynthesizer, StreamingTranscriber, VoiceEngine } from "./types";

const DEFAULT_DIR = fileURLToPath(new URL("./engines", import.meta.url));
const DEFAULT_TRANSCRIBERS_DIR = fileURLToPath(new URL("./transcribers", import.meta.url));
const DECIDERS_DIR = fileURLToPath(new URL("./deciders", import.meta.url));
const SYNTHESIZERS_DIR = fileURLToPath(new URL("./synthesizers", import.meta.url));

const pieceFiles = async (dir: string): Promise<string[]> => (await readdir(dir)).filter((name) => /\.(ts|js)$/.test(name) && !/\.(test|d)\.ts$/.test(name)).sort();

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
  const files = await pieceFiles(dir);
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
export async function loadEngines(dir: string = DEFAULT_DIR): Promise<Map<string, VoiceEngine>> {
  const files = await pieceFiles(dir);
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

/**
 * Descobre as peças de transcrição em streaming pela pasta `transcribers/`, como os motores: cada
 * arquivo exporta um `StreamingTranscriber` como `default`, e não existe lista central.
 */
export async function loadTranscribers(dir: string = DEFAULT_TRANSCRIBERS_DIR): Promise<Map<string, StreamingTranscriber>> {
  const transcribers = await loadPieces(dir, isStreamingTranscriber, "StreamingTranscriber", "transcritor");
  // `keySetting` só pode apontar para a chave de um motor (`engine.<id>.api_key`): uma peça que
  // lesse qualquer nome de settings levaria para o fornecedor um valor que não foi gravado como chave dele.
  for (const transcriber of transcribers.values()) {
    if (transcriber.keySetting !== undefined && !ENGINE_KEY_SETTING.test(transcriber.keySetting)) {
      throw new Error(`transcritor ${transcriber.id}: keySetting fora das chaves de motor (engine.<id>.api_key): ${transcriber.keySetting}`);
    }
  }
  return transcribers;
}

/** O único formato que `StreamingTranscriber.keySetting` aceita: a chave de um motor. */
const ENGINE_KEY_SETTING = /^engine\.[a-z0-9-]+\.api_key$/;

function isDecisionModel(value: unknown): value is DecisionModel {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof DecisionModel, unknown>>;
  return typeof candidate.id === "string" && typeof candidate.label === "string" && typeof candidate.pricing === "object" && typeof candidate.decide === "function";
}

/**
 * Descobre os modelos de decisão pela pasta, como os motores: cada arquivo de `deciders/` exporta um
 * `DecisionModel` como `default`. Modelo novo é só um arquivo novo.
 */
export async function loadDecisionModels(dir: string = DECIDERS_DIR): Promise<Map<string, DecisionModel>> {
  const models = new Map<string, DecisionModel>();
  for (const file of await pieceFiles(dir)) {
    const module: { default?: unknown } = await import(pathToFileURL(join(dir, file)).href);
    const model = module.default;
    // Falha alta, como nos motores: um modelo que some em silêncio deixaria o filtro desligado sem aviso.
    if (!isDecisionModel(model)) throw new Error(`${file}: o export default não é um DecisionModel`);
    if (models.has(model.id)) throw new Error(`${file}: id de modelo de decisão repetido: ${model.id}`);
    models.set(model.id, model);
  }
  return models;
}

function isSpeechSynthesizer(value: unknown): value is SpeechSynthesizer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof SpeechSynthesizer, unknown>>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.defaultModel === "string" &&
    typeof candidate.pricing === "object" &&
    typeof candidate.pricingOf === "function" &&
    typeof candidate.listVoices === "function" &&
    typeof candidate.checkKey === "function" &&
    typeof candidate.speak === "function"
  );
}

/**
 * Descobre as vozes do pipeline pela pasta, como os motores: cada arquivo de `synthesizers/`
 * exporta um `SpeechSynthesizer` como `default`. Voz nova é só um arquivo novo.
 */
export async function loadSynthesizers(dir: string = SYNTHESIZERS_DIR): Promise<Map<string, SpeechSynthesizer>> {
  const synthesizers = new Map<string, SpeechSynthesizer>();
  for (const file of await pieceFiles(dir)) {
    const module: { default?: unknown } = await import(pathToFileURL(join(dir, file)).href);
    const synthesizer = module.default;
    // Falha alta, como nos motores: uma voz que some em silêncio só seria notada numa ligação muda.
    if (!isSpeechSynthesizer(synthesizer)) throw new Error(`${file}: o export default não é um SpeechSynthesizer`);
    if (synthesizers.has(synthesizer.id)) throw new Error(`${file}: id de voz repetido: ${synthesizer.id}`);
    synthesizers.set(synthesizer.id, synthesizer);
  }
  return synthesizers;
}
