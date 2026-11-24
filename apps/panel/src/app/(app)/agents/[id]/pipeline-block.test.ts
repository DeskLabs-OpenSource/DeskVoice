// O bloco "Pipeline" da tela do agente desenhado no servidor (fatia 5b-1): a transcrição que falta, os
// cérebros que conversam com os modelos com preço, as vozes da ElevenLabs com o rótulo e o Ouvir, a
// linha sem chave, a voz sem amostra, o aviso da 9.1 confirmado e não confirmado, nos três idiomas.
// Nada é baixado sem clique, e o bloco não tem o que salvar.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../i18n/en/agents";
import enVoice from "../../../../i18n/en/voice";
import es from "../../../../i18n/es/agents";
import esVoice from "../../../../i18n/es/voice";
import type { Locale } from "../../../../i18n/locales";
import ptBR, { type AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import ptBRVoice, { type VoiceDictionary } from "../../../../i18n/pt-BR/voice";
import { formatDateTime } from "../../../../ui/format";
import type { Engine } from "../../../../ui/types";
import { conversationalBrains, PipelinePanel, type PipelineBrainOption, type PipelinePanelProps, type PipelineSynthesizer, type VoicesState } from "./pipeline-block";
import { playSample } from "./voice-field";

const PIPELINE: Engine = {
  id: "pipeline",
  label: "Pipeline (transcrição, cérebro e voz)",
  provider: "pipeline",
  processingLocation: { kind: "undeclared" },
  requiresKey: false,
  classifyTarget: false,
  baseUrl: null,
  classifyModel: null,
  classifyModelUnmeasured: false,
  classifyKeyConfigured: false,
  voices: [],
  defaultVoice: null,
  keyConfigured: false,
  keyCheck: null,
  priceCheckedOn: "2026-11-23",
  priceSource: "pipeline",
  assembled: true,
  unavailable: { reason: "no_live_transcriber" },
};
const CONFIRMED_AT = "2026-11-20T15:30:00.000Z";
const ELEVENLABS: PipelineSynthesizer = { id: "elevenlabs", label: "ElevenLabs", provider: "elevenlabs", processingLocation: { kind: "undeclared" }, configured: true, consent: { name: "Ana Souza", at: CONFIRMED_AT } };
const VOICES: VoicesState = {
  state: "ready",
  failure: null,
  voices: [
    { id: "v-bia", name: "Bia", languages: ["pt-BR"], previewUrl: "https://storage.example.invalid/bia.mp3" },
    { id: "v-ze", name: "Zé", languages: [] },
  ],
};
const PRICE = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "https://exemplo.invalid/precos", checkedOn: "2026-03-01" };
const BRAINS: PipelineBrainOption[] = [
  { id: "openai", label: "OpenAI", chat: true, configured: true, keyCheck: { result: "accepted" } },
  { id: "mudo", label: "Cérebro que não conversa", chat: false, configured: true, keyCheck: { result: "accepted" } },
  { id: "anthropic", label: "Anthropic", chat: true, configured: true, keyCheck: { result: "rejected" } },
  { id: "deepseek", label: "DeepSeek", chat: true, configured: false, keyCheck: null },
];
const MODELS = { fetchedAt: "2026-03-01T15:00:00.000Z", stale: false, models: [{ id: "com-preco", label: "Com preço", price: PRICE }, { id: "sem-preco", label: "Sem preço" }] };

const DICTS: Array<[Locale, AgentsDictionary, VoiceDictionary]> = [
  ["pt-BR", ptBR, ptBRVoice],
  ["en", en, enVoice],
  ["es", es, esVoice],
];

const render = (over: Partial<PipelinePanelProps> = {}, [locale, t, voiceT]: [Locale, AgentsDictionary, VoiceDictionary] = DICTS[0] as [Locale, AgentsDictionary, VoiceDictionary]): string =>
  renderToStaticMarkup(
    createElement(PipelinePanel, {
      t,
      voiceT,
      locale,
      pipeline: PIPELINE,
      canConfigure: true,
      synthesizers: [ELEVENLABS],
      brains: BRAINS,
      brain: "",
      onBrain: () => undefined,
      brainModels: MODELS,
      model: "",
      onModel: () => undefined,
      voicesOf: { elevenlabs: VOICES },
      ...over,
    }),
  );
const escaped = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

describe("PipelinePanel", () => {
  it.each(DICTS)("em %s: a transcrição que falta, as vozes da ElevenLabs com o rótulo e o Ouvir, e o aviso da 9.1 confirmado", (locale, t, voiceT) => {
    const html = render({}, [locale, t, voiceT]);
    expect(html).toContain('id="pipeline"');
    expect(html).toContain(escaped(t.pipelineTranscriberNone));
    expect(html).toContain(escaped(t.pipelineTranscriberNotice));
    expect(html).toContain(escaped(t.pipelineVoicesNote));
    // Cada voz leva o rótulo do fornecedor; a com amostra tem o Ouvir, a sem diz "sem amostra".
    expect(html.match(/>ElevenLabs</g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(`aria-label="${escaped(fill(t.pipelineVoiceListen, { voice: "Bia" }))}"`);
    expect(html).toContain('<audio preload="none" src="https://storage.example.invalid/bia.mp3">');
    expect(html).toContain(escaped(t.pipelineVoiceNoSample));
    expect(html).not.toContain(fill(t.pipelineVoiceListen, { voice: "Zé" }));
    // O aviso da 9.1 ao lado da voz: o que vai, por quem e quando foi confirmado.
    expect(html).toContain(escaped(fill(voiceT.confirm, { provider: "ElevenLabs" })));
    expect(html).toContain(escaped(fill(t.pipelineConfirmedBy, { who: "Ana Souza", when: formatDateTime(CONFIRMED_AT, locale) })));
  });

  it("sem amostra em nenhuma voz: nenhum elemento de áudio, e cada uma diz isso", () => {
    const html = render({ voicesOf: { elevenlabs: { state: "ready", failure: null, voices: [{ id: "a", name: "A", languages: [] }, { id: "b", name: "B", languages: [] }] } } });
    expect(html).not.toContain("<audio");
    expect(html.split(ptBR.pipelineVoiceNoSample).length - 1).toBe(2);
  });

  it.each(DICTS)("em %s: sem chave salva, a linha diz isso e leva a Configurações → Voz, sem lista", (locale, t, voiceT) => {
    const html = render({ synthesizers: [{ ...ELEVENLABS, configured: false, consent: null }], voicesOf: {} }, [locale, t, voiceT]);
    expect(html).toContain(escaped(fill(t.pipelineVoiceNoKey, { provider: "ElevenLabs" })));
    expect(html).toContain('href="/settings/voice"');
    expect(html).toContain(escaped(t.pipelineVoiceLink));
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("<ul");
    // O aviso fica com ou sem chave, e diz que não foi confirmado.
    expect(html).toContain(escaped(t.pipelineUnconfirmed));
  });

  it.each(DICTS)("em %s: o aviso da 9.1 não confirmado, e o de quem saiu da equipe", (locale, t, voiceT) => {
    const unconfirmed = render({ synthesizers: [{ ...ELEVENLABS, consent: null }] }, [locale, t, voiceT]);
    // Duas vezes: a da transcrição (que nunca tem confirmação nesta versão) e a da voz.
    const times = (html: string): number => html.split(escaped(t.pipelineUnconfirmed)).length - 1;
    expect(times(unconfirmed)).toBe(2);
    expect(times(render({}, [locale, t, voiceT]))).toBe(1);
    expect(unconfirmed).not.toContain("{who}");
    expect(unconfirmed).not.toContain(escaped(fill(t.pipelineConfirmedBy, { who: "Ana Souza", when: formatDateTime(CONFIRMED_AT, locale) })));
    const gone = render({ synthesizers: [{ ...ELEVENLABS, consent: { name: null, at: CONFIRMED_AT } }] }, [locale, t, voiceT]);
    expect(gone).toContain(escaped(fill(t.pipelineConfirmedBy, { who: t.pipelineRemovedPerson, when: formatDateTime(CONFIRMED_AT, locale) })));
  });

  it("a voz que roda neste servidor não leva aviso: o texto não sai daqui", () => {
    const html = render({ synthesizers: [{ ...ELEVENLABS, processingLocation: { kind: "this-server" }, consent: null }] });
    expect(html).not.toContain(escaped(fill(ptBRVoice.confirm, { provider: "ElevenLabs" })));
    // A transcrição continua com o dela.
    expect(html.match(/data-testid="pipeline-consent"/g)).toHaveLength(1);
  });

  it("a falha da lista diz a frase, e nunca fica em silêncio", () => {
    expect(render({ voicesOf: { elevenlabs: { state: "failed", text: "Muitas leituras." } } })).toContain("Muitas leituras.");
    expect(render({ voicesOf: { elevenlabs: { state: "ready", voices: [], failure: "Não foi possível ler as vozes: sem crédito." } } })).toContain("Não foi possível ler as vozes: sem crédito.");
    expect(render({ loadError: "Sem permissão." })).toContain("Sem permissão.");
  });

  it("o cérebro: só os que conversam com a chave aceita; o modelo: só os com preço, pela regra de `pricePipeline`", () => {
    expect(conversationalBrains(BRAINS).map((brain) => brain.id)).toEqual(["openai"]);
    const html = render();
    expect(html).toContain('<option value="openai" selected="">OpenAI</option>');
    expect(html).not.toContain('value="mudo"');
    expect(html).not.toContain('value="anthropic"');
    expect(html).not.toContain('value="deepseek"');
    expect(html).toContain('<option value="com-preco" selected="">com-preco</option>');
    expect(html).not.toContain('value="sem-preco"');
    expect(render({ brainModels: { models: [{ id: "sem-preco", label: "Sem preço" }] } })).toContain(ptBR.pipelineModelNone);
    const none = render({ brains: [] });
    expect(none).toContain(escaped(ptBR.pipelineBrainNone));
    expect(none).toContain('href="/settings/brains"');
  });

  it("quem só lê vê uma linha, e nenhuma lista nem áudio", () => {
    const html = render({ canConfigure: false });
    expect(html).toContain(escaped(ptBR.pipelineReadOnly));
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("<select");
  });

  it("não salva: nenhum campo com nome, nenhum botão de enviar, e o único botão é o Ouvir", () => {
    const html = render();
    expect(html).not.toMatch(/\sname="/);
    expect(html).not.toContain('type="submit"');
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('type="button"');
    expect(buttons[0]).toContain(escaped(fill(ptBR.pipelineVoiceListen, { voice: "Bia" })));
  });

  it("a página não toca nem baixa áudio sem clique: todo áudio com `preload=\"none\"` e sem `autoplay`", () => {
    const html = render();
    const audios = html.match(/<audio[^>]*>/g) ?? [];
    expect(audios.length).toBeGreaterThan(0);
    for (const audio of audios) {
      expect(audio).toContain('preload="none"');
      expect(audio).not.toContain("autoplay");
    }
  });
});

describe("playSample: o Ouvir nunca fica mudo sem dizer nada", () => {
  it("o `play()` recusado diz o erro, e começa do início", async () => {
    const element = { currentTime: 12, play: vi.fn(() => Promise.reject(new DOMException("blocked", "NotAllowedError"))) };
    const failed = vi.fn();
    await playSample(element, failed);
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(element.currentTime).toBe(0);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("o `play()` que toca não diz erro; sem elemento, diz", async () => {
    const failed = vi.fn();
    await playSample({ currentTime: 0, play: () => Promise.resolve() }, failed);
    expect(failed).not.toHaveBeenCalled();
    await playSample(null, failed);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
