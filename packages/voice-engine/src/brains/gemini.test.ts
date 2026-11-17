import { describe, expect, it } from "vitest";
import brain, { isTextModel, priceOf, usageOf } from "./gemini";
import { estimateCostMicrocents } from "../pricing";

// Inventada: não tem a forma de uma chave real, e o teste procura por ela onde não pode aparecer.
const KEY = "chave-inventada-do-teste-gemini";
const TODAY = "2026-11-16";

type Reply = { status: number; body?: unknown };
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(reply: Reply | ((url: URL) => Reply)) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const { status, body } = typeof reply === "function" ? reply(new URL(url)) : reply;
    return new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

const model = (id: string, methods: string[] = ["generateContent", "countTokens"], extra: Record<string, unknown> = {}) => ({
  name: `models/${id}`,
  baseModelId: id,
  version: "1",
  displayName: `Nome de ${id}`,
  inputTokenLimit: 1_048_576,
  outputTokenLimit: 65_536,
  supportedGenerationMethods: methods,
  ...extra,
});

// Resposta gravada na forma de `GET /v1beta/models` (documentação de 2026-11-16), com ids inventados
// misturados aos reais.
const MODELS = {
  models: [
    model("gemini-3.5-flash-lite"),
    model("gemini-9-inventado"),
    model("gemini-4-carbon"),
    model("gemini-3.8-live", ["bidiGenerateContent"]),
    model("gemini-embedding-002", ["embedContent"]),
    model("gemini-3.5-flash-preview-tts", ["generateContent"]),
    model("gemini-3.5-flash-image", ["generateContent"]),
    model("gemini-sem-nome", ["generateContent"], { displayName: null, inputTokenLimit: null }),
    // Fora da forma: sem prefixo, sem métodos, não é objeto. Saem, e a lista continua.
    { name: "gemini-sem-prefixo", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-sem-metodos" },
    "texto solto",
  ],
};

const SCHEMA = { name: "desfecho", strict: { type: "object", additionalProperties: false }, google: { type: "object", properties: {} } };
const REQUEST = { model: "gemini-3.5-flash-lite", prompt: "Leia a ligação.", schema: SCHEMA, timeoutMs: 30_000 };

describe("brains/gemini: lista de modelos", () => {
  it("lê a lista da API com a chave no cabeçalho, só com modelos que geram texto", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models.map((m) => m.id)).toEqual(["gemini-3.5-flash-lite", "gemini-4-carbon", "gemini-9-inventado", "gemini-sem-nome"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(sent[0]?.headers["x-goog-api-key"]).toBe(KEY);
  });

  it("o filtro pede generateContent e tira voz, imagem e embedding", () => {
    expect(isTextModel("gemini-3.5-flash-lite", ["generateContent"])).toBe(true);
    expect(isTextModel("gemini-3.8-live", ["bidiGenerateContent"])).toBe(false);
    for (const id of ["gemini-2.5-flash-preview-tts", "gemini-3-pro-image-preview", "gemini-embedding-001"]) expect(isTextModel(id, ["generateContent"]), id).toBe(false);
  });

  it("usa o nome publicado e a janela de contexto; sem nome, o id", async () => {
    const { fetch } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models.find((m) => m.id === "gemini-sem-nome")).toEqual({ id: "gemini-sem-nome", label: "gemini-sem-nome" });
    expect(result.models.find((m) => m.id === "gemini-3.5-flash-lite")).toMatchObject({ label: "Nome de gemini-3.5-flash-lite", contextTokens: 1_048_576 });
  });

  it("modelo sem preço na tabela vem sem preço, nunca com zero; o que tem troca de preço marcada também", async () => {
    const { fetch } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    for (const id of ["gemini-9-inventado", "gemini-4-carbon"]) {
      const found = result.models.find((m) => m.id === id);
      expect(found && "price" in found, id).toBe(false);
    }
    expect(result.models.find((m) => m.id === "gemini-3.5-flash-lite")?.price).toEqual({
      centsPerMillionInputTokens: 30,
      centsPerMillionCachedInputTokens: 3,
      centsPerMillionOutputTokens: 250,
      source: "https://aistudio.google.com/docs/pricing",
      checkedOn: "2026-11-16",
    });
    // Preço por faixa de tamanho: sem preço.
    expect(priceOf("gemini-3.1-pro-preview")).toBeUndefined();
  });

  it("a tabela de preço não faz modelo aparecer: lista vazia da API é lista vazia", async () => {
    const { fetch } = fakeFetch({ status: 200, body: {} });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: true, models: [] });
  });

  it("pagina por pageToken até a página sem nextPageToken", async () => {
    const pages: Record<string, unknown> = {
      "": { models: [model("gemini-a")], nextPageToken: "pagina/2" },
      "pagina/2": { models: [model("gemini-b")], nextPageToken: "pagina/3" },
      "pagina/3": { models: [model("gemini-c")] },
    };
    const { fetch, sent } = fakeFetch((url) => ({ status: 200, body: pages[url.searchParams.get("pageToken") ?? ""] }));
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    expect(result.ok && result.models.map((m) => m.id)).toEqual(["gemini-a", "gemini-b", "gemini-c"]);
    expect(sent[1]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=pagina%2F2");
  });

  it("para no teto de 20 páginas, e na página que não traz nome novo", async () => {
    let n = 0;
    const endless = fakeFetch(() => {
      n += 1;
      return { status: 200, body: { models: [model(`gemini-${n}`)], nextPageToken: `p${n}` } };
    });
    const result = await brain.listModels(KEY, { fetch: endless.fetch, today: TODAY });
    expect(endless.sent).toHaveLength(20);
    expect(result.ok && result.models).toHaveLength(20);

    const repeating = fakeFetch({ status: 200, body: { models: [model("gemini-a")], nextPageToken: "mesma" } });
    const repeated = await brain.listModels(KEY, { fetch: repeating.fetch, today: TODAY });
    expect(repeating.sent).toHaveLength(2);
    expect(repeated.ok && repeated.models.map((m) => m.id)).toEqual(["gemini-a"]);
  });

  it("corpo fora da forma é unexpected_response com o status", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { models: "não é lista" } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
    const naoJson = fakeFetch({ status: 200, body: "<html>proxy</html>" });
    expect(await brain.listModels(KEY, { fetch: naoJson.fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
  });

  it.each([
    [401, {}, "rejected"],
    [400, { error: { code: 400, message: `chave ${KEY}`, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, "rejected"],
    [400, { error: { code: 400, status: "FAILED_PRECONDITION", details: [] } }, "unexpected_response"],
    [403, {}, "rejected"],
    [402, {}, "no_credit"],
    [429, {}, "rate_limited"],
    [500, {}, "unreachable"],
    [503, {}, "unreachable"],
    [404, {}, "unexpected_response"],
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

describe("brains/gemini: pedido em JSON", () => {
  const ok = {
    candidates: [{ content: { role: "model", parts: [{ text: '{"outcome":' }, { text: '"booked"}' }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 300, candidatesTokenCount: 150, thoughtsTokenCount: 50, totalTokenCount: 1200 },
  };

  it("pede JSON com responseSchema em :generateContent, com a chave só no cabeçalho", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: ok });
    const result = await brain.completeJson(KEY, REQUEST, { fetch });
    expect(result).toEqual({ ok: true, text: '{"outcome":"booked"}', model: "gemini-3.5-flash-lite", usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 200 } });
    expect(sent[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.headers["x-goog-api-key"]).toBe(KEY);
    expect(sent[0]?.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "Leia a ligação." }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA.google },
    });
  });

  it("o consumo entra no custo pelo preço da tabela, com o raciocínio como saída", async () => {
    const { fetch } = fakeFetch({ status: 200, body: ok });
    const result = await brain.completeJson(KEY, REQUEST, { fetch });
    const price = priceOf("gemini-3.5-flash-lite");
    if (!price) throw new Error("sem preço");
    // 700 × 30 + 300 × 3 + 200 × 250 centavos por milhão = 0,0719 centavo.
    expect(estimateCostMicrocents(price, result.usage)).toBe(71_900);
    expect(usageOf({ usageMetadata: { promptTokenCount: 10 } })).toEqual({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 0 });
  });

  it("200 fora da forma (bloqueado, sem candidato) é unexpected_response, com o consumo", async () => {
    const blocked = fakeFetch({ status: 200, body: { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 1000 } } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch: blocked.fetch })).toEqual({
      ok: false,
      failure: "unexpected_response",
      status: 200,
      model: "gemini-3.5-flash-lite",
      usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 0 },
    });
    const empty = fakeFetch({ status: 200, body: { candidates: [{ content: { parts: [] } }] } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch: empty.fetch })).toEqual({ ok: false, failure: "unexpected_response", status: 200, model: "gemini-3.5-flash-lite", usage: {} });
  });

  it.each([
    [401, {}, "rejected"],
    [400, { error: { details: [{ reason: "API_KEY_INVALID" }] } }, "rejected"],
    [402, {}, "no_credit"],
    [403, {}, "unexpected_response"],
    [404, {}, "unexpected_response"],
    [429, {}, "rate_limited"],
    [503, {}, "unreachable"],
    [400, {}, "unexpected_response"],
  ] as const)("status %i com %j é %s", async (status, body, failure) => {
    const { fetch } = fakeFetch({ status, body });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({ ok: false, failure, status, model: "gemini-3.5-flash-lite", usage: {} });
  });

  it("a chave nunca vai na URL nem no resultado, e o texto do provedor não sai", async () => {
    const providerText = `API key not valid: ${KEY}`;
    for (const status of [200, 400, 401, 429, 500]) {
      const body = status === 200 ? { models: providerText, candidates: providerText } : { error: { message: providerText, details: [{ reason: "API_KEY_INVALID" }] } };
      const { fetch, sent } = fakeFetch((url) => (url.searchParams.has("pageToken") ? { status: 200, body: {} } : { status, body }));
      const listed = await brain.listModels(KEY, { fetch, today: TODAY });
      const asked = await brain.completeJson(KEY, REQUEST, { fetch });
      for (const request of sent) {
        expect(request.url).not.toContain(KEY);
        expect(new URL(request.url).searchParams.has("key")).toBe(false);
      }
      for (const out of [JSON.stringify(listed), JSON.stringify(asked)]) {
        expect(out).not.toContain(KEY);
        expect(out).not.toContain("API key not valid");
      }
    }
  });
});
