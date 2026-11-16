/**
 * Cérebro Gemini (Google): os modelos de texto que a chave alcança e um pedido com saída em JSON.
 *
 * Documentação oficial consultada em 2026-11-16 (ai.google.dev redireciona para aistudio.google.com):
 *   - https://aistudio.google.com/api-reference/models/list-models  (`GET /v1beta/models`; `pageSize`, padrão
 *     50 e máximo 1000; `pageToken` para a página seguinte; resposta com `models[]` e `nextPageToken`, que
 *     falta na última página)
 *   - https://aistudio.google.com/api-reference/models  (o recurso `Model`: `name` no formato `models/{id}`,
 *     `displayName`, `inputTokenLimit` e `supportedGenerationMethods`, com os métodos em Pascal case, como
 *     `generateContent`)
 *   - https://aistudio.google.com/api-reference/generate-content  (`POST /v1beta/models/{model}:generateContent`;
 *     `candidates[].content.parts[].text`; `usageMetadata.promptTokenCount` já inclui
 *     `cachedContentTokenCount`; `candidatesTokenCount`; `thoughtsTokenCount`, cobrado como saída)
 *   - https://aistudio.google.com/docs/api-key  (a chave se cria em aistudio.google.com/apikey; o exemplo REST
 *     manda a chave no cabeçalho `x-goog-api-key`)
 *   - https://aistudio.google.com/docs/api-errors  (401 chave ausente, inválida ou vencida; 402 crédito
 *     pré-pago esgotado; 403 sem permissão; 404 modelo inexistente; 429 limite; 5xx do lado do Google)
 *   - https://aistudio.google.com/docs/pricing  (preços, camada paga "Standard")
 *
 * A chave vai só no cabeçalho `x-goog-api-key`, nunca na URL: o exemplo da página de lista põe
 * `?key=` na URL, e URL cai em log de proxy. O `pageToken` vai na URL, mas não é segredo.
 *
 * O pedido usa `responseMimeType` e `responseSchema` com a forma `google` de `analysis.ts` e `outcome.ts`,
 * como o motor `gemini-live.ts` já faz. A página de saída estruturada desta data só fala da API nova
 * (`/v1beta/interactions`); a referência de `generateContent` ainda descreve o `generationConfig`.
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - o código de uma chave inválida na lista: a página de erros diz 401, e a forma antiga da API
 *     respondia 400 com `API_KEY_INVALID`; as duas são chave recusada, como no motor;
 *   - se o cache implícito cobra só a leitura (o preço "context caching") e nada de armazenamento;
 *   - se `responseSchema` continua aceito em todos os modelos novos (Gemini 4).
 */
import { z } from "zod";
import type { Brain, BrainFailure, BrainModel, BrainPrice } from "../brain";
import { LIST_TIMEOUT_MS, brainFailureByStatus, parseEach, requestJson } from "../brain-http";
import type { Usage } from "../types";

const API_URL = "https://generativelanguage.googleapis.com/v1beta";
const PRICING_SOURCE = "https://aistudio.google.com/docs/pricing";
const PRICING_CHECKED_ON = "2026-11-16";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/**
 * Famílias que declaram `generateContent` mas não devolvem texto: voz (`-tts`), imagem e embedding.
 * O pedido delas nunca traria o JSON.
 */
const NOT_TEXT = ["-tts", "image", "embedding"];

const price = (input: number, cachedInput: number, output: number): BrainPrice => ({
  centsPerMillionInputTokens: input,
  centsPerMillionOutputTokens: output,
  centsPerMillionCachedInputTokens: cachedInput,
  source: PRICING_SOURCE,
  checkedOn: PRICING_CHECKED_ON,
});

/**
 * Preço por modelo, em centavos por milhão de tokens (entrada de texto, leitura de cache, saída com o
 * raciocínio), lido em 2026-11-16 na camada paga "Standard". É dado de preço, não a lista de modelos.
 *
 * Ficaram de fora, de propósito:
 *   - os que mudam de preço acima de 200 mil tokens (`gemini-3.1-pro-preview`, `gemini-2.5-pro`);
 *   - os que já têm troca de preço marcada (`gemini-4-carbon` e `gemini-4-argon` em 2026-12-01;
 *     `gemini-3.8-flash`, `gemini-3.6-flash` e `gemini-robotics-er-2-preview` em 2027-01-01;
 *     `gemini-2.5-flash`, que passa a ser cobrado como outro modelo em 2026-12-01). Um preço com data
 *     para acabar viraria custo errado sem ninguém notar.
 */
const PRICES = new Map<string, BrainPrice>([
  ["gemini-4-hydrogen", price(150, 7.5, 750)],
  ["gemini-3.5-flash-lite", price(30, 3, 250)],
  ["gemini-3.1-flash-lite", price(25, 2.5, 150)],
  ["gemini-3-flash-preview", price(50, 5, 300)],
  ["gemini-2.5-flash-lite", price(10, 1, 40)],
]);

/** O preço do modelo pela tabela, só com o id exato. */
export const priceOf = (id: string): BrainPrice | undefined => PRICES.get(id);

export const isTextModel = (id: string, methods: readonly string[]): boolean => {
  const lower = id.toLowerCase();
  return methods.includes("generateContent") && !NOT_TEXT.some((family) => lower.includes(family));
};

const modelItem = z.object({
  name: z.string().startsWith("models/").min("models/".length + 1),
  displayName: z.string().nullish(),
  inputTokenLimit: z.number().int().positive().nullish(),
  supportedGenerationMethods: z.array(z.string()),
});
const modelPage = z.object({ models: z.array(z.unknown()).nullish(), nextPageToken: z.string().nullish() });
const withName = z.object({ name: z.string() });

const readModel = (item: unknown): BrainModel | null => {
  const parsed = modelItem.safeParse(item);
  if (!parsed.success) return null;
  const { name, displayName, inputTokenLimit, supportedGenerationMethods } = parsed.data;
  // O id do pedido é o nome sem o prefixo `models/`.
  const id = name.slice("models/".length);
  if (!isTextModel(id, supportedGenerationMethods)) return null;
  const known = priceOf(id);
  return {
    id,
    label: displayName && displayName.trim() !== "" ? displayName : id,
    ...(inputTokenLimit ? { contextTokens: inputTokenLimit } : {}),
    ...(known ? { price: known } : {}),
  };
};

const generateBody = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().nullish() })) }) })).min(1),
});
const generateUsage = z.object({
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative(),
    cachedContentTokenCount: z.number().int().nonnegative().nullish(),
    candidatesTokenCount: z.number().int().nonnegative().nullish(),
    thoughtsTokenCount: z.number().int().nonnegative().nullish(),
  }),
});

/** O consumo de `:generateContent`: o cache sai do total de entrada, e o raciocínio é cobrado como saída. */
export function usageOf(body: unknown): Usage {
  const usage = generateUsage.safeParse(body).data?.usageMetadata;
  if (!usage) return {};
  const cached = Math.min(usage.cachedContentTokenCount ?? 0, usage.promptTokenCount);
  return {
    inputTokens: usage.promptTokenCount - cached,
    cachedInputTokens: cached,
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  };
}

// A forma antiga da API recusava a chave com 400 e o motivo `API_KEY_INVALID` nos detalhes.
const errorDetails = z.object({ error: z.object({ details: z.array(z.unknown()) }) });
const invalidKeyDetail = z.object({ reason: z.literal("API_KEY_INVALID") });
const saysInvalidKey = (body: unknown): boolean =>
  errorDetails.safeParse(body).data?.error.details.some((detail) => invalidKeyDetail.safeParse(detail).success) ?? false;

/** O código do erro pelo status e pelo motivo; o texto (`error.message`) nunca é lido. */
const failureOf = (status: number, body: unknown): BrainFailure => (status === 400 && saysInvalidKey(body) ? "rejected" : brainFailureByStatus(status));

/** No pedido, 403 e 404 não são a chave: a chave já foi provada pela lista, e o modelo veio dela. */
const completionFailureOf = (status: number, body: unknown): BrainFailure =>
  status === 403 || status === 404 ? "unexpected_response" : failureOf(status, body);

const brain: Brain = {
  id: "gemini",
  label: "Gemini",
  keyUrl: "https://aistudio.google.com/apikey",

  async listModels(apiKey, options) {
    const timeoutMs = options.timeoutMs ?? LIST_TIMEOUT_MS;
    const items: unknown[] = [];
    const seen = new Set<string>();
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${API_URL}/models?pageSize=${PAGE_SIZE}${token === undefined ? "" : `&pageToken=${encodeURIComponent(token)}`}`;
      const response = await requestJson(url, { method: "GET", headers: { "x-goog-api-key": apiKey } }, { fetch: options.fetch, timeoutMs });
      if (!response.ok) {
        return { ok: false, failure: response.status === null ? "unreachable" : failureOf(response.status, response.body), status: response.status };
      }
      const parsed = modelPage.safeParse(response.body);
      if (!parsed.success) return { ok: false, failure: "unexpected_response", status: response.status };
      // Página sem nome novo é o servidor repetindo a lista: para aqui, como no OpenRouter.
      const fresh = (parsed.data.models ?? []).filter((item) => {
        const name = withName.safeParse(item).data?.name;
        if (name === undefined || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      if (fresh.length === 0) break;
      items.push(...fresh);
      if (!parsed.data.nextPageToken) break;
      token = parsed.data.nextPageToken;
    }
    const models = parseEach(items, readModel).sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  },

  async completeJson(apiKey, request, options) {
    const { model } = request;
    const response = await requestJson(
      `${API_URL}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: request.schema.google },
        }),
      },
      { fetch: options.fetch, timeoutMs: request.timeoutMs },
    );
    if (!response.ok) {
      const failure = response.status === null ? "unreachable" : completionFailureOf(response.status, response.body);
      return { ok: false, failure, status: response.status, model, usage: {} };
    }
    // Um 200 fora da forma (pedido bloqueado, sem candidato) também pode ter sido cobrado.
    const usage = usageOf(response.body);
    const parts = generateBody.safeParse(response.body).data?.candidates[0]?.content.parts;
    const text = parts?.map((part) => part.text ?? "").join("");
    if (!text) return { ok: false, failure: "unexpected_response", status: response.status, model, usage };
    return { ok: true, text, model, usage };
  },
};

export default brain;
