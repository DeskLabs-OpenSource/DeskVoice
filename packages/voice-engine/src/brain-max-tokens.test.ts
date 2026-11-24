import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Brain, BrainChatRequest, BrainJsonRequest } from "./brain";
import anthropic, { anthropicSchema } from "./brains/anthropic";
import deepseek, { promptWithSchema } from "./brains/deepseek";
import gemini from "./brains/gemini";
import openai from "./brains/openai";
import openrouter from "./brains/openrouter";
import { PIPELINE_BRAIN_MAX_TOKENS } from "./pipeline-engine";

/**
 * O teto de saída do pedido ao cérebro (desenho do pipeline, seção 3.3, fatia 3b-2): cada cérebro manda
 * `BrainChatRequest.maxTokens` no campo do provedor, só no `chat`. O `completeJson` (a análise e o
 * desfecho) manda o mesmo corpo de antes. O cérebro fala com um servidor falso local: o `fetch` troca
 * só a origem do endereço, e o servidor guarda o corpo que chegou.
 *
 * **Não medido:** os nomes dos campos num provedor real (sem chave e sem custo).
 */

// Inventada: não tem a forma de uma chave real.
const KEY = "chave-inventada-do-teste-teto";
/** Um número que nenhum cérebro tem fixo: prova que o valor vem do pedido. */
const MAX = 321;

interface Seen {
  path: string;
  body: Record<string, unknown>;
}

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

/** O servidor falso: responde 500 a tudo (o corpo do pedido é o que importa aqui) e guarda o que chegou. */
async function fakeProvider(): Promise<{ fetch: typeof fetch; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (piece: Buffer) => (raw += piece.toString("utf8")));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", body: JSON.parse(raw) as Record<string, unknown> });
      res.writeHead(500, { "content-type": "application/json" }).end("{}");
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stops.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const redirected = ((input: string | URL | Request, init?: RequestInit) =>
    globalThis.fetch(String(input instanceof Request ? input.url : input).replace(/^https:\/\/[^/]+/, origin), init)) as typeof fetch;
  return { fetch: redirected, seen };
}

const chatRequest = (model: string): BrainChatRequest => ({
  model,
  messages: [
    { role: "system", content: "Você atende uma clínica." },
    { role: "user", content: "Quero marcar para terça." },
  ],
  tools: [{ name: "agendar", description: "Marca um horário.", parameters: { type: "object", properties: { dia: { type: "string" } } } }],
  timeoutMs: 5_000,
  maxTokens: MAX,
});

/** Um pedido de `chat` até o fim (o servidor falso recusa), e o corpo que chegou. */
async function chatBody(brain: Brain, model: string): Promise<Record<string, unknown>> {
  const { fetch, seen } = await fakeProvider();
  const chat = brain.chat?.(KEY, chatRequest(model), { fetch });
  if (!chat) throw new Error(`${brain.id}: sem chat`);
  await new Promise<void>((resolve) => {
    chat.on("done", () => resolve());
    chat.on("error", () => resolve());
  });
  expect(seen).toHaveLength(1);
  return seen[0]?.body ?? {};
}

const SCHEMA = {
  name: "desfecho",
  strict: { type: "object", properties: { outcome: { type: "string" } }, required: ["outcome"], additionalProperties: false },
  google: { type: "object", properties: { outcome: { type: "string" } } },
};
const JSON_REQUEST = (model: string): BrainJsonRequest => ({ model, prompt: "Leia a ligação.", schema: SCHEMA, timeoutMs: 5_000 });

async function completeJsonBody(brain: Brain, model: string): Promise<Seen> {
  const { fetch, seen } = await fakeProvider();
  await brain.completeJson(KEY, JSON_REQUEST(model), { fetch });
  expect(seen).toHaveLength(1);
  return seen[0] ?? { path: "", body: {} };
}

describe("o teto de saída no `chat` de cada cérebro (3b-2)", () => {
  it("o motor pipeline pede 4 096 tokens de saída", () => {
    expect(PIPELINE_BRAIN_MAX_TOKENS).toBe(4096);
  });

  it("OpenAI: `max_completion_tokens`, e não o `max_tokens` obsoleto", async () => {
    const body = await chatBody(openai, "gpt-5-nano");
    expect(body.max_completion_tokens).toBe(MAX);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("DeepSeek: `max_tokens`", async () => {
    const body = await chatBody(deepseek, "deepseek-chat");
    expect(body.max_tokens).toBe(MAX);
    expect(body).not.toHaveProperty("max_completion_tokens");
  });

  it("OpenRouter: `max_tokens`", async () => {
    const body = await chatBody(openrouter, "openai/gpt-5-nano");
    expect(body.max_tokens).toBe(MAX);
    expect(body).not.toHaveProperty("max_completion_tokens");
  });

  it("Anthropic: `max_tokens` do pedido, no lugar dos 16 000 fixos", async () => {
    const body = await chatBody(anthropic, "claude-haiku-4-5-20251001");
    expect(body.max_tokens).toBe(MAX);
  });

  it("Gemini: `generationConfig.maxOutputTokens`", async () => {
    const body = await chatBody(gemini, "gemini-3.5-flash-lite");
    expect(body.generationConfig).toEqual({ maxOutputTokens: MAX });
  });
});

describe("o `completeJson` (análise e desfecho) manda o mesmo corpo de antes, sem o teto do `chat`", () => {
  const openaiShape = (model: string) => ({
    model,
    messages: [{ role: "user", content: "Leia a ligação." }],
    response_format: { type: "json_schema", json_schema: { name: "desfecho", strict: true, schema: SCHEMA.strict } },
  });

  it("OpenAI", async () => {
    expect((await completeJsonBody(openai, "gpt-5-nano")).body).toEqual(openaiShape("gpt-5-nano"));
  });

  it("OpenRouter", async () => {
    expect((await completeJsonBody(openrouter, "openai/gpt-5-nano")).body).toEqual(openaiShape("openai/gpt-5-nano"));
  });

  it("DeepSeek", async () => {
    expect((await completeJsonBody(deepseek, "deepseek-chat")).body).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: promptWithSchema("Leia a ligação.", SCHEMA.strict) }],
      response_format: { type: "json_object" },
    });
  });

  it("Anthropic: continua com os 16 000", async () => {
    expect((await completeJsonBody(anthropic, "claude-opus-5-5")).body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 16_000,
      messages: [{ role: "user", content: "Leia a ligação." }],
      output_config: { format: { type: "json_schema", schema: anthropicSchema(SCHEMA.strict) } },
    });
  });

  it("Gemini: sem `maxOutputTokens`", async () => {
    const seen = await completeJsonBody(gemini, "gemini-3.5-flash-lite");
    expect(seen.path).toContain("gemini-3.5-flash-lite:generateContent");
    expect(seen.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "Leia a ligação." }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA.google },
    });
  });
});
