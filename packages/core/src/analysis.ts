import { z } from "zod";

/**
 * A análise da ligação no fim (desenho `docs/specs/2026-11-13-analise-da-ligacao.md`, seções 3.2 a
 * 3.4). Mora em `core` porque três lugares a leem sem poder importar o motor de voz: o expurgo
 * (`purgeTranscripts`), o painel e, depois, a entrega ao Deskcomm.
 *
 * A nota não vem do modelo: ele diz, critério por critério, se o agente cumpriu, e `scoreOf` soma.
 */

/** A régua da nota, versão 1. Os textos "soma" e "tira" de cada critério moram nos dicionários do painel. */
export const RUBRIC = [
  { id: "opening", points: 2 },
  { id: "discovery", points: 2 },
  { id: "objections", points: 2 },
  { id: "accuracy", points: 2 },
  { id: "closing", points: 2 },
] as const;

export const RUBRIC_VERSION = 1;

export type RubricCriterionId = (typeof RUBRIC)[number]["id"];

const RUBRIC_IDS = RUBRIC.map((criterion) => criterion.id) as [RubricCriterionId, ...RubricCriterionId[]];

/** Frio, morno, quente, ou sem fala do cliente nesse trecho. */
export const TEMPERATURES = ["cold", "warm", "hot", "unknown"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const CRITERION_STATUSES = ["met", "partial", "missed"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const OBJECTION_HANDLING = ["addressed", "partial", "ignored"] as const;

const criterionId = z.enum(RUBRIC_IDS);
const criterionStatus = z.enum(CRITERION_STATUSES);
const temperature = z.enum(TEMPERATURES);
const temperatureArc = z.strictObject({ start: temperature, middle: temperature, end: temperature });

/** Um critério por item da régua, na ordem dela: sem isso, a nota não seria a soma da régua mostrada. */
function followsRubric(criteria: readonly { id: RubricCriterionId }[]): boolean {
  return criteria.length === RUBRIC.length && criteria.every((criterion, index) => criterion.id === RUBRIC[index]?.id);
}
const RUBRIC_ORDER = { message: `criteria must list ${RUBRIC_IDS.join(", ")}, once each, in this order` };

/** Até quantas objeções a análise guarda, e quantos caracteres por campo de objeção. */
export const MAX_OBJECTIONS = 5;
export const MAX_OBJECTION_FIELD = 280;

const objection = z.strictObject({
  objection: z.string().max(MAX_OBJECTION_FIELD),
  quote: z.string().max(MAX_OBJECTION_FIELD),
  response: z.string().max(MAX_OBJECTION_FIELD),
  handled: z.enum(OBJECTION_HANDLING),
});

/** A análise inteira, como fica gravada até o prazo de guarda. */
export const callAnalysisSchema = z.strictObject({
  rubricVersion: z.literal(RUBRIC_VERSION),
  model: z.string().min(1),
  criteria: z.array(z.strictObject({ id: criterionId, status: criterionStatus, evidence: z.string() })).refine(followsRubric, RUBRIC_ORDER),
  temperature: temperatureArc,
  objections: z.array(objection).max(MAX_OBJECTIONS),
  strengths: z.array(z.string().max(200)).max(3),
  weaknesses: z.array(z.string().max(200)).max(3),
  nextStep: z.string().max(280),
  droppedObjections: z.number().int().min(0),
});

/** O que sobra depois do prazo de guarda: a régua, a temperatura e a contagem de objeções. Nenhum texto. */
export const purgedCallAnalysisSchema = z.strictObject({
  rubricVersion: z.literal(RUBRIC_VERSION),
  model: z.string().min(1),
  criteria: z.array(z.strictObject({ id: criterionId, status: criterionStatus })).refine(followsRubric, RUBRIC_ORDER),
  temperature: temperatureArc,
  objectionCount: z.number().int().min(0),
  purged: z.literal(true),
});

/**
 * O que se lê de `calls.analysis`: uma das duas formas. As duas são estritas, então uma análise
 * inteira com `purged` (ou uma expurgada com texto) não passa.
 */
export const storedCallAnalysisSchema = z.union([callAnalysisSchema, purgedCallAnalysisSchema]);

export type CallAnalysis = z.infer<typeof callAnalysisSchema>;
export type PurgedCallAnalysis = z.infer<typeof purgedCallAnalysisSchema>;
export type StoredCallAnalysis = z.infer<typeof storedCallAnalysisSchema>;

/** A análise como vem do provedor, já na forma, antes da checagem contra a transcrição. */
export type CallAnalysisDraft = Omit<CallAnalysis, "droppedObjections">;

/** Quanto vale cada status, em fração dos pontos do critério. */
const STATUS_SHARE: Record<CriterionStatus, number> = { met: 1, partial: 0.5, missed: 0 };

/**
 * A nota de 0 a 10: `met` vale os pontos do critério (2), `partial` metade, `missed` zero. É a única
 * fonte de `calls.analysis_score`.
 */
export function scoreOf(criteria: readonly { id: RubricCriterionId; status: CriterionStatus }[]): number {
  return criteria.reduce((sum, criterion) => {
    const rule = RUBRIC.find((candidate) => candidate.id === criterion.id);
    if (!rule) throw new Error(`Unknown rubric criterion: ${JSON.stringify(criterion.id)}`);
    return sum + rule.points * STATUS_SHARE[criterion.status];
  }, 0);
}

/** Uma fala da transcrição enviada ao provedor. `user` é quem ligou. */
export interface TranscriptTurn {
  speaker: "user" | "agent";
  text: string;
}

/** Minúsculas, sem acento, sem pontuação, espaços colapsados. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A citação aparece numa das falas, por inclusão, depois de normalizar as duas. A comparação é por
 * palavra inteira (as bordas contam como espaço), para "não" não achar "nãoo". Citação vazia nunca
 * aparece: ela não sustenta nada.
 */
function appearsIn(quote: string, turns: readonly string[]): boolean {
  const needle = normalize(quote);
  if (needle === "") return false;
  return turns.some((turn) => ` ${turn} `.includes(` ${needle} `));
}

/**
 * Citação de objeção mais curta que isto, depois de normalizar, não sustenta objeção nenhuma: "não"
 * e "sim" aparecem em toda conversa. Três é um palpite, não uma medida.
 */
export const MIN_OBJECTION_QUOTE_WORDS = 3;

const wordCount = (text: string): number => (text === "" ? 0 : text.split(" ").length);

/**
 * Confere a resposta do provedor contra a transcrição enviada, antes de gravar. Objeção cuja citação
 * não aparece numa fala de quem ligou sai, e conta em `droppedObjections`; também sai a de citação
 * com menos de `MIN_OBJECTION_QUOTE_WORDS` palavras. Evidência de critério que
 * não aparece em fala nenhuma vira `""`, e o status fica. É o que impede a tela de mostrar uma
 * objeção que ninguém disse.
 */
export function verifyAgainstTranscript(draft: CallAnalysisDraft, transcript: readonly TranscriptTurn[]): CallAnalysis {
  const callerTurns = transcript.filter((turn) => turn.speaker === "user").map((turn) => normalize(turn.text));
  const allTurns = transcript.map((turn) => normalize(turn.text));
  const objections = draft.objections.filter(
    (candidate) => wordCount(normalize(candidate.quote)) >= MIN_OBJECTION_QUOTE_WORDS && appearsIn(candidate.quote, callerTurns),
  );
  return {
    ...draft,
    criteria: draft.criteria.map((criterion) => ({ ...criterion, evidence: appearsIn(criterion.evidence, allTurns) ? criterion.evidence : "" })),
    objections,
    droppedObjections: draft.objections.length - objections.length,
  };
}
