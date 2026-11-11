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
