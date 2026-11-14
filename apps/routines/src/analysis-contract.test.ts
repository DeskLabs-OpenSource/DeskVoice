import { MAX_OBJECTION_FIELD, MAX_OBJECTIONS, RUBRIC } from "@deskvoice/core";
import { ANALYSIS_CRITERIA, MAX_OBJECTION_FIELD as ENGINE_MAX_OBJECTION_FIELD, MAX_OBJECTIONS as ENGINE_MAX_OBJECTIONS } from "@deskvoice/voice-engine";
import { describe, expect, it } from "vitest";

// O motor de voz não depende de `core`, então repete o vocabulário da análise. A rotina importa os
// dois e é onde eles se encontram: se a régua mudar só de um lado, toda análise viraria
// `unexpected_response` na gravação.
describe("o contrato da análise entre o motor de voz e a forma guardada", () => {
  it("os critérios pedidos ao provedor são os da régua, na mesma ordem", () => {
    expect([...ANALYSIS_CRITERIA]).toEqual(RUBRIC.map((criterion) => criterion.id));
  });

  it("os limites das objeções são os mesmos", () => {
    expect([ENGINE_MAX_OBJECTIONS, ENGINE_MAX_OBJECTION_FIELD]).toEqual([MAX_OBJECTIONS, MAX_OBJECTION_FIELD]);
  });
});
