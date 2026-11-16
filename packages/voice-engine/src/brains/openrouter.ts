/**
 * Cérebro OpenRouter: os modelos de texto que a chave alcança, com o preço da própria lista, e um
 * pedido com saída em JSON.
 *
 * Documentação oficial consultada em 2026-11-16:
 *   - https://openrouter.ai/docs/api-reference/api-keys/get-current-key  (`GET /api/v1/key`,
 *     `Authorization: Bearer`; 200 com `{ data: { label, limit, usage, ... } }`, 401 para chave ausente ou
 *     inválida). É a prova da chave: a lista de modelos é pública e responderia 200 a uma chave recusada.
 *   - https://openrouter.ai/docs/api-reference/models/get-models  (`GET /api/v1/models`; `data[]` com `id`,
 *     `name`, `context_length` inteiro ou nulo, `architecture.input_modalities` e `output_modalities`, e
 *     `pricing.prompt` e `pricing.completion` em **texto**, "USD per token", mais `input_cache_read`
 *     opcional. `output_modalities` padrão `text`. Paginação por `offset` e `limit`, padrão 500 e máximo
 *     1000; "When both offset and limit are omitted, the full list is returned", mas o exemplo da mesma
 *     página traz `links.next` não nulo com 150 modelos. Para não depender de qual das duas vale, o
 *     pedido manda `limit=1000` e segue `offset` até vir uma página menor, sem id novo, ou o teto de 20.)
 *   - https://openrouter.ai/docs/api-reference/chat-completion  (`POST /api/v1/chat/completions`,
 *     `response_format: { type: "json_schema", json_schema: { name, schema } }`, `choices[].message.content`,
 *     `usage.prompt_tokens`, `completion_tokens` e `prompt_tokens_details.cached_tokens`)
 *   - https://openrouter.ai/docs/api-reference/errors  (400 parâmetro, 401 chave inválida ou desativada,
 *     402 sem crédito, 403 moderação ou guarda, 408 prazo, 429 limite, 502 e 503 modelo ou provedor fora;
 *     erro no meio da geração pode vir com 200 e `error` no corpo)
 *
 * Endereços e cabeçalhos iguais aos do desenho (seção 3.2). A lista de modelos é pedida com a chave,
 * como o desenho diz; a página a descreve com autenticação global.
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - se `/api/v1/models` com `limit` e `offset` pagina de fato, ou devolve tudo de uma vez;
 *   - se a lista lida com a chave muda conforme as restrições da conta (provedores, região, dados);
 *   - o preço publicado negativo (`-1`) de modelos que roteiam para outros: aqui ele vira "sem preço".
 *
 * Além de `prompt`, `completion` e `input_cache_read`, o `pricing` da lista traz outros componentes
 * (`request` por pedido, busca na web, imagem, escrita em cache). Qualquer um deles diferente de zero
 * deixa o modelo sem preço: o `BrainPrice` só cobra por token, e o número ficaria abaixo da fatura.
 */
import { z } from "zod";
import type { Brain, BrainFailure, BrainModel, BrainPrice } from "../brain";
import { LIST_TIMEOUT_MS, brainFailureByStatus, chatCompletionJson, parseEach, requestJson } from "../brain-http";

const API_URL = "https://openrouter.ai/api/v1";
const MODELS_URL = `${API_URL}/models`;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/**
 * Dólar por token, em texto, para centavo por milhão: × 100 × 1 000 000. Fora da forma, negativo ou não
 * finito é `undefined`, e o modelo fica sem preço; zero só quando o provedor publica zero.
 */
export function centsPerMillionOf(dollarsPerToken: string | undefined): number | undefined {
  if (dollarsPerToken === undefined || !/^\d+(\.\d+)?(e-?\d+)?$/i.test(dollarsPerToken.trim())) return undefined;
  const value = Number(dollarsPerToken) * 1e8;
  if (!Number.isFinite(value) || value < 0) return undefined;
  // A conversão em ponto flutuante deixa ruído (5.000000000000001): doze algarismos bastam ao preço.
  return Number(value.toPrecision(12));
}

const modelItem = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  context_length: z.number().int().positive().nullish(),
  architecture: z.object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) }),
  pricing: z.object({ prompt: z.string(), completion: z.string(), input_cache_read: z.string().nullish() }).passthrough(),
});

/** Os componentes que o `BrainPrice` sabe cobrar. Qualquer outro diferente de zero cobra fora dele. */
const PRICED_BY_TOKEN = new Set(["prompt", "completion", "input_cache_read"]);

/** Zero publicado: `"0"`, `"0.0"` ou o número 0. Ausente ou nulo também não cobra. O resto conta como tarifa. */
const isZeroOrAbsent = (value: unknown): boolean =>
  value === undefined || value === null || value === 0 || (typeof value === "string" && /^0+(\.0+)?$/.test(value.trim()));

/**
 * Tarifa além do token (`request` por pedido, busca na web, imagem, escrita em cache e o que vier):
 * o preço por token sozinho ficaria abaixo do cobrado. Preço incompleto mostrado como completo é o mesmo
 * erro do zero inventado, então o modelo fica sem preço.
 */
const chargesBeyondTokens = (pricing: Record<string, unknown>): boolean =>
  Object.entries(pricing).some(([key, value]) => !PRICED_BY_TOKEN.has(key) && !isZeroOrAbsent(value));
const modelPage = z.object({ data: z.array(z.unknown()) });
const withId = z.object({ id: z.string() });
const keyInfo = z.object({ data: z.object({}).passthrough() });

const readModel =
  (today: string) =>
  (item: unknown): BrainModel | null => {
    const parsed = modelItem.safeParse(item);
    if (!parsed.success) return null;
    const { id, name, context_length, architecture, pricing } = parsed.data;
    // Só texto: entra texto e sai texto. Modelo só de imagem, de áudio ou de embedding não conversa.
    if (!architecture.input_modalities.includes("text") || !architecture.output_modalities.includes("text")) return null;
    const input = centsPerMillionOf(pricing.prompt);
    const output = centsPerMillionOf(pricing.completion);
    const cached = centsPerMillionOf(pricing.input_cache_read ?? undefined);
    const price: BrainPrice | undefined =
      input === undefined || output === undefined || chargesBeyondTokens(pricing)
        ? undefined
        : {
            centsPerMillionInputTokens: input,
            centsPerMillionOutputTokens: output,
            ...(cached === undefined ? {} : { centsPerMillionCachedInputTokens: cached }),
            source: MODELS_URL,
            checkedOn: today,
          };
    return {
      id,
      label: name && name.trim() !== "" ? name : id,
      ...(context_length ? { contextTokens: context_length } : {}),
      ...(price ? { price } : {}),
    };
  };

/**
 * O código do erro pelo status. O texto do provedor nunca é lido. No pedido, o 403 é moderação ou
 * guarda da conta, não chave recusada: dizer "confira a chave" mandaria a pessoa ao lugar errado.
 */
const failureOf = (status: number): BrainFailure => brainFailureByStatus(status);
const completionFailureOf = (status: number): BrainFailure => (status === 403 ? "unexpected_response" : brainFailureByStatus(status));

const brain: Brain = {
  id: "openrouter",
  label: "OpenRouter",
  keyUrl: "https://openrouter.ai/settings/keys",

  async listModels(apiKey, options) {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const timeoutMs = options.timeoutMs ?? LIST_TIMEOUT_MS;
    // A prova da chave vem antes: `/models` é público e daria 200 a uma chave recusada.
    const key = await requestJson(`${API_URL}/key`, { method: "GET", headers }, { fetch: options.fetch, timeoutMs });
    if (!key.ok) return { ok: false, failure: key.status === null ? "unreachable" : failureOf(key.status), status: key.status };
    if (!keyInfo.safeParse(key.body).success) return { ok: false, failure: "unexpected_response", status: key.status };

    const items: unknown[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${MODELS_URL}?output_modalities=text&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const response = await requestJson(url, { method: "GET", headers }, { fetch: options.fetch, timeoutMs });
      if (!response.ok) {
        return { ok: false, failure: response.status === null ? "unreachable" : failureOf(response.status), status: response.status };
      }
      const parsed = modelPage.safeParse(response.body);
      if (!parsed.success) return { ok: false, failure: "unexpected_response", status: response.status };
      // Uma página sem id novo é o servidor repetindo a lista inteira (sem paginar): para aqui. Item
      // sem id texto fica de fora já aqui; o resto da forma é conferido por modelo, adiante.
      const fresh = parsed.data.data.filter((item) => {
        const id = withId.safeParse(item).data?.id;
        if (id === undefined || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (fresh.length === 0) break;
      items.push(...fresh);
      if (parsed.data.data.length < PAGE_SIZE) break;
    }
    const models = parseEach(items, readModel(options.today)).sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  },

  completeJson(apiKey, request, options) {
    return chatCompletionJson(`${API_URL}/chat/completions`, apiKey, request, { fetch: options.fetch, failureOf: completionFailureOf });
  },
};

export default brain;
