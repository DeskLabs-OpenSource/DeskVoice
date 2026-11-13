"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import en from "../../../i18n/en/settings";
import es from "../../../i18n/es/settings";
import ptBR from "../../../i18n/pt-BR/settings";
import { useDict } from "../../../i18n/provider";
import { ReadOnlyNotice } from "../../../ui/errors";
import { PageHeader } from "../../../ui/kit";

// A primeira seção é a de `/settings`: os links do painel que mandam cadastrar a chave caem nela.
const SECTIONS = [
  { href: "/settings", key: "ai" },
  { href: "/settings/calls", key: "calls" },
  { href: "/settings/whatsapp", key: "whatsapp" },
  { href: "/settings/integrations", key: "integrations" },
  { href: "/settings/privacy", key: "privacy" },
  { href: "/settings/system", key: "system" },
  { href: "/settings/account", key: "account" },
] as const;

const ACCOUNT = "/settings/account";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useDict(ptBR, en, es);
  const pathname = usePathname();
  return (
    <>
      <div className="grid gap-5">
        <PageHeader title={t.title} lead={t.lead} />
        {/* Em tela estreita as seções rolam na horizontal; a linha de baixo fica fora da rolagem. */}
        <div className="border-b border-line">
          <nav aria-label={t.sectionsNav} className="flex gap-1 overflow-x-auto">
            {SECTIONS.map(({ href, key }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className="shrink-0 border-b-2 border-transparent px-3 py-2.5 whitespace-nowrap text-muted transition-colors duration-[120ms] ease-out hover:text-ink focus-visible:-outline-offset-2 aria-[current=page]:border-ink aria-[current=page]:font-bold aria-[current=page]:text-ink"
              >
                {t.sections[key]}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {/* O próprio contato e a senha qualquer papel edita; nas outras seções, quem não configura só lê. */}
      {pathname === ACCOUNT ? null : <ReadOnlyNotice />}
      {children}
    </>
  );
}
