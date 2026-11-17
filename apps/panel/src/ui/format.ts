import type { Locale } from "../i18n/locales";

/** 272 -> "4:32"; acima de uma hora, "1:04:32". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (value: number): string => String(value).padStart(2, "0");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
}

/** O custo é medido em centavos de dólar, que é a moeda do preço dos provedores. */
export function formatMoney(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(cents / 100);
}

/** "+5531999998888" -> "+55 31 99999-8888". Número de outro país fica como veio. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return match ? `+55 ${match[1]} ${match[2]}-${match[3]}` : e164;
}

/** Quem está do outro lado: o número, ou o que a chamada é quando não há número (navegador, simulada). */
export function formatCaller(
  call: { direction: "inbound" | "outbound"; channel: "phone" | "web" | "whatsapp" | "simulated"; from: string | null; to: string | null },
  words: { unknownCaller: string; noNumber: { web: string; simulated: string } },
): string {
  const phone = formatPhone(call.direction === "outbound" ? call.to : call.from);
  if (phone) return phone;
  return call.channel === "web" || call.channel === "simulated" ? words.noNumber[call.channel] : words.unknownCaller;
}

export function formatClock(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

export const secondsBetween = (fromIso: string, to: number | string): number => (new Date(to).getTime() - new Date(fromIso).getTime()) / 1000;

/**
 * "rode `x` agora" -> texto, código, texto: a crase das notas de versão vira `<code>` na tela.
 * Só texto entra e sai, nada vira HTML. Crase sem par, ou par vazio, fica como texto.
 */
export function splitInlineCode(text: string): Array<{ code: boolean; text: string }> {
  const pieces: Array<{ code: boolean; text: string }> = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    if (match.index > last) pieces.push({ code: false, text: text.slice(last, match.index) });
    pieces.push({ code: true, text: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ code: false, text: text.slice(last) });
  return pieces;
}
