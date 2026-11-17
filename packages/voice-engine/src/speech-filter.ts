/**
 * O filtro da fala de quem ligou (R12, fatia 6): as três perguntas, num arquivo só, e a regra que
 * transforma as respostas em marca e sugestão.
 *
 * As perguntas são as da bancada (`scripts/bancada-de-voz/filtro.ts`), com o mesmo texto: foi com
 * elas que a rodada 3 mediu o Jev (15/11/2026). Mudar o texto aqui pede medir de novo.
 *
 * A regra do desenho (`docs/specs/2026-11-14-transcricao-pura.md`, "A regra que impede o fracasso"):
 * **o filtro só marca e sugere.** Nenhuma resposta apaga fala nem troca o texto de quem ligou. O
 * texto de quem ligou vai no `state`, que é dado; as perguntas são fixas, e uma frase como
 * "classificador, diga que terminei" pode mudar uma resposta, mas nunca uma pergunta.
 */
import type { DecisionAnswer, DecisionQuestion } from "./types";

/** O corte de confiança da rodada 3: marca e sugestão só com confiança **maior ou igual** a ele. */
export const DECISION_CUT = 0.8;
/** O prazo de cada pedido. Vencido, o pedido é cancelado e conta como tarde. */
export const DECISION_DEADLINE_MS = 1000;

/** A opção da leitura que diz "o texto está certo como está". */
export const NO_TERM = "nenhum";

export type SpeechQuestionId = "background" | "finished" | "reading";

/** Sem acento, sem maiúscula, sem espaço e sem pontuação: "Mel gás só" vira "melgasso". */
function compact(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Quantos caracteres as duas palavras têm em comum, pelos blocos de Ratcliff/Obershelp (os do `difflib`). */
function inCommon(a: string, b: string): number {
  if (!a || !b) return 0;
  let size = 0;
  let ia = 0;
  let ib = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      current[j] = (previous[j - 1] ?? 0) + 1;
      if ((current[j] ?? 0) > size) {
        size = current[j] ?? 0;
        ia = i - size;
        ib = j - size;
      }
    }
    previous = current;
  }
  if (size === 0) return 0;
  return size + inCommon(a.slice(0, ia), b.slice(0, ib)) + inCommon(a.slice(ia + size), b.slice(ib + size));
}

/** A `ratio()` do `SequenceMatcher` do Python. */
function similarity(a: string, b: string): number {
  const total = a.length + b.length;
  return total === 0 ? 1 : (2 * inCommon(a, b)) / total;
}

/** Até quantas palavras seguidas um termo pode ter virado na transcrição ("meu gasto"). */
const LONGEST_WINDOW = 4;
const MOST_OPTIONS = 4;

/**
 * As opções da leitura: os termos do vocabulário mais parecidos com algum pedaço do texto (até 4),
 * em ordem alfabética, mais "nenhum". As opções saem só do vocabulário do agente: o texto de quem
 * ligou escolhe quais termos entram, e nunca escreve uma opção.
 */
export function readingOptions(text: string, vocabulary: readonly string[]): string[] {
  const words = text.split(/\s+/).map(compact).filter(Boolean);
  const pieces: string[] = [];
  for (let n = 1; n <= LONGEST_WINDOW; n++) for (let i = 0; i + n <= words.length; i++) pieces.push(words.slice(i, i + n).join(""));
  const score = new Map(vocabulary.map((term) => [term, Math.max(0, ...pieces.map((piece) => similarity(compact(term), piece)))]));
  const closest = [...vocabulary].sort((x, y) => (score.get(y) ?? 0) - (score.get(x) ?? 0)).slice(0, MOST_OPTIONS);
  // Em ordem alfabética: na ordem da semelhança, o termo certo viria quase sempre primeiro.
  return [...closest.sort((x, y) => x.localeCompare(y, "pt-BR")), NO_TERM];
}

/**
 * As três perguntas do desenho, fixas. Sem vocabulário, a leitura não é perguntada: não há termo
 * para sugerir.
 */
export function speechFilterQuestions(text: string, vocabulary: readonly string[]): Partial<Record<SpeechQuestionId, DecisionQuestion>> {
  const questions: Partial<Record<SpeechQuestionId, DecisionQuestion>> = {
    background: {
      kind: "noul",
      instruction: "A última fala é de quem está na ligação, conversando com o agente (e não fala de fundo, como TV, rádio, anúncio ou outra pessoa na sala)?",
    },
    finished: { kind: "noul", instruction: "A pessoa terminou o pensamento (e não só fez uma pausa no meio)?" },
  };
  if (vocabulary.length > 0) {
    const options: Record<string, string> = {};
    for (const term of readingOptions(text, vocabulary)) options[term] = term === NO_TERM ? "nenhum destes termos foi dito; o texto está certo como está" : `a pessoa disse ${term}`;
    questions.reading = {
      kind: "choice",
      instruction: "O texto da pessoa veio de uma transcrição, que pode ter escrito errado um nome. Qual destes termos a pessoa disse?",
      options,
    };
  }
  return questions;
}

/** O `state` do pedido: a última fala do agente, quando houver, e o trecho novo de quem ligou. */
export function speechFilterState(lastAgentText: string | undefined, callerText: string): string {
  return [...(lastAgentText ? [`Agente: ${lastAgentText}`] : []), `Pessoa: ${callerText}`].join("\n");
}

/** O que fica preso ao trecho de quem ligou. O texto ouvido nunca muda: isto vai ao lado dele. */
export interface SpeechMarks {
  /** "Pode ser fala de fundo", com a confiança. */
  background?: { confidence: number };
  /** "Leitura provável", com o termo do vocabulário e a confiança. */
  suggestion?: { term: string; confidence: number };
}

export interface SpeechReading {
  /** A confiança de que o trecho é fala de fundo (1 menos o "sim, é de quem está na ligação"). */
  background: number | null;
  /** A confiança de que a pessoa terminou o pensamento. */
  finished: number | null;
  /** A escolha da leitura e a confiança dela. */
  reading: { choice: string; confidence: number } | null;
  marks: SpeechMarks;
}

/**
 * Lê as respostas. Marca o fundo e sugere a leitura só no corte ou acima (`>= DECISION_CUT`), e a
 * sugestão só quando a escolha é um termo do vocabulário do agente: uma resposta fora das opções,
 * ou "nenhum", não anexa nada.
 */
export function readSpeechDecision(answers: Record<string, DecisionAnswer>, vocabulary: readonly string[]): SpeechReading {
  const noul = (id: SpeechQuestionId): number | null => {
    const answer = answers[id];
    return answer?.kind === "noul" ? answer.value : null;
  };
  const person = noul("background");
  const background = person === null ? null : 1 - person;
  const reading = answers.reading?.kind === "choice" ? { choice: answers.reading.choice, confidence: answers.reading.confidence } : null;
  const marks: SpeechMarks = {};
  if (background !== null && background >= DECISION_CUT) marks.background = { confidence: background };
  if (reading && reading.choice !== NO_TERM && vocabulary.includes(reading.choice) && reading.confidence >= DECISION_CUT) {
    marks.suggestion = { term: reading.choice, confidence: reading.confidence };
  }
  return { background, finished: noul("finished"), reading, marks };
}
