// O campo "Voz" desenhado no servidor (DESA-397, fatia 1a; a linha da ElevenLabs, fatia 5b-1): o grupo com o provedor vem de
// `provider`, a voz sem amostra desliga o "Ouvir" e diz por quê nos três idiomas, a amostra que
// falta no idioma cai na de pt-BR com aviso, nada é baixado antes do clique e a voz salva fora da
// lista continua aparecendo.
import type { EngineVoice } from "@deskvoice/voice-engine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en/agents";
import es from "../../../../i18n/es/agents";
import ptBR, { type AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import type { Engine } from "../../../../ui/types";
import { VoiceField } from "./voice-field";
import { sampleFor, selectedVoice } from "./voice-sample";

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
  voices: [{ id: "Kore", style: "Firm" }, { id: "Puck", style: "Upbeat" }],
  defaultVoice: "Kore",
  keyConfigured: true,
  keyCheck: null,
  priceCheckedOn: "2026-11-01",
  priceSource: "https://example.com",
  ...over,
});

const render = (t: AgentsDictionary, engine: Engine | undefined, voiceId = "", language = "pt-BR"): string =>
  renderToStaticMarkup(createElement(VoiceField, { t, engine, voiceId, language, onChange: () => undefined }));

/** O botão "Ouvir" e se está desligado. */
const listenButton = (html: string, t: AgentsDictionary): string | undefined => new RegExp(`<button[^>]*>(?:(?!</button>).)*${t.voiceListen}</button>`).exec(html)?.[0];

const escaped = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

describe("VoiceField", () => {
  it.each([
    ["pt-BR", ptBR, "Esta voz ainda não tem amostra. Teste numa ligação."],
    ["en", en, "This voice has no sample yet. Try it on a call."],
    ["es", es, "Esta voz aún no tiene muestra. Pruébala en una llamada."],
  ])("voz sem amostra em %s: o botão fica desligado e a linha diz por quê", (_, t, line) => {
    const html = render(t, engineWith({}));
    expect(html).toContain(line);
    expect(listenButton(html, t)).toMatch(/disabled=""/);
    expect(html).not.toContain("<audio");
  });

  it("o grupo das vozes leva o nome do provedor tirado de `provider`, e o motor", () => {
    expect(render(ptBR, engineWith({}))).toContain('<optgroup label="Google · Gemini Live (Google)">');
    expect(render(ptBR, engineWith({ id: "openai-realtime", label: "OpenAI Realtime", provider: "openai" }))).toContain('<optgroup label="OpenAI · OpenAI Realtime">');
    // Provedor que o dicionário não conhece sai como veio: nunca some.
    expect(render(en, engineWith({ provider: "acme", label: "Acme Voice" }))).toContain('<optgroup label="acme · Acme Voice">');
    expect(render(es, engineWith({}))).toContain(escaped("Las voces del proveedor Google, por el motor Gemini Live (Google)."));
  });

  it("com amostra: o botão liga e o áudio não baixa nada antes do clique", () => {
    const voices: EngineVoice[] = [{ id: "Kore", sample: { "pt-BR": "voice-samples/gemini-live/Kore.pt-BR.mp3" } }];
    const html = render(ptBR, engineWith({ voices }));
    expect(listenButton(html, ptBR)).not.toMatch(/disabled=""/);
    expect(html).toContain('<audio preload="none" src="/voice-samples/gemini-live/Kore.pt-BR.mp3">');
    expect(html).not.toContain(ptBR.voiceNoSample);
    expect(html).not.toContain(ptBR.voiceSampleInPortuguese);
  });

  it("sem a amostra do idioma do agente, toca a de pt-BR e diz que é em português", () => {
    const voices: EngineVoice[] = [{ id: "Kore", sample: { "pt-BR": "voice-samples/gemini-live/Kore.pt-BR.mp3" } }];
    const html = render(en, engineWith({ voices }), "", "en-US");
    expect(html).toContain('src="/voice-samples/gemini-live/Kore.pt-BR.mp3"');
    expect(html).toContain(escaped(en.voiceSampleInPortuguese));
  });

  it("a voz salva fora da lista continua no campo, sem amostra", () => {
    const voices: EngineVoice[] = [{ id: "Kore", sample: { "pt-BR": "voice-samples/gemini-live/Kore.pt-BR.mp3" } }];
    const html = render(ptBR, engineWith({ voices }), "Zephyr-antiga");
    expect(html).toContain('<option value="Zephyr-antiga" selected="">Zephyr-antiga (fora da lista do motor)</option>');
    expect(html).toContain(ptBR.voiceNoSample);
    expect(html).not.toContain("<audio");
  });

  it("a linha da ElevenLabs aponta para o bloco Pipeline, diz que só falam quando ele ligar, e nenhuma voz da ElevenLabs entra na lista (5b-1)", () => {
    for (const t of [ptBR, en, es]) {
      const html = render(t, engineWith({}));
      expect(html).toContain(escaped(t.voiceElevenLabs));
      expect(t.voiceElevenLabs).toMatch(/Pipeline/);
      expect(html).toContain(`href="#pipeline"`);
      expect(html).toContain(escaped(t.voiceElevenLabsLink));
      expect(html.match(/<option /g)).toHaveLength(3);
    }
  });

  it("motor sem voz nenhuma (o simulado): sem botão, a linha da ElevenLabs fica", () => {
    const html = render(ptBR, engineWith({ id: "simulated", provider: "none", label: "Simulado", voices: [], defaultVoice: null }));
    expect(listenButton(html, ptBR)).toBeUndefined();
    expect(html).toContain(escaped(ptBR.voiceElevenLabs));
  });
});

describe("sampleFor", () => {
  const voice: EngineVoice = { id: "Kore", sample: { "pt-BR": "a/pt.mp3", es: "a/es.mp3" } };

  it("escolhe pelo prefixo do idioma do agente", () => {
    expect(sampleFor(voice, "es-MX")).toEqual({ src: "/a/es.mp3", inPortuguese: false });
    expect(sampleFor(voice, "pt-BR")).toEqual({ src: "/a/pt.mp3", inPortuguese: false });
    expect(sampleFor(voice, "pt")).toEqual({ src: "/a/pt.mp3", inPortuguese: false });
  });

  it("cai na de pt-BR, marcada, quando falta a do idioma", () => {
    expect(sampleFor(voice, "en")).toEqual({ src: "/a/pt.mp3", inPortuguese: true });
    expect(sampleFor(voice, "")).toEqual({ src: "/a/pt.mp3", inPortuguese: true });
  });

  it("sem a do idioma e sem a de pt-BR, não há amostra", () => {
    expect(sampleFor({ id: "x", sample: { es: "a/es.mp3" } }, "en")).toBeNull();
    expect(sampleFor({ id: "x" }, "pt-BR")).toBeNull();
    expect(sampleFor(undefined, "pt-BR")).toBeNull();
  });

  it("a voz ouvida é o padrão do motor quando o campo está no padrão", () => {
    const voices: EngineVoice[] = [{ id: "Kore" }, { id: "Puck" }];
    expect(selectedVoice(voices, "", "Puck")?.id).toBe("Puck");
    expect(selectedVoice(voices, "Kore", "Puck")?.id).toBe("Kore");
    expect(selectedVoice(voices, "", null)).toBeUndefined();
  });
});
