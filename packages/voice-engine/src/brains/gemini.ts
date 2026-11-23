/**
 * Cérebro Gemini (Google): os modelos de texto que a chave alcança, um pedido com saída em JSON e a
 * conversa em streaming, com ferramentas (`chat`, R5 fatia 2c).
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
 * Para `chat`, conferidas em 2026-11-17:
 *   - https://aistudio.google.com/docs/text-generation.md?generate-content=true  (o exemplo REST de streaming:
 *     `POST .../v1beta/models/{model}:streamGenerateContent?alt=sse`, com a chave em `x-goog-api-key`; cada
 *     pedaço é um `GenerateContentResponse`, com `candidates[0].content.parts[]` e `usageMetadata`. A página
 *     não descreve erro no meio do streaming)
 *   - https://aistudio.google.com/api-reference/generate-content  (`streamGenerateContent`; `systemInstruction`;
 *     a parte com `text`, `thought`, `thoughtSignature`, `functionCall { id, name, args }` e
 *     `functionResponse { id, name, response }`, com `response` "in JSON object format";
 *     `FunctionDeclaration.parametersJsonSchema`, "the parameters to the function in JSON Schema format",
 *     exclusivo com `parameters` (que é o `Schema` do OpenAPI), e por isso o `ToolSpec` entra em
 *     `parametersJsonSchema`, sem a forma `google`; a lista de `FinishReason`; `promptFeedback.blockReason`)
 *   - https://aistudio.google.com/docs/thought-signatures.md?generate-content=true  (a assinatura é obrigatória
 *     na primeira `functionCall` de cada passo do turno atual, senão 400; nas paralelas, só a primeira traz;
 *     volta "exactly as received", na mesma parte; as respostas das paralelas vêm juntas, depois das
 *     chamadas; a assinatura fictícia, na FAQ; no streaming, a assinatura pode vir numa parte de texto vazio)
 *   - https://aistudio.google.com/docs/function-calling.md?generate-content=true  ("Gemini 3 now always
 *     returns a unique `id` with every `functionCall`", e o `id` volta na `functionResponse`, numa mensagem
 *     `role: "user"`)
 *
 * Não confirmado contra o servidor real (nenhuma chamada com chave foi feita):
 *   - o código de uma chave inválida na lista: a página de erros diz 401, e a forma antiga da API
 *     respondia 400 com `API_KEY_INVALID`; as duas são chave recusada, como no motor;
 *   - se o cache implícito cobra só a leitura (o preço "context caching") e nada de armazenamento;
 *   - se `responseSchema` continua aceito em todos os modelos novos (Gemini 4);
 *   - em `chat`: a forma do erro no meio do SSE (a referência não descreve; aqui se lê só `error.code`);
 *     se o último pedaço sempre traz `usageMetadata` junto do `finishReason` (a leitura para no
 *     `finishReason`, e um consumo que viesse depois dele ficaria estimado); se `parametersJsonSchema` e a
 *     assinatura fictícia são aceitos pelos modelos 2.5; se a assinatura de uma `functionCall` pode chegar
 *     numa parte separada dela no streaming (a página só fala disso para texto).
 */
import { z } from "zod";
import type { Brain, BrainChatMessage, BrainChatRequest, BrainFailure, BrainModel, BrainPrice } from "../brain";
import { type ChatFormat, type ChatStep, LIST_TIMEOUT_MS, brainFailureByStatus, chatTransport, parseEach, requestJson, utf8Bytes } from "../brain-http";
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

// ---------------------------------------------------------------------------------------------
// A conversa em streaming (R5, fatia 2c): `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`.
// O transporte é o comum (`chatTransport`); aqui fica só o formato do `generateContent`. Fontes no topo.
// ---------------------------------------------------------------------------------------------

/**
 * A assinatura fictícia, para `functionCall` que não veio do Gemini (histórico de outro cérebro, troca de
 * cérebro no meio da ligação). Sem assinatura na primeira `functionCall` de um passo do turno atual, o
 * Gemini 3 e o 4 recusam o pedido com 400. A FAQ de
 * https://aistudio.google.com/docs/thought-signatures.md?generate-content=true (lida em 2026-11-17) diz:
 * "While injecting custom function call blocks into the request is strongly discouraged", "in cases where
 * it can't be avoided", "you can set the following dummy signatures of either
 * `"context_engineering_is_the_way_to_go"` or `"skip_thought_signature_validator"` in the thought
 * signature field to skip validation". Por isso ela vai só onde a validação olha (a primeira
 * `functionCall` de cada passo), e nunca no lugar de uma assinatura de verdade.
 */
export const SKIP_SIGNATURE = "skip_thought_signature_validator";

/**
 * O começo do id gerado aqui quando a `functionCall` veio sem `id`. Esse id é só nosso: serve para o
 * `tool` achar a chamada, e nunca volta ao Gemini como `id`.
 */
export const LOCAL_ID_PREFIX = "deskvoice-local-";
const isLocalId = (id: string): boolean => id.startsWith(LOCAL_ID_PREFIX);

type WirePart = Record<string, unknown>;
type WireContent = { role: "user" | "model"; parts: WirePart[] };

/** O `args` de uma volta anterior, de volta a objeto. Fora de um objeto JSON, é erro de quem chama: `null`. */
const argsOf = (args: string): Record<string, unknown> | null => {
  let value: unknown;
  try {
    value = JSON.parse(args);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
};

/**
 * O `response` de uma `functionResponse`, que a API pede em objeto JSON: o `content` do `tool` parseado,
 * se for um objeto JSON; senão (texto solto, lista, número, JSON quebrado), `{ result: content }`.
 */
export const responseOf = (content: string): Record<string, unknown> => argsOf(content) ?? { result: content };

/**
 * As mensagens na forma do `generateContent`:
 * - `system` sai para `systemInstruction`, uma parte por mensagem, na ordem;
 * - `assistant` vira `role: "model"`, com o texto e uma parte `functionCall` por chamada. O `providerState`
 *   volta como `thoughtSignature` **na mesma parte** da `functionCall`. A primeira `functionCall` de um
 *   passo do turno atual sem `providerState` leva `SKIP_SIGNATURE` (ver lá o porquê);
 * - os `tool` seguidos viram uma só mensagem `role: "user"` com uma `functionResponse` cada, na ordem das
 *   chamadas do `assistant` anterior, de onde sai o `name`.
 * `null` se algum `args` não é um objeto JSON, ou se um `toolCallId` não está no `assistant` anterior.
 */
export function geminiContents(messages: BrainChatMessage[]): { system: string[]; contents: WireContent[] } | null {
  const system: string[] = [];
  const contents: WireContent[] = [];
  // O turno atual começa na última fala de quem liga (`user`); a validação da assinatura olha só ele.
  let turnStart = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") turnStart = index;
  });
  let previousCalls: NonNullable<BrainChatMessage["toolCalls"]> = [];
  let pending: { order: number; part: WirePart }[] = [];
  // As respostas juntas, depois de todas as chamadas: intercalar chamada e resposta dá 400.
  const flush = (): void => {
    if (pending.length === 0) return;
    contents.push({ role: "user", parts: pending.sort((a, b) => a.order - b.order).map((item) => item.part) });
    pending = [];
  };

  for (const [index, message] of messages.entries()) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      const order = previousCalls.findIndex((call) => call.id === message.toolCallId);
      const call = previousCalls[order];
      if (!call) return null;
      const id = isLocalId(call.id) ? {} : { id: call.id };
      pending.push({ order, part: { functionResponse: { name: call.name, ...id, response: responseOf(message.content) } } });
      continue;
    }
    flush();
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }
    const calls = message.toolCalls ?? [];
    const parts: WirePart[] = message.content === "" && calls.length > 0 ? [] : [{ text: message.content }];
    for (const [position, call] of calls.entries()) {
      const args = argsOf(call.args);
      if (args === null) return null;
      const signature = call.providerState ?? (position === 0 && index > turnStart ? SKIP_SIGNATURE : undefined);
      parts.push({
        functionCall: { name: call.name, args, ...(isLocalId(call.id) ? {} : { id: call.id }) },
        ...(signature === undefined ? {} : { thoughtSignature: signature }),
      });
    }
    contents.push({ role: "model", parts });
    previousCalls = calls;
  }
  flush();
  return { system, contents };
}

// Leniente de propósito: campo novo do provedor não derruba a conversa.
const streamPart = z.object({
  text: z.string().nullish(),
  thought: z.boolean().nullish(),
  thoughtSignature: z.string().nullish(),
  functionCall: z.object({ id: z.string().nullish(), name: z.string().nullish(), args: z.record(z.string(), z.unknown()).nullish() }).nullish(),
});
const streamChunk = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(streamPart).nullish() }).nullish(), finishReason: z.string().nullish() })).nullish(),
  usageMetadata: z.unknown().optional(),
  promptFeedback: z.object({ blockReason: z.string().nullish() }).nullish(),
  // Erro depois do 200 já enviado. A referência não descreve um; se vier, na forma do erro HTTP do
  // Google (`{ error: { code, status, message } }`), lê só o `code`, nunca o `message`.
  error: z.object({ code: z.number().int().nullish() }).nullish(),
});

/**
 * O fim normal da resposta. `MAX_TOKENS` é a volta cortada pelo teto, que termina como as outras (como o
 * `finish_reason: "length"` no `/chat/completions`). Todo o resto da lista de `FinishReason` da referência
 * (`SAFETY`, `RECITATION`, `LANGUAGE`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`,
 * `MISSING_THOUGHT_SIGNATURE`, `UNEXPECTED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS`, `MALFORMED_RESPONSE`,
 * `ESCALATION`, `PUP_LIMITED_DISABLED`, `CONTINUATION`, `OTHER`, os de imagem e o que vier de novo) é
 * bloqueio ou falha: `unexpected_response`.
 */
const NORMAL_END = new Set(["STOP", "MAX_TOKENS"]);

const BAD: ChatStep = { failure: "unexpected_response" };

/**
 * O formato `streamGenerateContent` do Gemini, para o transporte comum. Leitura:
 * - `parts[].text` não vazio vira `text`; parte com `thought: true` não vira `text`, mas conta na saída
 *   estimada; parte de texto vazio (a que traz só a assinatura) não vira evento;
 * - `functionCall` vira `toolCall` com `args = JSON.stringify(args)`: é a única exceção a "args como veio",
 *   porque o Gemini manda objeto, não texto. O `providerState` é a `thoughtSignature` da mesma parte. O
 *   `id` é o `functionCall.id`; sem ele, um id local (`LOCAL_ID_PREFIX`), que não volta ao Gemini;
 * - lê até o `finishReason`, sem parar na primeira `functionCall`;
 * - o `usageMetadata` pode vir em vários pedaços: vale o último, nunca a soma.
 */
function generateFormat(apiKey: string, request: BrainChatRequest): ChatFormat {
  const wire = geminiContents(request.messages);
  const declarations = request.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters }));
  const tools = declarations.length > 0 ? [{ functionDeclarations: declarations }] : null;
  const systemInstruction = wire && wire.system.length > 0 ? { parts: wire.system.map((text) => ({ text })) } : null;
  return {
    // A chave só no cabeçalho, como no `completeJson`: nunca na URL.
    headers: { "x-goog-api-key": apiKey },
    // Sem `cachedContent`: o cache explícito fica fora (desenho, fatia 2c).
    request:
      wire === null
        ? null
        : {
            body: {
              contents: wire.contents,
              ...(systemInstruction === null ? {} : { systemInstruction }),
              ...(tools === null ? {} : { tools }),
            },
            // A estimativa da entrada: o que foi enviado em `systemInstruction`, `contents` e `tools`, um token por byte.
            inputTokens:
              (systemInstruction === null ? 0 : utf8Bytes(JSON.stringify(systemInstruction))) +
              utf8Bytes(JSON.stringify(wire.contents)) +
              (tools === null ? 0 : utf8Bytes(JSON.stringify(tools))),
          },
    failureOf: completionFailureOf,
    reader() {
      let localIds = 0;
      return (data, sink) => {
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          return BAD;
        }
        const chunk = streamChunk.safeParse(json);
        if (!chunk.success) return BAD;
        if (chunk.data.error) {
          const code = chunk.data.error.code;
          return { failure: typeof code === "number" ? completionFailureOf(code, json) : "unexpected_response" };
        }
        if (typeof chunk.data.usageMetadata === "object" && chunk.data.usageMetadata !== null) {
          const usage = usageOf(json);
          if (usage.outputTokens !== undefined) sink.declare(usage);
        }
        // Pedido bloqueado: não vem candidato.
        if (chunk.data.promptFeedback?.blockReason) return BAD;
        // Só um candidato é pedido (sem `candidateCount`).
        const candidate = chunk.data.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.thought === true) {
            sink.output(utf8Bytes(part.text ?? ""));
            continue;
          }
          if (part.functionCall) {
            const { name } = part.functionCall;
            if (!name) return BAD;
            const args = JSON.stringify(part.functionCall.args ?? {});
            sink.output(utf8Bytes(args));
            localIds += 1;
            const id = part.functionCall.id || `${LOCAL_ID_PREFIX}${localIds}`;
            sink.toolCall({ id, name, args, ...(part.thoughtSignature ? { providerState: part.thoughtSignature } : {}) });
            continue;
          }
          if (part.text) {
            sink.output(utf8Bytes(part.text));
            sink.text(part.text);
          }
        }
        const reason = candidate?.finishReason;
        if (!reason) return "more";
        return NORMAL_END.has(reason) ? "end" : BAD;
      };
    },
  };
}

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

  chat(apiKey, request, options) {
    const url = `${API_URL}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
    return chatTransport(url, request, generateFormat(apiKey, request), { fetch: options.fetch });
  },
};

export default brain;
