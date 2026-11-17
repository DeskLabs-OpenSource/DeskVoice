import { SPOKEN_LANGUAGES } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
import type { CallTransport } from "./transport";
import { playUnavailable, unavailableNotice } from "./unavailable";
import { voicemailNotice } from "./voicemail";

describe("a fala gravada de indisponível", () => {
  it.each(SPOKEN_LANGUAGES)("existe em %s, como PCM16 mono a 8 kHz, com a duração de uma frase, e não é o aviso da caixa postal", async (language) => {
    const pcm = await unavailableNotice(language);
    const seconds = pcm.length / 2 / 8000;
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(10);
    // Não é silêncio: a frase está lá.
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    expect(peak).toBeGreaterThan(5000);
    expect(pcm.equals(await voicemailNotice(language))).toBe(false);
  });

  it("toca e desliga; se a fala não puder ser lida, desliga do mesmo jeito, sem lançar", async () => {
    const actions: string[] = [];
    const transport = {
      sendAudio: (pcm: Buffer) => void actions.push(`audio ${pcm.length}`),
      hangup: async () => void actions.push("hangup"),
      close: async () => void actions.push("close"),
    } as unknown as CallTransport;
    const errors: string[] = [];
    const log = (level: string, message: string) => void (level === "error" && errors.push(message));

    await playUnavailable(transport, { callId: "c1", language: "es" }, log);
    expect(actions).toEqual([`audio ${(await unavailableNotice("es")).length}`, "hangup"]);

    actions.length = 0;
    await playUnavailable(transport, { callId: "c2", language: "xx" as never }, log);
    expect(actions).toEqual(["hangup"]);
    expect(errors).toEqual(["could not play the unavailable notice; hanging up"]);
  });
});
