import { describe, expect, it } from "vitest";
import { splitRecording } from "./transcription";

function wav(channels: number, samples: number[], extra?: Buffer): Uint8Array {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(8000, 12);
  fmt.writeUInt32LE(8000 * 2 * channels, 16);
  fmt.writeUInt16LE(2 * channels, 20);
  fmt.writeUInt16LE(16, 22);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0);
  dataHeader.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), fmt, ...(extra ? [extra] : []), dataHeader, data]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0);
  riff.writeUInt32LE(body.length, 4);
  return new Uint8Array(Buffer.concat([riff, body]));
}

const samplesOf = (side: Uint8Array | null): number[] => {
  if (!side) return [];
  const buffer = Buffer.from(side).subarray(44);
  return Array.from({ length: buffer.length / 2 }, (_, index) => buffer.readInt16LE(index * 2));
};

describe("splitRecording", () => {
  it("separa o canal esquerdo (quem ligou) do direito (agente), cada um em WAV mono", () => {
    const sides = splitRecording(wav(2, [1, -1, 2, -2, 3, -3]));
    expect(samplesOf(sides?.caller ?? null)).toEqual([1, 2, 3]);
    expect(samplesOf(sides?.agent ?? null)).toEqual([-1, -2, -3]);
    expect(Buffer.from(sides?.caller ?? []).readUInt16LE(22)).toBe(1);
    expect(sides?.sideBytes).toBe(44 + 6);
  });

  it("pula blocos que não são de áudio e devolve null para o lado só de silêncio digital", () => {
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([3, 0, 0, 0]), Buffer.from("abc"), Buffer.from([0])]);
    const sides = splitRecording(wav(2, [5, 0, 6, 0], list));
    expect(samplesOf(sides?.caller ?? null)).toEqual([5, 6]);
    expect(sides?.agent).toBeNull();
  });

  it("recusa o que não é estéreo PCM16: sem os dois canais não se sabe quem falou", () => {
    expect(splitRecording(wav(1, [1, 2, 3]))).toBeNull();
    expect(splitRecording(new Uint8Array(Buffer.from("nada disso é um wav, nem de longe")))).toBeNull();
  });
});
