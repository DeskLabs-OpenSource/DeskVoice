import { describe, expect, it } from "vitest";
import { pcm16ToUlaw, resample, ulawToPcm16 } from "./resample";

function tone(hz: number, rate: number, samples: number, amplitude = 10000): Buffer {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / rate)), i * 2);
  return pcm;
}

function rms(pcm: Buffer, skip = 0): number {
  let sum = 0;
  const count = pcm.length / 2 - skip * 2;
  for (let i = skip; i < pcm.length / 2 - skip; i++) sum += pcm.readInt16LE(i * 2) ** 2;
  return Math.sqrt(sum / count);
}

describe("resample", () => {
  it("8k -> 16k -> 8k preserva o número de amostras", () => {
    const original = tone(440, 8000, 801);
    const up = resample(original, 8000, 16000);
    expect(up.length / 2).toBe(1602);
    const back = resample(up, 16000, 8000);
    expect(Math.abs(back.length / 2 - 801)).toBeLessThanOrEqual(1);
  });

  it("24k -> 8k dá um terço das amostras", () => {
    expect(resample(tone(300, 24000, 2400), 24000, 8000).length / 2).toBe(800);
  });

  it("preserva um tom dentro da banda e atenua o que viraria aliasing ao descer", () => {
    const inBand = resample(tone(1000, 24000, 4800), 24000, 8000);
    expect(rms(inBand, 50)).toBeGreaterThan(0.9 * (10000 / Math.SQRT2));
    // 7 kHz está acima de Nyquist de 8 kHz (4 kHz): sem filtro reapareceria como 1 kHz em volume cheio.
    const aliased = resample(tone(7000, 24000, 4800), 24000, 8000);
    expect(rms(aliased, 50)).toBeLessThan(0.05 * (10000 / Math.SQRT2));
  });

  it("mesma taxa devolve o mesmo áudio; buffer vazio devolve vazio", () => {
    const original = tone(440, 8000, 160);
    expect(resample(original, 8000, 8000).equals(original)).toBe(true);
    expect(resample(Buffer.alloc(0), 24000, 8000).length).toBe(0);
  });

  it("recusa taxa inválida", () => {
    expect(() => resample(Buffer.alloc(4), 0, 8000)).toThrow(RangeError);
  });
});

describe("μ-law", () => {
  it("ida e volta tem erro limitado", () => {
    const samples = [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 20000, -20000, 32635, -32635];
    const pcm = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, i) => pcm.writeInt16LE(sample, i * 2));
    const ulaw = pcm16ToUlaw(pcm);
    expect(ulaw.length).toBe(samples.length);
    const back = ulawToPcm16(ulaw);
    samples.forEach((sample, i) => {
      // O passo de quantização do μ-law cresce com a amplitude: no máximo ~3% do valor, mais o piso.
      expect(Math.abs(back.readInt16LE(i * 2) - sample)).toBeLessThanOrEqual(Math.abs(sample) * 0.04 + 8);
    });
  });

  it("usa os códigos padrão do G.711 e satura sem estourar", () => {
    expect(pcm16ToUlaw(Buffer.from(new Int16Array([0]).buffer))[0]).toBe(0xff);
    const extremes = ulawToPcm16(pcm16ToUlaw(Buffer.from(new Int16Array([32767, -32768]).buffer)));
    expect(extremes.readInt16LE(0)).toBe(32124);
    expect(extremes.readInt16LE(2)).toBe(-32124);
  });
});
