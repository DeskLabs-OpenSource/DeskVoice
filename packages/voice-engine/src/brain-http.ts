import { z } from "zod";
import type { BrainChat, BrainChatEvents, BrainChatMessage, BrainChatRequest, BrainFailure, BrainJsonResult } from "./brain";
import type { ToolSpec, Usage } from "./types";

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

// ---------------------------------------------------------------------------------------------
// A conversa em streaming (R5, fatia 2; desenho docs/specs/2026-11-17-motor-de-voz-em-pipeline.md, 3.2).
//
// `POST /chat/completions` com `stream: true`, na forma da OpenAI, que OpenRouter e DeepSeek seguem:
// eventos SSE `data: {chunk}`, um por linha, terminados por `data: [DONE]`. Cada pedaço traz
// `choices[0].delta.content` (texto) e `choices[0].delta.tool_calls[]` (ferramentas aos pedaços, pelo
// `index`: o primeiro pedaço de cada chamada traz `id` e `function.name`, os seguintes só pedaços de
// `function.arguments`). O consumo vem em `usage`, no último pedaço antes do `[DONE]`.
// Linha que não começa por `data:` (comentário `: OPENROUTER PROCESSING`, `event:`, linha vazia) é
// ignorada, como o SSE manda. Cada provedor cita a própria página no arquivo dele.
// ---------------------------------------------------------------------------------------------

/** Quantos bytes UTF-8 o texto tem: a contagem da estimativa, um token por byte (a regra do Jev). */
const utf8Bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/**
 * A conexão nem abriu: o pedido não saiu e não há consumo. Os códigos são os do `cause` do `fetch`
 * do Node (undici). Qualquer outra falha antes da resposta conta como pedido que saiu.
 */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const codeOf = (error: unknown): unknown => {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code ?? (typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined);
};
const wasNotSent = (error: unknown): boolean => {
  const code = codeOf(error);
  return typeof code === "string" && NOT_SENT.has(code);
};

const wireMessage = (message: BrainChatMessage): Record<string, unknown> => {
  if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.toolCallId ?? "" };
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content === "" ? null : message.content,
      tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.args } })),
    };
  }
  return { role: message.role, content: message.content };
};

const wireTool = (tool: ToolSpec): Record<string, unknown> => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
});

// Leniente de propósito: campo novo do provedor não derruba a conversa. Fora disto, o pedaço é quebrado.
const toolDelta = z.object({
  index: z.number().int().nonnegative(),
  id: z.string().nullish(),
  function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish(),
});
const streamChunk = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            // O raciocínio (DeepSeek `reasoning_content`, OpenRouter `reasoning`) é cobrado como saída e
            // não é fala: entra só na estimativa.
            reasoning_content: z.string().nullish(),
            reasoning: z.string().nullish(),
            tool_calls: z.array(toolDelta).nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  usage: z.unknown().optional(),
  // Erro depois do 200 já enviado (o OpenRouter documenta): vem no topo do pedaço.
  error: z.unknown().optional(),
});

export interface ChatStreamOptions {
  fetch?: typeof fetch;
  /** A recusa de um status fora de 2xx, como o `completeJson` do mesmo cérebro. */
  failureOf: (status: number, body: unknown) => BrainFailure;
  /** Manda `stream_options.include_usage`: só onde a documentação do provedor diz que existe. */
  includeUsage: boolean;
  /** O consumo do pedaço que traz `usage`, na leitura do próprio cérebro. */
  usageOf: (chunk: unknown) => Usage;
}

type Handlers = { [K in keyof BrainChatEvents]: BrainChatEvents[K][] };

/**
 * A conversa em streaming. Nunca lança: toda falha vira `error(failure, status)`. Nunca registra a
 * chave nem o corpo do provedor. O pedido sai no giro seguinte à chamada, então quem registra os
 * ouvintes logo após `chat` não perde nenhum evento; `cancel` antes disso não envia nada e não tem
 * consumo. Ver `BrainChatEvents` para a regra do consumo.
 */
export function chatStream(url: string, apiKey: string, request: BrainChatRequest, options: ChatStreamOptions): BrainChat {
  const handlers: Handlers = { text: [], toolCall: [], usage: [], done: [], error: [] };
  const emit = <K extends keyof BrainChatEvents>(event: K, ...args: Parameters<BrainChatEvents[K]>): void => {
    for (const handler of handlers[event]) {
      try {
        (handler as (...values: unknown[]) => void)(...args);
      } catch {
        // A exceção de quem escuta é de quem escuta: não derruba o pedido nem vira falha do provedor.
      }
    }
  };

  const messages = request.messages.map(wireMessage);
  const tools = request.tools.map(wireTool);
  const body = {
    model: request.model,
    messages,
    // Lista vazia de ferramentas é recusada por alguns provedores: sem ferramenta, o campo não vai.
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
    ...(options.includeUsage ? { stream_options: { include_usage: true } } : {}),
  };
  // A estimativa da entrada: o que foi enviado em `messages` e `tools`, um token por byte.
  const inputTokens = utf8Bytes(JSON.stringify(messages)) + (tools.length > 0 ? utf8Bytes(JSON.stringify(tools)) : 0);
  let outputBytes = 0;
  const estimate = (): Usage => ({ inputTokens, outputTokens: outputBytes });

  const controller = new AbortController();
  let finished = false;
  let cancelled = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs);

  /** O fim, uma vez só: o consumo (quando o pedido saiu) e depois o evento final. */
  const finish = (usage: Usage | null, estimated: boolean, end: () => void): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (usage !== null) emit("usage", usage, estimated);
    end();
  };
  /** Falha de um pedido que saiu e cujo consumo não foi lido: estimado. */
  const fail = (failure: BrainFailure, status: number | null): void => finish(estimate(), true, () => emit("error", failure, status));
  /** O que acontece quando a leitura parou: prazo é `unreachable`; cancelamento já fechou. */
  const stopped = (status: number): void => {
    if (cancelled || finished) return;
    fail(timedOut ? "unreachable" : "unexpected_response", timedOut ? null : status);
  };

  let sent = false;
  const run = async (): Promise<void> => {
    if (finished) return;
    sent = true;
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (cancelled || finished) return;
      if (timedOut) return fail("unreachable", null);
      // A conexão nem abriu: nada foi enviado, nada a cobrar.
      if (wasNotSent(error)) return finish(null, false, () => emit("error", "unreachable", null));
      return fail("unreachable", null);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = JSON.parse(await response.text());
      } catch {
        errorBody = undefined;
      }
      if (cancelled || finished) return;
      if (timedOut) return fail("unreachable", null);
      // Recusa do pedido (fora de 2xx): sem custo, como no Jev (`deciders/jev.ts`).
      const { status } = response;
      return finish({}, false, () => emit("error", options.failureOf(status, errorBody), status));
    }

    const { status } = response;
    if (!response.body) return fail("unexpected_response", status);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let declared: Usage | null = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let callsSent = false;

    /** As ferramentas montadas, inteiras e na ordem do `index`, uma vez só. Falso se alguma veio sem id ou nome. */
    const sendCalls = (): boolean => {
      if (callsSent) return true;
      callsSent = true;
      const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
      if (ordered.some((call) => call.id === "" || call.name === "")) return false;
      for (const call of ordered) {
        if (finished) return true;
        emit("toolCall", { id: call.id, name: call.name, args: call.args });
      }
      return true;
    };

    /** Um evento `data:`. `more` segue lendo, `end` é o `[DONE]`, `bad` é pedaço quebrado ou erro do provedor. */
    const onData = (data: string): "more" | "end" | "bad" => {
      if (data === "[DONE]") return "end";
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        return "bad";
      }
      const chunk = streamChunk.safeParse(json);
      if (!chunk.success || (chunk.data.error !== undefined && chunk.data.error !== null)) return "bad";
      if (typeof chunk.data.usage === "object" && chunk.data.usage !== null) {
        const usage = options.usageOf(json);
        if (usage.outputTokens !== undefined) declared = usage;
      }
      for (const choice of chunk.data.choices ?? []) {
        if (choice.finish_reason === "error") return "bad";
        const delta = choice.delta;
        outputBytes += utf8Bytes(delta?.reasoning_content ?? "") + utf8Bytes(delta?.reasoning ?? "");
        if (delta?.content) {
          outputBytes += utf8Bytes(delta.content);
          if (finished) return "more";
          emit("text", delta.content);
        }
        for (const piece of delta?.tool_calls ?? []) {
          const call = calls.get(piece.index) ?? { id: "", name: "", args: "" };
          if (piece.id && call.id === "") call.id = piece.id;
          if (piece.function?.name && call.name === "") call.name = piece.function.name;
          if (piece.function?.arguments) {
            call.args += piece.function.arguments;
            outputBytes += utf8Bytes(piece.function.arguments);
          }
          // Pedaço de ferramenta depois do fim declarado é forma que o provedor não documenta.
          if (callsSent) return "bad";
          calls.set(piece.index, call);
        }
        // O fim da escolha fecha as ferramentas: quem executa não espera o `[DONE]`.
        if (choice.finish_reason && !sendCalls()) return "bad";
      }
      return "more";
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (finished) return;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const result = onData(line.slice(5).trim());
          if (finished) return;
          if (result === "bad") {
            void reader.cancel().catch(() => undefined);
            return fail("unexpected_response", status);
          }
          if (result === "end") {
            void reader.cancel().catch(() => undefined);
            if (!sendCalls()) return fail("unexpected_response", status);
            if (finished) return;
            const usage: Usage | null = declared;
            return finish(usage ?? estimate(), usage === null, () => emit("done"));
          }
        }
      }
    } catch {
      return stopped(status);
    }
    // O corpo acabou sem `[DONE]`: cortado no meio.
    return stopped(status);
  };

  // O pedido sai no giro seguinte: quem registra os ouvintes logo após `chat` não perde nem a falha
  // de um `fetch` que explode na hora.
  void Promise.resolve()
    .then(run)
    .catch(() => {
      if (!finished && !cancelled) fail("unexpected_response", null);
    });

  return {
    on(event, handler) {
      handlers[event].push(handler);
    },
    cancel() {
      if (finished) return;
      cancelled = true;
      finished = true;
      clearTimeout(timer);
      controller.abort();
      // Cancelado antes de sair: não há pedido, nem consumo.
      if (!sent) return;
      // O consumo estimado sai depois de quem cancelou voltar: nada mais chega antes dele.
      const usage = estimate();
      queueMicrotask(() => emit("usage", usage, true));
    },
  };
}
