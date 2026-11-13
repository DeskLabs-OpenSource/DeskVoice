import type { ZodType } from "zod";
import type { KeyCheck, KeyCheckOptions, KeyCheckResult } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

const scheduleTimeout = (fn: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(fn, delayMs);
  return () => clearTimeout(timer);
};

export interface KeyCheckRequest {
  url: string;
  headers: Record<string, string>;
  model: string;
  /** O corpo de um 200 que prova o acesso ao modelo. Fora dele, `unexpected_response`. */
  accepted: ZodType;
  /** O que o provedor diz de próprio em respostas de erro; `undefined` cai na regra geral do status. */
  classify?: (status: number, body: unknown) => KeyCheckResult | undefined;
}

export function byStatus(status: number): KeyCheckResult {
  if (status === 401 || status === 403) return "rejected";
  if (status === 404) return "model_unavailable";
  if (status === 402) return "no_credit";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unreachable";
  return "unexpected_response";
}

/**
 * Um `GET` com prazo, traduzido para o vocabulário fechado. Nada aqui registra a chave nem o
 * corpo do provedor: o resultado é só o código.
 */
export async function checkKeyOverHttp(request: KeyCheckRequest, options: KeyCheckOptions): Promise<KeyCheck> {
  const controller = new AbortController();
  const cancel = (options.schedule ?? scheduleTimeout)(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const done = (result: KeyCheckResult): KeyCheck => ({ result, model: request.model });
  try {
    let response: Response;
    let body: unknown;
    try {
      response = await (options.fetch ?? fetch)(request.url, { method: "GET", headers: request.headers, signal: controller.signal });
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        // Corpo que não é JSON (página de erro de um proxy, por exemplo): fica sem corpo.
        body = undefined;
      }
    } catch {
      // Prazo, DNS, conexão recusada: para quem testa é o mesmo "o provedor não respondeu".
      return done("unreachable");
    }
    if (response.ok) return done(request.accepted.safeParse(body).success ? "accepted" : "unexpected_response");
    return done(request.classify?.(response.status, body) ?? byStatus(response.status));
  } finally {
    cancel();
  }
}
