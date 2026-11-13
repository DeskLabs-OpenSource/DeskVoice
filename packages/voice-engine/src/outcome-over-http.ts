import type { ClassifyOptions } from "./types";
import { UNKNOWN_OUTCOME, type OutcomeGuess } from "./outcome";

const DEFAULT_TIMEOUT_MS = 10_000;

const scheduleTimeout = (fn: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

export interface OutcomeRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** Lê o palpite do corpo de um 200. `null` quando o corpo não tem o que esperar. */
  read: (body: unknown) => OutcomeGuess | null;
}

/**
 * Um `POST` com prazo que devolve sempre um palpite — e `unknown` em tudo que não for um 200 com
 * corpo legível.
 *
 * Nunca lança, de propósito: a classificação é um enfeite do resumo, não o resumo. Provedor fora do
 * ar, chave sem crédito, limite de pedidos ou resposta que não é JSON custam uma ligação sem
 * desfecho — nunca uma tarefa que falha três vezes e trava a fila atrás dela. Nada aqui registra a
 * chave nem o corpo do provedor.
 */
export async function classifyOutcomeOverHttp(request: OutcomeRequest, options: ClassifyOptions): Promise<OutcomeGuess> {
  const controller = new AbortController();
  const cancel = (options.schedule ?? scheduleTimeout)(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    let text: string;
    try {
      response = await (options.fetch ?? fetch)(request.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...request.headers },
        body: request.body,
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      // Prazo, DNS, conexão recusada: para quem lê o resumo, é a mesma coisa.
      return UNKNOWN_OUTCOME;
    }
    if (!response.ok) return UNKNOWN_OUTCOME;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return UNKNOWN_OUTCOME;
    }
    return request.read(body) ?? UNKNOWN_OUTCOME;
  } finally {
    cancel();
  }
}
