import { describe, expect, it } from "vitest";
import { inKeyOrder, personExitOf } from "./ivr";
import { parseRecordedSpeech } from "./recorded-speech";

/** Um WAV mínimo, com o formato pedido, e um bloco extra antes do áudio (como o `LIST` de muitos editores). */
function wav(options: { format?: number; channels?: number; rate?: number; bits?: number; data?: Buffer; extra?: boolean } = {}): Buffer {
  const data = options.data ?? Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(options.format ?? 1, 8);
  fmt.writeUInt16LE(options.channels ?? 1, 10);
  fmt.writeUInt32LE(options.rate ?? 8000, 12);
  fmt.writeUInt32LE((options.rate ?? 8000) * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(options.bits ?? 16, 22);
  const extra = options.extra ? Buffer.concat([Buffer.from("LIST", "ascii"), Buffer.from([3, 0, 0, 0]), Buffer.from("abc\0", "ascii")]) : Buffer.alloc(0);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), fmt, extra, dataHeader, data]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

describe("parseRecordedSpeech: o parser único de fala gravada", () => {
  it("devolve o PCM16 mono a 8 kHz de dentro do WAV, pulando os blocos que não são áudio", () => {
    expect(parseRecordedSpeech(wav(), "anúncio")).toEqual(Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]));
    expect(parseRecordedSpeech(wav({ extra: true }), "anúncio")).toEqual(Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]));
  });

  it("recusa, com o formato esperado na mensagem, o que não é PCM16 mono a 8 kHz", () => {
    for (const other of [{ rate: 44_100 }, { channels: 2 }, { bits: 8 }, { format: 3 }]) {
      expect(() => parseRecordedSpeech(wav(other), "anúncio"), JSON.stringify(other)).toThrow("anúncio is not PCM16 mono at 8000 Hz");
    }
  });

  it("recusa o que não é WAV e o WAV sem áudio", () => {
    expect(() => parseRecordedSpeech(Buffer.from("ID3\x04 isto é um MP3"), "anúncio")).toThrow("anúncio is not a WAV file");
    expect(() => parseRecordedSpeech(Buffer.alloc(4), "anúncio")).toThrow("anúncio is not a WAV file");
    expect(() => parseRecordedSpeech(wav().subarray(0, 36), "anúncio")).toThrow("anúncio has no audio");
  });
});

describe("a saída para uma pessoa", () => {
  it("é a primeira opção `transfer` na ordem do teclado, em que o 0 vem depois do 9", () => {
    const options = [
      { digit: "#", action: "transfer" },
      { digit: "0", action: "transfer" },
      { digit: "9", action: "transfer" },
      { digit: "1", action: "agent" },
    ];
    expect(inKeyOrder(options).map((option) => option.digit)).toEqual(["1", "9", "0", "#"]);
    expect(personExitOf(options)?.digit).toBe("9");
    expect(personExitOf([{ digit: "1", action: "agent" }])).toBeUndefined();
  });
});
