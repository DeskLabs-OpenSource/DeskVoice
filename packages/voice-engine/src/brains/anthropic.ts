/**
 * Cérebro Anthropic: os modelos de texto que a chave alcança e um pedido com saída em JSON.
 *
 * Documentação oficial consultada em 2026-11-16 (docs.anthropic.com redireciona para platform.claude.com):
 *   - https://platform.claude.com/docs/en/api/models-list  (`GET /v1/models`, cabeçalho `anthropic-version`;
 *     `limit` de 1 a 1000, padrão 20; `after_id` para a página seguinte; resposta com `data[]`, `has_more`,
 *     `first_id` e `last_id`. Cada item traz `type: "model"`, `id`, `display_name`, `max_input_tokens`
 *     (pode ser nulo), `lifecycle` e `capabilities` (pode ser nulo) com `structured_outputs.supported`.
 *     Sem filtro pedido, a lista traz os modelos `active` e `deprecated`; os `retired` só vêm se pedidos)
 *   - https://platform.claude.com/docs/en/build-with-claude/structured-outputs  (estável, sem cabeçalho beta:
 *     `POST /v1/messages` com `output_config.format = { type: "json_schema", schema }`; o JSON volta como
 *     texto no bloco `type: "text"` de `content[]`. O schema não aceita `minimum`/`maximum`, `minLength`/
 *     `maxLength` nem limite de lista além de `minItems` 0 ou 1, e todo objeto leva
 *     `additionalProperties: false`. Recurso fora disso é 400)
 *   - https://platform.claude.com/docs/en/build-with-claude/prompt-caching  (sem `cache_control` não há cache
 *     no Messages API; `usage` traz `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
 *     e `output_tokens`, e a entrada total é a soma das três primeiras)
 *   - https://platform.claude.com/docs/en/api/errors  (401 `authentication_error`, 402 `billing_error`,
 *     403 `permission_error`, 404 `not_found_error`, 429 `rate_limit_error`, que também é teto de gasto do
 *     nível, 500 `api_error`, 504 `timeout_error`, 529 `overloaded_error`. O teto de gasto definido pela
 *     organização volta como 400 e só o texto diz isso: aqui fica `unexpected_response`, porque o texto
 *     do provedor nunca é lido)
 *   - https://platform.claude.com/docs/en/about-claude/pricing  (preços, tabela "Model pricing")
 *   - https://platform.claude.com/docs/en/about-claude/models/overview  (os ids de cada modelo)
 *
 * O desenho deixava escolher entre saída estruturada e ferramenta única com `input_schema`. Ficou a saída
 * estruturada, que está documentada como estável nesta data. A ferramenta forçada (`tool_choice`) é
 * recusada com 400 pelos modelos mais novos (Opus 5.5, Sonnet 5.5, Fable 5.1 e 5.2).
 *
 * Diferença do desenho: o cabeçalho de versão vai com o valor dos exemplos da documentação nesta data
 * (`2026-10-21`); a referência usava outro. Modelo que declara `structured_outputs` sem suporte sai da
 * lista, porque todo pedido dele daria 400.
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - o código de uma chave sem crédito pré-pago (a página diz 402, mas não mostra o corpo);
 *   - se algum modelo listado com `capabilities` nulo recusa a saída estruturada;
 *   - o tamanho da resposta com o raciocínio adaptativo ligado por padrão: `MAX_TOKENS` cobre o raciocínio
 *     e o JSON, e uma resposta cortada por ele volta como `unexpected_response`, com o consumo.
 */
import { z } from "zod";
import type { Brain, BrainFailure, BrainModel, BrainPrice } from "../brain";
import { LIST_TIMEOUT_MS, brainFailureByStatus, parseEach, requestJson } from "../brain-http";
import type { Usage } from "../types";

const API_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2026-10-21";
const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
const PRICING_CHECKED_ON = "2026-11-16";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
/** O teto de saída do pedido: o raciocínio também conta aqui. O JSON da análise é pequeno. */
const MAX_TOKENS = 16_000;

const price = (input: number, cachedInput: number, output: number): BrainPrice => ({
  centsPerMillionInputTokens: input,
  centsPerMillionOutputTokens: output,
  centsPerMillionCachedInputTokens: cachedInput,
  source: PRICING_SOURCE,
  checkedOn: PRICING_CHECKED_ON,
});

/**
 * Preço por modelo, em centavos por milhão de tokens (entrada, leitura de cache, saída), lido em
 * 2026-11-16 na tabela "Model pricing". É dado de preço, não a lista de modelos: nunca faz um modelo
 * aparecer nem sumir. Modelo que a API lista e esta tabela não tem aparece sem preço.
 *
 * Todo modelo tem preço de escrita em cache, que o `BrainPrice` não tem. Aqui ele não pesa: o pedido não
 * manda `cache_control`, e sem isso o Messages API não escreve cache. Se uma resposta trouxer escrita em
 * cache, o consumo volta vazio, e quem chama trata como custo desconhecido (`usageOf`).
 *
 * Ficaram de fora, de propósito: o Claude Haiku 5.5, que muda de preço acima de 100 mil tokens de
 * entrada; o Opus 4.1, o Opus 4 e o Sonnet 4, que estão aposentados na API da Anthropic. Preço do pedido
 * com `inference_geo: "us"` é 1,1 vez este; o pedido não manda o campo, e vale o preço da tabela.
 */
const PRICES = new Map<string, BrainPrice>([
  ["claude-fable-5-2", price(800, 20, 4000)],
  ["claude-mythos-5-2", price(800, 20, 4000)],
  ["claude-fable-5-1", price(1000, 25, 5000)],
  ["claude-mythos-5-1", price(1000, 25, 5000)],
  ["claude-fable-5", price(1000, 100, 5000)],
  ["claude-mythos-5", price(1000, 100, 5000)],
  ["claude-opus-5-5", price(400, 20, 2000)],
  ["claude-opus-5", price(500, 50, 2500)],
  ["claude-opus-4-8", price(500, 50, 2500)],
  ["claude-opus-4-7", price(500, 50, 2500)],
  ["claude-opus-4-6", price(500, 50, 2500)],
  ["claude-opus-4-5-20251101", price(500, 50, 2500)],
  ["claude-sonnet-5-5", price(200, 10, 1000)],
  ["claude-sonnet-5", price(200, 20, 1000)],
  ["claude-sonnet-4-6", price(300, 30, 1500)],
  ["claude-sonnet-4-5-20250929", price(300, 30, 1500)],
  ["claude-haiku-4-5-20251001", price(100, 10, 500)],
]);

/** O preço do modelo pela tabela, só com o id exato. */
export const priceOf = (id: string): BrainPrice | undefined => PRICES.get(id);

const modelItem = z.object({
  type: z.literal("model"),
  id: z.string().min(1),
  display_name: z.string().nullish(),
  max_input_tokens: z.number().int().positive().nullish(),
  lifecycle: z.string().nullish(),
  capabilities: z.object({ structured_outputs: z.object({ supported: z.boolean() }).nullish() }).nullish(),
});
const modelPage = z.object({ data: z.array(z.unknown()), has_more: z.boolean().nullish(), last_id: z.string().nullish() });
const withId = z.object({ id: z.string() });

const readModel = (item: unknown): BrainModel | null => {
  const parsed = modelItem.safeParse(item);
  if (!parsed.success) return null;
  const { id, display_name, max_input_tokens, lifecycle, capabilities } = parsed.data;
  // Todo modelo da Anthropic conversa por texto. Sai o que não atenderia o pedido: o aposentado e o que
  // declara não ter saída estruturada. Sem a declaração (`capabilities` nulo), fica.
  if (lifecycle === "retired" || capabilities?.structured_outputs?.supported === false) return null;
  const known = priceOf(id);
  return {
    id,
    label: display_name && display_name.trim() !== "" ? display_name : id,
    ...(max_input_tokens ? { contextTokens: max_input_tokens } : {}),
    ...(known ? { price: known } : {}),
  };
};

/** Palavras do JSON Schema que a saída estruturada recusa com 400. Os limites ficam na leitura com zod. */
const UNSUPPORTED = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems"]);

/** O schema estrito sem os limites que a Anthropic não aceita. `minItems` só fica se for 0 ou 1. */
export function anthropicSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(anthropicSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED.has(key)) continue;
    if (key === "minItems" && value !== 0 && value !== 1) continue;
    // `properties` é um mapa de nomes, não um schema: os nomes passam (um campo pode se chamar
    // `maximum`), e só os valores são limpos.
    out[key] =
      key === "properties" && typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).map(([name, property]) => [name, anthropicSchema(property)]))
        : anthropicSchema(value);
  }
  return out;
}

const messageBody = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().nullish() })),
  stop_reason: z.string().nullish(),
});
const messageUsage = z.object({
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative().nullish(),
    cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
  }),
});

/**
 * O consumo de `/v1/messages`. A escrita em cache tem preço próprio, que o `BrainPrice` não tem: se ela
 * aparecer, o consumo volta vazio, e o custo é desconhecido, nunca menor que o cobrado.
 */
export function usageOf(body: unknown): Usage {
  const usage = messageUsage.safeParse(body).data?.usage;
  if (!usage || (usage.cache_creation_input_tokens ?? 0) > 0) return {};
  return { inputTokens: usage.input_tokens, cachedInputTokens: usage.cache_read_input_tokens ?? 0, outputTokens: usage.output_tokens };
}

const providerError = z.object({ error: z.object({ type: z.string().nullish() }) });

/** O código do erro, lido do tipo; o texto (`error.message`) nunca é lido. */
const failureOf = (status: number, body: unknown): BrainFailure => {
  if (providerError.safeParse(body).data?.error.type === "billing_error") return "no_credit";
  return brainFailureByStatus(status);
};

/** No pedido, 403 e 404 não são a chave: a chave já foi provada pela lista, e o modelo veio dela. */
const completionFailureOf = (status: number, body: unknown): BrainFailure =>
  status === 403 || status === 404 ? "unexpected_response" : failureOf(status, body);

const headersOf = (apiKey: string) => ({ "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION });

const brain: Brain = {
  id: "anthropic",
  label: "Anthropic",
  keyUrl: "https://platform.claude.com/settings/keys",

  async listModels(apiKey, options) {
    const timeoutMs = options.timeoutMs ?? LIST_TIMEOUT_MS;
    const items: unknown[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${API_URL}/models?limit=${PAGE_SIZE}${after === undefined ? "" : `&after_id=${encodeURIComponent(after)}`}`;
      const response = await requestJson(url, { method: "GET", headers: headersOf(apiKey) }, { fetch: options.fetch, timeoutMs });
      if (!response.ok) {
        return { ok: false, failure: response.status === null ? "unreachable" : failureOf(response.status, response.body), status: response.status };
      }
      const parsed = modelPage.safeParse(response.body);
      if (!parsed.success) return { ok: false, failure: "unexpected_response", status: response.status };
      // Página sem id novo é o servidor repetindo a lista: para aqui, como no OpenRouter.
      const fresh = parsed.data.data.filter((item) => {
        const id = withId.safeParse(item).data?.id;
        if (id === undefined || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (fresh.length === 0) break;
      items.push(...fresh);
      if (!parsed.data.has_more || !parsed.data.last_id) break;
      after = parsed.data.last_id;
    }
    const models = parseEach(items, readModel).sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  },

  async completeJson(apiKey, request, options) {
    const { model } = request;
    const response = await requestJson(
      `${API_URL}/messages`,
      {
        method: "POST",
        headers: headersOf(apiKey),
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: "user", content: request.prompt }],
          output_config: { format: { type: "json_schema", schema: anthropicSchema(request.schema.strict) } },
        }),
      },
      { fetch: options.fetch, timeoutMs: request.timeoutMs },
    );
    if (!response.ok) {
      const failure = response.status === null ? "unreachable" : completionFailureOf(response.status, response.body);
      return { ok: false, failure, status: response.status, model, usage: {} };
    }
    // Um 200 fora da forma também foi cobrado: o consumo volta sempre.
    const usage = usageOf(response.body);
    const parsed = messageBody.safeParse(response.body).data;
    // Cortado pelo teto (`max_tokens`) ou recusado (`refusal`), o texto não é o JSON inteiro.
    const finished = parsed?.stop_reason === "end_turn" || parsed?.stop_reason === "stop_sequence";
    const text = parsed?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!finished || !text) return { ok: false, failure: "unexpected_response", status: response.status, model, usage };
    return { ok: true, text, model, usage };
  },
};

export default brain;
