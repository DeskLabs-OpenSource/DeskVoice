import { describe, expect, it } from "vitest";
import { proposedLanguage } from "./proposed-language";

describe("proposedLanguage", () => {
  it("proposes the organization's language when it is one the panel has", () => {
    expect(proposedLanguage("es")).toBe("es");
    expect(proposedLanguage("en")).toBe("en");
    expect(proposedLanguage("pt-BR")).toBe("pt-BR");
  });

  it("proposes pt-BR, as always, when the organization has no language or something else", () => {
    for (const value of [null, undefined, "", "fr", "pt", "ES", 3]) expect(proposedLanguage(value)).toBe("pt-BR");
  });
});
