import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import brain, { LOCAL_ID_PREFIX, SKIP_SIGNATURE, isTextModel, priceOf, responseOf, usageOf } from "./gemini";
import anthropic from "./anthropic";
import deepseek from "./deepseek";
import openai from "./openai";
import openrouter from "./openrouter";
import type { Brain, BrainChat, BrainChatMessage, BrainChatRequest } from "../brain";
import type { ToolSpec, Usage } from "../types";
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
    [500, {}, "provider_error"],
    [503, {}, "provider_error"],
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
    [503, {}, "provider_error"],
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

// ---------------------------------------------------------------------------------------------
// A conversa em streaming (R5, fatia 2c), contra um servidor falso de verdade (HTTP, SSE).
// ---------------------------------------------------------------------------------------------

const CHAT_KEY = "chave-inventada-do-chat-gemini";
const CHAT_MODEL = "gemini-2.5-flash-lite";
const CHAT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse`;

const CHAT_TOOLS: ToolSpec[] = [
  { name: "agendar", description: "Marca a consulta.", parameters: { type: "object", properties: { dia: { type: "string" } }, required: ["dia"] } },
  { name: "consultar_preco", description: "Diz o preço.", parameters: { type: "object", properties: { exame: { type: "string" } } } },
];

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

/** Servidor falso; o `fetch` devolvido leva o pedido da URL real para ele, e guarda a URL. */
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

/** Escreve os pedaços um por vez, cada um num giro do laço, e termina (ou não). */
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

/** Um pedaço do `streamGenerateContent?alt=sse`: um `GenerateContentResponse` por `data:`. */
const chunk = (parts: Record<string, unknown>[], extra: { finishReason?: string; usageMetadata?: Record<string, unknown> } = {}): string => {
  const { finishReason, usageMetadata } = extra;
  const body = {
    candidates: [{ content: { role: "model", parts }, index: 0, ...(finishReason ? { finishReason } : {}) }],
    ...(usageMetadata ? { usageMetadata } : {}),
    modelVersion: CHAT_MODEL,
    responseId: "resp-1",
  };
  return `data: ${JSON.stringify(body)}\r\n\r\n`;
};
const USAGE = { promptTokenCount: 300, candidatesTokenCount: 12, thoughtsTokenCount: 8, totalTokenCount: 320 };
const END = chunk([{ text: "" }], { finishReason: "STOP", usageMetadata: USAGE });

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

const SIMPLE: BrainChatMessage[] = [
  { role: "system", content: "Você atende uma clínica." },
  { role: "user", content: "Quero marcar para terça." },
];
const chatRequest = (overrides: Partial<BrainChatRequest> = {}): BrainChatRequest => ({
  model: CHAT_MODEL,
  messages: SIMPLE,
  tools: CHAT_TOOLS,
  timeoutMs: 5_000,
  maxTokens: 321,
  ...overrides,
});
const openChat = (fake: { fetch: typeof fetch }, overrides: Partial<BrainChatRequest> = {}, target: Brain = brain): BrainChat => {
  const chat = target.chat?.(CHAT_KEY, chatRequest(overrides), { fetch: fake.fetch });
  if (!chat) throw new Error("sem chat");
  return chat;
};
const chatBytes = (text: string): number => Buffer.byteLength(text, "utf8");
const settleChat = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};
type WireContent = { role: string; parts: Record<string, unknown>[] };
const contentsOf = (body: Record<string, unknown> | undefined): WireContent[] => (body?.contents ?? []) as WireContent[];

describe("brains/gemini: chat em streaming", () => {
  it("1. vários pedaços de texto viram vários text, em ordem; a parte vazia com assinatura não emite nada", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [
        chunk([{ text: "Bom " }], { usageMetadata: { promptTokenCount: 300 } }),
        chunk([{ text: "dia, " }]),
        chunk([{ text: "tudo bem?" }]),
        chunk([{ text: "", thoughtSignature: "assinatura-do-texto" }], { finishReason: "STOP", usageMetadata: USAGE }),
      ]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Bom "],
      ["text", "dia, "],
      ["text", "tudo bem?"],
      ["usage", { inputTokens: 300, cachedInputTokens: 0, outputTokens: 20 }, false],
      ["done"],
    ]);
    expect(fake.urls).toEqual([CHAT_URL]);
    expect(fake.headers[0]?.["x-goog-api-key"]).toBe(CHAT_KEY);
  });

  it("2. uma functionCall com assinatura dá um toolCall com providerState igual à assinatura e args em texto JSON", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [chunk([{ functionCall: { id: "fc-1", name: "agendar", args: { dia: "terça" } }, thoughtSignature: "ASSINATURA_A" }]), END]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["toolCall", { id: "fc-1", name: "agendar", args: '{"dia":"terça"}', providerState: "ASSINATURA_A" }],
      ["usage", { inputTokens: 300, cachedInputTokens: 0, outputTokens: 20 }, false],
      ["done"],
    ]);
  });

  it("3. duas paralelas (assinatura só na 1ª) dão dois toolCall; o 2º vem sem providerState; sem id, um id local único", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [
        chunk([
          { functionCall: { name: "agendar", args: { dia: "terça" } }, thoughtSignature: "ASSINATURA_A" },
          { functionCall: { name: "consultar_preco", args: { exame: "sangue" } } },
        ]),
        chunk([{ functionCall: { name: "consultar_preco" } }]),
        END,
      ]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    const calls = got.events.filter(([name]) => name === "toolCall").map(([, call]) => call as Record<string, unknown>);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ name: "agendar", args: '{"dia":"terça"}', providerState: "ASSINATURA_A" });
    expect(calls[1]).toMatchObject({ name: "consultar_preco", args: '{"exame":"sangue"}' });
    expect(calls[1]).not.toHaveProperty("providerState");
    // Sem `args`, é uma ferramenta sem argumentos.
    expect(calls[2]).toMatchObject({ name: "consultar_preco", args: "{}" });
    const ids = calls.map((call) => call.id as string);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.startsWith(LOCAL_ID_PREFIX)).toBe(true);
    expect(got.events.at(-1)).toEqual(["done"]);
  });

  it("4. ida e volta: a assinatura volta na mesma parte da functionCall; as functionResponse vêm juntas, depois das chamadas, com o name certo; sem chave no corpo", async () => {
    const first = await chatServer((_req, res) =>
      sseReply(res, [
        chunk([{ text: "Um instante." }]),
        chunk([
          { functionCall: { id: "fc-1", name: "agendar", args: { dia: "terça" } }, thoughtSignature: "ASSINATURA_A" },
          { functionCall: { id: "fc-2", name: "consultar_preco", args: { exame: "sangue" } } },
        ]),
        END,
      ]),
    );
    const turn = collectChat(openChat(first));
    await turn.ended;
    const calls = turn.events.filter(([name]) => name === "toolCall").map(([, call]) => call) as NonNullable<BrainChatMessage["toolCalls"]>;

    // O que o motor faz: devolve as chamadas como vieram e responde na ordem inversa de propósito.
    const messages: BrainChatMessage[] = [
      ...SIMPLE,
      { role: "assistant", content: "Um instante.", toolCalls: calls },
      { role: "tool", content: '{"preco":"R$ 40"}', toolCallId: "fc-2" },
      { role: "tool", content: "marcado", toolCallId: "fc-1" },
    ];
    const second = await chatServer((_req, res) => sseReply(res, [chunk([{ text: "Marcado." }]), END]));
    const answer = collectChat(openChat(second, { messages }));
    await answer.ended;
    expect(answer.events.at(-1)).toEqual(["done"]);

    const body = second.bodies[0];
    expect(contentsOf(body)).toEqual([
      { role: "user", parts: [{ text: "Quero marcar para terça." }] },
      {
        role: "model",
        parts: [
          { text: "Um instante." },
          { functionCall: { name: "agendar", args: { dia: "terça" }, id: "fc-1" }, thoughtSignature: "ASSINATURA_A" },
          { functionCall: { name: "consultar_preco", args: { exame: "sangue" }, id: "fc-2" } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "agendar", id: "fc-1", response: { result: "marcado" } } },
          { functionResponse: { name: "consultar_preco", id: "fc-2", response: { preco: "R$ 40" } } },
        ],
      },
    ]);
    // A assinatura real nunca é trocada pela fictícia.
    expect(JSON.stringify(body)).not.toContain(SKIP_SIGNATURE);
    expect(JSON.stringify(body)).not.toContain(CHAT_KEY);
    expect(JSON.stringify(body)).not.toContain("providerState");
  });

  it("4b. response da functionResponse: o content se for objeto JSON, senão { result: content }", () => {
    expect(responseOf('{"a":1}')).toEqual({ a: 1 });
    for (const content of ["texto", "[1,2]", "3", "{quebrado", '"x"']) expect(responseOf(content)).toEqual({ result: content });
  });

  it("5. histórico sem providerState leva a fictícia só na primeira functionCall do passo do turno atual; a chamada com assinatura real nunca", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [chunk([{ text: "Ok." }]), END]));
    const local = `${LOCAL_ID_PREFIX}1`;
    const messages: BrainChatMessage[] = [
      { role: "system", content: "Você atende uma clínica." },
      // Turno passado, de outro cérebro: a validação não olha, a fictícia não vai.
      { role: "user", content: "Oi" },
      { role: "assistant", content: "", toolCalls: [{ id: "call_antigo", name: "consultar_preco", args: "{}" }] },
      { role: "tool", content: "{}", toolCallId: "call_antigo" },
      { role: "assistant", content: "Olá." },
      // Turno atual.
      { role: "user", content: "Quero marcar para terça." },
      // Passo 1, de outro cérebro (troca no meio da ligação): duas paralelas sem assinatura.
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_a", name: "agendar", args: '{"dia":"terça"}' },
          { id: "call_b", name: "consultar_preco", args: '{"exame":"sangue"}' },
        ],
      },
      { role: "tool", content: "{}", toolCallId: "call_a" },
      { role: "tool", content: "{}", toolCallId: "call_b" },
      // Passo 2, do Gemini: a primeira sem assinatura (não deveria, mas acontece), a segunda com uma real.
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: local, name: "agendar", args: '{"dia":"quarta"}' },
          { id: "fc-9", name: "consultar_preco", args: "{}", providerState: "REAL_B" },
        ],
      },
      { role: "tool", content: "{}", toolCallId: local },
      { role: "tool", content: "{}", toolCallId: "fc-9" },
      // Passo 3, do Gemini, com a assinatura real na primeira.
      { role: "assistant", content: "", toolCalls: [{ id: "fc-10", name: "agendar", args: "{}", providerState: "REAL_C" }] },
      { role: "tool", content: "{}", toolCallId: "fc-10" },
    ];
    await collectChat(openChat(fake, { messages })).ended;
    const contents = contentsOf(fake.bodies[0]);
    const signatures = contents.filter((c) => c.role === "model").map((c) => c.parts.map((part) => part.thoughtSignature ?? null));
    // Turno passado (a chamada e o "Olá."), depois os três passos do turno atual.
    expect(signatures).toEqual([[null], [null], [SKIP_SIGNATURE, null], [SKIP_SIGNATURE, "REAL_B"], ["REAL_C"]]);
    // O id local não vai, nem na chamada nem na resposta.
    expect(JSON.stringify(contents)).not.toContain(LOCAL_ID_PREFIX);
    const step2 = contents.filter((c) => c.role === "model")[3];
    expect(step2?.parts[0]).toEqual({ functionCall: { name: "agendar", args: { dia: "quarta" } }, thoughtSignature: SKIP_SIGNATURE });
    const responses = contents.filter((c) => c.role === "user" && c.parts.some((part) => "functionResponse" in part));
    expect(responses[2]?.parts).toEqual([
      { functionResponse: { name: "agendar", response: {} } },
      { functionResponse: { name: "consultar_preco", id: "fc-9", response: {} } },
    ]);
  });

  it("6. system vai em systemInstruction, uma parte por mensagem na ordem, e fica fora de contents; ferramentas com parametersJsonSchema", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [END]));
    const messages: BrainChatMessage[] = [...SIMPLE, { role: "system", content: "Seja breve." }];
    await collectChat(openChat(fake, { messages })).ended;
    const body = fake.bodies[0];
    expect(body?.systemInstruction).toEqual({ parts: [{ text: "Você atende uma clínica." }, { text: "Seja breve." }] });
    expect(contentsOf(body)).toEqual([{ role: "user", parts: [{ text: "Quero marcar para terça." }] }]);
    expect(JSON.stringify(body?.contents)).not.toContain("Seja breve");
    expect(body?.tools).toEqual([{ functionDeclarations: CHAT_TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }]);
    expect(body).not.toHaveProperty("cachedContent");
    expect(body).not.toHaveProperty("model");
  });

  it("6b. sem system nem ferramentas, os campos não vão; args que não é objeto JSON e toolCallId sem chamada são erro de quem chama, sem envio e sem usage", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [END]));
    await collectChat(openChat(fake, { messages: [{ role: "user", content: "Oi" }], tools: [] })).ended;
    expect(fake.bodies[0]).not.toHaveProperty("systemInstruction");
    expect(fake.bodies[0]).not.toHaveProperty("tools");

    const broken: BrainChatMessage[][] = [
      ...["{quebrado", "[1,2]", '"texto"'].map((args): BrainChatMessage[] => [
        { role: "user", content: "Oi" },
        { role: "assistant", content: "", toolCalls: [{ id: "fc-x", name: "agendar", args }] },
        { role: "tool", content: "{}", toolCallId: "fc-x" },
      ]),
      [
        { role: "user", content: "Oi" },
        { role: "assistant", content: "", toolCalls: [{ id: "fc-x", name: "agendar", args: "{}" }] },
        { role: "tool", content: "{}", toolCallId: "fc-outro" },
      ],
      [
        { role: "user", content: "Oi" },
        { role: "tool", content: "{}", toolCallId: "fc-x" },
      ],
    ];
    for (const messages of broken) {
      const got = collectChat(openChat(fake, { messages }));
      await got.ended;
      expect(got.events).toEqual([["error", "unexpected_response", null]]);
    }
    expect(fake.bodies).toHaveLength(1);
  });

  it("7. usageMetadata em dois pedaços: vale o último, nunca a soma; a saída inclui thoughtsTokenCount; o cache sai da entrada", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [
        chunk([{ text: "Oi" }], { usageMetadata: { promptTokenCount: 300, cachedContentTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 40 } }),
        chunk([{ text: " tudo bem?" }], { finishReason: "STOP", usageMetadata: { promptTokenCount: 300, cachedContentTokenCount: 100, candidatesTokenCount: 9, thoughtsTokenCount: 40 } }),
      ]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events.filter(([name]) => name === "usage")).toEqual([["usage", { inputTokens: 200, cachedInputTokens: 100, outputTokens: 49 }, false]]);
    expect(got.events.at(-1)).toEqual(["done"]);
  });

  it("7b. raciocínio (thought: true) não vira text, mas conta na saída estimada; MAX_TOKENS termina como as outras", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [chunk([{ text: "Pensando.", thought: true }]), chunk([{ text: "Oi" }], { finishReason: "MAX_TOKENS" })]));
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([["text", "Oi"], ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Pensando.") + chatBytes("Oi") }, true], ["done"]]);
  });

  it("8. corte sem usageMetadata: usage estimado, entrada > 0, e unexpected_response; não para na primeira functionCall", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [chunk([{ functionCall: { id: "fc-1", name: "agendar", args: {} }, thoughtSignature: "A" }]), chunk([{ text: "Meia frase" }])]));
    const got = collectChat(openChat(fake));
    await got.ended;
    const body = fake.bodies[0] as { systemInstruction: unknown; contents: unknown; tools: unknown };
    const { usage, estimated } = await got.usage;
    expect(estimated).toBe(true);
    expect(usage.inputTokens).toBe(chatBytes(JSON.stringify(body.systemInstruction)) + chatBytes(JSON.stringify(body.contents)) + chatBytes(JSON.stringify(body.tools)));
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBe(chatBytes("{}") + chatBytes("Meia frase"));
    expect(got.events.map(([name]) => name)).toEqual(["toolCall", "text", "usage", "error"]);
    expect(got.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
  });

  it("9a. cancel no meio: o servidor vê o corte, não chega mais texto, e chega um usage estimado", async () => {
    let more: () => void = () => undefined;
    const fake = await chatServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk([{ text: "Primeiro pedaço" }]));
      more = () => {
        if (!res.destroyed) res.write(chunk([{ text: "depois do cancel" }]) + END);
      };
    });
    const chat = openChat(fake);
    const got = collectChat(chat);
    chat.on("text", () => {
      chat.cancel();
      more();
    });
    const { estimated } = await got.usage;
    await fake.aborted;
    await settleChat();
    expect(fake.sawAbort()).toBe(true);
    expect(estimated).toBe(true);
    expect(got.events).toEqual([["text", "Primeiro pedaço"], ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Primeiro pedaço") }, true]]);
  });

  it("9b. prazo estourado no meio vira error(unreachable, null), depois do usage estimado", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [chunk([{ text: "Começo" }])], { end: false }));
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
    [401, "UNAUTHENTICATED", "rejected"],
    [402, "PAYMENT_REQUIRED", "no_credit"],
    [429, "RESOURCE_EXHAUSTED", "rate_limited"],
    [500, "INTERNAL", "provider_error"],
    [503, "UNAVAILABLE", "provider_error"],
    [403, "PERMISSION_DENIED", "unexpected_response"],
    [404, "NOT_FOUND", "unexpected_response"],
  ])("9c. HTTP %i (%s) vira %s, como no completeJson; a recusa vem sem custo", async (status, code, failure) => {
    const fake = await chatServer((_req, res) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: status, status: code, message: `segredo ${CHAT_KEY}` } })),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["usage", {}, false],
      ["error", failure, status],
    ]);
    expect(JSON.stringify(got.events)).not.toContain(CHAT_KEY);
  });

  it("9d. SSE quebrado vira error(unexpected_response, 200), sem lançar", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [chunk([{ text: "Antes" }]), 'data: {"candidates": [quebrado\n\n', chunk([{ text: "depois" }]), END]));
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Antes"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Antes") }, true],
      ["error", "unexpected_response", 200],
    ]);
  });

  it.each([
    [429, "rate_limited"],
    [500, "provider_error"],
    [400, "unexpected_response"],
  ])("9e. erro no meio do SSE (code %i) vira %s, pelo código, nunca pelo texto", async (code, failure) => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [chunk([{ text: "Oi" }]), `data: ${JSON.stringify({ error: { code, status: "X", message: "Resource has been exhausted" } })}\n\n`, END]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Oi"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes("Oi") }, true],
      ["error", failure, 200],
    ]);
  });

  it.each(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "MALFORMED_FUNCTION_CALL", "MISSING_THOUGHT_SIGNATURE", "OTHER", "MOTIVO_NOVO"])(
    "10. bloqueio por finishReason %s dá error e um só usage",
    async (reason) => {
      const fake = await chatServer((_req, res) => sseReply(res, [chunk([{ text: "Oi" }]), chunk([], { finishReason: reason, usageMetadata: USAGE })]));
      const got = collectChat(openChat(fake));
      await got.ended;
      await settleChat();
      expect(got.events.filter(([name]) => name === "usage")).toHaveLength(1);
      expect(got.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
      expect(got.events).not.toContainEqual(["done"]);
    },
  );

  it("10b. pedido bloqueado (promptFeedback.blockReason, sem candidato) dá error e um só usage", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [`data: ${JSON.stringify({ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 30 } })}\n\n`]));
    const got = collectChat(openChat(fake));
    await got.ended;
    await settleChat();
    expect(got.events.filter(([name]) => name === "usage")).toHaveLength(1);
    expect(got.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
  });

  it("11. toolCall seguido de erro: os dois chegam, e um só usage", async () => {
    const fake = await chatServer((_req, res) =>
      sseReply(res, [chunk([{ functionCall: { id: "fc-1", name: "agendar", args: { dia: "terça" } }, thoughtSignature: "A" }]), `data: ${JSON.stringify({ error: { code: 503 } })}\n\n`, END]),
    );
    const got = collectChat(openChat(fake));
    await got.ended;
    await settleChat();
    expect(got.events).toEqual([
      ["toolCall", { id: "fc-1", name: "agendar", args: '{"dia":"terça"}', providerState: "A" }],
      ["usage", { inputTokens: expect.any(Number), outputTokens: chatBytes('{"dia":"terça"}') }, true],
      ["error", "provider_error", 200],
    ]);
  });

  it("functionCall sem name é resposta quebrada", async () => {
    const fake = await chatServer((_req, res) => sseReply(res, [chunk([{ functionCall: { args: {} } }]), END]));
    const got = collectChat(openChat(fake));
    await got.ended;
    expect(got.events.filter(([name]) => name === "toolCall")).toEqual([]);
    expect(got.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
  });
});

describe("providerState: os outros quatro cérebros não emitem e ignoram", () => {
  const withState: BrainChatMessage[] = [
    { role: "user", content: "Oi" },
    { role: "assistant", content: "", toolCalls: [{ id: "call_a", name: "agendar", args: '{"dia":"terça"}', providerState: "ESTADO_OPACO" }] },
    { role: "tool", content: "{}", toolCallId: "call_a" },
  ];
  const completions = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_b", function: { name: "agendar", arguments: '{"dia":"terça"}' } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const ev = (type: string, data: Record<string, unknown> = {}): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const messages = [
    ev("message_start", { message: { content: [], usage: { input_tokens: 10, output_tokens: 1 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_b", name: "agendar", input: {} } }),
    ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"dia":"terça"}' } }),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }),
    ev("message_stop"),
  ];

  it.each([
    ["openai", openai, completions],
    ["openrouter", openrouter, completions],
    ["deepseek", deepseek, completions],
    ["anthropic", anthropic, messages],
  ] as const)("%s: o toolCall sai sem providerState, e o campo recebido não vai no corpo", async (_id, target, pieces) => {
    const fake = await chatServer((_req, res) => sseReply(res, [...pieces]));
    const got = collectChat(openChat(fake, { model: "modelo-qualquer", messages: withState }, target));
    await got.ended;
    const calls = got.events.filter(([name]) => name === "toolCall").map(([, call]) => call);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty("providerState");
    expect(JSON.stringify(fake.bodies[0])).not.toContain("ESTADO_OPACO");
    expect(JSON.stringify(fake.bodies[0])).not.toContain("providerState");
  });
});
