import type { EnginePricing, Usage } from "./types";

/** Centavos de dólar, arredondados para cima. Soma tempo e tokens quando o preço tem os dois. */
export function estimateCostCents(pricing: EnginePricing, usage: Usage): number {
  const cents =
    ((usage.seconds ?? 0) / 60) * (pricing.centsPerMinute ?? 0) +
    ((usage.inputTokens ?? 0) / 1e6) * (pricing.centsPerMillionInputTokens ?? 0) +
    ((usage.outputTokens ?? 0) / 1e6) * (pricing.centsPerMillionOutputTokens ?? 0) +
    ((usage.textInputTokens ?? 0) / 1e6) * (pricing.centsPerMillionTextInputTokens ?? pricing.centsPerMillionInputTokens ?? 0) +
    ((usage.cachedInputTokens ?? 0) / 1e6) * (pricing.centsPerMillionCachedInputTokens ?? pricing.centsPerMillionInputTokens ?? 0) +
    ((usage.textOutputTokens ?? 0) / 1e6) * (pricing.centsPerMillionTextOutputTokens ?? pricing.centsPerMillionOutputTokens ?? 0);
  // A folga evita que ruído de ponto flutuante (3.0000000000000004) vire um centavo a mais.
  return Math.max(0, Math.ceil(cents - 1e-9));
}
