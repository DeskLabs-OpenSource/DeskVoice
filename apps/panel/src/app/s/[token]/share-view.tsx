"use client";

import { DownloadSimple, Waveform } from "@phosphor-icons/react";
import en from "../../../i18n/en/share";
import es from "../../../i18n/es/share";
import ptBR from "../../../i18n/pt-BR/share";
import { useDict, useLocale } from "../../../i18n/provider";
import { formatDateTime } from "../../../ui/format";
import { buttonClass } from "../../../ui/kit";
import { LocaleSelect } from "../../../ui/shell";

export interface PublicShare {
  startedAt: string;
  endedAt: string | null;
  expiresAt: string;
  left: number;
  download: string;
}

/** Mesmo visual da tela de entrada e do convite: quem chega aqui não tem conta. */
export function ShareView({ share }: { share: PublicShare | null }) {
  const t = useDict(ptBR, en, es).page;
  const locale = useLocale();
  // A hora é a do aparelho de quem abre; o servidor desenha na dele, então o texto pode mudar ao hidratar.
  const when = (iso: string): string => formatDateTime(iso, locale);

  return (
    <main className="mx-auto grid min-h-dvh max-w-[440px] content-center gap-8 px-5 py-10">
      <div className="rise grid gap-8">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[1.2rem] font-bold tracking-[-0.01em]">
            <Waveform size={28} weight="duotone" className="text-accent" aria-hidden />
            DeskVoice
          </span>
          <LocaleSelect />
        </div>

        {share ? (
          <>
            <div className="grid gap-1">
              <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{t.title}</h1>
              <p className="text-muted">{t.lead}</p>
            </div>
            <dl className="grid gap-3 border-y border-line py-4">
              {(
                [
                  [t.started, when(share.startedAt), true],
                  [t.ended, share.endedAt ? when(share.endedAt) : t.endedUnknown, share.endedAt !== null],
                  [t.validUntil, when(share.expiresAt), true],
                  [t.left, String(share.left), false],
                ] satisfies Array<[string, string, boolean]>
              ).map(([label, value, isTime]) => (
                <div key={label} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
                  <dt className="text-[0.87rem] font-bold text-muted">{label}</dt>
                  <dd className="data" suppressHydrationWarning={isTime}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-2">
              <a href={share.download} rel="nofollow noreferrer" className={buttonClass("primary", "justify-self-start")}>
                <DownloadSimple size={18} weight="bold" aria-hidden />
                {t.download}
              </a>
              <p className="text-[0.87rem] text-muted">{t.downloadHint}</p>
            </div>
            <p className="text-[0.87rem] text-muted">{t.personal}</p>
          </>
        ) : (
          <div className="grid gap-3">
            <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{t.goneTitle}</h1>
            <p className="text-muted">{t.goneBody}</p>
          </div>
        )}
      </div>
    </main>
  );
}
