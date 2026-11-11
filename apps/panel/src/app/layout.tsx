import type { Metadata } from "next";
import { Atkinson_Hyperlegible, IBM_Plex_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { LOCALE_COOKIE, THEME_COOKIE, pickLocale } from "../i18n/locales";
import { LocaleProvider } from "../i18n/provider";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-atkinson" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

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
