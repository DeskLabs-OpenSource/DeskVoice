"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./locales";

const LocaleContext = createContext<Locale>("pt-BR");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/**
 * O dicionário da área no idioma da pessoa. Cada tela importa os três arquivos da própria área:
 * não existe índice de dicionários para todo PR editar. O tipo do pt-BR é a fonte dos outros dois.
 */
export function useDict<T>(ptBR: T, en: NoInfer<T>, es: NoInfer<T>): T {
  const locale = useLocale();
  return locale === "en" ? en : locale === "es" ? es : ptBR;
}
