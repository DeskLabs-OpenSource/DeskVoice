export const LOCALES = ["pt-BR", "en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "dv_locale";
export const THEME_COOKIE = "dv_theme";

/** Idioma do cookie; sem cookie, o primeiro idioma do navegador que o painel fala; senão pt-BR. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  const known = LOCALES.find((locale) => locale === cookie);
  if (known) return known;
  for (const tag of (acceptLanguage ?? "").split(",")) {
    const language = tag.trim().slice(0, 2).toLowerCase();
    const match = LOCALES.find((locale) => locale.slice(0, 2).toLowerCase() === language);
    if (match) return match;
  }
  return "pt-BR";
}

/** Troca `{nome}` pelo valor: `fill("{n} chamadas", { n: 3 })`. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
