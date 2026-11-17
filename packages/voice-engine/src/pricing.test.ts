import { describe, expect, it } from "vitest";
import { estimateCostCents, estimateCostMicrocents } from "./pricing";

const base = { checkedOn: "2026-11-10", source: "teste" };

describe("estimateCostCents", () => {
  it("cobra por tempo e arredonda para cima", () => {
    expect(estimateCostCents({ ...base, centsPerMinute: 6 }, { seconds: 60 })).toBe(6);
    expect(estimateCostCents({ ...base, centsPerMinute: 6 }, { seconds: 61 })).toBe(7);
  });

  it("cobra por tokens de entrada e de saída", () => {
    const pricing = { ...base, centsPerMillionInputTokens: 300, centsPerMillionOutputTokens: 1200 };
    expect(estimateCostCents(pricing, { inputTokens: 1_000_000, outputTokens: 500_000 })).toBe(900);
    expect(estimateCostCents(pricing, { inputTokens: 1 })).toBe(1);
  });

  it("soma tempo e tokens quando o preço tem os dois", () => {
    const pricing = { ...base, centsPerMinute: 2, centsPerMillionInputTokens: 100, centsPerMillionOutputTokens: 100 };
    expect(estimateCostCents(pricing, { seconds: 90, inputTokens: 2_000_000, outputTokens: 1_000_000 })).toBe(303);
  });

  it("uso vazio ou preço sem a dimensão usada custa zero", () => {
    expect(estimateCostCents({ ...base, centsPerMinute: 6 }, {})).toBe(0);
    expect(estimateCostCents(base, { seconds: 600, inputTokens: 1000 })).toBe(0);
  });

  it("não cobra um centavo a mais por ruído de ponto flutuante", () => {
    expect(estimateCostCents({ ...base, centsPerMinute: 0.1 }, { seconds: 1800 })).toBe(3);
  });

  it("o micro-centavo guarda o que o centavo arredonda: uma leitura de ligação custa 0,034 centavo", () => {
    // Pelo preço do gpt-5-nano (5 centavos por milhão de entrada, 40 por milhão de saída), a
    // transcrição de 6 000 caracteres e a resposta curta dão 0,034 centavo — o valor que, em
    // centavo inteiro, virava 1 centavo, trinta vezes a tabela.
    const nano = { ...base, centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40 };
    expect(estimateCostMicrocents(nano, { inputTokens: 6_000, outputTokens: 100 })).toBe(34_000);
    expect(estimateCostCents(nano, { inputTokens: 6_000, outputTokens: 100 })).toBe(1);
  });

  it("não perde token: um token de entrada do gpt-5-nano custa 5 micro-centavos", () => {
    const nano = { ...base, centsPerMillionInputTokens: 5 };
    expect(estimateCostMicrocents(nano, { inputTokens: 1 })).toBe(5);
    expect(estimateCostMicrocents(nano, {})).toBe(0);
    expect(estimateCostMicrocents({ ...base, centsPerMinute: 6 }, { seconds: 60 })).toBe(6_000_000);
  });
});
