import { VOICEMAIL_LANGUAGES } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
import { voicemailNotice } from "./voicemail";

describe("o aviso gravado da caixa postal", () => {
  it.each(VOICEMAIL_LANGUAGES)("existe em %s, como PCM16 mono a 8 kHz, com a duração de uma frase", async (language) => {
    const pcm = await voicemailNotice(language);
    const seconds = pcm.length / 2 / 8000;
    expect(seconds).toBeGreaterThan(3);
    expect(seconds).toBeLessThan(10);
    // Não é silêncio: a frase está lá.
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    expect(peak).toBeGreaterThan(5000);
  });
});
