/**
 * Transcrição de áudio já gravado — a segunda passada que o motor em tempo real não faz.
 *
 * O motor transcreve enquanto conversa; quando não há conversa (recado, gravação antiga, chamada
 * sem transcrição), o áudio fica sem texto e não existe caminho para recuperá-lo. Esta função é
 * esse caminho: recebe o `.wav` e devolve o texto pelo provedor que já atende a organização.
 *
 * Nunca loga áudio nem texto: o que sai daqui é dado de titular de terceiro.
 */

export type TranscriptionFailure = "provider" | "empty";

export class TranscriptionError extends Error {
  constructor(
    readonly reason: TranscriptionFailure,
    readonly status?: number,
  ) {
    super(reason === "empty" ? "o provedor não devolveu texto" : `o provedor recusou a transcrição${status ? ` (HTTP ${status})` : ""}`);
    this.name = "TranscriptionError";
  }
}

export interface TranscriptionRequest {
  /** Id do motor do agente (`openai-realtime`, `gemini-live`). */
  engine: string;
  apiKey: string;
  audio: Uint8Array;
  fetch: typeof fetch;
  /** `audio/wav` por padrão: é o que a gravação produz. */
  mime?: string;
  model?: string;
  /** Troca do endereço do provedor; sem ele, o padrão do motor. */
  baseUrl?: string;
}

export interface Transcription {
  text: string;
  engine: string;
  model: string;
}

const OPENAI_URL = "https://api.openai.com/v1";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_MODEL = "whisper-1";
const GEMINI_MODEL = "gemini-2.5-flash";

/** Instrução literal: transcrever, não resumir. Resumo é outra rotina, com outro dono. */
const PROMPT = "Transcreva o áudio a seguir, literalmente, sem resumir, sem comentar e sem traduzir. Se não houver fala, responda com nada.";

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

async function openai(request: TranscriptionRequest): Promise<Transcription> {
  const model = request.model ?? OPENAI_MODEL;
  // Cópia com buffer próprio: `Blob` não aceita o tipo genérico de `Uint8Array` que chega aqui.
  const bytes = new Uint8Array(request.audio.byteLength);
  bytes.set(request.audio);
  const form = new FormData();
  form.set("model", model);
  form.set("file", new Blob([bytes], { type: request.mime ?? "audio/wav" }), "gravacao.wav");
  const response = await request.fetch(`${request.baseUrl ?? OPENAI_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${request.apiKey}` },
    body: form,
  });
  if (!response.ok) throw new TranscriptionError("provider", response.status);
  const body = (await response.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text === "") throw new TranscriptionError("empty");
  return { text, engine: request.engine, model };
}

async function gemini(request: TranscriptionRequest): Promise<Transcription> {
  const model = request.model ?? GEMINI_MODEL;
  const url = `${request.baseUrl ?? GEMINI_URL}/models/${model}:generateContent?key=${encodeURIComponent(request.apiKey)}`;
  const response = await request.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: request.mime ?? "audio/wav", data: base64(request.audio) } }, { text: PROMPT }] }],
    }),
  });
  if (!response.ok) throw new TranscriptionError("provider", response.status);
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (text === "") throw new TranscriptionError("empty");
  return { text, engine: request.engine, model };
}

/** Provedores que sabem transcrever áudio gravado. Motor desconhecido é erro alto, não silêncio. */
export const TRANSCRIBING_ENGINES = ["openai-realtime", "gemini-live"] as const;

export function canTranscribe(engine: string): boolean {
  return (TRANSCRIBING_ENGINES as readonly string[]).includes(engine);
}

export async function transcribeRecording(request: TranscriptionRequest): Promise<Transcription> {
  if (request.engine === "openai-realtime") return openai(request);
  if (request.engine === "gemini-live") return gemini(request);
  throw new TranscriptionError("provider");
}
