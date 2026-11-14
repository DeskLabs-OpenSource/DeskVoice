import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CRITERIA,
  ANALYSIS_SCHEMA,
  ANALYSIS_SCHEMA_GOOGLE,
  ANALYSIS_TIMEOUT_MS,
  OMITTED_TURNS_MARK,
  analysisPrompt,
  clipTranscriptForAnalysis,
  readAnalysisGuess,
} from "./analysis";
import gemini from "./engines/gemini-live";
import openai from "./engines/openai-realtime";
import { createSimulatedEngine } from "./engines/simulated";
import { FERRAMENTAS, OUTCOME_ONLY_BODY_BEFORE_ANALYSIS, TRANSCRICAO } from "./testing/outcome-bodies";
import type { ClassifyInput, VoiceEngine } from "./types";

/** Uma resposta completa e válida, como o provedor devolveria no texto JSON. */
const resposta = (overrides: Record<string, unknown> = {}) => ({
  outcome: "booked",
  confidence: 0.9,
  evidence: "Pode marcar quinta.",
  criteria: Object.fromEntries(ANALYSIS_CRITERIA.map((id) => [id, { status: id === "closing" ? "partial" : "met", evidence: "" }])),
  temperature: { start: "warm", middle: "unknown", end: "hot" },
  objections: [{ objection: "Preço", quote: "achei caro demais", response: "Ofereceu parcelamento.", handled: "addressed" }],
  strengths: ["Confirmou o horário."],
  weaknesses: [],
  nextStep: "Lembrar na véspera.",
  ...overrides,
});

describe("readAnalysisGuess", () => {
  it("lê o desfecho e a análise, com os critérios na ordem da régua", () => {
    const lida = readAnalysisGuess(resposta());
    expect(lida?.guess).toEqual({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta." });
    expect(lida?.analysis.criteria.map((criterion) => criterion.id)).toEqual([...ANALYSIS_CRITERIA]);
    expect(lida?.analysis.criteria.at(-1)).toEqual({ id: "closing", status: "partial", evidence: "" });
    expect(lida?.analysis).toMatchObject({ temperature: { start: "warm", middle: "unknown", end: "hot" }, nextStep: "Lembrar na véspera." });
  });

  it("não aceita nota vinda do modelo: ela não faz parte da forma lida", () => {
    expect(readAnalysisGuess({ ...resposta(), score: 10 })?.analysis).not.toHaveProperty("score");
  });

  const objecao = { objection: "Preço", quote: "achei caro demais", response: "Ofereceu parcelamento.", handled: "addressed" };
  it.each([
    ["sem o desfecho", { outcome: undefined }],
    ["desfecho fora da lista", { outcome: "comprou" }],
    ["critério faltando", { criteria: { opening: { status: "met", evidence: "" } } }],
    ["status fora da lista", { criteria: Object.fromEntries(ANALYSIS_CRITERIA.map((id) => [id, { status: "ótimo", evidence: "" }])) }],
    ["temperatura fora da lista", { temperature: { start: "morno", middle: "unknown", end: "hot" } }],
    ["seis objeções", { objections: Array.from({ length: 6 }, () => objecao) }],
    ["objeção com 281 caracteres", { objections: [{ ...objecao, objection: "x".repeat(281) }] }],
    ["citação com 281 caracteres", { objections: [{ ...objecao, quote: "x".repeat(281) }] }],
    ["resposta com 281 caracteres", { objections: [{ ...objecao, response: "x".repeat(281) }] }],
    ["quatro pontos fortes", { strengths: ["a", "b", "c", "d"] }],
    ["próximo passo com 281 caracteres", { nextStep: "x".repeat(281) }],
  ])("%s é fora da forma", (_, overrides) => {
    expect(readAnalysisGuess(resposta(overrides))).toBeNull();
  });

  it("aceita o limite exato: cinco objeções de 280 caracteres por campo", () => {
    const cheia = { objection: "x".repeat(280), quote: "y".repeat(280), response: "z".repeat(280), handled: "partial" };
    expect(readAnalysisGuess(resposta({ objections: Array.from({ length: 5 }, () => cheia) }))?.analysis.objections).toHaveLength(5);
  });
});

describe("clipTranscriptForAnalysis", () => {
  it("até 24 000 caracteres vai inteira", () => {
    const inteira = "a".repeat(24_000);
    expect(clipTranscriptForAnalysis(inteira)).toBe(inteira);
  });

  it("acima disso vão as primeiras 8 000 e as últimas 16 000, com a marca no meio", () => {
    const longa = `${"c".repeat(8_000)}${"m".repeat(10_000)}${"f".repeat(16_000)}`;
    expect(clipTranscriptForAnalysis(longa)).toBe(`${"c".repeat(8_000)}\n${OMITTED_TURNS_MARK}\n${"f".repeat(16_000)}`);
  });
});

describe("analysisPrompt", () => {
  it("leva o pedido do desfecho, a régua inteira, as regras da citação e a transcrição", () => {
    const prompt = analysisPrompt({ transcript: TRANSCRICAO, tools: FERRAMENTAS });
    expect(prompt).toContain("diz o desfecho comercial dela");
    for (const id of ANALYSIS_CRITERIA) expect(prompt).toContain(`- ${id}:`);
    expect(prompt).toContain("copie literalmente a fala do CLIENTE");
    expect(prompt).toContain("Use unknown no trecho sem fala do cliente");
    expect(prompt).toContain("Sem objeção, lista vazia");
    expect(prompt).not.toMatch(/\bnota\b|\bscore\b/i);
    expect(prompt.endsWith(`Transcrição:\n${TRANSCRICAO}`)).toBe(true);
  });
});

describe("os schemas do pedido completo", () => {
  /** Percorre todo objeto do schema. */
  const objects = (node: unknown): Record<string, unknown>[] => {
    if (typeof node !== "object" || node === null) return [];
    const record = node as Record<string, unknown>;
    const own = record.type === "object" ? [record] : [];
    return [...own, ...Object.values(record).flatMap(objects)];
  };

  it("o do OpenAI é strict: additionalProperties false e todo campo em required, em todo nível", () => {
    const all = objects(ANALYSIS_SCHEMA);
    expect(all.length).toBeGreaterThan(5);
    for (const object of all) {
      expect(object.additionalProperties).toBe(false);
      expect(object.required).toEqual(Object.keys(object.properties as object));
    }
  });

  it("o do Google não leva additionalProperties em nível nenhum, e exige todo campo", () => {
    expect(JSON.stringify(ANALYSIS_SCHEMA_GOOGLE)).not.toContain("additionalProperties");
    for (const object of objects(ANALYSIS_SCHEMA_GOOGLE)) expect(object.required).toEqual(Object.keys(object.properties as object));
  });
});

/** Um `fetch` falso que guarda o pedido e devolve o texto JSON no envelope do provedor. */
const fakeProvider = (engine: VoiceEngine, text: string) => {
  const sent: { body: string; url: string }[] = [];
  const envelope =
    engine.id === "gemini-live"
      ? { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1_000_000 } }
      : { choices: [{ message: { content: text } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } };
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body) });
    return new Response(JSON.stringify(envelope), { status: 200 });
  }) as typeof globalThis.fetch;
  return { sent, fetch };
};

const classify = (engine: VoiceEngine, input: ClassifyInput, options: Parameters<NonNullable<VoiceEngine["classifyOutcome"]>>[2]) => {
  const run = engine.classifyOutcome;
  if (!run) throw new Error(`${engine.id} classifies the outcome`);
  return run.call(engine, "chave-de-teste", input, options);
};

describe.each([openai, gemini])("$id: o pedido ao provedor", (engine) => {
  const id = engine.id as keyof typeof OUTCOME_ONLY_BODY_BEFORE_ANALYSIS;
  const desfecho = JSON.stringify({ outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta." });

  it("declara a análise", () => {
    expect(engine.analyzes).toBe(true);
  });

  it.each([
    ["sem analyze", { transcript: TRANSCRICAO, tools: FERRAMENTAS }],
    ["com analyze false", { transcript: TRANSCRICAO, tools: FERRAMENTAS, analyze: false }],
  ])("só de desfecho (%s): o pedido é byte a byte o de antes da análise, com o prazo de 10 s", async (_, input) => {
    const provider = fakeProvider(engine, desfecho);
    const prazos: number[] = [];
    const result = await classify(engine, input, {
      fetch: provider.fetch,
      schedule: (_fn, delayMs) => {
        prazos.push(delayMs);
        return () => undefined;
      },
    });
    expect(provider.sent.map((request) => request.body)).toEqual([OUTCOME_ONLY_BODY_BEFORE_ANALYSIS[id]]);
    expect(prazos).toEqual([10_000]);
    expect(result).toMatchObject({ ok: true, guess: { outcome: "booked" } });
    expect(result).not.toHaveProperty("analysis");
  });

  it("completo: uma chamada, com o pedido da análise, o schema da análise e o prazo de 30 s", async () => {
    const provider = fakeProvider(engine, JSON.stringify(resposta()));
    const prazos: number[] = [];
    const result = await classify(
      engine,
      { transcript: TRANSCRICAO, tools: FERRAMENTAS, analyze: true },
      {
        fetch: provider.fetch,
        schedule: (_fn, delayMs) => {
          prazos.push(delayMs);
          return () => undefined;
        },
      },
    );
    expect(provider.sent).toHaveLength(1);
    expect(prazos).toEqual([ANALYSIS_TIMEOUT_MS]);
    const body = JSON.parse(provider.sent[0]?.body ?? "");
    const prompt = analysisPrompt({ transcript: TRANSCRICAO, tools: FERRAMENTAS });
    if (id === "gemini-live") {
      expect(body).toEqual({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: ANALYSIS_SCHEMA_GOOGLE },
      });
    } else {
      expect(body).toEqual({
        model: "gpt-5-nano",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_schema", json_schema: { name: "analise", strict: true, schema: ANALYSIS_SCHEMA } },
      });
    }
    expect(result).toMatchObject({ ok: true, guess: { outcome: "booked", confidence: 0.9 }, analysis: readAnalysisGuess(resposta())?.analysis });
  });

  it("completo: o prazo de quem chamou vale sobre o de 30 s", async () => {
    const provider = fakeProvider(engine, JSON.stringify(resposta()));
    const prazos: number[] = [];
    await classify(
      engine,
      { transcript: TRANSCRICAO, tools: FERRAMENTAS, analyze: true },
      {
        fetch: provider.fetch,
        timeoutMs: 5,
        schedule: (_fn, delayMs) => {
          prazos.push(delayMs);
          return () => undefined;
        },
      },
    );
    expect(prazos).toEqual([5]);
  });

  it.each([
    ["só o desfecho, sem a análise", desfecho],
    ["seis objeções", JSON.stringify(resposta({ objections: Array.from({ length: 6 }, () => resposta().objections[0]) }))],
    ["texto que não é JSON", "não é JSON"],
  ])("completo com resposta fora da forma (%s) é unexpected_response, e o que foi cobrado vem junto", async (_, text) => {
    const provider = fakeProvider(engine, text);
    const result = await classify(engine, { transcript: TRANSCRICAO, tools: FERRAMENTAS, analyze: true }, { fetch: provider.fetch });
    expect(result).toMatchObject({ ok: false, failure: "unexpected_response", status: 200 });
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("completo corta a transcrição longa no pedido", async () => {
    const provider = fakeProvider(engine, JSON.stringify(resposta()));
    const longa = `Cliente: ${"a".repeat(30_000)}`;
    await classify(engine, { transcript: longa, tools: [], analyze: true }, { fetch: provider.fetch });
    expect(provider.sent[0]?.body).toContain(OMITTED_TURNS_MARK);
  });
});

describe("motor simulado", () => {
  it("não declara análise, e com analyze continua sem análise e sem custo", async () => {
    const engine = createSimulatedEngine();
    expect(engine.analyzes).toBeUndefined();
    const result = await classify(engine, { transcript: TRANSCRICAO, tools: [], analyze: true }, {});
    expect(result).toEqual({ ok: true, guess: { outcome: "unknown", confidence: 0, evidence: "" }, model: "simulated", usage: {}, costCents: 0 });
  });
});
