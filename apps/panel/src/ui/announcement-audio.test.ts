import { parseRecordedSpeech } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
import { pcm16Wav } from "./announcement-audio";

describe("o anúncio convertido no navegador", () => {
  it("sai num WAV que o parser estrito do servidor aceita, com as amostras em PCM16", () => {
    const wav = Buffer.from(pcm16Wav(new Float32Array([0, 1, -1, 0.5, 2])));
    const pcm = parseRecordedSpeech(wav, "anúncio");
    expect(pcm.length).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => pcm.readInt16LE(i * 2))).toEqual([0, 32767, -32768, 16383, 32767]);
  });
});
