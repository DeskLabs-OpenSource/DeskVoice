/**
 * Cérebro OpenAI: os modelos de texto que a chave alcança e um pedido com saída em JSON.
 *
 * Documentação oficial consultada em 2026-11-16:
 *   - https://developers.openai.com/api/reference/resources/models/methods/list  (`GET /v1/models`,
 *     `Authorization: Bearer`; devolve `object: "list"` e `data[]` com `id`, `created`, `object: "model"`,
 *     `owned_by` e `shutdown_date` opcional. Sem paginação e sem campo de modalidade: o filtro de texto
 *     é por exclusão de famílias pelo nome, como o desenho pede)
 *   - https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
 *     (`POST /v1/chat/completions`, `response_format: { type: "json_schema", json_schema: { name, strict, schema } }`,
 *     `choices[].message.content` que pode ser nulo, `usage.prompt_tokens`, `usage.completion_tokens` e
 *     `usage.prompt_tokens_details.cached_tokens`, opcional)
 *   - https://developers.openai.com/api/docs/guides/error-codes  (401 chave inválida ou revogada, 403 país não
 *     atendido, 429 que é limite de pedidos OU falta de crédito pelo `error.code`, 5xx do lado deles;
 *     a mesma leitura do motor `openai-realtime.ts`, conferida lá em 2026-11-12)
 *   - https://developers.openai.com/api/docs/pricing  (preços, aba "Standard", tabela de tokens de texto)
 *
 * Endereços e cabeçalhos iguais aos do desenho (seção 3.2).
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - que a lista de uma chave restrita a um projeto traga só os modelos que ela alcança;
 *   - que todo modelo que sobra do filtro aceite `/chat/completions` com `json_schema` (modelos de
 *     completar texto antigos, como `davinci-002`, não aceitam, e o filtro do desenho não os tira).
 */
import { z } from "zod";
import type { Brain, BrainFailure, BrainModel, BrainPrice } from "../brain";
import { LIST_TIMEOUT_MS, brainFailureByStatus, chatCompletionJson, parseEach, requestJson } from "../brain-http";

const API_URL = "https://api.openai.com/v1";
const PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
const PRICING_CHECKED_ON = "2026-11-16";

/**
 * Famílias que não conversam por texto (desenho da R4, seção 3.1). A API não declara modalidade, então
 * o filtro é pelo nome: um modelo novo de texto aparece sozinho, e uma família nova que não é de texto
 * aparece até alguém pôr o nome dela aqui.
 */
const NOT_TEXT = ["embedding", "whisper", "tts", "dall-e", "moderation", "-realtime", "-transcribe", "-audio", "image"];

export const isTextModel = (id: string): boolean => {
  const lower = id.toLowerCase();
  return !NOT_TEXT.some((family) => lower.includes(family));
};

const price = (input: number, cachedInput: number | undefined, output: number): BrainPrice => ({
  centsPerMillionInputTokens: input,
  centsPerMillionOutputTokens: output,
  ...(cachedInput === undefined ? {} : { centsPerMillionCachedInputTokens: cachedInput }),
  source: PRICING_SOURCE,
  checkedOn: PRICING_CHECKED_ON,
});

/**
 * Preço por modelo, em centavos por milhão de tokens (entrada, entrada em cache, saída), lido em
 * 2026-11-16 na aba "Standard" da página de preços. É dado de preço, não a lista de modelos: nunca faz
 * um modelo aparecer nem sumir. Modelo que a API lista e esta tabela não tem aparece sem preço.
 *
 * Ficaram de fora, de propósito, as linhas que este cérebro não sabe cobrar inteiras: as que têm preço
 * de escrita em cache (`gpt-6-*`, `gpt-6.1-*`, `gpt-5.6-*`; o consumo de `/chat/completions` não separa
 * a escrita) e as que mudam de preço acima de 272 mil tokens de contexto (`gpt-5.5`, `gpt-5.4` e os
 * `-pro` deles). Sem preço de cache publicado (os `-pro`), o cache cobra como entrada cheia.
 */
const PRICES = new Map<string, BrainPrice>([
  ["gpt-5.4-mini", price(75, 7.5, 450)],
  ["gpt-5.4-nano", price(20, 2, 125)],
  ["gpt-5.2", price(175, 17.5, 1400)],
  ["gpt-5.2-pro", price(2100, undefined, 16800)],
  ["gpt-5.1", price(125, 12.5, 1000)],
  ["gpt-5", price(125, 12.5, 1000)],
  ["gpt-5-mini", price(25, 2.5, 200)],
  ["gpt-5-nano", price(5, 0.5, 40)],
  ["gpt-5-pro", price(1500, undefined, 12000)],
  ["gpt-4.1", price(200, 50, 800)],
  ["gpt-4.1-mini", price(40, 10, 160)],
  ["gpt-4o", price(250, 125, 1000)],
  ["gpt-4o-mini", price(15, 7.5, 60)],
  ["o3-pro", price(2000, undefined, 8000)],
  ["o3", price(200, 50, 800)],
]);

/** O preço do modelo pela tabela, só com o id exato: um id datado (`gpt-4o-2024-08-06`) não herda o do apelido. */
export const priceOf = (id: string): BrainPrice | undefined => PRICES.get(id);

const modelItem = z.object({ id: z.string().min(1), object: z.literal("model") });
const modelList = z.object({ object: z.literal("list"), data: z.array(z.unknown()) });

const readModel = (item: unknown): BrainModel | null => {
  const parsed = modelItem.safeParse(item);
  if (!parsed.success || !isTextModel(parsed.data.id)) return null;
  const { id } = parsed.data;
  const known = priceOf(id);
  return { id, label: id, ...(known ? { price: known } : {}) };
};

// 429 nem sempre é "espere": estes códigos (e o tipo `insufficient_quota`) dizem que falta crédito ou
// que um teto de gasto foi atingido, e repetir não resolve.
const BILLING_CODES = new Set([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "insufficient_quota",
]);
const providerError = z.object({ error: z.object({ code: z.string().nullish(), type: z.string().nullish() }) });

/** O código do erro, lido do corpo; o texto (`error.message`) nunca é lido. */
export const failureOf = (status: number, body: unknown): BrainFailure => {
  const error = providerError.safeParse(body).data?.error;
  if (status === 429 && (BILLING_CODES.has(error?.code ?? "") || BILLING_CODES.has(error?.type ?? ""))) return "no_credit";
  if (status === 403 && error?.code === "unsupported_country_region_territory") return "region_unavailable";
  return brainFailureByStatus(status);
};

const brain: Brain = {
  id: "openai",
  label: "OpenAI",
  keyUrl: "https://platform.openai.com/api-keys",

  async listModels(apiKey, options) {
    const response = await requestJson(
      `${API_URL}/models`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
      { fetch: options.fetch, timeoutMs: options.timeoutMs ?? LIST_TIMEOUT_MS },
    );
    if (!response.ok) {
      return { ok: false, failure: response.status === null ? "unreachable" : failureOf(response.status, response.body), status: response.status };
    }
    const list = modelList.safeParse(response.body);
    if (!list.success) return { ok: false, failure: "unexpected_response", status: response.status };
    const models = parseEach(list.data.data, readModel).sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  },

  completeJson(apiKey, request, options) {
    return chatCompletionJson(`${API_URL}/chat/completions`, apiKey, request, { fetch: options.fetch, failureOf });
  },
};

export default brain;
