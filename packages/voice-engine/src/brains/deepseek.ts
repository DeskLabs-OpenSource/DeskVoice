/**
 * Cérebro DeepSeek: os modelos de texto que a chave alcança, um pedido com saída em JSON e a conversa
 * em streaming, com ferramentas (`chat`, R5 fatia 2).
 *
 * Documentação oficial consultada em 2026-11-16:
 *   - https://api-docs.deepseek.com/  (endereço base `https://api.deepseek.com`, `Authorization: Bearer`)
 *   - https://api-docs.deepseek.com/api/list-models  (`GET /models`; `object: "list"` e `data[]` com `id`,
 *     `object: "model"` e `owned_by`; opcionais `name`, `context_window`, `input_modalities` (`text`,
 *     `image`) e `output_modalities` (`text`). Sem paginação)
 *   - https://api-docs.deepseek.com/api/create-chat-completion  (`POST /chat/completions`; `response_format`
 *     só aceita `text` ou `json_object`, e o próprio pedido tem de pedir JSON; `choices[].message.content`
 *     pode ser nulo; `usage.prompt_tokens` é a soma de `prompt_cache_hit_tokens` e
 *     `prompt_cache_miss_tokens`, que o esquema põe em `prompt_tokens_details` e o exemplo põe direto em
 *     `usage`; `prompt_tokens_details.cached_tokens`)
 *   - a mesma página de `create-chat-completion`, conferida em 2026-11-17, para `chat`: `stream_options`
 *     ("Must be set together with `stream: true`") com `include_usage` ("If set to `true`, all chunks in
 *     the stream will include a `usage` field, whose value is `null` on every chunk except the last one");
 *     o último pedaço antes do `[DONE]` traz o consumo do pedido inteiro, com ou sem a opção;
 *     `delta.tool_calls[]` com `index`, e o primeiro pedaço de cada chamada traz `id`, `type` e `function`;
 *     `delta.reasoning_content` só no modo de raciocínio
 *   - https://api-docs.deepseek.com/quick_start/error_codes  (400 formato, 401 chave errada, 402 sem saldo,
 *     422 parâmetro, 429 limite, 500 erro deles, 503 sobrecarga)
 *   - https://api-docs.deepseek.com/quick_start/pricing  (preços)
 *
 * Endereços e cabeçalhos iguais aos do desenho (seção 3.2).
 *
 * **Sem preço.** A DeepSeek cobra o dobro no horário de pico (01:00–04:00 e 06:00–10:00 UTC, de segunda a
 * sexta, fora feriados chineses) e a metade no resto. O preço muda com a hora do pedido e não cabe no
 * `BrainPrice`. Por isso não há tabela: todo modelo aparece sem preço, nunca com o preço de um dos horários.
 *
 * O formato do JSON vai no texto do pedido, porque `json_object` não leva schema. A garantia é a leitura
 * com zod de quem chama (`readClassifyText`).
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - o código de uma chave recusada na lista (a página de erros só fala do pedido);
 *   - que o modelo siga o schema escrito no texto do pedido sem o modo de schema estrito.
 */
import { z } from "zod";
import type { Brain, BrainFailure, BrainModel } from "../brain";
import { LIST_TIMEOUT_MS, brainFailureByStatus, chatStream, parseEach, requestJson } from "../brain-http";
import type { Usage } from "../types";

const API_URL = "https://api.deepseek.com";

const modelItem = z.object({
  id: z.string().min(1),
  object: z.literal("model"),
  name: z.string().nullish(),
  context_window: z.number().int().positive().nullish(),
  input_modalities: z.array(z.string()).nullish(),
  output_modalities: z.array(z.string()).nullish(),
});
const modelList = z.object({ object: z.literal("list"), data: z.array(z.unknown()) });

const readModel = (item: unknown): BrainModel | null => {
  const parsed = modelItem.safeParse(item);
  if (!parsed.success) return null;
  const { id, name, context_window, input_modalities, output_modalities } = parsed.data;
  // Só texto: quando a lista declara a modalidade, entra texto e sai texto. Sem a declaração, fica.
  if (input_modalities && !input_modalities.includes("text")) return null;
  if (output_modalities && !output_modalities.includes("text")) return null;
  return { id, label: name && name.trim() !== "" ? name : id, ...(context_window ? { contextTokens: context_window } : {}) };
};

/** O pedido termina dizendo o formato: o `json_object` exige que o texto peça JSON, e não leva schema. */
export const promptWithSchema = (prompt: string, schema: object): string =>
  `${prompt}\n\nResponda só com um objeto JSON que siga este JSON Schema:\n${JSON.stringify(schema)}`;

const chatBody = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1),
});
const count = z.number().int().nonnegative();
const chatUsage = z.object({
  usage: z.object({
    prompt_tokens: count,
    completion_tokens: count,
    prompt_cache_hit_tokens: count.nullish(),
    prompt_tokens_details: z.object({ cached_tokens: count.nullish(), prompt_cache_hit_tokens: count.nullish() }).nullish(),
  }),
});

/** O consumo de `/chat/completions`, com o acerto de cache onde a DeepSeek o puser. */
export function usageOf(body: unknown): Usage {
  const usage = chatUsage.safeParse(body).data?.usage;
  if (!usage) return {};
  const hit = usage.prompt_tokens_details?.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
  const cached = Math.min(hit, usage.prompt_tokens);
  return { inputTokens: usage.prompt_tokens - cached, cachedInputTokens: cached, outputTokens: usage.completion_tokens };
}

/** O código do erro pelo status. O texto do provedor nunca é lido. */
const failureOf = (status: number): BrainFailure => brainFailureByStatus(status);
/** No pedido, 403 e 404 não são a chave: a chave já foi provada pela lista, e o modelo veio dela. */
const completionFailureOf = (status: number): BrainFailure => (status === 403 || status === 404 ? "unexpected_response" : failureOf(status));

const brain: Brain = {
  id: "deepseek",
  label: "DeepSeek",
  keyUrl: "https://platform.deepseek.com/api_keys",

  async listModels(apiKey, options) {
    const response = await requestJson(
      `${API_URL}/models`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
      { fetch: options.fetch, timeoutMs: options.timeoutMs ?? LIST_TIMEOUT_MS },
    );
    if (!response.ok) return { ok: false, failure: response.status === null ? "unreachable" : failureOf(response.status), status: response.status };
    const list = modelList.safeParse(response.body);
    if (!list.success) return { ok: false, failure: "unexpected_response", status: response.status };
    const models = parseEach(list.data.data, readModel).sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  },

  async completeJson(apiKey, request, options) {
    const { model } = request;
    const response = await requestJson(
      `${API_URL}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: promptWithSchema(request.prompt, request.schema.strict) }],
          response_format: { type: "json_object" },
        }),
      },
      { fetch: options.fetch, timeoutMs: request.timeoutMs },
    );
    if (!response.ok) {
      const failure = response.status === null ? "unreachable" : completionFailureOf(response.status);
      return { ok: false, failure, status: response.status, model, usage: {} };
    }
    // Um 200 fora da forma também foi cobrado: o consumo volta sempre.
    const usage = usageOf(response.body);
    const text = chatBody.safeParse(response.body).data?.choices[0]?.message.content;
    if (typeof text !== "string" || text.trim() === "") return { ok: false, failure: "unexpected_response", status: response.status, model, usage };
    return { ok: true, text, model, usage };
  },

  chat(apiKey, request, options) {
    // `include_usage` é documentado (ver o cabeçalho): vai, e o consumo vem no último pedaço.
    return chatStream(`${API_URL}/chat/completions`, apiKey, request, {
      fetch: options.fetch,
      failureOf: completionFailureOf,
      includeUsage: true,
      usageOf,
      maxTokensField: "max_tokens",
    });
  },
};

export default brain;
