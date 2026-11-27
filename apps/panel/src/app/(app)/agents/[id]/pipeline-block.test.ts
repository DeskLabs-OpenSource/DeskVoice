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
import { conversationalBrains, PipelinePanel, type PipelineBrainOption, type PipelinePanelProps, type PipelineSynthesizer, type PipelineTranscriber, type VoicesState } from "./pipeline-block";
import { NO_PIECES } from "./pipeline-pieces";
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
      pieces: NO_PIECES,
      onPieces: () => undefined,
      brainModels: MODELS,
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
    // Sem transcrição de verdade, não há o que confirmar ao lado dela.
    expect(html).not.toContain(escaped(fill(t.pipelineTranscriberNotice, { provider: "OpenAI" })));
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
    // Uma vez, a da voz: sem transcrição de verdade, a dela não aparece.
    const times = (html: string): number => html.split(escaped(t.pipelineUnconfirmed)).length - 1;
    expect(times(unconfirmed)).toBe(1);
    expect(times(render({}, [locale, t, voiceT]))).toBe(0);
    expect(unconfirmed).not.toContain("{who}");
    expect(unconfirmed).not.toContain(escaped(fill(t.pipelineConfirmedBy, { who: "Ana Souza", when: formatDateTime(CONFIRMED_AT, locale) })));
    const gone = render({ synthesizers: [{ ...ELEVENLABS, consent: { name: null, at: CONFIRMED_AT } }] }, [locale, t, voiceT]);
    expect(gone).toContain(escaped(fill(t.pipelineConfirmedBy, { who: t.pipelineRemovedPerson, when: formatDateTime(CONFIRMED_AT, locale) })));
  });

  it("a voz que roda neste servidor não leva aviso: o texto não sai daqui", () => {
    const html = render({ synthesizers: [{ ...ELEVENLABS, processingLocation: { kind: "this-server" }, consent: null }] });
    expect(html).not.toContain(escaped(fill(ptBRVoice.confirm, { provider: "ElevenLabs" })));
    expect(html.match(/data-testid="pipeline-consent"/g)).toBeNull();
  });

  const OPENAI_EAR: PipelineTranscriber = { id: "openai", label: "OpenAI (gpt-4o-mini-transcribe)", provider: "openai", processingLocation: { kind: "undeclared" }, keyConfigured: true, consent: null };
  const LIVE: Engine = { ...PIPELINE, unavailable: null };

  it.each(DICTS)("em %s (fatia 6): a transcrição da OpenAI com o aviso da 9.1 e o botão que confirma, sem enviar formulário", (locale, t, voiceT) => {
    const html = render({ pipeline: LIVE, transcribers: [OPENAI_EAR] }, [locale, t, voiceT]);
    expect(html).not.toContain(escaped(t.pipelineTranscriberNone));
    expect(html).toContain("OpenAI (gpt-4o-mini-transcribe)");
    expect(html).toContain(escaped(fill(t.pipelineTranscriberNotice, { provider: "OpenAI" })));
    expect(html).toContain(escaped(t.pipelineTranscriberUnconfirmed));
    expect(html).toContain(escaped(fill(t.pipelineTranscriberConfirm, { provider: "OpenAI" })));
    expect(html).not.toContain(escaped(t.pipelineTranscriberNoKey));
    expect(html).not.toContain('type="submit"');
  });

  it.each(DICTS)("em %s (fatia 6): a confirmada diz por quem e quando, e oferece apagar; a sem a chave diz onde fica a chave", (locale, t, voiceT) => {
    const confirmed = render({ pipeline: LIVE, transcribers: [{ ...OPENAI_EAR, consent: { name: "Ana Souza", at: CONFIRMED_AT } }] }, [locale, t, voiceT]);
    expect(confirmed).toContain(escaped(fill(t.pipelineConfirmedBy, { who: "Ana Souza", when: formatDateTime(CONFIRMED_AT, locale) })));
    expect(confirmed).toContain(escaped(t.pipelineTranscriberRemove));
    expect(confirmed).not.toContain(escaped(fill(t.pipelineTranscriberConfirm, { provider: "OpenAI" })));
    const noKey = render({ pipeline: { ...PIPELINE, unavailable: { reason: "no_transcriber_key" } }, transcribers: [{ ...OPENAI_EAR, keyConfigured: false }] }, [locale, t, voiceT]);
    expect(noKey).toContain(escaped(t.pipelineTranscriberNoKey));
  });

  it.each([
    ["pt-BR", ptBR, ptBRVoice, "Transcrição provisória: a definitiva vem com a medida da transcrição."],
    ["en", en, enVoice, "Provisional transcription: the final one comes with the transcription measurement."],
    ["es", es, esVoice, "Transcripción provisional: la definitiva llega con la medición de la transcripción."],
  ] as const)("em %s (fatia 6b): a escolha da transcrição diz que ela é provisória; a não confirmada não entra na escolha", (locale, t, voiceT, line) => {
    const confirmed = { ...OPENAI_EAR, consent: { name: "Ana Souza", at: CONFIRMED_AT } };
    const html = render({ pipeline: LIVE, transcribers: [confirmed], pieces: { ...NO_PIECES, transcriber: "openai" } }, [locale, t, voiceT]);
    expect(html).toContain(escaped(line));
    expect(html).toContain(`>${t.pipelineTranscriberChoice}<`);
    expect(html).toContain('<option value="openai" selected="">OpenAI (gpt-4o-mini-transcribe)</option>');
    // Sem confirmação, a linha provisória fica, e a escolha não aparece: só o botão de confirmar.
    const unconfirmed = render({ pipeline: LIVE, transcribers: [OPENAI_EAR] }, [locale, t, voiceT]);
    expect(unconfirmed).toContain(escaped(line));
    expect(unconfirmed).not.toContain(`>${t.pipelineTranscriberChoice}<`);
    // Sem transcrição de verdade, nada de provisória.
    expect(render({}, [locale, t, voiceT])).not.toContain(escaped(line));
  });

  it.each(DICTS)("em %s (fatia 6b): cada voz da conta confirmada tem o \"Usar\", com a escolhida marcada; a conta sem confirmação, não", (locale, t, voiceT) => {
    const html = render({ pieces: { ...NO_PIECES, synthesizer: "elevenlabs", voiceId: "v-ze" } }, [locale, t, voiceT]);
    expect(html).toContain(`aria-label="${escaped(fill(t.pipelineVoiceUse, { voice: "Bia" }))}"`);
    const radios = html.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(radios).toEqual([
      `<input type="radio" aria-label="${escaped(fill(t.pipelineVoiceUse, { voice: "Bia" }))}" name="pipeline-voice"/>`,
      `<input type="radio" aria-label="${escaped(fill(t.pipelineVoiceUse, { voice: "Zé" }))}" name="pipeline-voice" checked=""/>`,
    ]);
    const unconfirmed = render({ synthesizers: [{ ...ELEVENLABS, consent: null }] }, [locale, t, voiceT]);
    expect(unconfirmed).not.toContain('type="radio"');
    expect(unconfirmed).toContain(`aria-label="${escaped(fill(t.pipelineVoiceListen, { voice: "Bia" }))}"`);
  });

  it("com a transcrição de verdade ainda carregando, o bloco espera, e não diz que falta", () => {
    expect(render({ pipeline: LIVE, transcribers: undefined })).not.toContain(escaped(ptBR.pipelineTranscriberNone));
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

  it.each(DICTS)("em %s: a peça gravada fora da lista fica a gravada, marcada, e nenhuma outra aparece como a do agente", (locale, t, voiceT) => {
    const brainGone = render({ pieces: { ...NO_PIECES, brain: "anthropic", model: "modelo-velho" } }, [locale, t, voiceT]);
    expect(brainGone).toContain(`<option value="anthropic" disabled="" selected="">${escaped(fill(t.pipelineStoredGone, { piece: "anthropic" }))}</option>`);
    expect(brainGone).toContain('<option value="openai">OpenAI</option>');
    expect(brainGone).not.toContain('value="openai" selected');
    expect(brainGone).not.toContain('value="com-preco"');
    expect(brainGone).toContain(escaped(t.pipelineStoredGoneHint));
    const modelGone = render({ pieces: { ...NO_PIECES, brain: "openai", model: "sem-preco" } }, [locale, t, voiceT]);
    expect(modelGone).toContain('<option value="sem-preco" disabled="" selected="">');
    expect(modelGone).not.toContain('value="com-preco" selected');
    expect(modelGone).toContain(escaped(t.pipelineStoredGoneHint));
    const earGone = render({ pipeline: { ...PIPELINE, unavailable: null }, transcribers: [{ id: "openai", label: "OpenAI", provider: "openai", processingLocation: { kind: "undeclared" }, keyConfigured: true, consent: { name: "Ana", at: CONFIRMED_AT } }], pieces: { ...NO_PIECES, transcriber: "velha" } }, [locale, t, voiceT]);
    expect(earGone).toContain(`<option value="velha" disabled="" selected="">${escaped(fill(t.pipelineStoredGone, { piece: "velha" }))}</option><option value="openai">OpenAI</option></select>`);
    // Sem peça gravada, nada é marcado como fora da lista.
    expect(render({}, [locale, t, voiceT])).not.toContain(escaped(t.pipelineStoredGoneHint));
  });

  it("quem só lê vê uma linha, e nenhuma lista nem áudio", () => {
    const html = render({ canConfigure: false });
    expect(html).toContain(escaped(ptBR.pipelineReadOnly));
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("<select");
  });

  it("não envia formulário sozinho: nenhum botão de enviar, o único botão é o Ouvir, e o único campo com nome é a escolha da voz", () => {
    const html = render();
    expect([...html.matchAll(/\sname="([^"]*)"/g)].map((match) => match[1])).toEqual(["pipeline-voice", "pipeline-voice"]);
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
      // O React escreve `autoPlay=""`: a conferência não olha maiúsculas, para pegar as duas grafias.
      expect(audio).not.toMatch(/autoplay/i);
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
