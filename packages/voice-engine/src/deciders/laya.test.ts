import { describe, expect, it } from "vitest";
import { speechFilterQuestions } from "../speech-filter";
import laya from "./laya";

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

function manualDeadline() {
  const fns: Array<() => void> = [];
  return { schedule: (fn: () => void) => (fns.push(fn), () => undefined), expire: () => fns.splice(0).forEach((fn) => fn()) };
}

// A resposta como o servidor de deploy/laya/server.py a devolve (formato do Jev, sem os campos a mais).
const okBody = {
  model: "convaiinnovations/laya/multilingual@e333cb7c823cd1787276228260f56d02fbf5180b",
  answers: {
    background: { type: "noul", noul: 0.95 },
    finished: { type: "noul", noul: 0.81 },
    reading: { type: "choice", choice: "Melgaço", confidence: 0.17, probabilities: { Melgaço: 0.74, Betim: 0.1, nenhum: 0.16 } },
  },
};

describe("Laya: o pedido", () => {
  it("um POST ao serviço laya da rede interna, sem chave, com o state e as perguntas no formato que o Laya lê", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: okBody });
    await laya.decide("", input, { fetch });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("http://laya:8000/v1/decide");
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.headers).toEqual({ "content-type": "application/json" });
    const body = sent[0]?.body as { state: string; questions: Record<string, { type: string; instructions: string; criteria?: unknown }> };
    expect(body.state).toBe(input.state);
    expect(Object.keys(body)).toEqual(["state", "questions"]);
    expect(Object.keys(body.questions).sort()).toEqual(Object.keys(input.questions).sort());
    for (const [id, question] of Object.entries(input.questions)) {
      const wire = body.questions[id];
      expect(wire?.type).toBe(question.kind);
      expect(wire?.instructions).toBe(question.instruction);
      if (question.kind === "choice") expect(wire?.criteria).toEqual(question.options);
    }
  });

  it("o baseUrl dos testes troca só o endereço", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: okBody });
    await laya.decide("", input, { fetch, baseUrl: "http://127.0.0.1:9" });
    expect(sent[0]?.url).toBe("http://127.0.0.1:9/v1/decide");
  });

  it("o score vai com os níveis como criteria", async () => {
    const { fetch, sent } = fakeFetch({ status: 200, body: { model: "m", answers: { mood: { type: "score", score: 1.2, confidence: 0.1, probabilities: { "0": 0.2, "1": 0.4, "2": 0.4 } } } } });
    const result = await laya.decide("", { state: "x", questions: { mood: { kind: "score", instruction: "Quão irritada?", levels: ["calma", "neutra", "irritada"] } } }, { fetch });
    expect((sent[0]?.body as { questions: unknown }).questions).toEqual({ mood: { type: "score", instructions: "Quão irritada?", criteria: ["calma", "neutra", "irritada"] } });
    expect(result).toMatchObject({ ok: true, answers: { mood: { kind: "score", score: 1.2, confidence: 0.1 } } });
  });
});

describe("Laya: a resposta", () => {
  it("lê as três respostas, sem custo, e devolve o modelo com a revisão dos pesos", async () => {
    const result = await laya.decide("", input, { fetch: fakeFetch({ status: 200, body: okBody }).fetch });
    expect(result).toMatchObject({
      ok: true,
      model: okBody.model,
      usage: {},
      costCents: 0,
      costMicrocents: 0,
      answers: {
        background: { kind: "noul", value: 0.95 },
        finished: { kind: "noul", value: 0.81 },
        reading: { kind: "choice", choice: "Melgaço", confidence: 0.17, probabilities: { Melgaço: 0.74, Betim: 0.1, nenhum: 0.16 } },
      },
    });
    expect(result.costEstimated).toBeUndefined();
  });

  it("a escolha sem confidence usa a probabilidade da opção escolhida", async () => {
    const body = { ...okBody, answers: { ...okBody.answers, reading: { type: "choice", choice: "Betim", probabilities: { Betim: 0.6, Melgaço: 0.4 } } } };
    const result = await laya.decide("", input, { fetch: fakeFetch({ status: 200, body }).fetch });
    expect(result.ok && result.answers.reading).toEqual({ kind: "choice", choice: "Betim", probabilities: { Betim: 0.6, Melgaço: 0.4 }, confidence: 0.6 });
  });

  it.each([
    ["resposta que falta", { model: "m", answers: { background: okBody.answers.background, finished: okBody.answers.finished } }],
    ["resposta de outro tipo", { model: "m", answers: { ...okBody.answers, finished: { type: "choice", choice: "x" } } }],
    ["probabilidade fora de 0 a 1", { model: "m", answers: { ...okBody.answers, background: { type: "noul", noul: 1.5 } } }],
    ["corpo sem answers", { model: "m" }],
    ["corpo que não é JSON", "<html>"],
  ])("%s é unexpected_response, nunca um palpite", async (_name, body) => {
    const result = await laya.decide("", input, { fetch: fakeFetch({ status: 200, body }).fetch });
    expect(result).toMatchObject({ ok: false, failure: "unexpected_response", status: 200, costCents: 0 });
  });
});

describe("Laya: falhas, sem esperar", () => {
  it.each([
    [503, "unreachable"],
    [500, "unreachable"],
    [400, "unexpected_response"],
    [404, "unexpected_response"],
    [413, "unexpected_response"],
  ] as const)("HTTP %i é %s", async (status, failure) => {
    const result = await laya.decide("", input, { fetch: fakeFetch({ status, body: { error: "x" } }).fetch });
    expect(result).toMatchObject({ ok: false, failure, status, costCents: 0, costMicrocents: 0 });
  });

  it("serviço fora do ar (perfil desligado, contêiner parado) é unreachable", async () => {
    const result = await laya.decide("", input, { fetch: fakeFetch("network").fetch });
    expect(result).toMatchObject({ ok: false, failure: "unreachable", status: null });
  });

  it("o prazo vence: cancela o pedido e devolve late", async () => {
    const deadline = manualDeadline();
    const pending = laya.decide("", input, { fetch: fakeFetch("hang").fetch, schedule: deadline.schedule, timeoutMs: 1000 });
    deadline.expire();
    expect(await pending).toMatchObject({ ok: false, failure: "late", status: null });
  });

  it("o prazo padrão é de 10 s, e quem chama passa o dele", async () => {
    const delays: number[] = [];
    const schedule = (_fn: () => void, delayMs: number) => (delays.push(delayMs), () => undefined);
    const { fetch } = fakeFetch({ status: 200, body: okBody });
    await laya.decide("", input, { fetch, schedule });
    await laya.decide("", input, { fetch, schedule, timeoutMs: 1000 });
    expect(delays).toEqual([10_000, 1000]);
  });
});

describe("Laya: o que a peça declara", () => {
  it("roda neste servidor, sem chave e sem preço por pedido", () => {
    expect(laya).toMatchObject({ id: "laya", provider: "convai", processingLocation: { kind: "this-server" }, keyless: true });
    expect(laya.pricing.centsPerMillionInputTokens).toBeUndefined();
    expect(laya.checkKey).toBeUndefined();
  });
});
