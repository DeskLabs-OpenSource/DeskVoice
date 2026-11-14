import { byStatus } from "./key-check";
import { ANALYSIS_TIMEOUT_MS, readAnalysisGuess, type AnalysisGuess } from "./analysis";
import { readOutcomeGuess, type OutcomeGuess } from "./outcome";
import { estimateCostCents } from "./pricing";
import type { ClassifyFailure, ClassifyOptions, ClassifyResult, EnginePricing, KeyCheckResult, TranscribeResult, Usage } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

const scheduleTimeout = (fn: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

/** O que se leu de um 200: o palpite do desfecho e, no pedido completo, a análise. */
export interface OutcomeReading {
  guess: OutcomeGuess;
  analysis?: AnalysisGuess;
}

export interface HttpRequest<T> {
  url: string;
  headers: Record<string, string>;
  /** Texto vai como JSON; `FormData` vai como multipart, com o cabeçalho que o `fetch` monta. */
  body: string | FormData;
  /** O modelo pedido: o preço abaixo é o dele. */
  model: string;
  pricing: EnginePricing;
  /** Lê o resultado do corpo de um 200. `null` quando o corpo não tem o que esperar. */
  read: (body: unknown) => T | null;
  /** Lê o consumo que o provedor declarou no corpo de um 200. Sem a declaração, `{}`. */
  usage: (body: unknown) => Usage;
  /** O que o provedor diz de próprio em respostas de erro; `undefined` cai na regra geral do status. */
  classify?: (status: number, body: unknown) => KeyCheckResult | undefined;
}

/**
 * Lê o texto JSON que o provedor pôs na resposta: só o desfecho, ou o desfecho com a análise
 * (`analyze`). Texto que não é JSON, ou fora da forma pedida, é `null`.
 */
export function readClassifyText(text: unknown, analyze: boolean): OutcomeReading | null {
  if (typeof text !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (analyze) return readAnalysisGuess(raw);
  const guess = readOutcomeGuess(raw);
  return guess ? { guess } : null;
}

/** O prazo do pedido: o de quem chamou, ou 30 s no pedido completo. Sem nada, o padrão de 10 s. */
export const classifyOptionsFor = (options: ClassifyOptions, analyze: boolean): ClassifyOptions =>
  analyze && options.timeoutMs === undefined ? { ...options, timeoutMs: ANALYSIS_TIMEOUT_MS } : options;

export type OutcomeRequest = HttpRequest<OutcomeReading>;

export type HttpResult<T> = { model: string; usage: Usage; costCents: number } & ({ ok: true; value: T } | { ok: false; failure: ClassifyFailure; status: number | null });

const asFailure = (result: KeyCheckResult): ClassifyFailure => (result === "accepted" || result === "not_needed" ? "unexpected_response" : result);

/**
 * Um `POST` com prazo, traduzido para um resultado ou para o motivo de não ter um, no vocabulário do
 * teste da chave. Devolve sempre o consumo e o custo: um 200 fora da forma também foi cobrado.
 *
 * Nunca lança, de propósito: quem chama decide o que registrar, e a tarefa não volta para a fila
 * para pagar de novo. Nada aqui registra a chave nem o corpo do provedor.
 */
export async function postOverHttp<T>(request: HttpRequest<T>, options: ClassifyOptions): Promise<HttpResult<T>> {
  const { model, pricing } = request;
  const failed = (failure: ClassifyFailure, status: number | null, usage: Usage = {}): HttpResult<T> => ({
    ok: false,
    failure,
    status,
    model,
    usage,
    costCents: estimateCostCents(pricing, usage),
  });
  const controller = new AbortController();
  const cancel = (options.schedule ?? scheduleTimeout)(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    let body: unknown;
    try {
      response = await (options.fetch ?? fetch)(request.url, {
        method: "POST",
        headers: typeof request.body === "string" ? { "content-type": "application/json", ...request.headers } : request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        // Corpo que não é JSON (página de erro de um proxy, por exemplo): fica sem corpo.
        body = undefined;
      }
    } catch {
      // Prazo, DNS, conexão recusada: o provedor não respondeu.
      return failed("unreachable", null);
    }
    if (!response.ok) return failed(asFailure(request.classify?.(response.status, body) ?? byStatus(response.status)), response.status);
    const usage = request.usage(body);
    const value = request.read(body);
    if (value === null) return failed("unexpected_response", response.status, usage);
    return { ok: true, value, model, usage, costCents: estimateCostCents(pricing, usage) };
  } finally {
    cancel();
  }
}

/** O desfecho por um `POST` com prazo: `postOverHttp` com o palpite (e, no pedido completo, a análise) no lugar do valor. */
export async function classifyOutcomeOverHttp(request: OutcomeRequest, options: ClassifyOptions): Promise<ClassifyResult> {
  const result = await postOverHttp(request, options);
  if (!result.ok) return result;
  const { value, ...rest } = result;
  return { ...rest, ...value };
}

// Um lado de uma ligação longa leva mais que os 10 s de um texto curto para voltar transcrito.
const TRANSCRIBE_TIMEOUT_MS = 120_000;

/** A transcrição por um `POST` com prazo: `postOverHttp` com o texto no lugar do valor. */
export async function transcribeOverHttp(request: HttpRequest<string>, options: ClassifyOptions): Promise<TranscribeResult> {
  const result = await postOverHttp(request, { timeoutMs: TRANSCRIBE_TIMEOUT_MS, ...options });
  if (!result.ok) return result;
  const { value, ...rest } = result;
  return { ...rest, text: value };
}
