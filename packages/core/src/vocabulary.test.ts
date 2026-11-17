import { describe, expect, it } from "vitest";
import { checkVocabulary, VOCABULARY_MAX_TERMS } from "./vocabulary";

describe("checkVocabulary", () => {
  it("aceita a lista vazia", () => {
    expect(checkVocabulary([])).toEqual({ ok: true, terms: [] });
  });

  it("apara cada termo e mantém a ordem", () => {
    expect(checkVocabulary(["  Melgaço ", "DeskVoice", "Rafael Melgaço"])).toEqual({ ok: true, terms: ["Melgaço", "DeskVoice", "Rafael Melgaço"] });
  });

  it("conta caracteres, e não bytes: 60 com acento passa, 61 não", () => {
    expect(checkVocabulary(["ç".repeat(60)]).ok).toBe(true);
    expect(checkVocabulary(["ç".repeat(61)])).toEqual({ ok: false, reason: "term 1 has 61 characters; the limit is 60", problem: { kind: "too_long", position: 1, length: 61 } });
  });

  const forbidden = "cannot contain line breaks, control characters, '<' or '>'";
  it.each([
    [["", "x"], "term 1 is empty", { kind: "empty", position: 1 }],
    [["ok", "   "], "term 2 is empty", { kind: "empty", position: 2 }],
    [["linha\nquebrada"], `term 1 ${forbidden}`, { kind: "forbidden", position: 1 }],
    [["com\ttab"], `term 1 ${forbidden}`, { kind: "forbidden", position: 1 }],
    [["nul\u0000"], `term 1 ${forbidden}`, { kind: "forbidden", position: 1 }],
    [["c1\u0085"], `term 1 ${forbidden}`, { kind: "forbidden", position: 1 }],
    [["<b>"], `term 1 ${forbidden}`, { kind: "forbidden", position: 1 }],
    [["ok", "a > b"], `term 2 ${forbidden}`, { kind: "forbidden", position: 2 }],
    [["Melgaço", "MELGAÇO"], 'term 2 repeats "MELGAÇO"', { kind: "repeated", position: 2, term: "MELGAÇO" }],
    [["Melgaço", " melgaço "], 'term 2 repeats "melgaço"', { kind: "repeated", position: 2, term: "melgaço" }],
  ])("recusa %j: %s", (input, reason, problem) => {
    expect(checkVocabulary(input)).toEqual({ ok: false, reason, problem });
  });

  it("aceita 50 termos e recusa 51", () => {
    const terms = Array.from({ length: VOCABULARY_MAX_TERMS + 1 }, (_, index) => `termo ${index}`);
    expect(checkVocabulary(terms.slice(0, 50)).ok).toBe(true);
    expect(checkVocabulary(terms)).toEqual({ ok: false, reason: "at most 50 terms (got 51)", problem: { kind: "too_many", count: 51 } });
  });
});
