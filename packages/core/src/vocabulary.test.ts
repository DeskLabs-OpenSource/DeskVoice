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
    expect(checkVocabulary(["ç".repeat(61)])).toEqual({ ok: false, reason: "term 1 has 61 characters; the limit is 60" });
  });

  it.each([
    [["", "x"], "term 1 is empty"],
    [["ok", "   "], "term 2 is empty"],
    [["linha\nquebrada"], "term 1 cannot contain line breaks, control characters, '<' or '>'"],
    [["com\ttab"], "term 1 cannot contain line breaks, control characters, '<' or '>'"],
    [["nul\u0000"], "term 1 cannot contain line breaks, control characters, '<' or '>'"],
    [["c1\u0085"], "term 1 cannot contain line breaks, control characters, '<' or '>'"],
    [["<b>"], "term 1 cannot contain line breaks, control characters, '<' or '>'"],
    [["a > b"], "term 1 cannot contain line breaks, control characters, '<' or '>'"],
    [["Melgaço", "MELGAÇO"], 'term 2 repeats "MELGAÇO"'],
    [["Melgaço", " melgaço "], 'term 2 repeats "melgaço"'],
  ])("recusa %j: %s", (input, reason) => {
    expect(checkVocabulary(input)).toEqual({ ok: false, reason });
  });

  it("aceita 50 termos e recusa 51", () => {
    const terms = Array.from({ length: VOCABULARY_MAX_TERMS + 1 }, (_, index) => `termo ${index}`);
    expect(checkVocabulary(terms.slice(0, 50)).ok).toBe(true);
    expect(checkVocabulary(terms)).toEqual({ ok: false, reason: "at most 50 terms (got 51)" });
  });
});
