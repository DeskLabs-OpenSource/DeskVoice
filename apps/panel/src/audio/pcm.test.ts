import { describe, expect, it } from "vitest";
import { FRAME_BYTES, VOICE_RATE, createFramer, createPcmDecoder, createResampler, floatToPcm16, pcm16ToFloat, rms } from "./pcm";

const sine = (hz: number, rate: number, seconds: number, amplitude = 0.8): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, n) => amplitude * Math.sin((2 * Math.PI * hz * n) / rate));
const chunks = (input: Float32Array, size: number): Float32Array[] => Array.from({ length: Math.ceil(input.length / size) }, (_, n) => input.subarray(n * size, (n + 1) * size));
const join = (parts: Float32Array[]): Float32Array => Float32Array.from(parts.flatMap((part) => [...part]));

describe("PCM16 <-> Float32", () => {
  it("clips what is out of range instead of wrapping around", () => {
    expect([...floatToPcm16(Float32Array.from([0, 1, -1, 1.7, -1.7, 0.5, Number.NaN]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384, 0]);
  });

  it("round-trips every 16-bit value", () => {
    const all = Int16Array.from({ length: 65536 }, (_, n) => n - 32768);
    expect(floatToPcm16(pcm16ToFloat(all))).toEqual(all);
  });
});

describe("createResampler", () => {
  it("48000 -> 8000 produces one sixth of the samples, however the input is split", () => {
    const input = sine(440, 48000, 1);
    const whole = createResampler(48000, VOICE_RATE)(input);
    expect(whole.length).toBe(8000);

    // Blocos de 128, que é o que a linha de áudio do navegador entrega.
    const resample = createResampler(48000, VOICE_RATE);
    const pieces = join(chunks(input, 128).map((block) => resample(block)));
    expect(pieces.length).toBe(8000);
    expect(Math.max(...pieces.map((sample, n) => Math.abs(sample - (whole[n] ?? 0))))).toBeLessThan(1e-6);
  });

  it("44100 -> 8000 keeps the duration", () => {
    const resample = createResampler(44100, VOICE_RATE);
    const total = chunks(sine(300, 44100, 2), 128).reduce((sum, block) => sum + resample(block).length, 0);
    expect(Math.abs(total - 16000)).toBeLessThanOrEqual(1);
  });

  it("keeps a voice-band tone and removes what would fold back as noise", () => {
    const settled = (output: Float32Array): Float32Array => output.subarray(400);
    const voice = rms(settled(createResampler(48000, VOICE_RATE)(sine(1000, 48000, 1))));
    const above = rms(settled(createResampler(48000, VOICE_RATE)(sine(6000, 48000, 1))));
    expect(voice).toBeGreaterThan(0.8 * rms(sine(1000, 48000, 1)));
    expect(above).toBeLessThan(0.01);
  });

  it("stays inside the 16-bit range even with a full-scale square wave", () => {
    const square = Float32Array.from({ length: 48000 }, (_, n) => (Math.floor(n / 60) % 2 === 0 ? 1 : -1));
    const pcm = floatToPcm16(createResampler(48000, VOICE_RATE)(square));
    expect(Math.max(...pcm)).toBeLessThanOrEqual(32767);
    expect(Math.min(...pcm)).toBeGreaterThanOrEqual(-32768);
    expect(pcm.every((sample) => Number.isInteger(sample))).toBe(true);
  });

  it("8000 -> 48000 multiplies the samples by six and stays continuous across chunks", () => {
    const input = sine(300, VOICE_RATE, 0.5);
    const resample = createResampler(VOICE_RATE, 48000);
    const output = join(chunks(input, 160).map((block) => resample(block)));
    expect(output.length).toBe(24000);
    // Sem estalo: nenhum salto entre amostras vizinhas maior que o do próprio tom.
    const jumps = output.slice(1).map((sample, n) => Math.abs(sample - (output[n] ?? 0)));
    expect(Math.max(...jumps)).toBeLessThan(0.05);
  });
});

describe("createFramer", () => {
  it("emits frames of exactly 320 bytes, little-endian, and holds the remainder", () => {
    const frame = createFramer();
    expect(frame(Int16Array.from({ length: 100 }, (_, n) => n))).toEqual([]);
    const frames = frame(Int16Array.from({ length: 400 }, (_, n) => n + 100));
    expect(frames.map((bytes) => bytes.byteLength)).toEqual([FRAME_BYTES, FRAME_BYTES, FRAME_BYTES]);

    const first = new Uint8Array(frames[0] ?? new ArrayBuffer(0));
    expect([first[0], first[1], first[2], first[3]]).toEqual([0, 0, 1, 0]);
    const third = new DataView(frames[2] ?? new ArrayBuffer(0));
    expect([third.getInt16(0, true), third.getInt16(318, true)]).toEqual([320, 479]);
    expect(frame(Int16Array.from({ length: 140 }, () => -2)).length).toBe(1);
  });

  it("one second of microphone audio becomes fifty frames", () => {
    const resample = createResampler(48000, VOICE_RATE);
    const frame = createFramer();
    const total = chunks(sine(200, 48000, 1), 128).reduce((count, block) => count + frame(floatToPcm16(resample(block))).length, 0);
    expect(total).toBe(50);
  });
});

describe("createPcmDecoder", () => {
  it("reads little-endian samples and keeps an odd byte for the next chunk", () => {
    const decode = createPcmDecoder();
    const bytes = Uint8Array.from([0x01, 0x00, 0xff, 0x7f, 0x00, 0x80, 0xfe, 0xff]);
    expect([...decode(bytes.slice(0, 3).buffer)]).toEqual([1]);
    expect([...decode(bytes.slice(3, 4).buffer)]).toEqual([32767]);
    expect([...decode(bytes.slice(4).buffer)]).toEqual([-32768, -2]);
    expect([...decode(new ArrayBuffer(0))]).toEqual([]);
  });
});
