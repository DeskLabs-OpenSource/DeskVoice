import { readFile } from "node:fs/promises";
import type { SpokenLanguage } from "@deskvoice/core";
import { SAMPLE_RATE } from "./transport";

/**
 * Uma fala já gravada, como PCM16 mono a 8 kHz, a forma em que a linha toca: o aviso da caixa
 * postal (`voicemail.ts`) e a fala de indisponível da organização suspensa (`unavailable.ts`). Os
 * arquivos são gerados por script versionado (`scripts/aviso-da-caixa-postal/gerar.sh`,
 * `scripts/fala-de-indisponivel/gerar.sh`); um arquivo em outro formato é recusado aqui, e não
 * tocado como ruído.
 */
export async function readRecordedSpeech(dir: URL, label: string, language: SpokenLanguage): Promise<Buffer> {
  const wav = await readFile(new URL(`${language}.wav`, dir));
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${label} ${language} is not a WAV file`);
  let format: { pcm: boolean; channels: number; rate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") format = { pcm: wav.readUInt16LE(body) === 1, channels: wav.readUInt16LE(body + 2), rate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) };
    if (id === "data") {
      if (!format || !format.pcm || format.channels !== 1 || format.rate !== SAMPLE_RATE || format.bits !== 16) throw new Error(`${label} ${language} is not PCM16 mono at ${SAMPLE_RATE} Hz`);
      return wav.subarray(body, Math.min(wav.length, body + size));
    }
    at = body + size + (size % 2);
  }
  throw new Error(`${label} ${language} has no audio`);
}
