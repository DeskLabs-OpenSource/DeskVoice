import { describe, expect, it } from "vitest";
import gemini from "./engines/gemini-live";
import openai from "./engines/openai-realtime";

describe("vozes dos motores", () => {
  it.each([gemini, openai])("$label: a voz padrão está na lista, e nenhuma se repete", (engine) => {
    const ids = (engine.voices ?? []).map((voice) => voice.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(engine.defaultVoice);
  });
});
