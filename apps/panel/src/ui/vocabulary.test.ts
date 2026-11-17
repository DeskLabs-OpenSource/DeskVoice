import { describe, expect, it } from "vitest";
import en from "../i18n/en/agents";
import es from "../i18n/es/agents";
import pt from "../i18n/pt-BR/agents";
import { readVocabulary, vocabularyCountText, vocabularyErrorText, vocabularyLines } from "./vocabulary";

describe("vocabularyLines", () => {
  it("caixa vazia ou só com Enter vira a lista vazia", () => {
    expect(vocabularyLines("")).toEqual([]);
    expect(vocabularyLines("\n\n  \n")).toEqual([]);
  });

  it("corta em linhas, qualquer que seja a quebra, e ignora só as linhas em branco do fim", () => {
    expect(vocabularyLines("Melgaço\r\nDeskVoice\rPix\n\n")).toEqual(["Melgaço", "DeskVoice", "Pix"]);
    expect(vocabularyLines("Melgaço\n\nPix")).toEqual(["Melgaço", "", "Pix"]);
  });
});

describe("readVocabulary", () => {
  it("vazio grava [], igual a quem nunca preencheu", () => {
    expect(readVocabulary("")).toEqual({ count: 0, result: { ok: true, terms: [] } });
  });

  it("apara cada termo, como a API", () => {
    expect(readVocabulary("  Melgaço \nDeskVoice\n")).toEqual({ count: 2, result: { ok: true, terms: ["Melgaço", "DeskVoice"] } });
  });

  it("linha em branco no meio é termo vazio, como na API", () => {
    expect(readVocabulary("Melgaço\n \nPix").result).toMatchObject({ ok: false, problem: { kind: "empty", position: 2 } });
  });

  it("conta os termos escritos, mesmo acima do limite", () => {
    const text = Array.from({ length: 51 }, (_, index) => `termo ${index}`).join("\n");
    const read = readVocabulary(text);
    expect(read.count).toBe(51);
    expect(read.result).toMatchObject({ ok: false, problem: { kind: "too_many", count: 51 } });
  });
});

describe("vocabularyErrorText", () => {
  const cases: [string, string][] = [
    ["Melgaço\nmelgaço", 'A linha 2 repete "melgaço". Maiúscula e minúscula contam como o mesmo termo.'],
    ["<b>", "A linha 1 tem < ou > ou um caractere de controle, como tabulação. Tire esse caractere."],
    ["com\ttab", "A linha 1 tem < ou > ou um caractere de controle, como tabulação. Tire esse caractere."],
    [`ok\n${"ç".repeat(61)}`, "A linha 2 tem 61 caracteres. O limite é 60 por termo."],
    ["a\n\nb", "A linha 2 está em branco. Apague a linha ou escreva um termo nela."],
    [Array.from({ length: 51 }, (_, index) => `t${index}`).join("\n"), "São no máximo 50 termos, e a lista tem 51."],
  ];
  it.each(cases)("%j → %s", (text, message) => {
    const { result } = readVocabulary(text);
    if (result.ok) throw new Error("expected a refusal");
    expect(vocabularyErrorText(result.problem, pt)).toBe(message);
  });

  it("toda mensagem sai preenchida nas três línguas", () => {
    for (const [text] of cases) {
      const { result } = readVocabulary(text);
      if (result.ok) throw new Error("expected a refusal");
      for (const dict of [pt, en, es]) expect(vocabularyErrorText(result.problem, dict)).not.toMatch(/\{\w+\}/);
    }
  });
});

it("o contador diz N de 50", () => {
  expect(vocabularyCountText(3, pt)).toBe("3 de 50");
  expect(vocabularyCountText(0, en)).toBe("0 of 50");
});
