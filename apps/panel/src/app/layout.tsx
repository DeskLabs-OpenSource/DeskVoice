import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { LOCALE_COOKIE, THEME_COOKIE, pickLocale } from "../i18n/locales";
import { LocaleProvider } from "../i18n/provider";
import "./globals.css";

// As fontes moram no repositório (./fonts, subconjunto latino, do Fontsource 5.3.0, licença OFL ao
// lado): a construção não baixa nada de fora, e sem acesso ao serviço de fontes a imagem ainda sai.
const atkinson = localFont({
  src: [
    { path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-atkinson",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = { title: "DeskVoice" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const locale = pickLocale(jar.get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
  const theme = jar.get(THEME_COOKIE)?.value;
  return (
    <html lang={locale} data-theme={theme === "light" || theme === "dark" ? theme : undefined} className={`${atkinson.variable} ${plexMono.variable}`}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
