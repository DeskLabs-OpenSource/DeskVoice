// Os três passos antes da primeira ligação, uma lista para Chamadas e para a central de
// Configurações (parte 3 do desenho da central de configuração).
import { describe, expect, it } from "vitest";
import { engineReady, firstSteps, firstStepsPending } from "./first-steps";
import type { Engine } from "./types";

const engine = (requiresKey: boolean, keyConfigured: boolean): Engine => ({ id: "x", requiresKey, keyConfigured }) as Engine;

describe("os primeiros passos", () => {
  it("só um motor que pede chave e a tem conta como chave cadastrada", () => {
    expect(engineReady(undefined)).toBeUndefined();
    expect(engineReady([])).toBe(false);
    // O simulado não pede chave: não conta.
    expect(engineReady([engine(false, false), engine(true, false)])).toBe(false);
    expect(engineReady([engine(false, false), engine(true, true)])).toBe(true);
  });

  it("numa organização nova, os três passos estão por fazer, na ordem", () => {
    const steps = firstSteps({ agents: [], trunks: [], engines: [engine(false, false), engine(true, false)] });
    expect(steps.map((step) => [step.key, step.href, step.done])).toEqual([
      ["agent", "/agents", false],
      ["line", "/line", false],
      ["engine", "/settings/ai", false],
    ]);
    expect(firstStepsPending({ agents: [], trunks: [], engines: [] })).toHaveLength(3);
  });

  it("o cartão some com agente, linha e chave, e só então", () => {
    const keyed = [engine(true, true)];
    expect(firstStepsPending({ agents: [{}], trunks: [{}], engines: keyed })).toBeNull();
    expect(firstStepsPending({ agents: [], trunks: [{}], engines: keyed })).not.toBeNull();
    expect(firstStepsPending({ agents: [{}], trunks: [], engines: keyed })).not.toBeNull();
    expect(firstStepsPending({ agents: [{}], trunks: [{}], engines: [engine(true, false)] })).not.toBeNull();
  });

  it("enquanto alguma leitura não volta, o cartão não aparece", () => {
    expect(firstStepsPending({ agents: undefined, trunks: [], engines: [] })).toBeNull();
    expect(firstStepsPending({ agents: [], trunks: undefined, engines: [] })).toBeNull();
    expect(firstStepsPending({ agents: [], trunks: [], engines: undefined })).toBeNull();
  });
});
