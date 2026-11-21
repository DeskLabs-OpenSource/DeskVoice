"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import commonEn from "../../../i18n/en/common";
import commonEs from "../../../i18n/es/common";
import commonPtBR from "../../../i18n/pt-BR/common";
import brainsEn from "../../../i18n/en/brains";
import en from "../../../i18n/en/settings";
import brainsEs from "../../../i18n/es/brains";
import es from "../../../i18n/es/settings";
import brainsPtBR from "../../../i18n/pt-BR/brains";
import ptBR from "../../../i18n/pt-BR/settings";
import analystsEn from "../../../i18n/en/analysts";
import speechFilterEn from "../../../i18n/en/speech-filter";
import analystsEs from "../../../i18n/es/analysts";
import speechFilterEs from "../../../i18n/es/speech-filter";
import analystsPtBR from "../../../i18n/pt-BR/analysts";
import speechFilterPtBR from "../../../i18n/pt-BR/speech-filter";
import voiceEn from "../../../i18n/en/voice";
import voiceEs from "../../../i18n/es/voice";
import voicePtBR from "../../../i18n/pt-BR/voice";
import { useDict } from "../../../i18n/provider";
import { ReadOnlyNotice } from "../../../ui/errors";
import { PageHeader } from "../../../ui/kit";
import { LimitsNotice } from "./limits-notice";

// As subtelas de Configurações e o nome de cada uma, que vira o título da tela (central de
// configuração, parte 4: a barra de abas saiu, e quem chega volta pela central). A central tem um
// cartão para cada uma, salvo "Sua conta", que mora no bloco da conta do menu como "Minha conta".
const SECTIONS = [
  { href: "/settings/ai", key: "ai" },
  { href: "/settings/after-call", key: "afterCall" },
  { href: "/settings/brains", key: "brains" },
  { href: "/settings/voice", key: "voice" },
  { href: "/settings/speech-filter", key: "speechFilter" },
  { href: "/settings/analysts", key: "analysts" },
  { href: "/settings/calls", key: "calls" },
  { href: "/settings/whatsapp", key: "whatsapp" },
  { href: "/settings/integrations", key: "integrations" },
  { href: "/settings/privacy", key: "privacy" },
  { href: "/settings/account", key: "account" },
] as const;

const ACCOUNT = "/settings/account";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useDict(ptBR, en, es);
  // O nome da seção de cérebros mora no dicionário dela, junto com a tela.
  const brains = useDict(brainsPtBR, brainsEn, brainsEs);
  const speechFilter = useDict(speechFilterPtBR, speechFilterEn, speechFilterEs);
  const analysts = useDict(analystsPtBR, analystsEn, analystsEs);
  const voice = useDict(voicePtBR, voiceEn, voiceEs);
  // O nome de "Depois da ligação" é o do cartão que leva a ela, sem um segundo texto para o mesmo lugar.
  const sectionLabel = (key: (typeof SECTIONS)[number]["key"]): string => (key === "brains" ? brains.menu : key === "voice" ? voice.menu : key === "speechFilter" ? speechFilter.menu : key === "analysts" ? analysts.menu : key === "afterCall" ? t.hub.cards.outcome.title : t.sections[key]);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const pathname = usePathname();
  const section = SECTIONS.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  return (
    <>
      {/* Na central, o título e o resumo de Configurações. Numa subtela, o caminho de volta à central
          em cima, e o nome da subtela como título: sem a barra de abas, é ele que diz onde se está. */}
      {section ? (
        <div className="grid gap-2">
          <Link href="/settings" className="inline-flex w-fit items-center gap-1.5 rounded-xs text-[0.93rem] text-muted underline-offset-4 hover:text-ink hover:underline">
            <ArrowLeft size={16} aria-hidden />
            {common.nav.settings}
          </Link>
          <PageHeader title={sectionLabel(section.key)} />
        </div>
      ) : (
        <PageHeader title={t.title} lead={t.lead} />
      )}
      {/* O próprio contato e a senha qualquer papel edita; nas outras seções, quem não configura só lê. */}
      {pathname === ACCOUNT ? null : <ReadOnlyNotice />}
      {/* Os limites da organização, definidos pela administração da instalação; sem nenhum, nada aparece. */}
      {pathname === ACCOUNT ? null : <LimitsNotice />}
      {children}
    </>
  );
}
