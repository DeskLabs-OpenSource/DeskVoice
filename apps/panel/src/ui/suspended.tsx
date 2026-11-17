"use client";

import { Buildings, SignOut, Waveform } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import en from "../i18n/en/common";
import es from "../i18n/es/common";
import { fill } from "../i18n/locales";
import ptBR from "../i18n/pt-BR/common";
import { useDict } from "../i18n/provider";
import { api, useApi } from "./api";
import { Button, Notice, PageHeader, Panel } from "./kit";
import { MeContext, type Membership } from "./me";
import { LocaleSelect } from "./shell";
import type { Me } from "./types";

/**
 * O painel de quem está numa organização suspensa (seção 3.3 do desenho do R8). Quem só tem vínculo
 * com ela vê o nome, o motivo e mais nada; quem tem outras organizações troca para elas. Quem
 * administra a instalação continua alcançando a área da instalação, para reativá-la estando nela.
 *
 * Não desenha a `Shell`: a navegação, os avisos, os pedidos de aprovação e a saúde são da organização,
 * e a API responde 409 `organization_suspended` para eles.
 */
export function SuspendedShell({ me, organization, children }: { me: Me; organization: { name: string; reason: string | null }; children: ReactNode }) {
  const t = useDict(ptBR, en, es);
  const pathname = usePathname();
  const onInstallation = me.installationAdmin === true && (pathname === "/installation" || pathname.startsWith("/installation/"));
  const { data } = useApi<Membership[]>("/auth/organizations");
  const others = (data ?? []).filter((membership) => !membership.current);
  const [busy, setBusy] = useState(false);

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-dvh">
        <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3 lg:px-10">
          <span className="mr-auto flex items-center gap-2 text-[1.13rem] font-bold tracking-[-0.01em]">
            <Waveform size={24} weight="duotone" className="text-accent" aria-hidden />
            DeskVoice
          </span>
          <LocaleSelect />
          <button
            type="button"
            aria-label={t.actions.signOut}
            title={t.actions.signOut}
            className="grid size-8 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-ink"
            onClick={() => void api("/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login"))}
          >
            <SignOut size={18} weight="duotone" aria-hidden />
          </button>
        </header>
        <main className="rise mx-auto grid max-w-[1160px] gap-8 px-4 py-6 lg:px-10 lg:py-10">
          {onInstallation ? (
            <>
              <Notice tone="warn">{fill(t.suspended.lead, { name: organization.name })}</Notice>
              {children}
            </>
          ) : (
            <>
            <PageHeader title={t.suspended.title} lead={fill(t.suspended.lead, { name: organization.name })} />
            <Panel>
              <div className="grid gap-4">
                <div className="grid gap-1">
                  <p className="font-bold">{t.suspended.reason}</p>
                  <p className="whitespace-pre-line">{organization.reason ?? t.suspended.noReason}</p>
                </div>
                {others.length > 0 ? (
                  <div className="grid gap-2">
                    <p>{t.suspended.others}</p>
                    <div className="flex flex-wrap gap-2">
                      {others.map((membership) => (
                        <Button
                          key={membership.organizationId}
                          busy={busy}
                          onClick={() => {
                            setBusy(true);
                            void api("/auth/switch", { body: { organizationId: membership.organizationId } }).then(
                              () => window.location.assign("/calls"),
                              () => window.location.reload(),
                            );
                          }}
                        >
                          {fill(t.suspended.open, { name: membership.organizationName })}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {me.installationAdmin ? (
                  <Link href="/installation" className="flex items-center gap-2 font-bold text-accent-strong underline underline-offset-4">
                    <Buildings size={18} weight="duotone" aria-hidden />
                    {t.suspended.installation}
                  </Link>
                ) : null}
              </div>
            </Panel>
            </>
          )}
        </main>
      </div>
    </MeContext.Provider>
  );
}
