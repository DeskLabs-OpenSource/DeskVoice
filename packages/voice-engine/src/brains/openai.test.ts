import { describe, expect, it } from "vitest";
import brain, { isTextModel, priceOf } from "./openai";
import { estimateCostMicrocents } from "../pricing";

// Inventada: não tem a forma de uma chave real, e o teste procura por ela onde não pode aparecer.
const KEY = "chave-inventada-do-teste-openai";
const TODAY = "2026-11-16";

type Reply = { status: number; body?: unknown };
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(reply: Reply | ((url: string) => Reply)) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const { status, body } = typeof reply === "function" ? reply(url) : reply;
    return new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

// Resposta gravada na forma de `GET /v1/models` (documentação de 2026-11-16), com ids inventados
// misturados aos reais para cobrir cada família do filtro.
const MODELS = {
  object: "list",
  data: [
    { id: "gpt-5-nano", object: "model", created: 1, owned_by: "system" },
    { id: "gpt-9-inventado", object: "model", created: 1, owned_by: "system" },
    { id: "gpt-4o-mini", object: "model", created: 1, owned_by: "system" },
    { id: "text-embedding-3-small", object: "model", created: 1, owned_by: "system" },
    { id: "whisper-1", object: "model", created: 1, owned_by: "system" },
    { id: "gpt-4o-mini-tts", object: "model", created: 1, owned_by: "system" },
    { id: "dall-e-3", object: "model", created: 1, owned_by: "system" },
    { id: "omni-moderation-latest", object: "model", created: 1, owned_by: "system" },
    { id: "gpt-realtime-2.1", object: "model", created: 1, owned_by: "system" },
    { id: "gpt-4o-mini-transcribe", object: "model", created: 1, owned_by: "system" },
    { id: "gpt-4o-audio-preview", object: "model", created: 1, owned_by: "system" },
    { id: "gpt-image-1", object: "model", created: 1, owned_by: "system" },
    // Fora da forma: sem id, objeto errado, não é objeto. Saem, e a lista continua.
    { object: "model", created: 1 },
    { id: "gpt-forma-errada", object: "file" },
    "texto solto",
    // Repetido: fica um.
    { id: "gpt-5-nano", object: "model", created: 2, owned_by: "system" },
  ],
};

const SCHEMA = { name: "desfecho", strict: { type: "object", properties: {} }, google: { type: "OBJECT" } };
const REQUEST = { model: "gpt-5-nano", prompt: "Leia a ligação.", schema: SCHEMA, timeoutMs: 30_000 };

describe("brains/openai: lista de modelos", () => {
  it("lê a lista da API, só com modelos de texto, descartando o que sai da forma", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((m) => m.id)).toEqual(["gpt-4o-mini", "gpt-5-nano", "gpt-9-inventado"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://api.openai.com/v1/models");
    expect(sent[0]?.method).toBe("GET");
    expect(sent[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("modelo que a tabela não conhece vem sem preço, nunca com zero", async () => {
    const { fetch } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    const unknown = result.models.find((m) => m.id === "gpt-9-inventado");
    expect(unknown).toEqual({ id: "gpt-9-inventado", label: "gpt-9-inventado" });
    expect(unknown && "price" in unknown).toBe(false);
    const nano = result.models.find((m) => m.id === "gpt-5-nano");
    expect(nano?.price).toEqual({
      centsPerMillionInputTokens: 5,
      centsPerMillionCachedInputTokens: 0.5,
      centsPerMillionOutputTokens: 40,
      source: "https://developers.openai.com/api/docs/pricing",
      checkedOn: "2026-11-16",
    });
  });

  it("a tabela de preço não faz modelo aparecer: lista vazia da API é lista vazia", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { object: "list", data: [] } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: true, models: [] });
  });

  it("o id datado não herda o preço do apelido", () => {
    expect(priceOf("gpt-4o-mini")).toBeDefined();
    expect(priceOf("gpt-4o-mini-2024-07-18")).toBeUndefined();
  });

  it("o filtro tira cada família que não conversa por texto", () => {
    for (const id of ["text-embedding-3-large", "whisper-1", "tts-1", "dall-e-2", "omni-moderation-latest", "gpt-realtime", "gpt-4o-transcribe", "gpt-audio", "gpt-image-1", "chatgpt-image-latest"]) {
      expect(isTextModel(id), id).toBe(false);
    }
    for (const id of ["gpt-5", "o3", "gpt-4.1-mini"]) expect(isTextModel(id), id).toBe(true);
  });

  it("corpo fora da forma é unexpected_response com o status", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { data: "não é lista" } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
    const naoJson = fakeFetch({ status: 200, body: "<html>proxy</html>" });
    expect(await brain.listModels(KEY, { fetch: naoJson.fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
  });

  it.each([
    [401, {}, "rejected"],
    [403, { error: { code: "unsupported_country_region_territory", message: `região ${KEY}` } }, "region_unavailable"],
    [403, {}, "rejected"],
    [402, {}, "no_credit"],
    [429, { error: { code: "insufficient_quota" } }, "no_credit"],
    [429, { error: { type: "insufficient_quota" } }, "no_credit"],
    [429, { error: { code: "rate_limit_exceeded" } }, "rate_limited"],
    [500, {}, "unreachable"],
    [503, {}, "unreachable"],
    [404, {}, "unexpected_response"],
    [400, {}, "unexpected_response"],
  ] as const)("status %i com %j é %s", async (status, body, failure) => {
    const { fetch } = fakeFetch({ status, body });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure, status });
  });

  it("sem resposta é unreachable, com status nulo", async () => {
    const fetch = (async () => {
      throw new Error(`conexão recusada ${KEY}`);
    }) as unknown as typeof globalThis.fetch;
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "unreachable", status: null });
  });
});

describe("brains/openai: pedido em JSON", () => {
  const ok = {
    choices: [{ message: { role: "assistant", content: '{"outcome":"resolved"}' } }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 300 } },
  };

  it("pede json_schema estrito em /chat/completions e devolve o texto e o consumo", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: ok });
    const result = await brain.completeJson(KEY, REQUEST, { fetch });
    expect(result).toEqual({ ok: true, text: '{"outcome":"resolved"}', model: "gpt-5-nano", usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 200 } });
    expect(sent[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.body).toEqual({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: "Leia a ligação." }],
      response_format: { type: "json_schema", json_schema: { name: "desfecho", strict: true, schema: SCHEMA.strict } },
    });
  });

  it("o consumo entra no custo pelo preço da tabela", async () => {
    const { fetch } = fakeFetch({ status: 200, body: ok });
    const result = await brain.completeJson(KEY, REQUEST, { fetch });
    const price = priceOf("gpt-5-nano");
    if (!price) throw new Error("sem preço");
    // 700 × 5 + 300 × 0,5 + 200 × 40 centavos por milhão = 0,01165 centavo.
    expect(estimateCostMicrocents(price, result.usage)).toBe(11_650);
  });

  it("200 fora da forma é unexpected_response, com o consumo que foi cobrado", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { choices: [{ message: { content: null } }], usage: ok.usage } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({
      ok: false,
      failure: "unexpected_response",
      status: 200,
      model: "gpt-5-nano",
      usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 200 },
    });
    const semChoices = fakeFetch({ status: 200, body: { usage: "errado" } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch: semChoices.fetch })).toEqual({ ok: false, failure: "unexpected_response", status: 200, model: "gpt-5-nano", usage: {} });
  });

  it.each([
    [401, "rejected"],
    [429, "rate_limited"],
    [500, "unreachable"],
    [404, "unexpected_response"],
  ] as const)("status %i é %s", async (status, failure) => {
    const { fetch } = fakeFetch({ status, body: { error: { message: `chave ${KEY} recusada`, code: "x" } } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({ ok: false, failure, status, model: "gpt-5-nano", usage: {} });
  });

  it("a chave nunca vai na URL nem no resultado, e o texto do provedor não sai", async () => {
    const providerText = `Incorrect API key provided: ${KEY}`;
    for (const status of [200, 401, 429, 500]) {
      const body = status === 200 ? { models: providerText } : { error: { message: providerText, code: "invalid_api_key" } };
      const { fetch, sent } = fakeFetch({ status, body });
      const listed = await brain.listModels(KEY, { fetch, today: TODAY });
      const asked = await brain.completeJson(KEY, REQUEST, { fetch });
      for (const request of sent) expect(request.url).not.toContain(KEY);
      for (const out of [JSON.stringify(listed), JSON.stringify(asked)]) {
        expect(out).not.toContain(KEY);
        expect(out).not.toContain("Incorrect");
      }
    }
  });
});
