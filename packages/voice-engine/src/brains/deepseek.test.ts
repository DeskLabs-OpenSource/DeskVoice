import { describe, expect, it } from "vitest";
import brain, { promptWithSchema, usageOf } from "./deepseek";

// Inventada: não tem a forma de uma chave real, e o teste procura por ela onde não pode aparecer.
const KEY = "chave-inventada-do-teste-deepseek";
const TODAY = "2026-11-16";

type Reply = { status: number; body?: unknown };
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(reply: Reply) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const { status, body } = reply;
    return new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

// Resposta gravada na forma de `GET /models` (documentação de 2026-11-16), com ids inventados
// misturados aos reais.
const MODELS = {
  object: "list",
  data: [
    { id: "deepseek-flash", object: "model", owned_by: "deepseek", name: "DeepSeek-V4.1-Flash", context_window: 1_048_576, input_modalities: ["text", "image"], output_modalities: ["text"] },
    { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
    { id: "deepseek-inventado-so-imagem", object: "model", owned_by: "deepseek", input_modalities: ["image"], output_modalities: ["text"] },
    { id: "deepseek-inventado-sem-texto", object: "model", owned_by: "deepseek", output_modalities: ["audio"] },
    // Fora da forma: sem id, objeto errado, não é objeto. Saem, e a lista continua.
    { object: "model", owned_by: "deepseek" },
    { id: "deepseek-forma-errada", object: "file" },
    "texto solto",
  ],
};

const SCHEMA = { name: "desfecho", strict: { type: "object", required: ["outcome"] }, google: { type: "object" } };
const REQUEST = { model: "deepseek-flash", prompt: "Leia a ligação.", schema: SCHEMA, timeoutMs: 30_000 };

describe("brains/deepseek: lista de modelos", () => {
  it("lê a lista da API, só com modelos de texto, descartando o que sai da forma", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models.map((m) => m.id)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://api.deepseek.com/models");
    expect(sent[0]?.method).toBe("GET");
    expect(sent[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("todo modelo vem sem preço, nunca com zero: o preço muda com a hora do pedido", async () => {
    const { fetch } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models).toEqual([
      { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash", contextTokens: 1_048_576 },
      { id: "deepseek-v4-pro", label: "deepseek-v4-pro" },
    ]);
    for (const found of result.models) expect("price" in found, found.id).toBe(false);
  });

  it("lista vazia da API é lista vazia", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { object: "list", data: [] } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: true, models: [] });
  });

  it("corpo fora da forma é unexpected_response com o status", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { data: "não é lista" } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
    const naoJson = fakeFetch({ status: 200, body: "<html>proxy</html>" });
    expect(await brain.listModels(KEY, { fetch: naoJson.fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
  });

  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [402, "no_credit"],
    [429, "rate_limited"],
    [500, "unreachable"],
    [503, "unreachable"],
    [404, "unexpected_response"],
    [422, "unexpected_response"],
  ] as const)("status %i é %s", async (status, failure) => {
    const { fetch } = fakeFetch({ status, body: { error: { message: `chave ${KEY}` } } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure, status });
  });

  it("sem resposta é unreachable, com status nulo", async () => {
    const fetch = (async () => {
      throw new Error(`conexão recusada ${KEY}`);
    }) as unknown as typeof globalThis.fetch;
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "unreachable", status: null });
  });
});

describe("brains/deepseek: pedido em JSON", () => {
  const ok = {
    choices: [{ index: 0, message: { role: "assistant", content: '{"outcome":"booked"}' }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 300, prompt_cache_hit_tokens: 300, prompt_cache_miss_tokens: 700 },
      completion_tokens_details: { reasoning_tokens: 150 },
    },
  };

  it("pede json_object em /chat/completions, com o formato no texto do pedido", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: ok });
    const result = await brain.completeJson(KEY, REQUEST, { fetch });
    expect(result).toEqual({ ok: true, text: '{"outcome":"booked"}', model: "deepseek-flash", usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 200 } });
    expect(sent[0]?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(sent[0]?.body).toEqual({
      model: "deepseek-flash",
      messages: [{ role: "user", content: promptWithSchema("Leia a ligação.", SCHEMA.strict) }],
      response_format: { type: "json_object" },
    });
    expect(promptWithSchema("Leia a ligação.", SCHEMA.strict)).toContain('JSON Schema:\n{"type":"object","required":["outcome"]}');
  });

  it("lê o acerto de cache onde a DeepSeek o puser", () => {
    expect(usageOf({ usage: { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 } })).toEqual({ inputTokens: 60, cachedInputTokens: 40, outputTokens: 5 });
    expect(usageOf({ usage: { prompt_tokens: 100, completion_tokens: 5 } })).toEqual({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 5 });
    expect(usageOf({ usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 99 } } })).toEqual({ inputTokens: 0, cachedInputTokens: 10, outputTokens: 5 });
    expect(usageOf({})).toEqual({});
  });

  it("200 fora da forma é unexpected_response, com o consumo que foi cobrado", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { choices: [{ message: { content: null } }], usage: ok.usage } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({
      ok: false,
      failure: "unexpected_response",
      status: 200,
      model: "deepseek-flash",
      usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 200 },
    });
    const semChoices = fakeFetch({ status: 200, body: { usage: "errado" } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch: semChoices.fetch })).toEqual({ ok: false, failure: "unexpected_response", status: 200, model: "deepseek-flash", usage: {} });
  });

  it.each([
    [401, "rejected"],
    [402, "no_credit"],
    [403, "unexpected_response"],
    [404, "unexpected_response"],
    [422, "unexpected_response"],
    [429, "rate_limited"],
    [503, "unreachable"],
  ] as const)("status %i é %s", async (status, failure) => {
    const { fetch } = fakeFetch({ status, body: { error: { message: `chave ${KEY} recusada` } } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({ ok: false, failure, status, model: "deepseek-flash", usage: {} });
  });

  it("a chave nunca vai na URL nem no resultado, e o texto do provedor não sai", async () => {
    const providerText = `Authentication Fails, Your api key: ${KEY} is invalid`;
    for (const status of [200, 401, 429, 500]) {
      const body = status === 200 ? { data: providerText } : { error: { message: providerText, type: "authentication_error" } };
      const { fetch, sent } = fakeFetch({ status, body });
      const listed = await brain.listModels(KEY, { fetch, today: TODAY });
      const asked = await brain.completeJson(KEY, REQUEST, { fetch });
      for (const request of sent) expect(request.url).not.toContain(KEY);
      for (const out of [JSON.stringify(listed), JSON.stringify(asked)]) {
        expect(out).not.toContain(KEY);
        expect(out).not.toContain("Authentication Fails");
      }
    }
  });
});
