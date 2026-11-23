import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { BrainChat, BrainChatMessage, BrainChatRequest } from "./brain";
import { brainFailureByStatus, chatStream, chatUsageOf } from "./brain-http";
import type { ToolSpec, Usage } from "./types";

// Inventada: não tem a forma de uma chave real, e o teste procura por ela onde não pode aparecer.
const KEY = "chave-inventada-do-teste-chat";

const TOOLS: ToolSpec[] = [
  { name: "agendar", description: "Marca um horário.", parameters: { type: "object", properties: { dia: { type: "string" } } } },
];
const MESSAGES: BrainChatMessage[] = [
  { role: "system", content: "Você atende uma clínica." },
  { role: "user", content: "Quero marcar para terça." },
  { role: "assistant", content: "", toolCalls: [{ id: "call_0", name: "agendar", args: '{"dia":"terça"}' }] },
  { role: "tool", content: '{"ok":true}', toolCallId: "call_0" },
];
const request = (overrides: Partial<BrainChatRequest> = {}): BrainChatRequest => ({
  model: "modelo-de-teste",
  messages: MESSAGES,
  tools: TOOLS,
  timeoutMs: 5_000,
  ...overrides,
});

const sse = (chunk: unknown): string => `data: ${JSON.stringify(chunk)}\n\n`;
const textChunk = (content: string) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });
const DONE = "data: [DONE]\n\n";
const USAGE = { prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 20 } };

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
interface Fake {
  url: string;
  bodies: unknown[];
  headers: IncomingMessage["headers"][];
  /** O cliente fechou a conexão antes de a resposta terminar. */
  aborted: Promise<void>;
  sawAbort: () => boolean;
  stop: () => Promise<void>;
}

const servers: Fake[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function fakeServer(handler: Handler): Promise<Fake> {
  const bodies: unknown[] = [];
  const headers: IncomingMessage["headers"][] = [];
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
      bodies.push(JSON.parse(raw));
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
  const fake: Fake = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/chat/completions`,
    bodies,
    headers,
    aborted,
    sawAbort: () => sawAbort,
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  servers.push(fake);
  return fake;
}

/** Escreve os pedaços um por vez, cada um num giro do laço, e termina (ou não). */
function stream(res: ServerResponse, pieces: string[], options: { end?: boolean } = {}): void {
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

type Event = [string, ...unknown[]];
interface Collected {
  events: Event[];
  /** Resolve no `done` ou no `error`. */
  ended: Promise<void>;
  /** Resolve no `usage`. */
  usage: Promise<{ usage: Usage; estimated: boolean }>;
}

function collect(chat: BrainChat): Collected {
  const events: Event[] = [];
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

const open = (url: string, overrides: Partial<BrainChatRequest> = {}, includeUsage = true): BrainChat =>
  chatStream(url, KEY, request(overrides), { failureOf: (status) => brainFailureByStatus(status), includeUsage, usageOf: chatUsageOf });

const bytes = (value: unknown): number => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");

/** Dá ao laço alguns giros: o que ainda fosse chegar, chega. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe("brainFailureByStatus: a regra geral do status no cérebro", () => {
  it.each([500, 502, 503, 529])("%i é erro do lado do provedor (provider_error)", (status) => {
    expect(brainFailureByStatus(status)).toBe("provider_error");
  });

  it("408 (prazo esgotado) e sem status (sem resposta) continuam unreachable", () => {
    expect(brainFailureByStatus(408)).toBe("unreachable");
    expect(brainFailureByStatus(null)).toBe("unreachable");
  });
});

describe("chatStream: o pedido", () => {
  it("manda stream, ferramentas, mensagens na forma da OpenAI e include_usage só quando pedido", async () => {
    const fake = await fakeServer((_req, res) => stream(res, [DONE]));
    await collect(open(fake.url)).ended;
    await collect(open(fake.url, { tools: [] }, false)).ended;

    const [withUsage, without] = fake.bodies as Record<string, unknown>[];
    expect(withUsage).toMatchObject({
      model: "modelo-de-teste",
      stream: true,
      stream_options: { include_usage: true },
      tools: [{ type: "function", function: { name: "agendar", description: "Marca um horário.", parameters: TOOLS[0]?.parameters } }],
    });
    expect(withUsage?.messages).toEqual([
      { role: "system", content: "Você atende uma clínica." },
      { role: "user", content: "Quero marcar para terça." },
      { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name: "agendar", arguments: '{"dia":"terça"}' } }] },
      { role: "tool", content: '{"ok":true}', tool_call_id: "call_0" },
    ]);
    // Provedor que não documenta a opção nunca a recebe; sem ferramenta, o campo não vai.
    expect(without).not.toHaveProperty("stream_options");
    expect(without).not.toHaveProperty("tools");
    expect(fake.headers[0]?.authorization).toBe(`Bearer ${KEY}`);
  });
});

describe("chatStream: a resposta", () => {
  it("1 e 3. texto em vários pedaços vira vários `text`, na ordem; o consumo do último pedaço vira usage declarado", async () => {
    const fake = await fakeServer((_req, res) =>
      stream(res, [
        ": OPENROUTER PROCESSING\n\n",
        sse({ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
        sse(textChunk("Bom ")),
        sse(textChunk("dia, ")),
        `data:${JSON.stringify(textChunk("tudo bem?"))}\r\n\r\n`,
        sse({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        sse({ choices: [], usage: USAGE }),
        DONE,
      ]),
    );
    const got = collect(open(fake.url));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Bom "],
      ["text", "dia, "],
      ["text", "tudo bem?"],
      ["usage", { inputTokens: 100, cachedInputTokens: 20, outputTokens: 9 }, false],
      ["done"],
    ]);
  });

  it("2. tool_calls em deltas viram um `toolCall` com args inteiros, em texto; duas em paralelo viram duas", async () => {
    const call = (index: number, extra: Record<string, unknown>) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index, ...extra }] }, finish_reason: null }] });
    const fake = await fakeServer((_req, res) =>
      stream(res, [
        sse(call(0, { id: "call_a", type: "function", function: { name: "agendar", arguments: "" } })),
        sse(call(1, { id: "call_b", type: "function", function: { name: "consultar_preco", arguments: "" } })),
        sse(call(0, { function: { arguments: '{"di' } })),
        sse(call(1, { function: { arguments: '{"exame":' } })),
        sse(call(0, { function: { arguments: 'a":"ter' } })),
        sse(call(0, { function: { arguments: 'ça"}' } })),
        sse(call(1, { function: { arguments: '"sangue"}' } })),
        sse({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
        sse({ choices: [], usage: USAGE }),
        DONE,
      ]),
    );
    const got = collect(open(fake.url));
    await got.ended;
    expect(got.events).toEqual([
      ["toolCall", { id: "call_a", name: "agendar", args: '{"dia":"terça"}' }],
      ["toolCall", { id: "call_b", name: "consultar_preco", args: '{"exame":"sangue"}' }],
      ["usage", { inputTokens: 100, cachedInputTokens: 20, outputTokens: 9 }, false],
      ["done"],
    ]);
    // Texto, nunca objeto parseado: quem executa valida com zod.
    for (const [, value] of got.events.filter(([name]) => name === "toolCall")) expect(typeof (value as { args: unknown }).args).toBe("string");
  });

  it("2b. ferramenta sem `finish_reason` sai no `[DONE]`; ferramenta sem nome é resposta quebrada", async () => {
    const piece = (extra: Record<string, unknown>) => sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...extra }] } }] });
    const ok = await fakeServer((_req, res) => stream(res, [piece({ id: "c", function: { name: "agendar", arguments: "{}" } }), DONE]));
    const first = collect(open(ok.url));
    await first.ended;
    expect(first.events[0]).toEqual(["toolCall", { id: "c", name: "agendar", args: "{}" }]);
    expect(first.events.at(-1)).toEqual(["done"]);

    const nameless = await fakeServer((_req, res) => stream(res, [piece({ id: "c", function: { arguments: "{}" } }), DONE]));
    const second = collect(open(nameless.url));
    await second.ended;
    expect(second.events.map(([name]) => name)).toEqual(["usage", "error"]);
    expect(second.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
  });

  it("4. sem consumo declarado, o usage é estimado pela regra do Jev: bytes enviados e recebidos", async () => {
    const fake = await fakeServer((_req, res) => stream(res, [sse(textChunk("Olá, ")), sse(textChunk("é só um instante.")), DONE]));
    const got = collect(open(fake.url, {}, false));
    await got.ended;
    const sent = fake.bodies[0] as { messages: unknown; tools: unknown };
    const { usage, estimated } = await got.usage;
    expect(estimated).toBe(true);
    expect(usage.inputTokens).toBe(bytes(sent.messages) + bytes(sent.tools));
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBe(bytes("Olá, é só um instante."));
    expect(got.events.at(-1)).toEqual(["done"]);
  });

  it("5. cancel no meio: o servidor vê o corte, não chega mais texto, e chega um usage estimado", async () => {
    let more: () => void = () => undefined;
    const fake = await fakeServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse(textChunk("Primeiro pedaço")));
      more = () => {
        if (!res.destroyed) res.write(sse(textChunk("depois do cancel")) + DONE);
      };
    });
    const chat = open(fake.url);
    const got = collect(chat);
    chat.on("text", () => {
      chat.cancel();
      more();
    });
    const { usage, estimated } = await got.usage;
    await fake.aborted;
    await settle();
    expect(fake.sawAbort()).toBe(true);
    expect(estimated).toBe(true);
    expect(usage).toEqual({ inputTokens: expect.any(Number), outputTokens: bytes("Primeiro pedaço") });
    expect(got.events).toEqual([["text", "Primeiro pedaço"], ["usage", usage, true]]);
    // Cancelar de novo não emite outro consumo.
    chat.cancel();
    await settle();
    expect(got.events.filter(([name]) => name === "usage")).toHaveLength(1);
  });

  it("5b. cancel no primeiro de dois pedaços que chegaram juntos: o segundo não sai", async () => {
    const fake = await fakeServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse(textChunk("um")) + sse(textChunk("dois")) + sse(textChunk("três")));
    });
    const chat = open(fake.url);
    const got = collect(chat);
    chat.on("text", () => chat.cancel());
    await got.usage;
    await settle();
    expect(got.events).toEqual([["text", "um"], ["usage", { inputTokens: expect.any(Number), outputTokens: bytes("um") }, true]]);
  });

  it("6. prazo estourado no meio do texto vira error(unreachable, null), depois do usage estimado", async () => {
    const fake = await fakeServer((_req, res) => stream(res, [sse(textChunk("Começo"))], { end: false }));
    const got = collect(open(fake.url, { timeoutMs: 100 }));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Começo"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: bytes("Começo") }, true],
      ["error", "unreachable", null],
    ]);
    await fake.aborted;
  });

  it("6b. prazo estourado antes da resposta também é unreachable, com usage estimado", async () => {
    const fake = await fakeServer(() => undefined);
    const got = collect(open(fake.url, { timeoutMs: 100 }));
    await got.ended;
    expect(got.events).toEqual([
      ["usage", { inputTokens: expect.any(Number), outputTokens: 0 }, true],
      ["error", "unreachable", null],
    ]);
  });

  it("7. 401, 402, 429 e 5xx caem no vocabulário fechado; a recusa vem sem custo, como no Jev", async () => {
    let status = 401;
    const fake = await fakeServer((_req, res) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `segredo ${KEY}` } })));
    const cases: [number, string][] = [
      [401, "rejected"],
      [402, "no_credit"],
      [429, "rate_limited"],
      [500, "provider_error"],
      [503, "provider_error"],
    ];
    for (const [code, failure] of cases) {
      status = code;
      const got = collect(open(fake.url));
      await got.ended;
      expect(got.events).toEqual([
        ["usage", {}, false],
        ["error", failure, code],
      ]);
      expect(JSON.stringify(got.events)).not.toContain(KEY);
    }
  });

  it("7b. a recusa passa o corpo ao `failureOf` do cérebro, que decide", async () => {
    const fake = await fakeServer((_req, res) => res.writeHead(429).end(JSON.stringify({ error: { code: "insufficient_quota" } })));
    const seen: unknown[] = [];
    const chat = chatStream(fake.url, KEY, request(), {
      failureOf: (_status, body) => {
        seen.push(body);
        return "no_credit";
      },
      includeUsage: true,
      usageOf: chatUsageOf,
    });
    const got = collect(chat);
    await got.ended;
    expect(seen).toEqual([{ error: { code: "insufficient_quota" } }]);
    expect(got.events.at(-1)).toEqual(["error", "no_credit", 429]);
  });

  it("8. corpo quebrado no meio do SSE vira error(unexpected_response, 200), sem lançar", async () => {
    const fake = await fakeServer((_req, res) => stream(res, [sse(textChunk("Antes")), 'data: {"choices": [ quebrado\n\n', sse(textChunk("depois")), DONE]));
    const got = collect(open(fake.url));
    await got.ended;
    expect(got.events).toEqual([
      ["text", "Antes"],
      ["usage", { inputTokens: expect.any(Number), outputTokens: bytes("Antes") }, true],
      ["error", "unexpected_response", 200],
    ]);
  });

  it("8b. o corpo que acaba sem [DONE] e o erro do provedor depois do 200 também são unexpected_response", async () => {
    const cut = await fakeServer((_req, res) => stream(res, [sse(textChunk("Meia frase"))]));
    const first = collect(open(cut.url));
    await first.ended;
    expect(first.events.slice(-2)).toEqual([
      ["usage", { inputTokens: expect.any(Number), outputTokens: bytes("Meia frase") }, true],
      ["error", "unexpected_response", 200],
    ]);

    // Na forma da página de streaming do OpenRouter: `error` no topo e `finish_reason: "error"`.
    const midError = await fakeServer((_req, res) =>
      stream(res, [sse(textChunk("Oi")), sse({ error: { code: "server_error", message: "Provider disconnected" }, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }] }), DONE]),
    );
    const second = collect(open(midError.url));
    await second.ended;
    expect(second.events.at(-1)).toEqual(["error", "unexpected_response", 200]);
    expect(second.events.filter(([name]) => name === "usage")).toEqual([["usage", { inputTokens: expect.any(Number), outputTokens: bytes("Oi") }, true]]);
  });

  it("a conexão recusada (o pedido nem saiu) é unreachable, sem usage", async () => {
    const closed = await fakeServer(() => undefined);
    await closed.stop();
    servers.splice(servers.indexOf(closed), 1);
    const got = collect(open(closed.url));
    await got.ended;
    expect(got.events).toEqual([["error", "unreachable", null]]);
  });

  it("nunca lança: fetch que explode vira unreachable com usage estimado; ouvinte que lança não derruba o pedido", async () => {
    const exploding = (() => {
      throw new Error("explodiu");
    }) as unknown as typeof fetch;
    const broken = chatStream("http://nao.usado.invalid", KEY, request(), { fetch: exploding, failureOf: () => "rejected", includeUsage: false, usageOf: chatUsageOf });
    const got = collect(broken);
    await got.ended;
    expect(got.events).toEqual([
      ["usage", { inputTokens: expect.any(Number), outputTokens: 0 }, true],
      ["error", "unreachable", null],
    ]);

    const fake = await fakeServer((_req, res) => stream(res, [sse(textChunk("a")), sse(textChunk("b")), DONE]));
    const chat = open(fake.url);
    chat.on("text", () => {
      throw new Error("ouvinte com defeito");
    });
    const second = collect(chat);
    await second.ended;
    expect(second.events.map(([name]) => name)).toEqual(["text", "text", "usage", "done"]);
  });
});

describe("chatStream: cancelar antes de sair", () => {
  it("cancel no mesmo giro de `chat` não envia o pedido e não emite nada", async () => {
    const fake = await fakeServer((_req, res) => stream(res, [DONE]));
    const chat = open(fake.url);
    const got = collect(chat);
    chat.cancel();
    await settle();
    expect(fake.bodies).toHaveLength(0);
    expect(got.events).toEqual([]);
  });
});
