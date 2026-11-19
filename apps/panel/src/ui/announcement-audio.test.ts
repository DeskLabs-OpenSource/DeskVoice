import { IVR_MIN_PROMPT_MS, parseRecordedSpeech } from "@deskvoice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertAnnouncement, pcm16Wav } from "./announcement-audio";

describe("o anúncio convertido no navegador", () => {
  it("sai num WAV que o parser estrito do servidor aceita, com as amostras em PCM16", () => {
    const wav = Buffer.from(pcm16Wav(new Float32Array([0, 1, -1, 0.5, 2])));
    const pcm = parseRecordedSpeech(wav, "anúncio");
    expect(pcm.length).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => pcm.readInt16LE(i * 2))).toEqual([0, 32767, -32768, 16383, 32767]);
  });
});

/** U11: o navegador que "abre" o arquivo com duração zero (ou quase) não salva silêncio. */
describe("convertAnnouncement recusa o anúncio sem som", () => {
  const rendered: number[] = [];
  /** Um navegador falso: decodifica com a duração dada e "renderiza" um quadro de silêncio por amostra. */
  const browserDecoding = (duration: number): void => {
    vi.stubGlobal("window", {
      AudioContext: class {
        decodeAudioData = async (): Promise<unknown> => ({ duration });
        close = async (): Promise<void> => undefined;
      },
    });
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        constructor(
          _channels: number,
          private readonly frames: number,
        ) {}
        destination = {};
        createBufferSource = () => ({ connect: () => undefined, start: () => undefined, buffer: null });
        startRendering = async () => {
          rendered.push(this.frames);
          return { getChannelData: () => new Float32Array(this.frames) };
        };
      },
    );
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    rendered.length = 0;
  });

  it("0 s e 199 ms: `null`, sem converter nada", async () => {
    for (const duration of [0, 0.199, Number.NaN]) {
      browserDecoding(duration);
      expect(await convertAnnouncement(new Blob([new Uint8Array(8)])), String(duration)).toBeNull();
    }
    expect(rendered).toEqual([]);
  });

  it("200 ms ou mais: converte, com a duração", async () => {
    browserDecoding(IVR_MIN_PROMPT_MS / 1000);
    const converted = await convertAnnouncement(new Blob([new Uint8Array(8)]));
    expect(converted?.ms).toBe(200);
    expect(converted?.wav.size).toBe(44 + 1600 * 2);
  });
});
