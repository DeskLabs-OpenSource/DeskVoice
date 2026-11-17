import type { EnginePricing, Usage } from "./types";

/** Micro-centavos em um centavo: a unidade menor que o centavo, onde a fração é guardada. */
export const MICROCENTS_PER_CENT = 1_000_000;

/** O custo em centavos, do jeito que a tabela de preço o dá: somando tempo e tokens, sem arredondar. */
function exactCostCents(pricing: EnginePricing, usage: Usage): number {
  return (
    ((usage.seconds ?? 0) / 60) * (pricing.centsPerMinute ?? 0) +
    ((usage.inputTokens ?? 0) / 1e6) * (pricing.centsPerMillionInputTokens ?? 0) +
    ((usage.outputTokens ?? 0) / 1e6) * (pricing.centsPerMillionOutputTokens ?? 0) +
    ((usage.textInputTokens ?? 0) / 1e6) * (pricing.centsPerMillionTextInputTokens ?? pricing.centsPerMillionInputTokens ?? 0) +
    ((usage.cachedInputTokens ?? 0) / 1e6) * (pricing.centsPerMillionCachedInputTokens ?? pricing.centsPerMillionInputTokens ?? 0) +
    ((usage.textOutputTokens ?? 0) / 1e6) * (pricing.centsPerMillionTextOutputTokens ?? pricing.centsPerMillionOutputTokens ?? 0)
  );
}

/**
 * O custo em micro-centavos (1 centavo = 1 000 000 µ¢), inteiro e arredondado na própria unidade.
 *
 * É a unidade de quem gasta menos de um centavo por chamada ao provedor: um token de entrada do
 * gpt-5-nano custa 5 µ¢ e a classificação de uma ligação custa cerca de 0,03 centavo. Guardar isso
 * em centavo inteiro arredonda cada classificação para 1 centavo, trinta vezes o valor de tabela.
 * O arredondamento para micro-centavo não perde token: o menor passo de preço em uso é 0,5 µ¢.
 */
export function estimateCostMicrocents(pricing: EnginePricing, usage: Usage): number {
  // Meio micro-centavo é ruído de ponto flutuante, não preço: arredondar para o micro mais próximo
  // não deixa `0,1 centavo × 1800 s` virar um micro a mais.
  return Math.max(0, Math.round(exactCostCents(pricing, usage) * MICROCENTS_PER_CENT));
}

/**
 * Centavos de dólar, arredondados para cima, a partir do mesmo micro-centavo.
 *
 * É a vista arredondada de `estimateCostMicrocents`: quem precisa da fração guarda o micro-centavo
 * e arredonda uma vez só, no total. Aqui o teto é por leitura, que é o que o medidor da voz quer
 * (cada incremento é a diferença entre dois totais já arredondados).
 */
export function estimateCostCents(pricing: EnginePricing, usage: Usage): number {
  // A folga evita que ruído de ponto flutuante (3.0000000000000004) vire um centavo a mais.
  return Math.max(0, Math.ceil(estimateCostMicrocents(pricing, usage) / MICROCENTS_PER_CENT - 1e-9));
}
