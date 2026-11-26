// O campo "Motor de voz" desenhado no servidor (fatia 5b-1): o pipeline aparece desligado, com a linha
// do que falta nos três idiomas, e os outros motores ficam como eram.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en/agents";
import es from "../../../../i18n/es/agents";
import ptBR, { type AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import { agentEngines, type Engine } from "../../../../ui/types";
import { EngineField, newAgentEngine } from "./engine-field";

const engineWith = (over: Partial<Engine>): Engine => ({
  id: "gemini-live",
  label: "Gemini Live (Google)",
  provider: "google",
  processingLocation: { kind: "undeclared" },
  requiresKey: true,
  classifyTarget: false,
  baseUrl: null,
  classifyModel: null,
  classifyModelUnmeasured: false,
  classifyKeyConfigured: false,
  voices: [],
  defaultVoice: null,
  keyConfigured: true,
  keyCheck: null,
  priceCheckedOn: "2026-11-01",
  priceSource: "https://example.com",
  ...over,
});
const GEMINI = engineWith({});
const OPENAI = engineWith({ id: "openai-realtime", label: "OpenAI Realtime", provider: "openai" });
const PIPELINE = engineWith({ id: "pipeline", label: "Pipeline (transcrição, cérebro e voz)", provider: "pipeline", requiresKey: false, keyConfigured: false, assembled: true, unavailable: { reason: "no_live_transcriber" } });

const render = (t: AgentsDictionary, engines: Engine[], value = "gemini-live"): string => renderToStaticMarkup(createElement(EngineField, { t, engines, value, onChange: () => undefined }));
const escaped = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

describe("EngineField", () => {
  it.each([
    ["pt-BR", ptBR, "Pipeline (desligado)", "Falta uma transcrição em tempo real neste servidor. Ela chega com a medida da R12."],
    ["en", en, "Pipeline (off)", "This server lacks a real-time transcription. It comes with the R12 measurement."],
    ["es", es, "Pipeline (apagado)", "Falta una transcripción en tiempo real en este servidor. Llega con la medición de la R12."],
  ])("em %s: o pipeline aparece desligado, com a linha do que falta", (_, t, option, line) => {
    const html = render(t, [GEMINI, OPENAI, PIPELINE]);
    expect(html).toContain(`<option value="pipeline" disabled="">${option}</option>`);
    expect(html).toContain(escaped(line));
  });

  it("os outros motores ficam como eram: ligados, com o nome do motor, e sem a linha", () => {
    const before = render(ptBR, [GEMINI, OPENAI]);
    const after = render(ptBR, [GEMINI, OPENAI, PIPELINE]);
    expect(before).toContain('<option value="gemini-live" selected="">Gemini Live (Google)</option><option value="openai-realtime">OpenAI Realtime</option>');
    expect(after).toContain('<option value="gemini-live" selected="">Gemini Live (Google)</option><option value="openai-realtime">OpenAI Realtime</option>');
    expect(before).not.toContain('disabled=""');
    expect(before).not.toContain(escaped(ptBR.enginePipelineOff.no_live_transcriber ?? ""));
  });

  it("o motivo que o dicionário não conhece cai na frase geral, e nunca no código", () => {
    const html = render(ptBR, [GEMINI, engineWith({ ...PIPELINE, unavailable: { reason: "outro" as "no_live_transcriber" } })]);
    expect(html).toContain(ptBR.enginePipelineOffUnknown);
    expect(html).not.toContain("outro");
  });

  it("o agente novo nunca nasce no pipeline: ele sai da lista dos motores de agente", () => {
    expect(agentEngines([PIPELINE, GEMINI, OPENAI]).map((engine) => engine.id)).toEqual(["gemini-live", "openai-realtime"]);
    expect(agentEngines(undefined)).toEqual([]);
    expect(newAgentEngine(undefined, [PIPELINE, GEMINI, OPENAI])).toBe("gemini-live");
    expect(newAgentEngine(null, [PIPELINE])).toBe("");
    expect(newAgentEngine("openai-realtime", [PIPELINE, GEMINI, OPENAI])).toBe("openai-realtime");
  });
});
