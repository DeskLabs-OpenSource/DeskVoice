import { describe, expect, it } from "vitest";
import { FRASES, compararComAConta, resumir, type MedidaDeFala } from "./sintetizador";

const medida = (primeiroAudioMs: number | null, bytes = 16_000, caracteres = 10): MedidaDeFala => ({ frase: "x", caracteres, aberturaMs: 50, primeiroAudioMs, bytes });

describe("bancada da voz do pipeline", () => {
  it("tem 30 falas curtas em pt-BR", () => {
    expect(FRASES).toHaveLength(30);
    for (const frase of FRASES) expect(frase.length).toBeLessThanOrEqual(60);
  });

  it("resume p50/p95 do primeiro áudio só com as falas que tiveram áudio, e acusa bytes ímpares", () => {
    const resumo = resumir([medida(100), medida(200), medida(300), medida(null, 0), medida(400, 15_999)]);
    expect(resumo).toMatchObject({ falas: 5, comAudio: 4, primeiroAudioP50Ms: 200, primeiroAudioP95Ms: 400, caracteresContados: 50, falasComBytesImpares: 1 });
    expect(resumo.segundosDeAudio).toBeCloseTo(63_999 / 16_000);
  });

  it("compara com a conta, ou diz que a conta não expôs", () => {
    expect(compararComAConta(100, 1_000, 1_103)).toEqual({ cobrados: 103, diferenca: 3 });
    expect(compararComAConta(100, null, 1_103)).toBeNull();
  });
});
