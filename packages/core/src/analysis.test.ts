import { describe, expect, it } from "vitest";
import {
  RUBRIC,
  callAnalysisSchema,
  purgedCallAnalysisSchema,
  scoreOf,
  storedCallAnalysisSchema,
  verifyAgainstTranscript,
  type CallAnalysisDraft,
  type CriterionStatus,
  type TranscriptTurn,
} from "./analysis";

const criteria = (...statuses: CriterionStatus[]) => RUBRIC.map((criterion, index) => ({ id: criterion.id, status: statuses[index] ?? "missed", evidence: "" }));

const transcript: TranscriptTurn[] = [
  { speaker: "agent", text: "Boa tarde, aqui é a Clínica Exemplo. Em que posso ajudar?" },
  { speaker: "user", text: "Queria marcar uma consulta, mas achei o preço caro demais, sabe?" },
  { speaker: "agent", text: "Entendo. Temos parcelamento em três vezes." },
  { speaker: "user", text: "Então pode marcar para terça." },
];

const draft = (overrides: Partial<CallAnalysisDraft> = {}): CallAnalysisDraft => ({
  rubricVersion: 1,
  model: "gemini-test",
  criteria: criteria("met", "met", "met", "met", "met"),
  temperature: { start: "warm", middle: "cold", end: "hot" },
  objections: [],
  strengths: [],
  weaknesses: [],
  nextStep: "",
  ...overrides,
});

describe("scoreOf", () => {
  it("soma 2 por cumprido, 1 por cumprido em parte e 0 por não cumprido", () => {
    expect(scoreOf(criteria("met", "met", "met", "met", "met"))).toBe(10);
    expect(scoreOf(criteria("missed", "missed", "missed", "missed", "missed"))).toBe(0);
    expect(scoreOf(criteria("met", "partial", "missed", "partial", "met"))).toBe(6);
    expect(scoreOf(criteria("partial", "partial", "partial", "partial", "partial"))).toBe(5);
  });

  it("a régua tem cinco critérios de 2 pontos, então a nota vai de 0 a 10", () => {
    expect(RUBRIC.map((criterion) => criterion.id)).toEqual(["opening", "discovery", "objections", "accuracy", "closing"]);
    expect(RUBRIC.reduce((sum, criterion) => sum + criterion.points, 0)).toBe(10);
  });
});

describe("verifyAgainstTranscript", () => {
  const objection = (quote: string) => ({ objection: "Preço", quote, response: "Ofereceu parcelamento.", handled: "addressed" as const });

  it("mantém a objeção com a citação literal de quem ligou", () => {
    const result = verifyAgainstTranscript(draft({ objections: [objection("achei o preço caro demais")] }), transcript);
    expect(result.objections).toHaveLength(1);
    expect(result.droppedObjections).toBe(0);
  });

  it("mantém a citação com acento, maiúscula ou pontuação diferente", () => {
    const result = verifyAgainstTranscript(draft({ objections: [objection("Achei o PRECO, caro demais!"), objection("caro demais sabe")] }), transcript);
    expect(result.objections).toHaveLength(2);
    expect(result.droppedObjections).toBe(0);
  });

  it("descarta a objeção inventada e a conta em droppedObjections", () => {
    const result = verifyAgainstTranscript(
      draft({ objections: [objection("achei o preço caro demais"), objection("não confio em clínica"), objection("")] }),
      transcript,
    );
    expect(result.objections.map((kept) => kept.quote)).toEqual(["achei o preço caro demais"]);
    expect(result.droppedObjections).toBe(2);
  });

  it("descarta a objeção cuja citação é fala do agente, e não de quem ligou", () => {
    const result = verifyAgainstTranscript(draft({ objections: [objection("Temos parcelamento em três vezes")] }), transcript);
    expect(result.objections).toEqual([]);
    expect(result.droppedObjections).toBe(1);
  });

  it("não aceita pedaço de palavra como citação", () => {
    expect(verifyAgainstTranscript(draft({ objections: [objection("aro dema")] }), transcript).droppedObjections).toBe(1);
  });

  it("apaga a evidência de critério que não está na transcrição e mantém o status; aceita fala de qualquer lado", () => {
    const base = draft();
    const result = verifyAgainstTranscript(
      draft({
        criteria: base.criteria.map((criterion) =>
          criterion.id === "opening"
            ? { ...criterion, evidence: "Boa tarde, aqui é a Clinica Exemplo" }
            : criterion.id === "closing"
              ? { ...criterion, status: "partial" as const, evidence: "Combinamos de ligar amanhã." }
              : criterion,
        ),
      }),
      transcript,
    );
    expect(result.criteria.find((criterion) => criterion.id === "opening")?.evidence).toBe("Boa tarde, aqui é a Clinica Exemplo");
    expect(result.criteria.find((criterion) => criterion.id === "closing")).toEqual({ id: "closing", status: "partial", evidence: "" });
    // A nota não muda com a checagem: o status fica.
    expect(scoreOf(result.criteria)).toBe(9);
  });

  it("descarta a objeção de citação com menos de três palavras, mesmo que ela esteja na fala", () => {
    const result = verifyAgainstTranscript(draft({ objections: [objection("sabe?"), objection("caro demais"), objection("caro demais, sabe")] }), transcript);
    expect(result.objections.map((kept) => kept.quote)).toEqual(["caro demais, sabe"]);
    expect(result.droppedObjections).toBe(2);
  });

  it("fala de quem ligou feita só de pontuação não sustenta citação vazia nem só de pontuação", () => {
    const pontuacao: TranscriptTurn[] = [
      { speaker: "user", text: "..." },
      { speaker: "user", text: "?!" },
      { speaker: "agent", text: "Alô?" },
    ];
    const base = draft();
    const result = verifyAgainstTranscript(
      draft({
        criteria: base.criteria.map((criterion) => ({ ...criterion, evidence: criterion.id === "opening" ? "..." : "?!" })),
        objections: [objection(""), objection("..."), objection("?!"), objection("  ")],
      }),
      pontuacao,
    );
    expect(result.objections).toEqual([]);
    expect(result.droppedObjections).toBe(4);
    expect(result.criteria.every((criterion) => criterion.evidence === "")).toBe(true);
  });

  it("devolve uma análise que passa no schema de gravação", () => {
    expect(callAnalysisSchema.safeParse(verifyAgainstTranscript(draft({ objections: [objection("inventada")] }), transcript)).success).toBe(true);
  });
});

describe("storedCallAnalysisSchema", () => {
  const full = { ...draft(), droppedObjections: 0 };
  const purged = {
    rubricVersion: 1,
    model: "gemini-test",
    criteria: full.criteria.map(({ id, status }) => ({ id, status })),
    temperature: full.temperature,
    objectionCount: 2,
    purged: true,
  };

  it("lê as duas formas", () => {
    expect(storedCallAnalysisSchema.parse(full)).toEqual(full);
    expect(storedCallAnalysisSchema.parse(purged)).toEqual(purged);
  });

  it("recusa a expurgada com texto e a inteira marcada como expurgada", () => {
    expect(purgedCallAnalysisSchema.safeParse({ ...purged, criteria: full.criteria }).success).toBe(false);
    expect(purgedCallAnalysisSchema.safeParse({ ...purged, nextStep: "Ligar amanhã." }).success).toBe(false);
    expect(storedCallAnalysisSchema.safeParse({ ...full, purged: true }).success).toBe(false);
  });

  it("recusa critério fora da régua, repetido ou fora de ordem", () => {
    expect(callAnalysisSchema.safeParse({ ...full, criteria: full.criteria.slice(1) }).success).toBe(false);
    expect(callAnalysisSchema.safeParse({ ...full, criteria: [...full.criteria].reverse() }).success).toBe(false);
    expect(callAnalysisSchema.safeParse({ ...full, criteria: full.criteria.map((criterion) => ({ ...criterion, id: "opening" })) }).success).toBe(false);
  });

  it("segura os limites de tamanho do desenho", () => {
    expect(callAnalysisSchema.safeParse({ ...full, strengths: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(callAnalysisSchema.safeParse({ ...full, weaknesses: ["x".repeat(201)] }).success).toBe(false);
    expect(callAnalysisSchema.safeParse({ ...full, nextStep: "x".repeat(281) }).success).toBe(false);
    const objection = { objection: "Preço", quote: "achei caro demais", response: "Ofereceu parcelamento.", handled: "addressed" };
    expect(callAnalysisSchema.safeParse({ ...full, objections: Array.from({ length: 5 }, () => objection) }).success).toBe(true);
    expect(callAnalysisSchema.safeParse({ ...full, objections: Array.from({ length: 6 }, () => objection) }).success).toBe(false);
    for (const field of ["objection", "quote", "response"]) {
      expect(callAnalysisSchema.safeParse({ ...full, objections: [{ ...objection, [field]: "x".repeat(280) }] }).success, field).toBe(true);
      expect(callAnalysisSchema.safeParse({ ...full, objections: [{ ...objection, [field]: "x".repeat(281) }] }).success, field).toBe(false);
    }
  });
});
