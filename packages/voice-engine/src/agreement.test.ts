import { describe, expect, it } from "vitest";
import { AGREEMENT_TERMS, isAgreementOnly } from "./agreement";

describe("isAgreementOnly: a concordância curta não corta o agente (fatia 6, R-lista)", () => {
  it.each([
    ["pt-BR", ["aham", "Sim.", "uhum", "Certo!", "tá", "Tá, tá.", "sim sim", "ok, entendi", "É.", "isso"]],
    ["en-US", ["uh-huh", "Uh huh.", "mhm", "Yeah.", "okay", "Got it.", "I see", "right, right"]],
    ["es-MX", ["ajá", "Sí.", "vale", "claro", "ya, ya", "entiendo", "mhm"]],
  ])("cada idioma tem a lista dele (%s)", (language, said) => {
    for (const text of said) expect(isAgreementOnly(text, language), text).toBe(true);
  });

  it("toda a lista do desenho conta, palavra por palavra", () => {
    const language = { pt: "pt-BR", en: "en", es: "es" } as const;
    for (const [key, terms] of Object.entries(AGREEMENT_TERMS)) {
      for (const term of terms) expect(isAgreementOnly(term, language[key as keyof typeof language]), term).toBe(true);
    }
  });

  it("'não', 'no', 'espera' e 'wait' cortam", () => {
    expect(isAgreementOnly("não", "pt-BR")).toBe(false);
    expect(isAgreementOnly("Não, espera.", "pt-BR")).toBe(false);
    expect(isAgreementOnly("espera", "pt-BR")).toBe(false);
    expect(isAgreementOnly("no", "en")).toBe(false);
    expect(isAgreementOnly("wait", "en")).toBe(false);
    expect(isAgreementOnly("no", "es")).toBe(false);
  });

  it("'sim, mas...' deixa de ser concordância na palavra 'mas'", () => {
    expect(isAgreementOnly("sim,", "pt-BR")).toBe(true);
    expect(isAgreementOnly("sim, mas", "pt-BR")).toBe(false);
    expect(isAgreementOnly("yeah but", "en")).toBe(false);
  });

  it("uma pergunta, um número ou uma palavra de fora cortam", () => {
    expect(isAgreementOnly("sim, 15 horas", "pt-BR")).toBe(false);
    expect(isAgreementOnly("certo, e o preço?", "pt-BR")).toBe(false);
    expect(isAgreementOnly("got", "en")).toBe(false);
  });

  it("a lista de um idioma não vale no outro, e idioma sem lista corta como antes", () => {
    expect(isAgreementOnly("vale", "pt-BR")).toBe(false);
    expect(isAgreementOnly("aham", "en")).toBe(false);
    expect(isAgreementOnly("ok", "fr-FR")).toBe(false);
  });

  it("o trecho sem palavra não é concordância", () => {
    expect(isAgreementOnly("", "pt-BR")).toBe(false);
    expect(isAgreementOnly(" ... ", "pt-BR")).toBe(false);
  });
});
