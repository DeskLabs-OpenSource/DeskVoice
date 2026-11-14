import { z } from "zod";
import { CALL_OUTCOMES, outcomeGuess, outcomeInstructions, type OutcomeGuess } from "./outcome";

/**
 * O pedido completo ao provedor: o desfecho e a análise da ligação na mesma resposta (desenho
 * `docs/specs/2026-11-13-analise-da-ligacao.md`, seção 3.4). Uma chamada paga só: a transcrição
 * vai uma vez.
 *
 * A forma guardada, a régua e a nota moram em `@deskvoice/core` (`analysis.ts`); o motor de voz não
 * depende de `core`, então o vocabulário abaixo é repetido aqui. Um teste da rotina (que importa os
 * dois) prova que os critérios são os mesmos e na mesma ordem.
 */

/** Os critérios da régua v1, na ordem dela. Os mesmos ids de `RUBRIC` em `@deskvoice/core`. */
export const ANALYSIS_CRITERIA = ["opening", "discovery", "objections", "accuracy", "closing"] as const;
export type AnalysisCriterionId = (typeof ANALYSIS_CRITERIA)[number];

const TEMPERATURES = ["cold", "warm", "hot", "unknown"] as const;
const CRITERION_STATUSES = ["met", "partial", "missed"] as const;
const OBJECTION_HANDLING = ["addressed", "partial", "ignored"] as const;

/** Até quantas objeções e quantos caracteres por campo de objeção a resposta pode trazer. */
export const MAX_OBJECTIONS = 5;
export const MAX_OBJECTION_FIELD = 280;

/** O pedido completo pede uma resposta maior: o prazo sobe de 10 s para 30 s. */
export const ANALYSIS_TIMEOUT_MS = 30_000;

/** A transcrição do pedido completo vai até aqui; acima, começo e fim com a marca no meio. */
export const ANALYSIS_TRANSCRIPT_LIMIT = 24_000;
const ANALYSIS_TRANSCRIPT_HEAD = 8_000;
const ANALYSIS_TRANSCRIPT_TAIL = 16_000;
export const OMITTED_TURNS_MARK = "[… falas omitidas …]";

/**
 * Corta a transcrição do pedido completo.
 *
 * ponytail: é um limite de custo, não de leitura. Acima de 24 000 caracteres vão as primeiras 8 000
 * e as últimas 16 000, e a temperatura do meio tende a sair `unknown`. Ler a ligação inteira pede
 * dividir o pedido, e isso é mais de uma chamada paga.
 */
export function clipTranscriptForAnalysis(transcript: string): string {
  if (transcript.length <= ANALYSIS_TRANSCRIPT_LIMIT) return transcript;
  return [transcript.slice(0, ANALYSIS_TRANSCRIPT_HEAD), OMITTED_TURNS_MARK, transcript.slice(-ANALYSIS_TRANSCRIPT_TAIL)].join("\n");
}

/** A análise como o provedor a deu, já na forma, antes da checagem contra a transcrição. */
export interface AnalysisGuess {
  /** Um por critério da régua, na ordem dela. */
  criteria: { id: AnalysisCriterionId; status: (typeof CRITERION_STATUSES)[number]; evidence: string }[];
  temperature: { start: (typeof TEMPERATURES)[number]; middle: (typeof TEMPERATURES)[number]; end: (typeof TEMPERATURES)[number] };
  objections: { objection: string; quote: string; response: string; handled: (typeof OBJECTION_HANDLING)[number] }[];
  strengths: string[];
  weaknesses: string[];
  nextStep: string;
}

const temperature = z.enum(TEMPERATURES);
const criterion = z.object({ status: z.enum(CRITERION_STATUSES), evidence: z.string() });
const objectionField = z.string().max(MAX_OBJECTION_FIELD);

/**
 * A resposta inteira, como pedimos. Os critérios vêm num objeto com uma chave por critério, e não
 * numa lista: o schema obriga os cinco, e a ordem da régua sai daqui, não do modelo.
 *
 * Os limites de tamanho ficam aqui e no texto do pedido, e não no schema enviado: não foi medido se
 * os dois provedores aceitam `maxItems` e `maxLength` no schema aninhado, e um schema recusado daria
 * 400 em toda ligação. Resposta acima do limite é `unexpected_response`.
 */
const analysisResponse = outcomeGuess.extend({
  criteria: z.object(Object.fromEntries(ANALYSIS_CRITERIA.map((id) => [id, criterion])) as Record<AnalysisCriterionId, typeof criterion>),
  temperature: z.object({ start: temperature, middle: temperature, end: temperature }),
  objections: z
    .array(z.object({ objection: objectionField, quote: objectionField, response: objectionField, handled: z.enum(OBJECTION_HANDLING) }))
    .max(MAX_OBJECTIONS),
  strengths: z.array(z.string().max(200)).max(3),
  weaknesses: z.array(z.string().max(200)).max(3),
  nextStep: z.string().max(280),
});

/** Lê a resposta do pedido completo sem confiar nela: fora da forma (desfecho incluído), `null`. */
export function readAnalysisGuess(raw: unknown): { guess: OutcomeGuess; analysis: AnalysisGuess } | null {
  const parsed = analysisResponse.safeParse(raw);
  if (!parsed.success) return null;
  const { outcome, confidence, evidence, criteria, temperature: arc, objections, strengths, weaknesses, nextStep } = parsed.data;
  return {
    guess: { outcome, confidence, evidence },
    analysis: {
      criteria: ANALYSIS_CRITERIA.map((id) => ({ id, status: criteria[id].status, evidence: criteria[id].evidence })),
      temperature: { start: arc.start, middle: arc.middle, end: arc.end },
      objections: objections.map(({ objection, quote, response, handled }) => ({ objection, quote, response, handled })),
      strengths,
      weaknesses,
      nextStep,
    },
  };
}

const stringEnum = (values: readonly string[]) => ({ type: "string", enum: values });

/** O schema do pedido completo. `strict` decide a versão: OpenAI (`additionalProperties: false` em todo nível) ou Google (sem o campo). */
function analysisSchema(strict: boolean) {
  const object = (properties: Record<string, unknown>) => ({
    type: "object",
    ...(strict ? { additionalProperties: false } : {}),
    required: Object.keys(properties),
    properties,
  });
  const temperatureValue = stringEnum(TEMPERATURES);
  return object({
    outcome: stringEnum(CALL_OUTCOMES),
    // O Google não leva `minimum`/`maximum`, como no schema só de desfecho.
    confidence: strict ? { type: "number", minimum: 0, maximum: 1 } : { type: "number" },
    evidence: { type: "string" },
    criteria: object(Object.fromEntries(ANALYSIS_CRITERIA.map((id) => [id, object({ status: stringEnum(CRITERION_STATUSES), evidence: { type: "string" } })]))),
    temperature: object({ start: temperatureValue, middle: temperatureValue, end: temperatureValue }),
    objections: {
      type: "array",
      items: object({ objection: { type: "string" }, quote: { type: "string" }, response: { type: "string" }, handled: stringEnum(OBJECTION_HANDLING) }),
    },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    nextStep: { type: "string" },
  });
}

/** Para o `response_format` `strict` do OpenAI. */
export const ANALYSIS_SCHEMA = analysisSchema(true);
/** Para o `responseSchema` do Gemini, que recusa `additionalProperties`. */
export const ANALYSIS_SCHEMA_GOOGLE = analysisSchema(false);

/**
 * O pedido completo: o do desfecho, mais a régua escrita para o modelo e as regras da análise. A
 * nota não é pedida: o código soma a régua.
 */
export function analysisPrompt(input: { transcript: string; tools: readonly string[] }): string {
  return [
    ...outcomeInstructions(input),
    "",
    "Além do desfecho, avalie o atendimento do AGENTE por esta régua. Para cada critério, diga met (cumpriu), partial (cumpriu em parte) ou missed (não cumpriu), e em evidence copie a fala que mostra isso:",
    "- opening: abriu se identificando e entendeu o motivo do contato. Não cumpre quem não disse quem é, ou seguiu sem entender o que a pessoa queria.",
    "- discovery: perguntou antes de oferecer ou responder, e confirmou o que entendeu. Não cumpre quem respondeu no escuro, ou empurrou uma oferta sem perguntar.",
    "- objections: respondeu cada objeção com informação, sem ignorar nem pressionar. Sem objeção na conversa, é met.",
    "- accuracy: só afirmou o que sabia, usou a ferramenta quando ela existia para isso, e disse quando não sabia. Não cumpre quem inventou informação, prometeu o que não pode cumprir, ou deixou de usar a ferramenta disponível.",
    "- closing: encerrou com um próximo passo claro e combinado com a pessoa. Não cumpre quem encerrou sem combinar nada.",
    "",
    "Regras da análise:",
    "- Baseie-se somente nas falas transcritas.",
    "- temperature: o interesse do CLIENTE no começo, no meio e no fim da conversa (cold, warm ou hot). Use unknown no trecho sem fala do cliente.",
    `- objections: cada objeção do CLIENTE (até ${MAX_OBJECTIONS}). Em quote, copie literalmente a fala do CLIENTE onde ela aparece. Em response, o que o agente respondeu. Cada campo com até ${MAX_OBJECTION_FIELD} caracteres. Sem objeção, lista vazia.`,
    "- strengths e weaknesses: até 3 cada, até 200 caracteres cada, sobre o atendimento do agente.",
    "- nextStep: o que fazer em seguida com este cliente, até 280 caracteres. Vazio quando a conversa não pede nada.",
    "",
    "Transcrição:",
    clipTranscriptForAnalysis(input.transcript),
  ].join("\n");
}
