import { describe, expect, it } from "vitest";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import ptBR from "../i18n/pt-BR/timeline";
import { transcribeAlsoClassifies } from "./transcription";

describe("transcribeAlsoClassifies", () => {
  it("avisa quando o desfecho ou a análise estão ligados, e só então", () => {
    expect(transcribeAlsoClassifies({ outcome: false, analysis: false })).toBe(false);
    expect(transcribeAlsoClassifies({ outcome: true, analysis: false })).toBe(true);
    expect(transcribeAlsoClassifies({ outcome: false, analysis: true })).toBe(true);
    expect(transcribeAlsoClassifies({ outcome: true, analysis: true })).toBe(true);
  });

  it("o aviso existe nos três dicionários e diz que a classificação é paga", () => {
    const texts = [ptBR.transcribeAlsoClassifies, en.transcribeAlsoClassifies, es.transcribeAlsoClassifies];
    for (const text of texts) expect(text.trim().split(" ").length).toBeGreaterThan(6);
    expect(ptBR.transcribeAlsoClassifies).toContain("paga");
    expect(en.transcribeAlsoClassifies).toContain("paid");
    expect(es.transcribeAlsoClassifies).toContain("paga");
  });
});
