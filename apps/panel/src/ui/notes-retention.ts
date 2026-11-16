import { fill } from "../i18n/locales";
import type { PrivacyDictionary } from "../i18n/pt-BR/privacy";

/**
 * O que a tela do prazo da memória recusa antes de mandar: fora de 30 a 365, ou acima do prazo de
 * guarda das conversas (decisão 2A). A rota confere as mesmas duas regras.
 */
export function notesRetentionProblem(
  value: string,
  limits: { minDays: number; maxDays: number; transcriptDays: number | null },
  t: Pick<PrivacyDictionary, "notesOutOfRange" | "notesAboveTranscripts">,
): string | null {
  const days = Number(value);
  if (value.trim() === "" || !Number.isInteger(days) || days < limits.minDays || days > limits.maxDays) return fill(t.notesOutOfRange, { min: limits.minDays, max: limits.maxDays });
  if (limits.transcriptDays !== null && days > limits.transcriptDays) return fill(t.notesAboveTranscripts, { days: limits.transcriptDays });
  return null;
}

/** Encurtar o prazo da memória apaga as notas mais velhas, e por isso pede confirmação. Alongar ou manter não apaga nada. */
export const notesRetentionNeedsConfirm = (next: number, current: number): boolean => next < current;
