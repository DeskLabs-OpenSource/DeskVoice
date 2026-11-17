import { describe, expect, it } from "vitest";
import brain, { anthropicSchema, priceOf, usageOf } from "./anthropic";
import { ANALYSIS_SCHEMA } from "../analysis";
import { OUTCOME_GUESS_SCHEMA } from "../outcome";
import { estimateCostMicrocents } from "../pricing";

// Inventada: não tem a forma de uma chave real, e o teste procura por ela onde não pode aparecer.
const KEY = "chave-inventada-do-teste-anthropic";
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

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "model",
  id,
  display_name: `Nome de ${id}`,
  created_at: "2026-01-01T00:00:00Z",
  lifecycle: "active",
  max_input_tokens: 1_000_000,
  capabilities: { structured_outputs: { supported: true } },
  ...extra,
});

// Resposta gravada na forma de `GET /v1/models` (documentação de 2026-11-16), com ids inventados
// misturados aos reais.
const MODELS = {
  data: [
    model("claude-opus-5-5"),
    model("claude-inventado-9"),
    model("claude-sem-saida-estruturada", { capabilities: { structured_outputs: { supported: false } } }),
    model("claude-sem-capacidades", { capabilities: null, display_name: "", max_input_tokens: null }),
    model("claude-aposentado", { lifecycle: "retired" }),
    // Fora da forma: sem id, tipo errado, não é objeto. Saem, e a lista continua.
    { type: "model", display_name: "sem id" },
    { type: "file", id: "claude-tipo-errado" },
    "texto solto",
  ],
  has_more: false,
  first_id: "claude-opus-5-5",
  last_id: "claude-aposentado",
};

const SCHEMA = { name: "desfecho", strict: OUTCOME_GUESS_SCHEMA, google: { type: "object" } };
const REQUEST = { model: "claude-opus-5-5", prompt: "Leia a ligação.", schema: SCHEMA, timeoutMs: 30_000 };

describe("brains/anthropic: lista de modelos", () => {
  it("lê a lista da API com a chave no cabeçalho, descartando o que sai da forma ou não atende o pedido", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models.map((m) => m.id)).toEqual(["claude-inventado-9", "claude-opus-5-5", "claude-sem-capacidades"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(sent[0]?.method).toBe("GET");
    expect(sent[0]?.headers["x-api-key"]).toBe(KEY);
    expect(sent[0]?.headers["anthropic-version"]).toBe("2026-10-21");
  });

  it("usa o nome publicado e a janela de contexto; sem nome, o id", async () => {
    const { fetch } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models.find((m) => m.id === "claude-sem-capacidades")).toEqual({ id: "claude-sem-capacidades", label: "claude-sem-capacidades" });
    expect(result.models.find((m) => m.id === "claude-opus-5-5")).toMatchObject({ label: "Nome de claude-opus-5-5", contextTokens: 1_000_000 });
  });

  it("modelo que a tabela não conhece vem sem preço, nunca com zero", async () => {
    const { fetch } = fakeFetch({ status: 200, body: MODELS });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    const unknown = result.models.find((m) => m.id === "claude-inventado-9");
    expect(unknown && "price" in unknown).toBe(false);
    expect(result.models.find((m) => m.id === "claude-opus-5-5")?.price).toEqual({
      centsPerMillionInputTokens: 400,
      centsPerMillionCachedInputTokens: 20,
      centsPerMillionOutputTokens: 2000,
      source: "https://platform.claude.com/docs/en/about-claude/pricing",
      checkedOn: "2026-11-16",
    });
  });

  it("o modelo com preço por faixa de tamanho fica sem preço", () => {
    expect(priceOf("claude-haiku-5-5")).toBeUndefined();
    expect(priceOf("claude-haiku-4-5-20251001")).toBeDefined();
    expect(priceOf("claude-haiku-4-5")).toBeUndefined();
  });

  it("a tabela de preço não faz modelo aparecer: lista vazia da API é lista vazia", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { data: [], has_more: false, first_id: null, last_id: null } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: true, models: [] });
  });

  it("pagina por after_id até has_more falso", async () => {
    const pages: Record<string, unknown> = {
      "": { data: [model("claude-a")], has_more: true, last_id: "claude-a" },
      "claude-a": { data: [model("claude-b")], has_more: true, last_id: "claude-b" },
      "claude-b": { data: [model("claude-c")], has_more: false, last_id: "claude-c" },
    };
    const { fetch, sent } = fakeFetch((url) => ({ status: 200, body: pages[url.searchParams.get("after_id") ?? ""] }));
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    expect(result.ok && result.models.map((m) => m.id)).toEqual(["claude-a", "claude-b", "claude-c"]);
    expect(sent.map((s) => new URL(s.url).searchParams.get("after_id"))).toEqual([null, "claude-a", "claude-b"]);
  });

  it("para no teto de 20 páginas, e na página que não traz id novo", async () => {
    let n = 0;
    const endless = fakeFetch(() => {
      n += 1;
      return { status: 200, body: { data: [model(`claude-${n}`)], has_more: true, last_id: `claude-${n}` } };
    });
    const result = await brain.listModels(KEY, { fetch: endless.fetch, today: TODAY });
    expect(endless.sent).toHaveLength(20);
    expect(result.ok && result.models).toHaveLength(20);

    const repeating = fakeFetch({ status: 200, body: { data: [model("claude-a")], has_more: true, last_id: "claude-a" } });
    const repeated = await brain.listModels(KEY, { fetch: repeating.fetch, today: TODAY });
    expect(repeating.sent).toHaveLength(2);
    expect(repeated.ok && repeated.models.map((m) => m.id)).toEqual(["claude-a"]);
  });

  it("corpo fora da forma é unexpected_response com o status", async () => {
    const { fetch } = fakeFetch({ status: 200, body: { data: "não é lista" } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
    const naoJson = fakeFetch({ status: 200, body: "<html>proxy</html>" });
    expect(await brain.listModels(KEY, { fetch: naoJson.fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
  });

  it.each([
    [401, { type: "error", error: { type: "authentication_error", message: `chave ${KEY}` } }, "rejected"],
    [403, { type: "error", error: { type: "permission_error" } }, "rejected"],
    [402, { type: "error", error: { type: "billing_error" } }, "no_credit"],
    [400, { type: "error", error: { type: "billing_error" } }, "no_credit"],
    [429, { type: "error", error: { type: "rate_limit_error" } }, "rate_limited"],
    [500, { type: "error", error: { type: "api_error" } }, "unreachable"],
    [529, { type: "error", error: { type: "overloaded_error" } }, "unreachable"],
    [404, { type: "error", error: { type: "not_found_error" } }, "unexpected_response"],
    [400, { type: "error", error: { type: "invalid_request_error" } }, "unexpected_response"],
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

describe("brains/anthropic: pedido em JSON", () => {
  const ok = {
    id: "msg_inventada",
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: '{"outcome":"booked",' },
      { type: "text", text: '"confidence":0.9,"evidence":"Pode marcar"}' },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 700, cache_read_input_tokens: 300, cache_creation_input_tokens: 0, output_tokens: 200 },
  };

  it("pede saída estruturada em /v1/messages e devolve o texto e o consumo", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: ok });
    const result = await brain.completeJson(KEY, REQUEST, { fetch });
    expect(result).toEqual({
      ok: true,
      text: '{"outcome":"booked","confidence":0.9,"evidence":"Pode marcar"}',
      model: "claude-opus-5-5",
      usage: { inputTokens: 700, cachedInputTokens: 300, outputTokens: 200 },
    });
    expect(sent[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.headers["x-api-key"]).toBe(KEY);
    expect(sent[0]?.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 16_000,
      messages: [{ role: "user", content: "Leia a ligação." }],
      output_config: { format: { type: "json_schema", schema: anthropicSchema(OUTCOME_GUESS_SCHEMA) } },
    });
  });

  it("o schema enviado não leva os limites que a Anthropic recusa, e mantém o resto", () => {
    for (const schema of [OUTCOME_GUESS_SCHEMA, ANALYSIS_SCHEMA]) {
      const sent = JSON.stringify(anthropicSchema(schema));
      for (const word of ["minimum", "maximum", "minLength", "maxLength", "maxItems"]) expect(sent).not.toContain(`"${word}"`);
      expect(sent).toContain('"additionalProperties":false');
    }
    expect(anthropicSchema({ type: "object", properties: { maximum: { type: "number", maximum: 1 } }, minItems: 3 })).toEqual({
      type: "object",
      properties: { maximum: { type: "number" } },
    });
    expect(anthropicSchema({ type: "array", minItems: 1, items: { type: "string", maxLength: 9 } })).toEqual({ type: "array", minItems: 1, items: { type: "string" } });
  });

  it("o consumo entra no custo pelo preço da tabela", async () => {
    const { fetch } = fakeFetch({ status: 200, body: ok });
    const result = await brain.completeJson(KEY, REQUEST, { fetch });
    const price = priceOf("claude-opus-5-5");
    if (!price) throw new Error("sem preço");
    // 700 × 400 + 300 × 20 + 200 × 2000 centavos por milhão = 0,686 centavo.
    expect(estimateCostMicrocents(price, result.usage)).toBe(686_000);
  });

  it("escrita em cache, que o preço não cobre, deixa o consumo vazio: custo desconhecido, nunca menor", () => {
    expect(usageOf({ usage: { input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 1 } })).toEqual({});
    expect(usageOf({ usage: { input_tokens: 10, output_tokens: 1 } })).toEqual({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 });
    expect(usageOf({ usage: "errado" })).toEqual({});
  });

  it("200 fora da forma, cortado ou recusado é unexpected_response, com o consumo que foi cobrado", async () => {
    const usage = { inputTokens: 700, cachedInputTokens: 300, outputTokens: 200 };
    for (const body of [
      { ...ok, stop_reason: "max_tokens" },
      { ...ok, stop_reason: "refusal", content: [] },
      { ...ok, content: [{ type: "thinking", thinking: "" }] },
    ]) {
      const { fetch } = fakeFetch({ status: 200, body });
      expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({ ok: false, failure: "unexpected_response", status: 200, model: "claude-opus-5-5", usage });
    }
    const semNada = fakeFetch({ status: 200, body: { usage: "errado" } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch: semNada.fetch })).toEqual({ ok: false, failure: "unexpected_response", status: 200, model: "claude-opus-5-5", usage: {} });
  });

  it.each([
    [401, "authentication_error", "rejected"],
    [402, "billing_error", "no_credit"],
    [403, "permission_error", "unexpected_response"],
    [404, "not_found_error", "unexpected_response"],
    [429, "rate_limit_error", "rate_limited"],
    [529, "overloaded_error", "unreachable"],
    [400, "invalid_request_error", "unexpected_response"],
  ] as const)("status %i (%s) é %s", async (status, type, failure) => {
    const { fetch } = fakeFetch({ status, body: { type: "error", error: { type, message: `chave ${KEY} recusada` } } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({ ok: false, failure, status, model: "claude-opus-5-5", usage: {} });
  });

  it("a chave nunca vai na URL nem no resultado, e o texto do provedor não sai", async () => {
    const providerText = `invalid x-api-key: ${KEY}`;
    for (const status of [200, 401, 429, 500]) {
      const body = status === 200 ? { data: providerText, content: providerText } : { type: "error", error: { type: "authentication_error", message: providerText } };
      const { fetch, sent } = fakeFetch({ status, body });
      const listed = await brain.listModels(KEY, { fetch, today: TODAY });
      const asked = await brain.completeJson(KEY, REQUEST, { fetch });
      for (const request of sent) expect(request.url).not.toContain(KEY);
      for (const out of [JSON.stringify(listed), JSON.stringify(asked)]) {
        expect(out).not.toContain(KEY);
        expect(out).not.toContain("invalid x-api-key");
      }
    }
  });
});
