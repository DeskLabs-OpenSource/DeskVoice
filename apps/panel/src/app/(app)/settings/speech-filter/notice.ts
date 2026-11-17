import type { ProcessingLocation } from "@deskvoice/voice-engine/types";
import { fill, type Locale } from "../../../../i18n/locales";
import type { SpeechFilterDictionary } from "../../../../i18n/pt-BR/speech-filter";

/**
 * A página de retenção lida pelo projeto, por fornecedor: o endereço, a data que ela traz e o dia da
 * leitura. A da TypeSafe foi lida em 16/11/2026 (desenho R12, ajuste de 17/11 da fatia 7).
 */
export const RETENTION_SOURCES: Record<string, { url: string; updated: string; read: string }> = {
  typesafe: { url: "https://typesafe.ai/legal/privacy-policy", updated: "2025-11-19", read: "2026-11-16" },
};

export interface NoticeModel {
  provider: string;
  processingLocation: ProcessingLocation;
}

export interface Notice {
  /** As frases do aviso, na ordem. */
  lines: string[];
  /** De onde elas vêm: a página, com a data, uma vez por endereço. */
  sources: Array<{ url: string; text: string }>;
}

const day = (iso: string, locale: Locale): string => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export const providerName = (t: SpeechFilterDictionary, provider: string): string => t.providers[provider] ?? provider;

/**
 * O aviso de para onde vai o texto, só com o que a fonte do fornecedor diz: a retenção lida (ou que
 * ela não foi lida) e o lugar. País só com fonte; sem ela, o aviso diz que o fornecedor não declara.
 */
export function noticeOf(t: SpeechFilterDictionary, model: NoticeModel, locale: Locale): Notice {
  const location = model.processingLocation;
  if (location.kind === "this-server") return { lines: [t.location["this-server"]], sources: [] };
  const provider = providerName(t, model.provider);
  const retention = t.retention[model.provider];
  const page = retention ? RETENTION_SOURCES[model.provider] : undefined;
  const lines = [...(retention && page ? retention : [t.retentionUnread])];
  const sources: Notice["sources"] = page ? [{ url: page.url, text: fill(t.source, { updated: day(page.updated, locale), read: day(page.read, locale) }) }] : [];
  if (location.kind === "undeclared") lines.push(fill(t.location.undeclared, { provider }));
  else {
    lines.push(fill(t.location.country, { provider, country: t.countries[location.country] ?? location.country }));
    if (!sources.some((source) => source.url === location.source.url)) sources.push({ url: location.source.url, text: fill(t.locationSource, { read: day(location.source.checkedOn, locale) }) });
  }
  return { lines, sources };
}
