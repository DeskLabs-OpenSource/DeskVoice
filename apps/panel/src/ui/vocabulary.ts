import { checkVocabulary, VOCABULARY_MAX_TERM_LENGTH, VOCABULARY_MAX_TERMS, type VocabularyProblem, type VocabularyResult } from "@deskvoice/core/vocabulary";
import { fill } from "../i18n/locales";
import type { AgentsDictionary } from "../i18n/pt-BR/agents";

/**
 * O campo de vocabulário é uma caixa de texto, um termo por linha. A tela só corta o texto em
 * linhas; quem decide se a lista vale é `checkVocabulary`, a mesma função da API.
 *
 * As linhas em branco do fim não contam: é o Enter de quem ia escrever o próximo termo. Uma linha
 * em branco no meio conta, e a regra a recusa como termo vazio, igual à API.
 */
export function vocabularyLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  return lines;
}

export interface VocabularyField {
  /** Quantos termos a pessoa escreveu, para o contador "N de 50". */
  count: number;
  result: VocabularyResult;
}

export function readVocabulary(text: string): VocabularyField {
  const lines = vocabularyLines(text);
  return { count: lines.length, result: checkVocabulary(lines) };
}

/** O motivo da recusa na língua da tela. A posição do termo é a linha da caixa. */
export function vocabularyErrorText(problem: VocabularyProblem, t: AgentsDictionary): string {
  switch (problem.kind) {
    case "too_many":
      return fill(t.vocabularyTooMany, { max: VOCABULARY_MAX_TERMS, n: problem.count });
    case "forbidden":
      return fill(t.vocabularyForbidden, { line: problem.position });
    case "empty":
      return fill(t.vocabularyEmpty, { line: problem.position });
    case "too_long":
      return fill(t.vocabularyTooLong, { line: problem.position, length: problem.length, max: VOCABULARY_MAX_TERM_LENGTH });
    case "repeated":
      return fill(t.vocabularyRepeated, { line: problem.position, term: problem.term });
  }
}

export const vocabularyCountText = (count: number, t: AgentsDictionary): string => fill(t.vocabularyCount, { n: count, max: VOCABULARY_MAX_TERMS });
