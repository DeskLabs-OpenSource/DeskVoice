import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import brain, { anthropicSchema, priceOf, usageOf } from "./anthropic";
import type { BrainChat, BrainChatMessage, BrainChatRequest } from "../brain";
import type { ToolSpec, Usage } from "../types";
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

// ---- chat (R5, fatia 2b): a API de mensagens em streaming, contra um servidor falso ----

const CHAT_KEY = "chave-inventada-do-teste-chat-anthropic";
const CHAT_TOOLS: ToolSpec[] = [
  { name: "agendar", description: "Marca um horário.", parameters: { type: "object", properties: { dia: { type: "string" } } } },
  { name: "consultar_preco", description: "Diz o preço.", parameters: { type: "object", properties: { exame: { type: "string" } } } },
];
const CHAT_MESSAGES: BrainChatMessage[] = [
  { role: "system", content: "Você atende uma clínica." },
  { role: "user", content: "Quero marcar para terça e saber o preço." },
  {
    role: "assistant",
    content: "Um instante.",
    toolCalls: [
      { id: "toolu_a", name: "agendar", args: '{"dia":"terça"}' },
      { id: "toolu_b", name: "consultar_preco", args: '{"exame":"sangue"}' },
    ],
  },
  { role: "tool", content: '{"ok":true}', toolCallId: "toolu_a" },
  { role: "tool", content: '{"preco":"R$ 40"}', toolCallId: "toolu_b" },
  { role: "system", content: "Seja breve." },
];
const chatRequest = (overrides: Partial<BrainChatRequest> = {}): BrainChatRequest => ({
  model: "claude-haiku-4-5-20251001",
  messages: CHAT_MESSAGES,
  tools: CHAT_TOOLS,
  timeoutMs: 5_000,
  ...overrides,
});

const ev = (type: string, data: Record<string, unknown> = {}): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const START = ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", content: [], usage: { input_tokens: 472, output_tokens: 2 } } });
const textStart = (index: number) => ev("content_block_start", { index, content_block: { type: "text", text: "" } });
const textDelta = (index: number, text: string) => ev("content_block_delta", { index, delta: { type: "text_delta", text } });
const toolStart = (index: number, id: string, name: string) => ev("content_block_start", { index, content_block: { type: "tool_use", id, name, input: {} } });
const jsonDelta = (index: number, partial_json: string) => ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json } });
const stop = (index: number) => ev("content_block_stop", { index });
const messageDelta = (usage: Record<string, unknown>) => ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage });
const MESSAGE_STOP = ev("message_stop");
const PING = ev("ping");

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
interface ChatFake {
  fetch: typeof fetch;
  urls: string[];
  bodies: Record<string, unknown>[];
  headers: IncomingMessage["headers"][];
  aborted: Promise<void>;
  sawAbort: () => boolean;
  stop: () => Promise<void>;
}
const chatServers: ChatFake[] = [];
afterEach(async () => {
  await Promise.all(chatServers.splice(0).map((server) => server.stop()));
});

/** Servidor falso; o `fetch` devolvido leva o pedido da URL real da Anthropic para ele, e guarda a URL. */
async function chatServer(handler: Handler): Promise<ChatFake> {
  const bodies: Record<string, unknown>[] = [];
  const headers: IncomingMessage["headers"][] = [];
  const urls: string[] = [];
  let sawAbort = false;
  let markAborted: () => void = () => undefined;
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (piece: Buffer) => {
      raw += piece.toString("utf8");
    });
    req.on("end", () => {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      headers.push(req.headers);
      res.on("close", () => {
        if (!res.writableFinished) {
          sawAbort = true;
          markAborted();
        }
      });
      handler(req, res);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fake: ChatFake = {
    fetch: ((input: string | URL, init?: RequestInit) => {
      urls.push(String(input));
      return fetch(local, init);
    }) as typeof fetch,
    urls,
    bodies,
    headers,
    aborted,
    sawAbort: () => sawAbort,
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  chatServers.push(fake);
  return fake;
}

/** Escreve os eventos um por vez, cada um num giro do laço, e termina (ou não). */
function sseReply(res: ServerResponse, pieces: string[], options: { end?: boolean } = {}): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let i = 0;
  const next = (): void => {
    if (res.destroyed) return;
    if (i < pieces.length) {
      res.write(pieces[i++]);
      setImmediate(next);
    } else if (options.end !== false) {
      res.end();
    }
  };
  next();
}

type ChatEvent = [string, ...unknown[]];
function collectChat(chat: BrainChat) {
  const events: ChatEvent[] = [];
  let end: () => void = () => undefined;
  let gotUsage: (value: { usage: Usage; estimated: boolean }) => void = () => undefined;
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  const usage = new Promise<{ usage: Usage; estimated: boolean }>((resolve) => {
    gotUsage = resolve;
  });
  chat.on("text", (delta) => events.push(["text", delta]));
  chat.on("toolCall", (call) => events.push(["toolCall", call]));
  chat.on("usage", (value, estimated) => {
    events.push(["usage", value, estimated]);
    gotUsage({ usage: value, estimated });
  });
  chat.on("done", () => {
    events.push(["done"]);
    end();
  });
  chat.on("error", (failure, status) => {
    events.push(["error", failure, status]);
    end();
  });
  return { events, ended, usage };
}

const openChat = (fake: { fetch: typeof fetch }, overrides: Partial<BrainChatRequest> = {}): BrainChat => {
  const chat = brain.chat?.(CHAT_KEY, chatRequest(overrides), { fetch: fake.fetch });
  if (!chat) throw new Error("sem chat");
  return chat;
};
const chatBytes = (text: string): number => Buffer.byteLength(text, "utf8");
const settleChat = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe("brains/anthropic: chat em streaming", () => {
  it("9. o corpo: system no topo, tool_use com input objeto, dois tool numa só user, ferramentas com input_schema, sem chave no corpo", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [START, messageDelta({ output_tokens: 1 }), MESSAGE_STOP]));
    await collectChat(openChat(fake)).ended;

    expect(fake.urls).toEqual(["https://api.anthropic.com/v1/messages"]);
    expect(fake.headers[0]?.["x-api-key"]).toBe(CHAT_KEY);
    expect(fake.headers[0]?.["anthropic-version"]).toBe("2026-10-21");
    const body = fake.bodies[0];
    expect(body).toMatchObject({ model: "claude-haiku-4-5-20251001", stream: true, max_tokens: expect.any(Number) });
    expect(body?.system).toBe("Você atende uma clínica.\n\nSeja breve.");
    expect(body?.messages).toEqual([
      { role: "user", content: "Quero marcar para terça e saber o preço." },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Um instante." },
          { type: "tool_use", id: "toolu_a", name: "agendar", input: { dia: "terça" } },
          { type: "tool_use", id: "toolu_b", name: "consultar_preco", input: { exame: "sangue" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_a", content: '{"ok":true}' },
          { type: "tool_result", tool_use_id: "toolu_b", content: '{"preco":"R$ 40"}' },
        ],
      },
    ]);
    expect(JSON.stringify(body?.messages)).not.toContain('"system"');
    expect(body?.tools).toEqual(CHAT_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })));
    expect(body).not.toHaveProperty("cache_control");
    expect(JSON.stringify(body)).not.toContain(CHAT_KEY);
  });

  it("9b. sem system nem ferramentas, os campos não vão; args que não é objeto JSON é erro de quem chama, sem envio e sem usage", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [START, messageDelta({ output_tokens: 1 }), MESSAGE_STOP]));
    await collectChat(openChat(fake, { messages: [{ role: "user", content: "Oi" }], tools: [] })).ended;
    expect(fake.bodies[0]).not.toHaveProperty("system");
    expect(fake.bodies[0]).not.toHaveProperty("tools");

    for (const args of ["{quebrado", "[1,2]", '"texto"']) {
      const messages: BrainChatMessage[] = [
        { role: "user", content: "Oi" },
        { role: "assistant", content: "", toolCalls: [{ id: "toolu_x", name: "agendar", args }] },
        { role: "tool", content: "{}", toolCallId: "toolu_x" },
      ];
      const got = collectChat(openChat(fake, { messages }));
      await got.ended;
      expect(got.events).toEqual([["error", "unexpected_response", null]]);
    }
    expect(fake.bodies).toHaveLength(1);
  });

  it("1 e 3. vários text_delta viram vários text, na ordem; entrada do message_start e saída do último message_delta", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [
        START,
        textStart(0),
        PING,
        textDelta(0, "Bom "),
        textDelta(0, "dia, "),
        textDelta(0, "tudo bem?"),
        stop(0),
        messageDelta({ output_tokens: 5 }),
        messageDelta({ output_tokens: 15 }),
        MESSAGE_STOP,
      ]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Bom "],
      ["text", "dia, "],
      ["text", "tudo bem?"],
      // Cumulativo: 15, nunca 5 + 15.
      ["usage", { inputTokens: 472, cachedInputTokens: 0, outputTokens: 15 }, false],
      ["done"],
    ]);
  });

  it("3b. a entrada do message_delta, quando vem, vale por cima da do message_start, com a leitura de cache", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [START, textStart(0), textDelta(0, "Oi"), stop(0), messageDelta({ input_tokens: 500, cache_read_input_tokens: 100, output_tokens: 7 }), MESSAGE_STOP]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events.at(-2)).toEqual(["usage", { inputTokens: 500, cachedInputTokens: 100, outputTokens: 7 }, false]);
  });

  it("2. tool_use em três input_json_delta vira um toolCall com args igual à concatenação, em texto; dois tool_use depois de um texto viram dois", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [
        START,
        textStart(0),
        textDelta(0, "Vou ver."),
        stop(0),
        toolStart(1, "toolu_a", "agendar"),
        jsonDelta(1, ""),
        jsonDelta(1, '{"di'),
        jsonDelta(1, 'a": "ter'),
        jsonDelta(1, 'ça"}'),
        stop(1),
        toolStart(2, "toolu_b", "consultar_preco"),
        jsonDelta(2, '{"exame":"sangue"}'),
        stop(2),
        messageDelta({ output_tokens: 89 }),
        MESSAGE_STOP,
      ]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Vou ver."],
      // Sem parse e sem reformatação: o espaço depois dos dois-pontos fica.
      ["toolCall", { id: "toolu_a", name: "agendar", args: '{"dia": "terça"}' }],
      ["toolCall", { id: "toolu_b", name: "consultar_preco", args: '{"exame":"sangue"}' }],
      ["usage", { inputTokens: 472, cachedInputTokens: 0, outputTokens: 89 }, false],
      ["done"],
    ]);
    for (const [, value] of got.events.filter(([name]) => name === "toolCall")) expect(typeof (value as { args: unknown }).args).toBe("string");
  });

  it("2b. tool_use sem input_json_delta vira args \"{}\"; o toolCall sai no content_block_stop, antes do fim", async () => {
    let more: () => void = () => undefined;
    const fake = await chatServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(START + toolStart(0, "toolu_c", "agendar") + stop(0));
      more = () => res.end(messageDelta({ output_tokens: 3 }) + MESSAGE_STOP);
    });
    const chat = openChat(fake);
    const got = collectChat(chat);
    chat.on("toolCall", () => more());
    await got.ended;
    expect(got.events[0]).toEqual(["toolCall", { id: "toolu_c", name: "agendar", args: "{}" }]);
    expect(got.events.at(-1)).toEqual(["done"]);
  });

  it("2c. raciocínio não vira text, mas conta na saída estimada", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [
        START,
        ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
        ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "Pensando." } }),
        ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "assinatura" } }),
        stop(0),
        ev("content_block_start", { index: 1, content_block: { type: "redacted_thinking", data: "opaco" } }),
        stop(1),
        textStart(2),
        textDelta(2, "Oi"),
        stop(2),
        // Sem `message_delta` com consumo: o fim leva a estimativa.
        ev("message_delta", { delta: { stop_reason: "end_turn" } }),
        MESSAGE_STOP,
      ]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Oi"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Pensando.") + chatBytes("opaco") + chatBytes("Oi") }, true],
      ["done"],
    ]);
  });

  it("4. cortado depois do message_start e antes do message_delta: usage estimado, entrada > 0, e unexpected_response", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [START, textStart(0), textDelta(0, "Meia frase")]));
    const got = collectChat(openChat(fake));
    await got.ended;
    const body = fake.bodies[0] as { system: string; messages: unknown; tools: unknown };
    const { usage, estimated } = await got.usage;
    expect(estimated).toBe(true);
    expect(usage.inputTokens).toBe(chatBytes(body.system) + chatBytes(JSON.stringify(body.messages)) + chatBytes(JSON.stringify(body.tools)));
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBe(chatBytes("Meia frase"));
    expect(got.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
  });

  it("5. cancel no meio: o servidor vê o corte, não chega mais texto, e chega um usage estimado", async () => {
    let more: () => void = () => undefined;
    const fake = await chatServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(START + textStart(0) + textDelta(0, "Primeiro pedaço"));
      more = () => {
        if (!res.destroyed) res.write(textDelta(0, "depois do cancel") + stop(0) + messageDelta({ output_tokens: 9 }) + MESSAGE_STOP);
      };
    });
    const chat = openChat(fake);
    const got = collectChat(chat);
    chat.on("text", () => {
      chat.cancel();
      more();
    });
    const { usage, estimated } = await got.usage;
    await fake.aborted;
    await settleChat();
    expect(fake.sawAbort()).toBe(true);
    expect(estimated).toBe(true);
    expect(got.events).toEqual([["text", "Primeiro pedaço"], ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Primeiro pedaço") }, true]]);
    expect(usage.inputTokens).toBeGreaterThan(0);
  });

  it("6. prazo estourado no meio vira error(unreachable, null), depois do usage estimado", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [START, textStart(0), textDelta(0, "Começo")], { end: false }));
    const got = collectChat(openChat(fake, { timeoutMs: 100 }));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Começo"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Começo") }, true],
      ["error", "unreachable", null],
    ]);
    await fake.aborted;
  });

  it.each([
    [401, "authentication_error", "rejected"],
    [402, "billing_error", "no_credit"],
    [400, "billing_error", "no_credit"],
    [429, "rate_limit_error", "rate_limited"],
    [529, "overloaded_error", "unreachable"],
    [500, "api_error", "unreachable"],
    [404, "not_found_error", "unexpected_response"],
  ])("7. HTTP %i (%s) vira %s, como no completeJson; a recusa vem sem custo", async (status, type, failure) => {
    const fake = await chatServer((_req, res) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type, message: `segredo ${CHAT_KEY}` } })));
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["usage", {}, false],
      ["error", failure, status],
    ]);
    expect(JSON.stringify(got.events)).not.toContain(CHAT_KEY);
  });

  it("8. SSE quebrado vira error(unexpected_response, 200), sem lançar", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [START, textStart(0), textDelta(0, "Antes"), 'data: {"type": "content_block_delta", quebrado\n\n', textDelta(0, "depois"), MESSAGE_STOP]));
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Antes"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Antes") }, true],
      ["error", "unexpected_response", 200],
    ]);
  });

  it.each([
    ["overloaded_error", "rate_limited"],
    ["billing_error", "no_credit"],
    ["api_error", "unreachable"],
    ["tipo_novo", "unexpected_response"],
  ])("o evento error (%s) no meio do SSE vira %s, pelo tipo, nunca pelo texto", async (type, failure) => {
    const fake = await chatServer((_req, res) => sseReply(res, [START, textStart(0), textDelta(0, "Oi"), `event: error\ndata: ${JSON.stringify({ type: "error", error: { type, message: "Overloaded" } })}\n\n`, MESSAGE_STOP]));
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Oi"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Oi") }, true],
      ["error", failure, 200],
    ]);
  });

  it("10. toolCall seguido de evento error: os dois chegam, e um só usage", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [START, toolStart(0, "toolu_a", "agendar"), jsonDelta(0, '{"dia":"terça"}'), stop(0), ev("error", { error: { type: "overloaded_error", message: "Overloaded" } }), MESSAGE_STOP]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    await settleChat();
    expect(got.events).toEqual([
      ["toolCall", { id: "toolu_a", name: "agendar", args: '{"dia":"terça"}' }],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes('{"dia":"terça"}') }, true],
      ["error", "rate_limited", 200],
    ]);
  });

  it("11. escrita em cache no consumo vira usage({}, false): custo desconhecido, nunca zero", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [
        ev("message_start", { message: { content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 2000, output_tokens: 1 } } }),
        textStart(0),
        textDelta(0, "Oi"),
        stop(0),
        messageDelta({ output_tokens: 4 }),
        MESSAGE_STOP,
      ]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([["text", "Oi"], ["usage", {}, false], ["done"]]);
  });

  /**
   * A leitura do consumo que o contrato `BrainChatEvents.usage` manda fazer: `{}` com `false` só vale
   * custo zero quando o fim é `error` com status fora de 2xx (recusa); em qualquer outro fim, é custo
   * não medido. É a leitura que o `meter` da fatia 3 faz; o teste prende os dois lados dela.
   */
  function costOf(events: ChatEvent[]): "zero" | "not_measured" | "declared" | "estimated" {
    const usages = events.filter(([name]) => name === "usage");
    expect(usages).toHaveLength(1);
    const [, usage, estimated] = usages[0] as [string, Usage, boolean];
    if (estimated) return "estimated";
    if (Object.keys(usage).length > 0) return "declared";
    const end = events.at(-1);
    const refused = end?.[0] === "error" && typeof end[2] === "number" && (end[2] < 200 || end[2] > 299);
    return refused ? "zero" : "not_measured";
  }

  it("contrato: usage({}, false) só vale zero junto de error fora de 2xx; a escrita em cache é não medida", async () => {
    const cache = await chatServer((_req, res) =>
      sseReply(res, [
        ev("message_start", { message: { content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 2000, output_tokens: 1 } } }),
        textStart(0),
        textDelta(0, "Oi"),
        stop(0),
        messageDelta({ output_tokens: 4 }),
        MESSAGE_STOP,
      ]),
    );
    const cached = collectChat(openChat(cache));
    await cached.ended;
    expect(cached.events.filter(([name]) => name === "usage")).toEqual([["usage", {}, false]]);
    expect(cached.events.at(-1)).toEqual(["done"]);
    expect(cached.events.some(([name, , status]) => name === "error" && typeof status === "number" && (status < 200 || status > 299))).toBe(false);
    expect(costOf(cached.events)).toBe("not_measured");

    const refusal = await chatServer((_req, res) =>
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "x" } })),
    );
    const refused = collectChat(openChat(refusal));
    await refused.ended;
    expect(refused.events).toEqual([
      ["usage", {}, false],
      ["error", "rejected", 401],
    ]);
    expect(costOf(refused.events)).toBe("zero");
  });

  it("ferramenta aberta no message_stop e pedaço de ferramenta sem bloco aberto são resposta quebrada", async () => {
    for (const pieces of [
      [START, toolStart(0, "toolu_a", "agendar"), jsonDelta(0, "{}"), messageDelta({ output_tokens: 1 }), MESSAGE_STOP],
      [START, jsonDelta(3, "{}"), MESSAGE_STOP],
      [START, ev("content_block_start", { index: 0, content_block: { type: "tool_use", name: "agendar", input: {} } }), stop(0), MESSAGE_STOP],
    ]) {
      const fake = await chatServer((_req, res) => sseReply(res, pieces));
      const got = collectChat(openChat(fake));
      await got.ended;
      expect(got.events.filter(([name]) => name === "toolCall")).toEqual([]);
      expect(got.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
      expect(got.events.filter(([name]) => name === "usage")).toHaveLength(1);
    }
  });
});
