"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import en from "../../../i18n/en/installation";
import es from "../../../i18n/es/installation";
import ptBR from "../../../i18n/pt-BR/installation";
import { useDict } from "../../../i18n/provider";
import { PageHeader } from "../../../ui/kit";

const SECTIONS = [
  { href: "/installation", key: "organizations" },
  { href: "/installation/overview", key: "overview" },
  { href: "/installation/admins", key: "admins" },
  { href: "/installation/audit", key: "audit" },
  { href: "/installation/update", key: "update" },
] as const;

/** O cabeçalho e as seções da área. A atualização mora só aqui (central de configuração, parte 8). */
export function InstallationNav() {
  const t = useDict(ptBR, en, es);
  const pathname = usePathname();
  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader title={t.title} lead={t.lead} />
      <div className="min-w-0 border-b border-line">
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
  );
}
