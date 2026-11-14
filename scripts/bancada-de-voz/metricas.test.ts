import { describe, expect, it } from "vitest";
import { distanciaDePalavras, medirFrase, percentil, tabelar, type ResultadoBruto } from "./metricas";
import { normalizar, numeroPresente, termoExato } from "./normalizacao";
import { carregarConjunto, conferirConjunto } from "./conjunto";

describe("normalizar", () => {
  it("tira maiúscula e pontuação, e guarda acento e cedilha", () => {
    expect(normalizar("Aqui é o Rafael Melgaço!")).toEqual(["aqui", "é", "o", "rafael", "melgaço"]);
    expect(normalizar("melgaco")).not.toEqual(normalizar("Melgaço"));
  });

  it("trata número por extenso e por algarismo como iguais", () => {
    expect(normalizar("o pedido é o 10.348")).toEqual(normalizar("o pedido é o dez mil trezentos e quarenta e oito"));
    expect(normalizar("termina em quatro sete dois")).toEqual(normalizar("termina em 472"));
    expect(normalizar("termina em quatrocentos e setenta e dois")).toEqual(normalizar("termina em 472"));
    expect(normalizar("às três e quinze")).toEqual(normalizar("às 3:15"));
    expect(normalizar("às 3h15")).toEqual(normalizar("às 3:15"));
    expect(normalizar("em dois mil e vinte")).toEqual(["em", "2020"]);
    expect(normalizar("vinte e um")).toEqual(["21"]);
  });
});

describe("acerto em nomes", () => {
  it("exige o termo letra por letra: sem acento ou sem cedilha é erro", () => {
    expect(termoExato("aqui é o Rafael Melgaço.", "Melgaço")).toBe(true);
    expect(termoExato("aqui é o Rafael Melgaco.", "Melgaço")).toBe(false);
    expect(termoExato("aqui é o Rafael meu gasso", "Melgaço")).toBe(false);
    expect(termoExato("Rafael Melgaçoso", "Melgaço")).toBe(false);
    expect(termoExato("sou cliente da Desk Voice", "DeskVoice")).toBe(false);
  });

  it("compara número depois da normalização", () => {
    expect(numeroPresente("o pedido é o dez mil trezentos e quarenta e oito", "10.348")).toBe(true);
    expect(numeroPresente("o pedido é o 10.384", "10.348")).toBe(false);
  });

  it("a frase só conta como certa se todos os termos saem certos", () => {
    expect(medirFrase("Falo com a Iracema Tupinambá?", "falo com a Iracema Tupinamba", ["Iracema", "Tupinambá"], []).termosCertos).toBe(false);
    expect(medirFrase("Bom dia", "bom dia", [], []).termosCertos).toBeNull();
  });
});

describe("WER e percentil", () => {
  it("conta troca, inserção e remoção", () => {
    expect(distanciaDePalavras(["a", "b", "c"], ["a", "x", "c", "d"])).toBe(2);
    expect(distanciaDePalavras(["a", "b"], [])).toBe(2);
  });

  it("percentil pelo vizinho mais próximo", () => {
    expect(percentil([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 95)).toBe(19);
    expect(percentil([], 95)).toBeNull();
  });

  it("a tabela soma edições e palavras do grupo, e conta frase sem final", () => {
    const base = { servico: "s", linha: "estreita", vocabulario: true, voz: "v", ruido: null, custoUsd: 0 } as const;
    const resultados: ResultadoBruto[] = [
      { ...base, fraseId: "a", casos: ["nomes"], medida: { palavras: 4, edicoes: 1, termosCertos: true }, latenciaParcialMs: 300, latenciaFinalMs: 500 },
      { ...base, fraseId: "b", casos: ["nomes"], medida: { palavras: 6, edicoes: 6, termosCertos: false }, latenciaParcialMs: null, latenciaFinalMs: null },
    ];
    const [todos] = tabelar(resultados);
    expect(todos).toMatchObject({ caso: "todos", frases: 2, wer: 0.7, acertoEmNomes: 0.5, semFinal: 1, finalP95: 500 });
  });
});

describe("conjunto", () => {
  it("o manifesto pt-br é válido: cada termo está escrito na frase, e cada número se lê na frase", () => {
    const conjunto = carregarConjunto();
    expect(conjunto.frases.length).toBeGreaterThan(0);
    for (const f of conjunto.frases) for (const n of f.numeros) expect(numeroPresente(f.texto, n), `${f.id}: ${n}`).toBe(true);
  });

  it("recusa termo que não está na frase e caso desconhecido", () => {
    const frase = { id: "a", texto: "Aqui é o Rafael", casos: ["nomes"], termos: ["Melgaço"], numeros: [] };
    expect(() => conferirConjunto({ versao: 1, idioma: "pt-BR", frases: [frase] })).toThrow(/não está escrito/);
    expect(() => conferirConjunto({ versao: 1, idioma: "pt-BR", frases: [{ ...frase, termos: [], casos: ["fala-atipica"] }] })).toThrow(/casos/);
  });
});
