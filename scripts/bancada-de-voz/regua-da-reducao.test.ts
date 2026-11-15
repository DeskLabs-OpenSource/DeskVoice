import { describe, expect, it } from "vitest";
import { LIMITE_PERDA_DB, atrasoPorCorrelacao, escalarAoPico, medirFalaBaixa, razaoDeEnergiaDb, reprovaNaFalaBaixa } from "./regua-da-reducao";
import { sorteio } from "./ruido";

const TAXA = 8000;

/** Um sinal com cara de fala (tons que mudam, com envelope de sílaba), entre 0,5 s de silêncio de cada lado. Sem TTS. */
function falaDeTeste(): { voz: Float64Array; fala: { inicio: number; fim: number } } {
  const rand = sorteio(7);
  const antes = TAXA / 2;
  const duracao = TAXA * 2;
  const voz = new Float64Array(antes + duracao + TAXA / 2);
  for (let i = 0; i < duracao; i++) {
    const s = i / TAXA;
    const silaba = Math.max(0, Math.sin(Math.PI * 4 * s));
    const f0 = 120 + 30 * Math.sin(2 * Math.PI * 0.7 * s);
    voz[antes + i] = silaba * (Math.sin(2 * Math.PI * f0 * s) + 0.5 * Math.sin(2 * Math.PI * 3 * f0 * s) + 0.1 * (rand() * 2 - 1));
  }
  return { voz, fala: { inicio: antes, fim: antes + duracao } };
}

const atenuar = (db: number) => (x: Float64Array) => x.map((v) => v * 10 ** (-db / 20));
const atrasar = (n: number) => (x: Float64Array) => Float64Array.from({ length: x.length }, (_, i) => (i >= n ? (x[i - n] ?? 0) : 0));

describe("a régua da perda na fala baixa", () => {
  const { voz, fala } = falaDeTeste();

  it("a identidade passa, com perda zero nos dois níveis", async () => {
    const r = await medirFalaBaixa(voz, fala, (x) => x, 400);
    expect(r.perdasDb).toHaveLength(2);
    for (const p of r.perdasDb) expect(p).toBeCloseTo(0, 6);
    expect(r.reprova).toBe(false);
  });

  it("um filtro que atenua 2 dB reprova", async () => {
    const r = await medirFalaBaixa(voz, fala, atenuar(2), 400);
    for (const p of r.perdasDb) expect(p).toBeCloseTo(2, 6);
    expect(r.reprova).toBe(true);
  });

  it("o limite é 1 dB: 0,9 passa, 1,1 reprova", async () => {
    expect(LIMITE_PERDA_DB).toBe(1);
    expect((await medirFalaBaixa(voz, fala, atenuar(0.9), 400)).reprova).toBe(false);
    expect((await medirFalaBaixa(voz, fala, atenuar(1.1), 400)).reprova).toBe(true);
  });

  it("só a fala baixa que some reprova: o filtro que corta só abaixo de −25 dB do pico cai no nível de −30 dB", async () => {
    const portaDeRuido = (x: Float64Array) => {
      let pico = 0;
      for (const v of x) pico = Math.max(pico, Math.abs(v));
      return pico < 32767 * 10 ** (-25 / 20) ? x.map(() => 0) : x;
    };
    const r = await medirFalaBaixa(voz, fala, portaDeRuido, 400);
    expect(r.perdasDb[0]).toBeCloseTo(0, 6);
    expect(r.perdasDb[1]).toBe(Number.POSITIVE_INFINITY);
    expect(r.reprova).toBe(true);
  });

  it("o atraso da saída é medido e não vira perda", async () => {
    const r = await medirFalaBaixa(voz, fala, atrasar(160), 400);
    expect(r.atrasos).toEqual([160, 160]);
    for (const p of r.perdasDb) expect(p).toBeCloseTo(0, 6);
    expect(r.reprova).toBe(false);
  });

  it("perda que não é número reprova", () => {
    expect(reprovaNaFalaBaixa([0.2, Number.NaN])).toBe(true);
  });
});

describe("as contas da régua", () => {
  it("escala ao pico pedido", () => {
    const x = escalarAoPico([0, 1000, -4000, 2000], -20);
    expect(Math.max(...x.map(Math.abs))).toBeCloseTo(32767 / 10, 6);
  });

  it("a redução do ruído é a razão de energia nos trechos, em dB", () => {
    const ruido = Float64Array.from({ length: 1000 }, (_, i) => Math.sin(i));
    const saida = ruido.map((v) => v / 10);
    expect(razaoDeEnergiaDb(ruido, saida, [{ inicio: 0, fim: 500 }, { inicio: 600, fim: 1000 }], 0)).toBeCloseTo(20, 6);
  });

  it("saída muda não inventa atraso", () => {
    expect(atrasoPorCorrelacao([1, 2, 3, 4], [0, 0, 0, 0], { inicio: 0, fim: 4 }, 2)).toBe(0);
  });
});
