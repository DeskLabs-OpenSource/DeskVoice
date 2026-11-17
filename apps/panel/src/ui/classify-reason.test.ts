import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import ptBR from "../i18n/pt-BR/timeline";
import { classifyReasonCode } from "./classify-reason";

describe("motivo da classificação na linha do tempo", () => {
  it("com endpoint configurado, a chave recusada é a do endpoint; sem ele, a do motor", () => {
    expect(classifyReasonCode({ reason: "rejected", endpoint: true })).toBe("rejected_endpoint");
    expect(classifyReasonCode({ reason: "rejected" })).toBe("rejected");
    // Os outros motivos não falam de qual chave: a frase é a mesma com ou sem endpoint.
    expect(classifyReasonCode({ reason: "no_credit", endpoint: true })).toBe("no_credit");
    expect(classifyReasonCode({})).toBe("");
  });

  it("com o cérebro escolhido, a chave recusada é a do cérebro; os motivos dele passam como são", () => {
    expect(classifyReasonCode({ reason: "rejected", brain: "openai" })).toBe("rejected_brain");
    expect(classifyReasonCode({ reason: "brain_no_key", brain: "openai" })).toBe("brain_no_key");
  });

  it.each([["pt-BR", ptBR], ["en", en], ["es", es]])("%s tem frase para cada motivo do cérebro, nos dois eventos", (_locale, dict) => {
    for (const phrases of [dict.events.outcome_not_classified_body, dict.events.analysis_not_done_reasons]) {
      for (const reason of ["rejected_brain", "brain_unavailable", "brain_no_key", "brain_unmeasured_without_ceiling"]) expect(phrases[reason]).toBeTruthy();
      expect(phrases.rejected_brain).not.toBe(phrases.rejected);
    }
  });

  it.each([["pt-BR", ptBR], ["en", en], ["es", es]])("%s tem a frase da chave do endpoint, diferente da do motor", (_locale, dict) => {
    for (const phrases of [dict.events.outcome_not_classified_body, dict.events.analysis_not_done_reasons]) {
      expect(phrases.rejected_endpoint).toBeTruthy();
      expect(phrases.rejected_endpoint).not.toBe(phrases.rejected);
    }
  });
});
