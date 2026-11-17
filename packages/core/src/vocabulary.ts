/**
 * Vocabulário do agente: nomes e termos que ele deve esperar ouvir na ligação.
 *
 * A regra mora aqui, num lugar só, e vale para a API e para a tela. Os limites são do DeskVoice, e
 * não do provedor: nem o Gemini Live nem o OpenAI Realtime publicam o seu (desenho
 * `docs/specs/2026-11-13-ouvido-vocabulario-e-diagnostico.md`).
 *
 * Sem dependência de banco: a tela pode importar este arquivo direto.
 */

export const VOCABULARY_MAX_TERMS = 50;
export const VOCABULARY_MAX_TERM_LENGTH = 60;

// Quebra de linha e todo caractere de controle (C0, DEL e C1), e `<`/`>`, que o termo não precisa
// e que abririam marcação dentro da instrução enviada ao modelo.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f<>]/;

export type VocabularyResult = { ok: true; terms: string[] } | { ok: false; reason: string };

/**
 * Confere a lista inteira e devolve os termos aparados, na ordem recebida, ou o primeiro motivo de
 * recusa, em inglês, como as outras mensagens de validação da API.
 */
export function checkVocabulary(input: readonly string[]): VocabularyResult {
  if (input.length > VOCABULARY_MAX_TERMS) {
    return { ok: false, reason: `at most ${VOCABULARY_MAX_TERMS} terms (got ${input.length})` };
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of input.entries()) {
    const position = `term ${index + 1}`;
    if (FORBIDDEN.test(raw)) {
      return { ok: false, reason: `${position} cannot contain line breaks, control characters, '<' or '>'` };
    }
    const term = raw.trim();
    const length = [...term].length;
    if (length === 0) return { ok: false, reason: `${position} is empty` };
    if (length > VOCABULARY_MAX_TERM_LENGTH) {
      return { ok: false, reason: `${position} has ${length} characters; the limit is ${VOCABULARY_MAX_TERM_LENGTH}` };
    }
    const key = term.toLocaleLowerCase("und");
    if (seen.has(key)) return { ok: false, reason: `${position} repeats "${term}"` };
    seen.add(key);
    terms.push(term);
  }
  return { ok: true, terms };
}
