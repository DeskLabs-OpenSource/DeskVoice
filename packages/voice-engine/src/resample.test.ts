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

/** Amplitude de um tom de `hz` no sinal, por DFT de um ponto com janela de Hann. */
function amplitude(pcm: Buffer, rate: number, hz: number): number {
  const count = pcm.length / 2;
  let re = 0;
  let im = 0;
  let weight = 0;
  for (let i = 0; i < count; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1));
    const sample = pcm.readInt16LE(i * 2) * w;
    re += sample * Math.cos((2 * Math.PI * hz * i) / rate);
    im += sample * Math.sin((2 * Math.PI * hz * i) / rate);
    weight += w;
  }
  return (2 * Math.hypot(re, im)) / weight;
}

const db = (ratio: number) => 20 * Math.log10(ratio);

/**
 * O que sobra fora do tom, em dB relativos ao tom: o sinal menos o tom de `hz` ajustado por mínimos
 * quadrados (seno e cosseno). Pega a imagem e também a junção entre pedaços.
 */
function residual(pcm: Buffer, rate: number, hz: number): number {
  const count = pcm.length / 2;
  let ss = 0;
  let cc = 0;
  let sc = 0;
  let ys = 0;
  let yc = 0;
  for (let i = 0; i < count; i++) {
    const s = Math.sin((2 * Math.PI * hz * i) / rate);
    const c = Math.cos((2 * Math.PI * hz * i) / rate);
    const y = pcm.readInt16LE(i * 2);
    ss += s * s;
    cc += c * c;
    sc += s * c;
    ys += y * s;
    yc += y * c;
  }
  const det = ss * cc - sc * sc;
  const a = (ys * cc - yc * sc) / det;
  const b = (yc * ss - ys * sc) / det;
  let error = 0;
  for (let i = 0; i < count; i++) {
    const fit = a * Math.sin((2 * Math.PI * hz * i) / rate) + b * Math.cos((2 * Math.PI * hz * i) / rate);
    error += (pcm.readInt16LE(i * 2) - fit) ** 2;
  }
  return db(Math.sqrt(error / count) / (Math.hypot(a, b) / Math.SQRT2));
}

/** Reamostra em pedaços de 20 ms, cada um isolado, como o produto chama (gemini-live, whatsapp-transport). */
function resampleIn20ms(pcm: Buffer, from: number, to: number): Buffer {
  const step = (from / 50) * 2;
  const parts: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += step) parts.push(resample(pcm.subarray(offset, offset + step), from, to));
  return Buffer.concat(parts);
}

describe("resample", () => {
  it("8k -> 16k não cria imagem espelhada em 8000 - f (40 dB abaixo do tom, no mínimo)", () => {
    for (const hz of [1000, 2000, 3000, 3400]) {
      const up = resample(tone(hz, 8000, 8000), 8000, 16000);
      const image = db(amplitude(up, 16000, 8000 - hz) / amplitude(up, 16000, hz));
      expect(image, `imagem de ${hz} Hz em ${8000 - hz} Hz`).toBeLessThanOrEqual(-40);
    }
  });

  it("8k -> 16k perde no máximo 1 dB de 300 Hz a 3 kHz", () => {
    for (const hz of [300, 500, 1000, 1500, 2000, 2500, 3000]) {
      const up = resample(tone(hz, 8000, 8000), 8000, 16000);
      expect(db(amplitude(up, 16000, hz) / 10000), `tom de ${hz} Hz`).toBeGreaterThanOrEqual(-1);
    }
  });

  it("8k -> 16k em pedaços de 20 ms: imagem 40 dB abaixo do tom, e a junção 25 dB abaixo, no mínimo", () => {
    // É o número que o fragmento afirma. Medido em 14/11: imagem de -45 a -64 dB, junção de -26 a -42 dB.
    for (const hz of [300, 1000, 2000, 3000, 3400]) {
      const up = resampleIn20ms(tone(hz, 8000, 8000), 8000, 16000);
      const image = db(amplitude(up, 16000, 8000 - hz) / amplitude(up, 16000, hz));
      expect(image, `imagem de ${hz} Hz em ${8000 - hz} Hz, em pedaços de 20 ms`).toBeLessThanOrEqual(-40);
      expect(residual(up, 16000, hz), `resíduo fora do tom de ${hz} Hz, em pedaços de 20 ms`).toBeLessThanOrEqual(-25);
    }
  });

  it("mede o tempo de reamostrar 1 s de áudio de 8k para 16k", () => {
    const second = tone(1000, 8000, 8000);
    const time = (run: () => void) => {
      for (let i = 0; i < 5; i++) run();
      const start = performance.now();
      for (let i = 0; i < 20; i++) run();
      return (performance.now() - start) / 20;
    };
    const up = time(() => resample(second, 8000, 16000));
    // Folga larga: o número medido vai no PR (0,8 ms em 13/11); aqui só se pega regressão grosseira.
    expect(up, `1 s de 8k para 16k levou ${up.toFixed(2)} ms`).toBeLessThan(100);
  });

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
