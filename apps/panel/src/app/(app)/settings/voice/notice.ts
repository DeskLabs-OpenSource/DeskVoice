import type { ProcessingLocation } from "@deskvoice/voice-engine/types";
import { fill, type Locale } from "../../../../i18n/locales";
import type { VoiceDictionary } from "../../../../i18n/pt-BR/voice";

/**
 * As páginas lidas pelo projeto, por fornecedor da voz (desenho R5, seção 9.1, resposta A da DESA-103):
 * a da retenção, com o dia da leitura, e a do armazenamento, com o país, a data que ela traz e o dia
 * da leitura. As da ElevenLabs foram lidas em 17/11/2026 e estão citadas em docs/guides/voz.md.
 */
export const VOICE_SOURCES: Record<string, { retention: { url: string; read: string }; storage?: { country: string; url: string; updated: string; read: string } }> = {
  elevenlabs: {
    retention: { url: "https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode", read: "2026-11-17" },
    storage: { country: "US", url: "https://elevenlabs.io/privacy-policy", updated: "2026-10-09", read: "2026-11-17" },
  },
};

export interface NoticeVoice {
  provider: string;
  processingLocation: ProcessingLocation;
}

export interface NoticeLine {
  text: string;
  /** A página de onde a frase vem, com a data. O país de armazenamento nunca aparece sem ela. */
  source?: { url: string; text: string };
}

const day = (iso: string, locale: Locale): string => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export const providerName = (t: VoiceDictionary, provider: string): string => t.providers[provider] ?? provider;

/**
 * O aviso de para onde vai o texto que o agente fala, só com o que as páginas do fornecedor dizem: a
 * retenção lida (ou que ela não foi lida), o armazenamento com a fonte e o lugar do processamento.
 * País só com fonte. O armazenamento é armazenamento: o processamento sem fonte sai como "não declara".
 */
export function noticeOf(t: VoiceDictionary, voice: NoticeVoice, locale: Locale): NoticeLine[] {
  const location = voice.processingLocation;
  if (location.kind === "this-server") return [{ text: t.location["this-server"] }];
  const provider = providerName(t, voice.provider);
  const sources = VOICE_SOURCES[voice.provider];
  const retention = t.retention[voice.provider];
  const lines: NoticeLine[] = [{ text: fill(t.goes, { provider }) }];
  if (retention && retention.length > 0 && sources) {
    retention.forEach((text, index) =>
      lines.push(index === retention.length - 1 ? { text, source: { url: sources.retention.url, text: fill(t.retentionSource, { read: day(sources.retention.read, locale) }) } } : { text }),
    );
  } else lines.push({ text: t.retentionUnread });
  const storage = sources?.storage;
  const storageCountry = storage ? t.countries[storage.country] : undefined;
  if (storage && storageCountry) {
    lines.push({
      text: fill(t.storage, { provider, country: storageCountry }),
      source: { url: storage.url, text: fill(t.storageSource, { updated: day(storage.updated, locale), read: day(storage.read, locale) }) },
    });
  }
  if (location.kind === "undeclared") lines.push({ text: fill(t.location.undeclared, { provider }) });
  else {
    const country = t.countries[location.country];
    // Sem o nome do país no dicionário, o aviso não o inventa: diz que não declara.
    lines.push(
      country
        ? { text: fill(t.location.country, { provider, country }), source: { url: location.source.url, text: fill(t.locationSource, { read: day(location.source.checkedOn, locale) }) } }
        : { text: fill(t.location.undeclared, { provider }) },
    );
  }
  return lines;
}
