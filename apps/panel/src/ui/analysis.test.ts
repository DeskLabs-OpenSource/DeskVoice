import { CRITERION_STATUSES, RUBRIC, scoreOf, storedCallAnalysisSchema, type CriterionStatus, type StoredCallAnalysis } from "@deskvoice/core";
import { describe, expect, it } from "vitest";
import { CRITERION_MAX, analysisView } from "./analysis";

const full = (statuses: CriterionStatus[], evidence: string[] = []): StoredCallAnalysis =>
  storedCallAnalysisSchema.parse({
    rubricVersion: 1,
    model: "gemini-2.5-flash",
    criteria: RUBRIC.map((criterion, index) => ({ id: criterion.id, status: statuses[index], evidence: evidence[index] ?? "" })),
    temperature: { start: "cold", middle: "warm", end: "hot" },
    objections: [],
    strengths: [],
    weaknesses: [],
    nextStep: "",
    droppedObjections: 0,
  });

const purged = (statuses: CriterionStatus[]): StoredCallAnalysis =>
  storedCallAnalysisSchema.parse({
    rubricVersion: 1,
    model: "gemini-2.5-flash",
    criteria: RUBRIC.map((criterion, index) => ({ id: criterion.id, status: statuses[index] })),
    temperature: { start: "unknown", middle: "warm", end: "warm" },
    objectionCount: 2,
    purged: true,
  });

/** Toda combinação de status nos cinco critérios: 3^5 = 243. */
function everyCombination(): CriterionStatus[][] {
  return RUBRIC.reduce<CriterionStatus[][]>((acc) => acc.flatMap((prefix) => CRITERION_STATUSES.map((status) => [...prefix, status])), [[]]);
}

describe("analysisView", () => {
  it("shows a score that is the sum of the points shown, and the same number scoreOf stores", () => {
    const combinations = everyCombination();
    expect(combinations).toHaveLength(243);
    for (const statuses of combinations) {
      const analysis = full(statuses);
      const view = analysisView(analysis);
      expect(view.score).toBe(view.rows.reduce((sum, row) => sum + row.points, 0));
      expect(view.score).toBe(scoreOf(analysis.criteria));
    }
  });

  it("keeps every criterion of the rubric, in its order, with points out of the rubric's maximum", () => {
    expect(RUBRIC.every((criterion) => criterion.points === CRITERION_MAX)).toBe(true);
    const view = analysisView(full(["met", "partial", "missed", "met", "partial"]));
    expect(view.rows.map((row) => row.id)).toEqual(RUBRIC.map((criterion) => criterion.id));
    expect(view.rows.map((row) => row.points)).toEqual([2, 1, 0, 2, 1]);
    expect(view.rows.map((row) => row.side)).toEqual(["adds", "takes", "takes", "adds", "takes"]);
    expect(view.score).toBe(6);
  });

  it("drops the quote when the evidence came empty", () => {
    const view = analysisView(full(["met", "met", "met", "met", "met"], ["Aqui é a Ana, da clínica", "", "   "]));
    expect(view.rows.map((row) => row.evidence)).toEqual(["Aqui é a Ana, da clínica", null, null, null, null]);
  });

  it("shows the purged rubric without any evidence, and the same score", () => {
    const analysis = purged(["met", "missed", "partial", "met", "met"]);
    const view = analysisView(analysis);
    expect(view.rows.every((row) => row.evidence === null)).toBe(true);
    expect(view.score).toBe(scoreOf(analysis.criteria));
  });
});
