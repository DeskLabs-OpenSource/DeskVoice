import { describe, expect, it } from "vitest";
import { misturar } from "./audio";
import {
  LIMITE_PERDA_DB,
  PARTE_MAIS_FRACA,
  QUADRO_COM_FALA_DB,
  QUADRO_MS,
  atrasoPorCorrelacao,
  escalarAoPico,
  mediaEP99,
  medirFalaBaixa,
  medirPorQuadro,
  medirSobRuido,
  perdaPorQuadroDb,
  quadrosMaisFracos,
  razaoDeEnergiaDb,
  reprovaNaFalaBaixa,
} from "./regua-da-reducao";
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

/** Zera todo quadro de 20 ms (a partir da amostra 0) com energia mais de `db` abaixo do quadro mais forte. */
const zerarQuadrosFracos = (db: number) => (x: Float64Array) => {
  const n = (TAXA * QUADRO_MS) / 1000;
  const energias: number[] = [];
  for (let a = 0; a < x.length; a += n) energias.push(x.subarray(a, a + n).reduce((s, v) => s + v * v, 0));
  const piso = Math.max(...energias) * 10 ** (-db / 10);
  return x.map((v, i) => ((energias[Math.floor(i / n)] ?? 0) < piso ? 0 : v));
};
/** Atenua `db` só nos quadros com energia mais de 12 dB abaixo do mais forte: a sílaba fraca some em parte. */
const atenuarQuadrosFracos = (db: number) => (x: Float64Array) => {
  const zerado = zerarQuadrosFracos(12)(x);
  return x.map((v, i) => (zerado[i] === 0 ? v * 10 ** (-db / 20) : v));
};

describe("a régua por quadro (fatia 4b)", () => {
  const { voz, fala } = falaDeTeste();

  it("os quadros são de 20 ms, e o quarto mais fraco dos quadros com fala entra", () => {
    expect(QUADRO_MS).toBe(20);
    expect(PARTE_MAIS_FRACA).toBe(0.25);
    const quadros = quadrosMaisFracos(voz, fala, TAXA);
    for (const q of quadros) expect(q.fim - q.inicio).toBe(160);
    const total = Math.floor((fala.fim - fala.inicio) / 160);
    expect(quadros.length).toBeGreaterThan(0);
    expect(quadros.length).toBeLessThanOrEqual(Math.ceil(total / 4));
  });

  it("todo quadro de 20 ms da fala é candidato: a conta à parte dá os mesmos quadros", () => {
    const energias: { inicio: number; e: number }[] = [];
    for (let a = fala.inicio; a + 160 <= fala.fim; a += 160) energias.push({ inicio: a, e: voz.subarray(a, a + 160).reduce((s, v) => s + v * v, 0) });
    const forte = Math.max(...energias.map((x) => x.e));
    const comFala = energias.filter((x) => x.e > 0 && x.e >= forte / 1000).sort((a, b) => a.e - b.e);
    const esperados = comFala.slice(0, Math.ceil(comFala.length / 4)).map((x) => x.inicio);
    expect(quadrosMaisFracos(voz, fala, TAXA).map((q) => q.inicio)).toEqual(esperados);
  });

  it("os quadros escolhidos não dependem do nível: −20 e −30 dB dão os mesmos", () => {
    expect(quadrosMaisFracos(escalarAoPico(voz, -30), fala, TAXA)).toEqual(quadrosMaisFracos(escalarAoPico(voz, -20), fala, TAXA));
  });

  it("o filtro que zera os quadros mais de 12 dB abaixo do mais forte passa na régua da frase inteira e reprova na por quadro", async () => {
    const filtro = zerarQuadrosFracos(12);
    const fraseInteira = await medirFalaBaixa(voz, fala, filtro, 400);
    expect(fraseInteira.reprova).toBe(false);
    const porQuadro = await medirPorQuadro(voz, fala, TAXA, filtro, 400);
    expect(porQuadro.reprova).toBe(true);
    for (const p of porQuadro.perdasDb) expect(p).toBeGreaterThan(LIMITE_PERDA_DB);
  });

  it("o filtro que só atenua 3 dB a sílaba fraca também passa na frase inteira e reprova por quadro", async () => {
    const filtro = atenuarQuadrosFracos(3);
    expect((await medirFalaBaixa(voz, fala, filtro, 400)).reprova).toBe(false);
    const r = await medirPorQuadro(voz, fala, TAXA, filtro, 400);
    expect(r.reprova).toBe(true);
  });

  it("quadro mais de 30 dB abaixo do mais forte não é fala: o filtro que só zera esses passa", async () => {
    expect(QUADRO_COM_FALA_DB).toBe(30);
    const r = await medirPorQuadro(voz, fala, TAXA, zerarQuadrosFracos(40), 400);
    expect(r.reprova).toBe(false);
    for (const p of r.perdasDb) expect(p).toBeCloseTo(0, 6);
  });

  it("a identidade, um atraso e uma atenuação de 0,5 dB passam; 1,5 dB reprova", async () => {
    for (const filtro of [(x: Float64Array) => x, atrasar(160), atenuar(0.5)]) {
      const r = await medirPorQuadro(voz, fala, TAXA, filtro, 400);
      expect(r.reprova).toBe(false);
    }
    const r = await medirPorQuadro(voz, fala, TAXA, atenuar(1.5), 400);
    for (const p of r.perdasDb) expect(p).toBeCloseTo(1.5, 6);
    expect(r.reprova).toBe(true);
  });

  it("a perda é a média por quadro: um quadro zerado dá perda infinita", () => {
    const q = [{ inicio: 0, fim: 4 }, { inicio: 4, fim: 8 }];
    const ref = [1, 1, 1, 1, 1, 1, 1, 1];
    expect(perdaPorQuadroDb(ref, ref.map((v, i) => (i < 4 ? v / 10 : v)), q, 0).mediaDb).toBeCloseTo(10, 6);
    const calado = perdaPorQuadroDb(ref, ref.map((v, i) => (i < 4 ? 0 : v)), q, 0);
    expect(calado.mediaDb).toBe(Number.POSITIVE_INFINITY);
    expect(calado.calados).toBe(0.5);
    expect(calado.semCaladosDb).toBeCloseTo(0, 6);
    expect(perdaPorQuadroDb(ref, ref.map(() => 0), q, 0).semCaladosDb).toBeNaN();
  });
});

describe("a fala baixa debaixo de ruído (fatia 4b)", () => {
  const { voz, fala } = falaDeTeste();
  const rand = sorteio(11);
  const ruido = Float64Array.from({ length: voz.length }, () => rand() * 2 - 1);
  const vozNoNivel = escalarAoPico(voz, -30);
  const quadros = quadrosMaisFracos(voz, fala, TAXA);
  const ruidoA = (snrDb: number) => misturar(vozNoNivel, ruido, snrDb, fala).ruidoNoNivel;
  const { ruidoNoNivel } = misturar(vozNoNivel, ruido, 0, fala);
  /** Só a voz dos quadros mais fracos (o resto zerado): o que o filtro de sílaba fraca corta. */
  const vozFraca = new Float64Array(vozNoNivel.length);
  for (const q of quadros) for (let i = q.inicio; i < q.fim; i++) vozFraca[i] = vozNoNivel[i] ?? 0;
  const naoFraco = (i: number) => vozFraca[i] === 0;

  it("mede contra a voz limpa: o filtro ideal (devolve a voz limpa) perde zero", async () => {
    expect((await medirSobRuido(vozNoNivel, ruidoNoNivel, quadros, 0, () => vozNoNivel)).mediaDb).toBeCloseTo(0, 6);
  });

  it("o ruído que sobra não conta como voz: sem redução, a perda dá zero", async () => {
    expect((await medirSobRuido(vozNoNivel, ruidoNoNivel, quadros, 0, (x) => x)).mediaDb).toBeCloseTo(0, 6);
  });

  it("o filtro que tira o ruído e zera os quadros fracos da fala reprova", async () => {
    const filtro = () => zerarQuadrosFracos(12)(vozNoNivel);
    expect((await medirSobRuido(vozNoNivel, ruidoNoNivel, quadros, 0, filtro)).mediaDb).toBeGreaterThan(LIMITE_PERDA_DB);
  });

  // O fracasso do aceite: na régua que contava o ruído como voz, este filtro passava a 15, 5 e 0 dB.
  for (const snrDb of [15, 5, 0]) {
    it(`o filtro que deixa o ruído e corta 6 dB da voz fraca reprova a ${snrDb} dB`, async () => {
      const k = 1 - 10 ** (-6 / 20);
      const filtro = (x: Float64Array) => x.map((v, i) => v - k * (vozFraca[i] ?? 0));
      const r = await medirSobRuido(vozNoNivel, ruidoA(snrDb), quadros, 0, filtro);
      expect(r.mediaDb).toBeCloseTo(6, 6);
    });

    it(`o filtro que corta 6 dB da mistura nos quadros fracos (voz e ruído) reprova a ${snrDb} dB`, async () => {
      const filtro = (x: Float64Array) => x.map((v, i) => (naoFraco(i) ? v : v * 10 ** (-6 / 20)));
      const r = await medirSobRuido(vozNoNivel, ruidoA(snrDb), quadros, 0, filtro);
      expect(r.mediaDb).toBeCloseTo(6, 6);
    });
  }

  it("passa a voz com o ruído e a voz com o ruído invertido, uma vez cada", async () => {
    const entradas: Float64Array[] = [];
    await medirSobRuido(vozNoNivel, ruidoNoNivel, quadros, 0, (x) => {
      entradas.push(x);
      return x;
    });
    expect(entradas).toHaveLength(2);
    const i = fala.inicio + 100;
    expect(entradas[0]?.[i]).toBeCloseTo((vozNoNivel[i] ?? 0) + (ruidoNoNivel[i] ?? 0), 9);
    expect(entradas[1]?.[i]).toBeCloseTo((vozNoNivel[i] ?? 0) - (ruidoNoNivel[i] ?? 0), 9);
  });

  it("usa o atraso dado: a voz limpa atrasada perde zero com o atraso certo", async () => {
    expect((await medirSobRuido(vozNoNivel, ruidoNoNivel, quadros, 160, () => atrasar(160)(vozNoNivel))).mediaDb).toBeCloseTo(0, 6);
  });
});

describe("o tempo por pedaço", () => {
  it("dá a média e o p99", () => {
    const v = Array.from({ length: 200 }, (_, i) => (i < 197 ? 1 : 10));
    const r = mediaEP99(v);
    expect(r.media).toBeCloseTo((197 + 30) / 200, 9);
    expect(r.p99).toBe(10);
    expect(mediaEP99(Array.from({ length: 100 }, (_, i) => i + 1)).p99).toBe(99);
  });
});
