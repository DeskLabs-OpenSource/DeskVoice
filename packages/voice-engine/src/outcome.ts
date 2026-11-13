import { z } from "zod";

/**
 * O desfecho comercial de uma ligação, em vocabulário fechado.
 *
 * `unknown` não é falha: é a resposta honesta quando a conversa não sustenta uma afirmação sobre o
 * cliente. Um relatório que chuta "não tinha interesse" em cima de um "tudo bem, obrigado" é pior
 * do que um relatório que admite não saber.
 */
export const CALL_OUTCOMES = ["booked", "callback_requested", "message_taken", "not_interested", "info_only", "unknown"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export interface OutcomeGuess {
  outcome: CallOutcome;
  /** 0 a 1, como o provedor declarou. */
  confidence: number;
  /** A fala que sustenta o palpite, copiada da conversa. Vazia em `unknown`. */
  evidence: string;
}

/** Abaixo disto o palpite não vale como afirmação sobre o cliente. */
export const OUTCOME_MIN_CONFIDENCE = 0.6;

export const UNKNOWN_OUTCOME: OutcomeGuess = { outcome: "unknown", confidence: 0, evidence: "" };

/** A forma exata que pedimos ao provedor — e a única que aceitamos de volta. */
export const outcomeGuess = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(280),
});

export const OUTCOME_GUESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "confidence", "evidence"],
  properties: {
    outcome: { type: "string", enum: CALL_OUTCOMES },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "string" },
  },
} as const;

/**
 * O mesmo pedido para o Google, sem `additionalProperties`: o `responseSchema` do Gemini aceita um
 * subconjunto de OpenAPI e recusa o campo. Mandar o schema do OpenAI para lá daria 400 e a
 * classificação nunca aconteceria — e, como falha vira `unknown`, ninguém veria o erro.
 */
export const OUTCOME_GUESS_SCHEMA_GOOGLE = {
  type: "object",
  required: ["outcome", "confidence", "evidence"],
  properties: {
    outcome: { type: "string", enum: CALL_OUTCOMES },
    confidence: { type: "number" },
    evidence: { type: "string" },
  },
} as const;

/** Lê o que o provedor devolveu sem confiar nele: fora da forma, `null`. */
export function readOutcomeGuess(raw: unknown): OutcomeGuess | null {
  const parsed = outcomeGuess.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Aplica o piso de confiança e a exigência de prova.
 *
 * Palpite fraco, ou sem a fala que o sustenta, não vira afirmação sobre o cliente: o desfecho é
 * rebaixado para `unknown`, mas guarda a confiança e a evidência que o provedor deu — é o que
 * permite, depois, medir se o classificador está bom ou só parece bom.
 */
export function settleOutcome(guess: OutcomeGuess): OutcomeGuess {
  if (guess.outcome === "unknown") return guess;
  if (guess.confidence < OUTCOME_MIN_CONFIDENCE || guess.evidence.trim() === "") {
    return { outcome: "unknown", confidence: guess.confidence, evidence: guess.evidence };
  }
  return guess;
}

/**
 * O pedido é o mesmo para todos os provedores: mesma tarefa, mesmas opções, mesma forma de
 * resposta. Quem muda é só o transporte.
 */
export function outcomePrompt(input: { transcript: string; tools: readonly string[] }): string {
  const tools = input.tools.length > 0 ? input.tools.join(", ") : "nenhuma";
  return [
    "Você lê a transcrição de uma ligação de atendimento e diz o desfecho comercial dela.",
    "",
    "Escolha um desfecho desta lista:",
    "- booked: o cliente marcou horário, agendou visita ou fechou algo.",
    "- callback_requested: o cliente pediu para ser chamado depois, ou disse que retorna.",
    "- message_taken: o cliente deixou recado para outra pessoa retornar.",
    "- not_interested: o cliente disse que não quer, ou pediu para não ser mais contatado.",
    "- info_only: o cliente só pediu uma informação e encerrou, sem marcar nada.",
    "- unknown: a conversa não sustenta nenhuma das opções acima.",
    "",
    "Regras:",
    "- Baseie-se somente nas falas transcritas. Não invente o que não está escrito.",
    "- Na dúvida entre duas opções, use unknown com confiança baixa.",
    `- Ferramentas chamadas durante a ligação: ${tools}. Um agendamento confirmado pesa para booked; uma ferramenta que falhou não pesa.`,
    "- Em evidence, copie a fala do CLIENTE que sustenta o desfecho (até 280 caracteres). Em unknown, deixe vazio.",
    "",
    "Transcrição:",
    input.transcript,
  ].join("\n");
}
