import { z } from "zod";
import type { BrainFailure, BrainJsonResult } from "./brain";
import type { Usage } from "./types";

/** Prazo da lista de modelos (desenho da R4, seção 3.1). */
export const LIST_TIMEOUT_MS = 10_000;

/** O que voltou de um pedido: o corpo de um 2xx já lido, ou o status de outro. */
export type BrainHttpResponse = { ok: true; status: number; body: unknown } | { ok: false; status: number | null; body: unknown };

/**
 * Um pedido com prazo. Nunca lança: sem resposta (prazo, DNS, conexão recusada) é `status: null`.
 * O corpo volta só para quem chama ler com zod; nada aqui o registra, nem a chave dos cabeçalhos.
 */
export async function requestJson(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
  options: { fetch?: typeof fetch; timeoutMs: number },
): Promise<BrainHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    let text: string;
    try {
      response = await (options.fetch ?? fetch)(url, {
        method: init.method,
        headers: init.body === undefined ? init.headers : { "content-type": "application/json", ...init.headers },
        body: init.body,
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      // Prazo, DNS, conexão recusada: para quem pediu é o mesmo "o provedor não respondeu".
      return { ok: false, status: null, body: undefined };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // Corpo que não é JSON (página de erro de um proxy, por exemplo): fica sem corpo.
      body = undefined;
    }
    return response.ok ? { ok: true, status: response.status, body } : { ok: false, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A regra geral do status, no vocabulário do cérebro. O 404 não é `model_unavailable` aqui: a lista
 * não tem modelo, e no pedido o modelo veio da lista da própria chave, então é resposta inesperada.
 */
export function brainFailureByStatus(status: number | null): BrainFailure {
  if (status === null) return "unreachable";
  if (status === 401 || status === 403) return "rejected";
  if (status === 402) return "no_credit";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "unreachable";
  return "unexpected_response";
}

/**
 * Lê uma lista item por item: o que sai da forma é descartado e o resto continua. Um item novo e
 * estranho do provedor não derruba a lista inteira. Id repetido fica com o primeiro.
 */
export function parseEach<T extends { id: string }>(items: readonly unknown[], read: (item: unknown) => T | null): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const parsed = read(item);
    if (parsed === null || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

// `/chat/completions`, na forma da OpenAI, que o OpenRouter também segue: `choices[].message.content`
// e `usage` com `prompt_tokens`, `completion_tokens` e `prompt_tokens_details.cached_tokens`.
const chatBody = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1),
});
const chatUsage = z.object({
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().nullish() }).nullish(),
  }),
});

/** O consumo de `/chat/completions`: a entrada em cache sai do total de entrada, para não ser cobrada duas vezes. */
export function chatUsageOf(body: unknown): Usage {
  const usage = chatUsage.safeParse(body).data?.usage;
  if (!usage) return {};
  const cached = Math.min(usage.prompt_tokens_details?.cached_tokens ?? 0, usage.prompt_tokens);
  return { inputTokens: usage.prompt_tokens - cached, cachedInputTokens: cached, outputTokens: usage.completion_tokens };
}

/**
 * Um `POST /chat/completions` com `json_schema` estrito, no formato da OpenAI. Devolve sempre o
 * consumo: um 200 fora da forma também foi cobrado. O texto devolvido é só o conteúdo pedido; a
 * leitura dele (zod de `readClassifyText`) é de quem chama.
 */
export async function chatCompletionJson(
  url: string,
  apiKey: string,
  request: { model: string; prompt: string; schema: { name: string; strict: object }; timeoutMs: number },
  options: { fetch?: typeof fetch; failureOf: (status: number, body: unknown) => BrainFailure },
): Promise<BrainJsonResult> {
  const { model } = request;
  const response = await requestJson(
    url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: request.prompt }],
        response_format: { type: "json_schema", json_schema: { name: request.schema.name, strict: true, schema: request.schema.strict } },
      }),
    },
    { fetch: options.fetch, timeoutMs: request.timeoutMs },
  );
  if (!response.ok) {
    const failure = response.status === null ? "unreachable" : options.failureOf(response.status, response.body);
    return { ok: false, failure, status: response.status, model, usage: {} };
  }
  const usage = chatUsageOf(response.body);
  const text = chatBody.safeParse(response.body).data?.choices[0]?.message.content;
  if (typeof text !== "string" || text === "") return { ok: false, failure: "unexpected_response", status: response.status, model, usage };
  return { ok: true, text, model, usage };
}
