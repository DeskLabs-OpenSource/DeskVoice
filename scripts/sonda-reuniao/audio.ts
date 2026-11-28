// O áudio da sonda: ler e escrever WAV PCM16, descer de 48 kHz para os 8 kHz que a voz recebe e
// medir o que chegou. É só aritmética, sem navegador, para o teste provar sem rede.
import { resample } from "../../packages/voice-engine/src/resample";

export interface Pcm {
  sampleRate: number;
  /** Mono. Um WAV estéreo é misturado ao ler. */
  samples: Int16Array;
}

/** Lê um WAV PCM de 16 bits (mono ou estéreo). Qualquer outro formato é recusado com o motivo. */
export function readWav(buffer: Buffer): Pcm {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("não é um WAV (falta RIFF/WAVE)");
  let offset = 12;
  let format: { channels: number; sampleRate: number; bits: number; code: number } | undefined;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = { code: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2), sampleRate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!format) throw new Error("WAV sem bloco fmt antes do data");
      if (format.code !== 1 || format.bits !== 16) throw new Error(`WAV precisa ser PCM de 16 bits (veio código ${format.code}, ${format.bits} bits)`);
      const frames = Math.floor(Math.min(size, buffer.length - body) / (2 * format.channels));
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i += 1) {
        let sum = 0;
        for (let c = 0; c < format.channels; c += 1) sum += buffer.readInt16LE(body + (i * format.channels + c) * 2);
        samples[i] = Math.round(sum / format.channels);
      }
      return { sampleRate: format.sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV sem bloco data");
}

export function writeWav({ sampleRate, samples }: Pcm): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write("WAVEfmt ", 8, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) out.writeInt16LE(samples[i]!, 44 + i * 2);
  return out;
}

/**
 * Desce a taxa com o mesmo passa-baixa que a voz usa (`resample`, `packages/voice-engine`), para o
 * ouvido da sonda ser o ouvido que a voz teria. Uma média simples por janela deixava um tom de
 * 6 kHz voltar como 2 kHz, só 10 dB abaixo (o teste "some na descida" pegou).
 */
export function downsample({ sampleRate, samples }: Pcm, to: number): Pcm {
  if (to >= sampleRate) return { sampleRate, samples: samples.slice() };
  const out = resample(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength), sampleRate, to);
  return { sampleRate: to, samples: new Int16Array(out.buffer, out.byteOffset, out.byteLength / 2).slice() };
}

/** Corta ou completa com silêncio até `seconds`. */
export function fitTo({ sampleRate, samples }: Pcm, seconds: number): Pcm {
  const out = new Int16Array(Math.round(sampleRate * seconds));
  out.set(samples.subarray(0, out.length));
  return { sampleRate, samples: out };
}

export function concat(parts: Pcm[]): Pcm {
  const rate = parts[0]?.sampleRate ?? 8000;
  if (parts.some((p) => p.sampleRate !== rate)) throw new Error("os WAVs da fala precisam ter a mesma taxa");
  const out = new Int16Array(parts.reduce((n, p) => n + p.samples.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part.samples, at);
    at += part.samples.length;
  }
  return { sampleRate: rate, samples: out };
}

export interface AudioStats {
  seconds: number;
  /** Nível médio do arquivo inteiro, em dBFS (−∞ vira null: silêncio digital). */
  rmsDbfs: number | null;
  peakDbfs: number | null;
  /** Fração dos quadros de 20 ms acima de −45 dBFS: quanto do tempo havia som. */
  activeFraction: number;
  /** Fração das amostras no limite (±32 767): som estourado. */
  clippedFraction: number;
}

const ACTIVE_DBFS = -45;
const dbfs = (value: number): number | null => (value > 0 ? Math.round(20 * Math.log10(value / 32768) * 10) / 10 : null);

/** O que dá para medir sem ouvido humano. Não diz se a fala é inteligível: isso é o ouvido de quem escuta o WAV. */
export function audioStats({ sampleRate, samples }: Pcm): AudioStats {
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  let squares = 0;
  let peak = 0;
  let clipped = 0;
  let frames = 0;
  let active = 0;
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let frameSquares = 0;
    for (let i = start; i < end; i += 1) {
      const s = samples[i]!;
      frameSquares += s * s;
      peak = Math.max(peak, Math.abs(s));
      if (s >= 32767 || s <= -32767) clipped += 1;
    }
    squares += frameSquares;
    frames += 1;
    const frameDb = dbfs(Math.sqrt(frameSquares / (end - start)));
    if (frameDb !== null && frameDb > ACTIVE_DBFS) active += 1;
  }
  const n = samples.length || 1;
  return {
    seconds: Math.round((samples.length / sampleRate) * 100) / 100,
    rmsDbfs: dbfs(Math.sqrt(squares / n)),
    peakDbfs: dbfs(peak),
    activeFraction: frames ? Math.round((active / frames) * 1000) / 1000 : 0,
    clippedFraction: Math.round((clipped / n) * 100000) / 100000,
  };
}
