import { describe, expect, it } from "vitest";
import { KEY_CHECK_RESULTS } from "@deskvoice/voice-engine/types";
import enBrains from "../i18n/en/brains";
import enSettings from "../i18n/en/settings";
import enSpeechFilter from "../i18n/en/speech-filter";
import enTimeline from "../i18n/en/timeline";
import enVoice from "../i18n/en/voice";
import esBrains from "../i18n/es/brains";
import esSettings from "../i18n/es/settings";
import esSpeechFilter from "../i18n/es/speech-filter";
import esTimeline from "../i18n/es/timeline";
import esVoice from "../i18n/es/voice";
import ptBrains from "../i18n/pt-BR/brains";
import ptSettings from "../i18n/pt-BR/settings";
import ptSpeechFilter from "../i18n/pt-BR/speech-filter";
import ptTimeline from "../i18n/pt-BR/timeline";
import ptVoice from "../i18n/pt-BR/voice";

// O resultado de provedor que vira frase: tudo menos o que não é falha.
const FAILURES = KEY_CHECK_RESULTS.filter((code) => code !== "accepted" && code !== "not_needed");

const LOCALES = [
  ["pt-BR", { brains: ptBrains, settings: ptSettings, speechFilter: ptSpeechFilter, timeline: ptTimeline, voice: ptVoice }],
  ["en", { brains: enBrains, settings: enSettings, speechFilter: enSpeechFilter, timeline: enTimeline, voice: enVoice }],
  ["es", { brains: esBrains, settings: esSettings, speechFilter: esSpeechFilter, timeline: esTimeline, voice: esVoice }],
] as const;

type Dicts = (typeof LOCALES)[number][1];

/** Cada bloco que traduz o resultado do provedor, com o nome que aparece na falha. */
const blocks = (d: Dicts): Array<[string, Record<string, string>]> => [
  ["voice.results", d.voice.results],
  ["speech-filter.results", d.speechFilter.results],
  ["settings.keyResults", d.settings.keyResults],
  ["brains.results", d.brains.results],
  ["timeline.events.transcription_failed_body", d.timeline.events.transcription_failed_body],
  ["timeline.events.outcome_not_classified_body", d.timeline.events.outcome_not_classified_body],
  ["timeline.events.analysis_not_done_reasons", d.timeline.events.analysis_not_done_reasons],
  ["timeline.events.analyst_read.failures", d.timeline.events.analyst_read.failures],
  ["timeline.events.caller_speech_read.reasons", d.timeline.events.caller_speech_read.reasons],
];

describe("o erro do lado do provedor (provider_error) tem frase própria", () => {
  it.each(LOCALES)("%s: todo bloco que tem unreachable tem provider_error, com frase diferente", (_locale, dicts) => {
    for (const [name, phrases] of blocks(dicts)) {
      expect(phrases.unreachable, name).toBeTruthy();
      expect(phrases.provider_error, name).toBeTruthy();
      expect(phrases.provider_error, name).not.toBe(phrases.unreachable);
    }
  });

  it.each(LOCALES)("%s: os blocos das telas de chave cobrem toda falha do vocabulário fechado", (_locale, dicts) => {
    // O cérebro não tem model_unavailable (brainFailureByStatus): o bloco dele fica de fora desta conta.
    for (const [name, phrases] of blocks(dicts).slice(0, 3)) {
      for (const code of FAILURES) expect(phrases[code], `${name}.${code}`).toBeTruthy();
    }
  });

  it.each(LOCALES)("%s: a frase não manda conferir a rede nem a chave", (_locale, dicts) => {
    for (const [name, phrases] of blocks(dicts)) {
      expect(phrases.provider_error, name).not.toMatch(/internet|\brede\b|\bred\b|network|chave|clave|\bkey\b/i);
    }
  });

  it("pt-BR: a tela da voz mostra a frase pedida no desenho (o 502 do /v2/voices)", () => {
    expect(ptVoice.results.provider_error).toBe("o fornecedor respondeu com erro do lado dele. Costuma passar sozinho: tente de novo em alguns minutos.");
  });
});
