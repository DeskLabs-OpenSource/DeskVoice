import { describe, expect, it } from "vitest";
import brain, { centsPerMillionOf } from "./openrouter";

// Inventada: não tem a forma de uma chave real, e o teste procura por ela onde não pode aparecer.
const KEY = "chave-inventada-do-teste-openrouter";
const TODAY = "2026-11-16";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

type Reply = { status: number; body?: unknown };
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Responde por caminho: `/key`, `/models` (com a página pelo `offset`) e `/chat/completions`. */
function fakeFetch(routes: { key?: Reply; models?: Reply | ((offset: number) => Reply); chat?: Reply }) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const parsed = new URL(url);
    let reply: Reply | undefined;
    if (parsed.pathname === "/api/v1/key") reply = routes.key;
    else if (parsed.pathname === "/api/v1/models") {
      const models = routes.models;
      reply = typeof models === "function" ? models(Number(parsed.searchParams.get("offset") ?? "0")) : models;
    } else if (parsed.pathname === "/api/v1/chat/completions") reply = routes.chat;
    if (!reply) throw new Error(`rota sem resposta no teste: ${parsed.pathname}`);
    const { status, body } = reply;
    return new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

const KEY_OK: Reply = { status: 200, body: { data: { label: "inventada", limit: null, usage: 0, is_free_tier: false } } };

const textModel = (id: string, pricing: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Nome de ${id}`,
  context_length: 128000,
  architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
  pricing,
  ...extra,
});

// Resposta gravada na forma de `GET /api/v1/models` (documentação de 2026-11-16), com dados inventados.
const MODELS = {
  data: [
    textModel("inventor/modelo-pago", { prompt: "0.0000025", completion: "0.00001", input_cache_read: "0.00000125" }),
    textModel("inventor/modelo-gratis:free", { prompt: "0", completion: "0" }),
    textModel("inventor/roteador", { prompt: "-1", completion: "-1" }),
    textModel("inventor/preco-estranho", { prompt: "grátis", completion: "0.00001" }),
    textModel("inventor/sem-nome", { prompt: "0.000001", completion: "0.000002" }, { name: "", context_length: null }),
    // Recebe imagem e texto, devolve texto: conversa.
    textModel("inventor/visao", { prompt: "0.000001", completion: "0.000001" }, { architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } }),
    // Só gera imagem, ou só embedding: fora.
    textModel("inventor/so-imagem", { prompt: "0.000001", completion: "0.000001" }, { architecture: { input_modalities: ["text"], output_modalities: ["image"] } }),
    textModel("inventor/embedding", { prompt: "0.000001", completion: "0" }, { architecture: { input_modalities: ["text"], output_modalities: ["embeddings"] } }),
    // Fora da forma: preço em número, sem arquitetura, sem id. Saem, e a lista continua.
    { id: "inventor/preco-numero", name: "x", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, pricing: { prompt: 0.000001, completion: 0.000001 } },
    { id: "inventor/sem-arquitetura", name: "x", pricing: { prompt: "0", completion: "0" } },
    { name: "sem id" },
    null,
  ],
  total_count: 12,
  links: { next: null },
};

const SCHEMA = { name: "analise", strict: { type: "object" }, google: { type: "OBJECT" } };
const REQUEST = { model: "inventor/modelo-pago", prompt: "Leia a ligação.", schema: SCHEMA, timeoutMs: 30_000 };

describe("brains/openrouter: lista de modelos", () => {
  it("prova a chave em /key antes de ler /models, ambos com a chave no cabeçalho", async () => {
    const { fetch, sent } = fakeFetch({ key: KEY_OK, models: { status: 200, body: MODELS } });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    expect(result.ok).toBe(true);
    expect(sent.map((s) => s.url)).toEqual(["https://openrouter.ai/api/v1/key", `${MODELS_URL}?output_modalities=text&limit=1000&offset=0`]);
    for (const request of sent) expect(request.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("só modelos de texto, descartando o que sai da forma", async () => {
    const { fetch } = fakeFetch({ key: KEY_OK, models: { status: 200, body: MODELS } });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models.map((m) => m.id)).toEqual([
      "inventor/modelo-gratis:free",
      "inventor/modelo-pago",
      "inventor/preco-estranho",
      "inventor/roteador",
      "inventor/sem-nome",
      "inventor/visao",
    ]);
  });

  it("o preço vem da lista: dólar por token vira centavo por milhão, com a URL e o dia da leitura", async () => {
    const { fetch } = fakeFetch({ key: KEY_OK, models: { status: 200, body: MODELS } });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    const byId = new Map(result.models.map((m) => [m.id, m]));
    expect(byId.get("inventor/modelo-pago")).toEqual({
      id: "inventor/modelo-pago",
      label: "Nome de inventor/modelo-pago",
      contextTokens: 128000,
      // US$ 2,50, US$ 1,25 e US$ 10 por milhão de tokens.
      price: { centsPerMillionInputTokens: 250, centsPerMillionCachedInputTokens: 125, centsPerMillionOutputTokens: 1000, source: MODELS_URL, checkedOn: TODAY },
    });
    // Zero publicado pelo provedor é zero.
    expect(byId.get("inventor/modelo-gratis:free")?.price).toEqual({ centsPerMillionInputTokens: 0, centsPerMillionOutputTokens: 0, source: MODELS_URL, checkedOn: TODAY });
  });

  it("preço negativo ou fora da forma deixa o modelo sem preço, nunca com zero", async () => {
    const { fetch } = fakeFetch({ key: KEY_OK, models: { status: 200, body: MODELS } });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    for (const id of ["inventor/roteador", "inventor/preco-estranho"]) {
      const model = result.models.find((m) => m.id === id);
      expect(model).toBeDefined();
      expect(model && "price" in model, id).toBe(false);
    }
  });

  it("tarifa além do token, diferente de zero, deixa o modelo sem preço; zero publicado não", async () => {
    const tokens = { prompt: "0.000001", completion: "0.000002" };
    const body = {
      data: [
        textModel("inventor/com-pedido", { ...tokens, request: "0.005" }),
        textModel("inventor/com-busca", { ...tokens, web_search: "0.01" }),
        textModel("inventor/com-imagem", { ...tokens, image: "0.0003" }),
        textModel("inventor/com-escrita-cache", { ...tokens, input_cache_write: "0.0000012" }),
        textModel("inventor/tarifa-estranha", { ...tokens, request: "consulte" }),
        textModel("inventor/tarifa-numero", { ...tokens }, { pricing: { ...tokens, request: 0.005 } }),
        textModel("inventor/extras-zerados", { ...tokens, request: "0", image: "0.0", web_search: "0" }),
        textModel("inventor/extras-numero-zero", { ...tokens }, { pricing: { ...tokens, request: 0, internal_reasoning: null } }),
      ],
    };
    const { fetch } = fakeFetch({ key: KEY_OK, models: { status: 200, body } });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    const byId = new Map(result.models.map((m) => [m.id, m]));
    expect(byId.size).toBe(8);
    for (const id of ["inventor/com-pedido", "inventor/com-busca", "inventor/com-imagem", "inventor/com-escrita-cache", "inventor/tarifa-estranha", "inventor/tarifa-numero"]) {
      const model = byId.get(id);
      expect(model, id).toBeDefined();
      expect(model && "price" in model, id).toBe(false);
    }
    for (const id of ["inventor/extras-zerados", "inventor/extras-numero-zero"]) {
      expect(byId.get(id)?.price, id).toEqual({ centsPerMillionInputTokens: 100, centsPerMillionOutputTokens: 200, source: MODELS_URL, checkedOn: TODAY });
    }
  });

  it("sem nome publicado, o rótulo é o id; contexto nulo fica ausente", async () => {
    const { fetch } = fakeFetch({ key: KEY_OK, models: { status: 200, body: MODELS } });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    const model = result.models.find((m) => m.id === "inventor/sem-nome");
    expect(model?.label).toBe("inventor/sem-nome");
    expect(model && "contextTokens" in model).toBe(false);
  });

  it("a conversão de unidade não deixa ruído de ponto flutuante", () => {
    expect(centsPerMillionOf("0.00000005")).toBe(5);
    expect(centsPerMillionOf("0.0000003")).toBe(30);
    expect(centsPerMillionOf("0")).toBe(0);
    expect(centsPerMillionOf("1e-7")).toBe(10);
    for (const raw of ["-1", "", "NaN", "Infinity", "0x10", " ", undefined]) expect(centsPerMillionOf(raw), String(raw)).toBeUndefined();
  });

  it("/key 401 com /models 200 é rejected: a lista pública não aprova chave recusada", async () => {
    const { fetch, sent } = fakeFetch({ key: { status: 401, body: { error: { code: 401, message: "No auth credentials found" } } }, models: { status: 200, body: MODELS } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "rejected", status: 401 });
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual(["/api/v1/key"]);
  });

  it("/key 200 fora da forma é unexpected_response", async () => {
    const { fetch } = fakeFetch({ key: { status: 200, body: { nada: true } }, models: { status: 200, body: MODELS } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
  });

  it.each([
    [401, "rejected"],
    [402, "no_credit"],
    [403, "rejected"],
    [408, "unreachable"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [502, "provider_error"],
    [400, "unexpected_response"],
  ] as const)("/key com status %i é %s", async (status, failure) => {
    const { fetch } = fakeFetch({ key: { status, body: { error: { code: status, message: `algo sobre ${KEY}` } } } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure, status });
  });

  it("/models falhando depois da chave aceita traz o motivo dele", async () => {
    const { fetch } = fakeFetch({ key: KEY_OK, models: { status: 503, body: {} } });
    expect(await brain.listModels(KEY, { fetch, today: TODAY })).toEqual({ ok: false, failure: "provider_error", status: 503 });
    const forma = fakeFetch({ key: KEY_OK, models: { status: 200, body: { data: "não é lista" } } });
    expect(await brain.listModels(KEY, { fetch: forma.fetch, today: TODAY })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
  });

  it("segue a paginação até a página menor que o limite", async () => {
    const page = (offset: number, count: number) => ({
      status: 200,
      body: { data: Array.from({ length: count }, (_, i) => textModel(`inventor/m${String(offset + i).padStart(5, "0")}`, { prompt: "0", completion: "0" })) },
    });
    const { fetch, sent } = fakeFetch({ key: KEY_OK, models: (offset) => (offset === 0 ? page(0, 1000) : page(offset, 3)) });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models).toHaveLength(1003);
    expect(sent).toHaveLength(3);
  });

  it("servidor que ignora o offset e repete a lista inteira para na página sem id novo", async () => {
    const full = { status: 200, body: { data: Array.from({ length: 1000 }, (_, i) => textModel(`inventor/r${i}`, { prompt: "0", completion: "0" })) } };
    const { fetch, sent } = fakeFetch({ key: KEY_OK, models: () => full });
    const result = await brain.listModels(KEY, { fetch, today: TODAY });
    if (!result.ok) throw new Error("lista falhou");
    expect(result.models).toHaveLength(1000);
    expect(sent).toHaveLength(3);
  });
});

describe("brains/openrouter: pedido em JSON", () => {
  const ok = {
    id: "gen-inventado",
    choices: [{ message: { role: "assistant", content: '{"summary":"ok"}' } }],
    usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 }, cost: 0.0001 },
  };

  it("pede json_schema em /api/v1/chat/completions e devolve o texto e o consumo", async () => {
    const { fetch, sent } = fakeFetch({ chat: { status: 200, body: ok } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({
      ok: true,
      text: '{"summary":"ok"}',
      model: "inventor/modelo-pago",
      usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 10 },
    });
    expect(sent[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(sent[0]?.body).toEqual({
      model: "inventor/modelo-pago",
      messages: [{ role: "user", content: "Leia a ligação." }],
      response_format: { type: "json_schema", json_schema: { name: "analise", strict: true, schema: SCHEMA.strict } },
    });
  });

  it("erro no meio da geração vem com 200 e `error` no corpo: unexpected_response", async () => {
    const { fetch } = fakeFetch({ chat: { status: 200, body: { error: { code: 502, message: `falhou ${KEY}` } } } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({ ok: false, failure: "unexpected_response", status: 200, model: "inventor/modelo-pago", usage: {} });
  });

  it.each([
    [401, "rejected"],
    [402, "no_credit"],
    // No pedido, 403 é moderação ou guarda da conta, não chave recusada.
    [403, "unexpected_response"],
    [408, "unreachable"],
    [429, "rate_limited"],
    [502, "provider_error"],
    [503, "provider_error"],
    [400, "unexpected_response"],
  ] as const)("status %i é %s", async (status, failure) => {
    const { fetch } = fakeFetch({ chat: { status, body: { error: { code: status, message: `algo sobre ${KEY}` } } } });
    expect(await brain.completeJson(KEY, REQUEST, { fetch })).toEqual({ ok: false, failure, status, model: "inventor/modelo-pago", usage: {} });
  });

  it("a chave nunca vai na URL nem no resultado, e o texto do provedor não sai", async () => {
    const providerText = `Invalid key ${KEY}`;
    for (const status of [200, 401, 402, 500]) {
      const reply = { status, body: { error: { code: status, message: providerText } } };
      const { fetch, sent } = fakeFetch({ key: reply, models: reply, chat: reply });
      const listed = await brain.listModels(KEY, { fetch, today: TODAY });
      const asked = await brain.completeJson(KEY, REQUEST, { fetch });
      for (const request of sent) expect(request.url).not.toContain(KEY);
      for (const out of [JSON.stringify(listed), JSON.stringify(asked)]) {
        expect(out).not.toContain(KEY);
        expect(out).not.toContain("Invalid key");
      }
    }
  });
});

// ---- chat (R5, fatia 2): a ligação deste cérebro ao caminho comum, testado em `brain-http.test.ts` ----

const CHAT_KEY = "chave-inventada-do-teste-chat-openrouter";
const CHAT_REQUEST = {
  model: "openai/gpt-5-nano",
  messages: [{ role: "user" as const, content: "Oi" }],
  tools: [{ name: "agendar", description: "Marca um horário.", parameters: { type: "object" } }],
  timeoutMs: 5_000,
};

/** `fetch` falso que responde SSE (ou um erro) e guarda o pedido. */
function sseFetch(reply: { status: number; body: string }) {
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) as Record<string, unknown> });
    return new Response(reply.body, { status: reply.status, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

/** Roda a conversa até `done` ou `error` e devolve os eventos em ordem. */
async function chatEvents(fetch: typeof globalThis.fetch): Promise<unknown[][]> {
  const chat = brain.chat?.(CHAT_KEY, CHAT_REQUEST, { fetch });
  if (!chat) throw new Error("sem chat");
  const events: unknown[][] = [];
  await new Promise<void>((resolve) => {
    chat.on("text", (delta) => events.push(["text", delta]));
    chat.on("toolCall", (call) => events.push(["toolCall", call]));
    chat.on("usage", (usage, estimated) => events.push(["usage", usage, estimated]));
    chat.on("done", () => {
      events.push(["done"]);
      resolve();
    });
    chat.on("error", (failure, status) => {
      events.push(["error", failure, status]);
      resolve();
    });
  });
  return events;
}

const sseOf = (...chunks: unknown[]): string => chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";

describe("brains/openrouter: chat em streaming", () => {
  it("não manda `stream_options` (obsoleto e sem efeito no OpenRouter), em POST https://openrouter.ai/api/v1/chat/completions, e entrega texto, ferramenta e consumo declarado", async () => {
    const { fetch, sent } = sseFetch({
      status: 200,
      body: sseOf(
        { choices: [{ index: 0, delta: { content: "Bom " } }] },
        { choices: [{ index: 0, delta: { content: "dia" } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "agendar", arguments: '{"dia"' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':"terça"}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 50, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 10 } } },
      ),
    });
    const events = await chatEvents(fetch);
    expect(sent[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent[0]?.headers.Authorization).toBe(`Bearer ${CHAT_KEY}`);
    expect(sent[0]?.body).toMatchObject({ model: "openai/gpt-5-nano", stream: true });
    expect(sent[0]?.body).not.toHaveProperty("stream_options");
    expect(events).toEqual([
      ["text", "Bom "],
      ["text", "dia"],
      ["toolCall", { id: "c1", name: "agendar", args: '{"dia":"terça"}' }],
      ["usage", { inputTokens: 40, cachedInputTokens: 10, outputTokens: 4 }, false],
      ["done"],
    ]);
  });

  it("a recusa cai no vocabulário fechado, como no completeJson, sem custo e sem a chave", async () => {
    const cases: [number, unknown, string][] = [
      [402, {}, "no_credit"],
      [403, {}, "unexpected_response"],
      [401, {}, "rejected"],
      [429, {}, "rate_limited"],
      [502, {}, "provider_error"],
    ];
    for (const [status, body, failure] of cases) {
      const { fetch } = sseFetch({ status, body: JSON.stringify(body) });
      const events = await chatEvents(fetch);
      expect(events).toEqual([
        ["usage", {}, false],
        ["error", failure, status],
      ]);
      expect(JSON.stringify(events)).not.toContain(CHAT_KEY);
    }
  });
});
