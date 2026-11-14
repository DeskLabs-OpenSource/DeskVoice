/**
 * A frase que leva o vocabulário do agente à instrução do modelo de voz, num lugar só, usada pelos
 * dois motores. Nenhum dos dois provedores tem campo de vocabulário para o modelo que conversa; o
 * campo de cada um vale só para a transcrição lateral (ver o cabeçalho de cada motor).
 *
 * Fica em inglês, como o "Speak only in …" que vem logo depois dela.
 */

/** Sem termos, devolve as instruções intactas: a mensagem ao provedor fica byte a byte a de antes. */
export function instructionsWithVocabulary(instructions: string, vocabulary: readonly string[] | undefined): string {
  if (!vocabulary || vocabulary.length === 0) return instructions;
  return `${instructions}\n\nNames and terms that may come up in this call, spelled as written: ${vocabulary.join("; ")}.`;
}
