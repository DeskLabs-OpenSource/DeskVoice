import { describe, expect, it } from "vitest";
import { speechFilterQuestions } from "../speech-filter";
import jev, { estimatedInputTokens, JEV_PRICING } from "./jev";

const KEY = "jev-test-key-que-nunca-aparece";
const input = { state: "Agente: Em que cidade?\nPessoa: moro em meu gasto", questions: speechFilterQuestions("moro em meu gasto", ["Melgaço", "Betim"]) };

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** `fetch` falso: guarda o pedido e responde o que o teste mandar; `hang` só termina pelo cancelamento. */
function fakeFetch(reply: { status: number; body?: unknown } | "hang" | "network") {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (reply === "network") throw new TypeError("fetch failed");
    if (reply === "hang") {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}), { status: reply.status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

/** Agendador manual: o prazo só vence quando o teste manda. */
function manualDeadline() {
  const fns: Array<() => void> = [];
  return { schedule: (fn: () => void) => (fns.push(fn), () => undefined), expire: () => fns.splice(0).forEach((fn) => fn()), delays: fns };
}

const okBody = {
  model: "jev-1.14.0",
  answers: {
    background: { type: "noul", noul: 0.97 },
    finished: { type: "noul", noul: 0.4 },
    reading: { type: "choice", choice: "Melgaço", confidence: 0.91, probabilities: { Melgaço: 0.91, Betim: 0.02, nenhum: 0.07 } },
  },
  usage: { input_tokens: 512, output_tokens: 3 },
};

describe("Jev: o pedido", () => {
  it("um POST ao /v1/systemone, com Bearer, o state e as perguntas no formato do Jev", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: okBody });
    const result = await jev.decide(KEY, input, { fetch });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: "https://api.typesafe.ai/v1/systemone", method: "POST", headers: { authorization: `Bearer ${KEY}` } });
    expect(sent[0]?.body).toEqual({
      model: "jev-latest",
      state: input.state,
      questions: {
        background: { type: "noul", instructions: input.questions.background?.instruction },
        finished: { type: "noul", instructions: input.questions.finished?.instruction },
        reading: { type: "choice", instructions: input.questions.reading?.instruction, criteria: input.questions.reading?.kind === "choice" ? input.questions.reading.options : null },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      model: "jev-1.14.0",
      usage: { inputTokens: 512, outputTokens: 3 },
      answers: {
        background: { kind: "noul", value: 0.97 },
        finished: { kind: "noul", value: 0.4 },
        reading: { kind: "choice", choice: "Melgaço", confidence: 0.91 },
      },
    });
  });

  it("o custo pelo preço do arquivo: 512 tokens de entrada a US$ 0,042 por milhão, saída grátis", async () => {
    const { fetch } = fakeFetch({ status: 200, body: okBody });
    const result = await jev.decide(KEY, input, { fetch });
    expect(JEV_PRICING).toMatchObject({ checkedOn: "2026-11-16", source: expect.stringContaining("docs.typesafe.ai/models") });
    // 512 × 4,2 centavos / 1e6 = 0,0021504 centavo = 2150 micro-centavos (arredondado).
    expect(result.costMicrocents).toBe(2150);
    expect(result.costCents).toBe(1);
  });

  it("sem confidence, vale a probabilidade da escolha", async () => {
    const body = { ...okBody, answers: { ...okBody.answers, reading: { type: "choice", choice: "Melgaço", probabilities: { Melgaço: 0.83, nenhum: 0.17 } } } };
    const result = await jev.decide(KEY, input, { fetch: fakeFetch({ status: 200, body }).fetch });
    expect(result.ok && result.answers.reading).toMatchObject({ kind: "choice", confidence: 0.83 });
  });
});

describe("Jev: nunca lança, e a chave nunca sai", () => {
  const cases: Array<[string, Parameters<typeof fakeFetch>[0], string, number | null]> = [
    ["chave recusada (401)", { status: 401, body: { detail: "Invalid API key" } }, "rejected", 401],
    ["limite (429)", { status: 429, body: { detail: "rate" } }, "rate_limited", 429],
    ["sobrecarga (529)", { status: 529, body: {} }, "unreachable", 529],
    ["pedido fora da regra (422)", { status: 422, body: { detail: [] } }, "unexpected_response", 422],
    ["sem rede", "network", "unreachable", null],
    ["corpo que não é JSON", { status: 200, body: "<html>" }, "unexpected_response", 200],
    ["resposta fora do esquema (noul acima de 1)", { status: 200, body: { ...okBody, answers: { ...okBody.answers, background: { type: "noul", noul: 1.2 } } } }, "unexpected_response", 200],
    ["falta a resposta de uma pergunta", { status: 200, body: { ...okBody, answers: { background: okBody.answers.background } } }, "unexpected_response", 200],
    ["resposta de outro tipo", { status: 200, body: { ...okBody, answers: { ...okBody.answers, reading: { type: "noul", noul: 0.5 } } } }, "unexpected_response", 200],
  ];
  for (const [label, reply, failure, status] of cases) {
    it(label, async () => {
      const result = await jev.decide(KEY, input, { fetch: fakeFetch(reply).fetch });
      expect(result).toMatchObject({ ok: false, failure, status });
      expect(JSON.stringify(result)).not.toContain(KEY);
    });
  }

  it("um 200 com resposta faltando foi cobrado: o consumo entra no resultado", async () => {
    const body = { ...okBody, answers: { background: okBody.answers.background } };
    const result = await jev.decide(KEY, input, { fetch: fakeFetch({ status: 200, body }).fetch });
    expect(result).toMatchObject({ ok: false, usage: { inputTokens: 512 }, costMicrocents: 2150 });
  });

  it("lento: passado o prazo, o pedido é cancelado e volta late", async () => {
    const deadline = manualDeadline();
    const pending = jev.decide(KEY, input, { fetch: fakeFetch("hang").fetch, timeoutMs: 1000, schedule: deadline.schedule });
    deadline.expire();
    expect(await pending).toMatchObject({ ok: false, failure: "late", status: null });
  });
});

describe("Jev: custo desconhecido nunca é zero", () => {
  /** O corpo que o pedido levou, sem o `model`: o `state` e as perguntas no formato do Jev. */
  const sentTokens = (sent: Sent[]): number => {
    const body = sent[0]?.body as { state: string; questions: Record<string, unknown> };
    return new TextEncoder().encode(JSON.stringify({ state: body.state, questions: body.questions })).length;
  };
  const expectEstimate = (result: Awaited<ReturnType<typeof jev.decide>>, sent: Sent[]) => {
    const tokens = sentTokens(sent);
    expect(tokens).toBeGreaterThan(100);
    expect(estimatedInputTokens(input.state, (sent[0]?.body as { questions: Record<string, unknown> }).questions)).toBe(tokens);
    expect(result).toMatchObject({ ok: false, costEstimated: true, usage: { inputTokens: tokens, outputTokens: 0 } });
    // Pelo preço do arquivo: um token por byte, a 4,2 centavos por milhão de tokens de entrada.
    expect(result.costMicrocents).toBe(Math.round(tokens * 4.2));
    expect(result.costMicrocents).toBeGreaterThan(0);
  };

  it("atrasado: o pedido cancelado pelo prazo grava a estimativa pela entrada enviada", async () => {
    const deadline = manualDeadline();
    const { fetch, sent } = fakeFetch("hang");
    const pending = jev.decide(KEY, input, { fetch, timeoutMs: 1000, schedule: deadline.schedule });
    deadline.expire();
    const result = await pending;
    expect(result).toMatchObject({ failure: "late", status: null });
    expectEstimate(result, sent);
  });

  it("atrasado depois de ler: a resposta chega, o prazo vence antes de terminar, e grava a estimativa", async () => {
    const deadline = manualDeadline();
    const sent: Sent[] = [];
    // Um 200 com o consumo medido, mas o prazo vence enquanto o corpo é lido: o resultado é late, e o
    // consumo declarado não vale (não foi aceito), então entra a estimativa pela entrada enviada.
    const fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      const response = new Response(JSON.stringify(okBody), { status: 200 });
      Object.defineProperty(response, "text", {
        value: async () => {
          deadline.expire();
          return JSON.stringify(okBody);
        },
      });
      return response;
    }) as unknown as typeof globalThis.fetch;
    const result = await jev.decide(KEY, input, { fetch, timeoutMs: 1000, schedule: deadline.schedule });
    expect(result).toMatchObject({ failure: "late", status: 200 });
    expectEstimate(result, sent);
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("sem rede: a estimativa pela entrada enviada", async () => {
    const { fetch, sent } = fakeFetch("network");
    const result = await jev.decide(KEY, input, { fetch });
    expect(result).toMatchObject({ failure: "unreachable", status: null });
    expectEstimate(result, sent);
  });

  for (const [label, body] of [
    ["fora da forma: corpo que não é JSON", "<html>"],
    ["fora da forma: resposta fora do esquema", { ...okBody, answers: { ...okBody.answers, background: { type: "noul", noul: 1.2 } } }],
    ["fora da forma: sem o consumo", { model: okBody.model, answers: okBody.answers }],
  ] as const) {
    it(label, async () => {
      const { fetch, sent } = fakeFetch({ status: 200, body });
      const result = await jev.decide(KEY, input, { fetch });
      expect(result).toMatchObject({ failure: "unexpected_response", status: 200 });
      expectEstimate(result, sent);
    });
  }

  it("o pedido que dá certo grava o consumo medido, sem a marca", async () => {
    const result = await jev.decide(KEY, input, { fetch: fakeFetch({ status: 200, body: okBody }).fetch });
    expect(result).toMatchObject({ ok: true, costEstimated: false, usage: { inputTokens: 512, outputTokens: 3 }, costMicrocents: 2150 });
  });

  it("um 200 com resposta faltando: o consumo declarado é medido, não estimado", async () => {
    const body = { ...okBody, answers: { background: okBody.answers.background } };
    const result = await jev.decide(KEY, input, { fetch: fakeFetch({ status: 200, body }).fetch });
    expect(result).toMatchObject({ ok: false, costEstimated: false, usage: { inputTokens: 512 }, costMicrocents: 2150 });
  });

  it("erro HTTP (recusa do pedido): sem custo, como antes", async () => {
    for (const status of [401, 429, 529, 422]) {
      const result = await jev.decide(KEY, input, { fetch: fakeFetch({ status, body: {} }).fetch });
      expect(result).toMatchObject({ ok: false, costEstimated: false, usage: {}, costMicrocents: 0 });
    }
  });
});

describe("Jev: o teste da chave", () => {
  it("GET /v1/models, sem custo de token; aceita quando jev-latest está na lista", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: { models: [{ name: "jev-latest", description: "x", release_date: "2026-09-15" }] } });
    expect(await jev.checkKey?.(KEY, { fetch })).toEqual({ result: "accepted", model: "jev-latest" });
    expect(sent[0]).toMatchObject({ url: "https://api.typesafe.ai/v1/models", method: "GET", headers: { authorization: `Bearer ${KEY}` } });
  });

  it("chave recusada, lista sem o modelo e sobrecarga, no vocabulário fechado", async () => {
    expect((await jev.checkKey?.(KEY, { fetch: fakeFetch({ status: 401, body: { detail: "no" } }).fetch }))?.result).toBe("rejected");
    expect((await jev.checkKey?.(KEY, { fetch: fakeFetch({ status: 200, body: { models: [{ name: "outro" }] } }).fetch }))?.result).toBe("unexpected_response");
    expect((await jev.checkKey?.(KEY, { fetch: fakeFetch({ status: 529, body: {} }).fetch }))?.result).toBe("unreachable");
  });
});
