"use client";

import { Bell, ChartBar, CircleHalf, GearSix, Headset, ListChecks, Moon, PhoneCall, PhoneOutgoing, PlugsConnected, SealQuestion, SignOut, Sun, UsersThree, Waveform } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import enApprovals from "../i18n/en/approvals";
import en from "../i18n/en/common";
import esApprovals from "../i18n/es/approvals";
import es from "../i18n/es/common";
import { LOCALES, LOCALE_COOKIE, THEME_COOKIE, fill } from "../i18n/locales";
import ptBRApprovals from "../i18n/pt-BR/approvals";
import ptBR from "../i18n/pt-BR/common";
import { useDict, useLocale } from "../i18n/provider";
import { api, useApi } from "./api";
import { APPROVALS_CHANGED, ApprovalCard, isWaiting } from "./approval";
import { formatDateTime } from "./format";
import { useLive, useNow } from "./live";
import { MeContext } from "./me";
import type { Approval, HealthReport, HealthStatus, Me, PanelNotification } from "./types";

type Theme = "light" | "dark" | undefined;

const YEAR = 60 * 60 * 24 * 365;
const setCookie = (name: string, value: string): void => {
  document.cookie = `${name}=${value}; path=/; max-age=${value ? YEAR : 0}; samesite=lax`;
};

const NAV = [
  { href: "/calls", key: "calls", icon: PhoneCall },
  { href: "/approvals", key: "approvals", icon: SealQuestion },
  { href: "/follow-ups", key: "followUps", icon: ListChecks },
  { href: "/agents", key: "agents", icon: Headset },
  { href: "/line", key: "line", icon: PlugsConnected },
  { href: "/outbound", key: "outbound", icon: PhoneOutgoing },
  { href: "/costs", key: "costs", icon: ChartBar },
  { href: "/team", key: "team", icon: UsersThree },
  { href: "/settings", key: "settings", icon: GearSix },
] as const;

const DOT: Record<HealthStatus, string> = { ok: "bg-ok", warn: "bg-warn", fail: "bg-fail" };

/** Fecha um <details> aberto quando a pessoa clica fora ou aperta Esc. */
function useDismiss() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event): void => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return ref;
}

const POPOVER = "absolute z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-2 shadow-md";

export function LocaleSelect() {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  const router = useRouter();
  return (
    <select
      aria-label={t.shell.language}
      value={locale}
      onChange={(event) => {
        setCookie(LOCALE_COOKIE, event.target.value);
        router.refresh();
      }}
      className="data h-8 cursor-pointer rounded-xs bg-transparent px-1 text-muted hover:text-ink"
    >
      {LOCALES.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** O resumo da saúde, sempre à vista; é também a porta da tela "Saúde do sistema", com cada linha. */
function HealthIndicator() {
  const t = useDict(ptBR, en, es).health;
  const pathname = usePathname();
  const { data, error, reload } = useApi<HealthReport>("/system/health");
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  const troubled = (data?.checks ?? []).filter((line) => line.status !== "ok").length;
  const worst: HealthStatus = error && !data ? "fail" : (data?.worst ?? "ok");
  const summary = !data ? (error ? t.unreachable : t.checking) : troubled === 0 ? t.allOk : fill(t.attention, { n: troubled });

  return (
    <Link
      href="/health"
      aria-current={pathname === "/health" ? "page" : undefined}
      className="flex h-9 min-w-0 items-center gap-2 rounded-xs px-2 text-[0.87rem] text-muted hover:bg-sunken hover:text-ink aria-[current=page]:bg-sunken aria-[current=page]:text-ink"
    >
      <span className={`size-2 shrink-0 rounded-full ${data || error ? DOT[worst] : "bg-line-strong"}`} aria-hidden />
      <span className="truncate">{summary}</span>
    </Link>
  );
}

function NotificationBell({ align }: { align: string }) {
  const t = useDict(ptBR, en, es).shell;
  const locale = useLocale();
  const { data = [], reload } = useApi<PanelNotification[]>("/notifications");
  const ref = useDismiss();
  useLive(reload);
  const unread = data.filter((notification) => notification.readAt === null).length;

  return (
    <details ref={ref} className="relative">
      <summary aria-label={t.notifications} className="relative grid size-9 cursor-pointer list-none place-items-center rounded-xs text-muted hover:bg-sunken hover:text-ink [&::-webkit-details-marker]:hidden">
        <Bell size={20} weight="duotone" aria-hidden />
        {unread > 0 ? <span className="data absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[0.7rem] font-medium text-on-accent">{unread}</span> : null}
      </summary>
      <div className={`${POPOVER} ${align} max-h-[60vh] overflow-y-auto`}>
        {data.length === 0 ? <p className="p-3 text-muted">{t.noNotifications}</p> : null}
        {data.map((notification) => (
          <div key={notification.id} className={`grid gap-1 rounded-xs px-3 py-2.5 ${notification.readAt ? "text-muted" : ""}`}>
            <p className="whitespace-pre-line">{notification.body}</p>
            {/* O aviso de uma pendência não copia o título: ele vem da própria pendência, pelo id. */}
            {notification.followUpId ? <p className="font-bold">{notification.followUpTitle ?? t.followUpGone}</p> : null}
            <div className="flex flex-wrap items-center gap-x-3 text-[0.87rem] text-muted">
              <span className="data">{formatDateTime(notification.createdAt, locale)}</span>
              {notification.followUpId ? (
                <Link href="/follow-ups" className="font-bold underline-offset-4 hover:text-ink hover:underline">
                  {t.followUpOpen}
                </Link>
              ) : null}
              {notification.callId ? (
                <Link href={`/calls/${notification.callId}`} className="font-bold underline-offset-4 hover:text-ink hover:underline">
                  {t.openCall}
                </Link>
              ) : null}
              {notification.readAt === null ? (
                <button type="button" className="cursor-pointer font-bold underline-offset-4 hover:text-ink hover:underline" onClick={() => void api(`/notifications/${notification.id}/read`, { method: "POST" }).then(reload, reload)}>
                  {t.markRead}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function ThemeToggle({ initial }: { initial: Theme }) {
  const t = useDict(ptBR, en, es).shell;
  const [theme, setTheme] = useState<Theme>(initial);
  const next: Theme = theme === undefined ? "light" : theme === "light" ? "dark" : undefined;
  const label = theme === "light" ? t.themeLight : theme === "dark" ? t.themeDark : t.themeSystem;
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : CircleHalf;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-8 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-ink"
      onClick={() => {
        setTheme(next);
        setCookie(THEME_COOKIE, next ?? "");
        if (next) document.documentElement.dataset.theme = next;
        else delete document.documentElement.dataset.theme;
      }}
    >
      <Icon size={18} weight="duotone" aria-hidden />
    </button>
  );
}

function Brand() {
  return (
    <Link href="/calls" className="flex items-center gap-2 rounded-xs text-[1.13rem] font-bold tracking-[-0.01em]">
      <Waveform size={24} weight="duotone" className="text-accent" aria-hidden />
      DeskVoice
    </Link>
  );
}

export function Shell({ me, theme, children }: { me: Me; theme: Theme; children: ReactNode }) {
  const t = useDict(ptBR, en, es);
  const tApprovals = useDict(ptBRApprovals, enApprovals, esApprovals);
  const pathname = usePathname();
  const now = useNow();
  const approvals = useApi<Approval[]>("/approvals?status=pending");
  useLive(approvals.reload);
  useEffect(() => {
    window.addEventListener(APPROVALS_CHANGED, approvals.reload);
    return () => window.removeEventListener(APPROVALS_CHANGED, approvals.reload);
  }, [approvals.reload]);

  const waiting = (approvals.data ?? []).filter((approval) => isWaiting(approval, now)).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const first = waiting[0];

  const nav = (
    <nav aria-label={t.shell.mainNav} className="flex gap-1 overflow-x-auto lg:grid lg:overflow-visible">
      {/* Equipe só aparece para quem pode gerir: operador não vê a porta. */}
      {NAV.filter((item) => item.key !== "team" || me.role !== "operator").map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-10 shrink-0 items-center gap-2.5 rounded-xs px-3 transition-colors duration-[120ms] ease-out ${active ? "bg-sunken font-bold text-ink" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            <Icon size={20} weight="duotone" aria-hidden />
            <span className="whitespace-nowrap">{t.nav[key]}</span>
            {key === "approvals" && waiting.length > 0 ? <span className="data ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[0.75rem] font-medium text-on-accent">{waiting.length}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      <div className="grid min-w-0 basis-full leading-tight lg:basis-full">
        <span className="truncate font-bold">{me.name}</span>
        <span className="text-[0.8rem] text-muted">{t.roles[me.role]}</span>
      </div>
      <div className="mr-auto">
        <LocaleSelect />
      </div>
      <ThemeToggle initial={theme} />
      <button
        type="button"
        aria-label={t.actions.signOut}
        title={t.actions.signOut}
        className="grid size-8 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-ink"
        onClick={() => void api("/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login"))}
      >
        <SignOut size={18} weight="duotone" aria-hidden />
      </button>
    </div>
  );

  return (
    <MeContext.Provider value={me}>
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 px-3 py-5">
        <div className="flex items-center justify-between pr-1 pl-3">
          <Brand />
          <NotificationBell align="left-0" />
        </div>
        {nav}
        <div className="mt-auto grid gap-3">
          <HealthIndicator />
          <div className="border-t border-line pt-3 pl-2">{account}</div>
        </div>
        </div>
      </aside>

      <header className="sticky top-0 z-10 grid gap-2 border-b border-line bg-surface px-4 pt-3 pb-2 lg:hidden">
        <div className="flex items-center gap-1">
          <div className="mr-auto">
            <Brand />
          </div>
          <HealthIndicator />
          <NotificationBell align="right-0" />
        </div>
        {nav}
      </header>

      <div className="min-w-0">
        {first && pathname !== "/approvals" ? (
          <div className="border-b border-accent bg-accent-soft px-4 py-3 lg:px-10">
            <div className="mx-auto grid max-w-[1080px] gap-2">
              <ApprovalCard approval={first} now={now} compact unknownCaller={t.unknownCaller} />
              <p className="flex flex-wrap gap-x-3 text-[0.87rem] text-muted">
                {tApprovals.bannerWaiting}
                {waiting.length > 1 ? (
                  <Link href="/approvals" className="font-bold text-accent-strong underline underline-offset-4">
                    {fill(tApprovals.bannerMore, { n: waiting.length })}
                  </Link>
                ) : null}
              </p>
            </div>
          </div>
        ) : null}
        <main className="rise mx-auto grid max-w-[1160px] gap-8 px-4 py-6 lg:px-10 lg:py-10">{children}</main>
        <div className="border-t border-line px-4 py-3 lg:hidden">{account}</div>
      </div>
    </div>
    </MeContext.Provider>
  );
}
