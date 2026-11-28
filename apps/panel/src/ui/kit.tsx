"use client";

import { CheckCircle, CircleNotch, Info, Warning, WarningOctagon } from "@phosphor-icons/react";
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "fail";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-strong",
  secondary: "bg-surface text-ink border border-line-strong hover:border-muted",
  ghost: "text-muted hover:text-ink hover:bg-sunken",
  danger: "bg-surface text-fail border border-fail hover:bg-fail-soft",
};

export const buttonClass = (variant: Variant = "secondary", extra = ""): string =>
  `inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xs px-4 text-[0.93rem] font-bold whitespace-nowrap transition-colors duration-[120ms] ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-55 ${VARIANTS[variant]} ${extra}`;

export function Button({
  variant,
  busy = false,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; icon?: ReactNode }) {
  // Ocupado desabilita: clique duplo não manda dois pedidos.
  return (
    <button type="button" {...rest} disabled={busy || rest.disabled} className={buttonClass(variant, className)}>
      {busy ? <CircleNotch size={18} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="grid content-start gap-1.5">
      <span className="text-[0.87rem] font-bold">{label}</span>
      {children}
      {hint ? <span className="text-[0.87rem] text-muted">{hint}</span> : null}
      {error ? (
        <span role="alert" className="text-[0.87rem] text-fail">
          {error}
        </span>
      ) : null}
    </label>
  );
}

const CONTROL =
  "w-full rounded-xs border border-line-strong bg-surface px-3 text-ink transition-colors duration-[120ms] ease-out placeholder:text-muted/70 hover:border-muted focus:border-accent disabled:bg-sunken disabled:text-muted";

export function TextInput({ mono, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input {...rest} className={`${CONTROL} h-10 ${mono ? "data" : ""} ${className}`} />;
}

export function TextArea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${CONTROL} min-h-24 py-2 leading-relaxed ${className}`} />;
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${CONTROL} h-10 ${className}`}>
      {children}
    </select>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange(next: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-3 text-left disabled:pointer-events-none disabled:opacity-55"
    >
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-accent" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform duration-200 ease-out ${checked ? "translate-x-5" : ""}`} />
      </span>
      <span className="font-bold">{label}</span>
    </button>
  );
}

const BADGE: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-soft text-accent-strong",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  fail: "bg-fail-soft text-fail",
};

export function Badge({ tone = "neutral", live = false, children }: { tone?: Tone; live?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 items-center gap-2 rounded-full px-2.5 text-[0.8rem] font-bold whitespace-nowrap ${BADGE[tone]}`}>
      {live ? <span className="live-dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Panel({ title, description, actions, children, tone }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; tone?: "accent" }) {
  return (
    <section className={`rounded-md border bg-surface ${tone === "accent" ? "border-accent" : "border-line"}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="grid max-w-[62ch] gap-1">
            <h2 className="text-[1.07rem] leading-snug font-bold">{title}</h2>
            {description ? <p className="text-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid max-w-[64ch] gap-1">
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{title}</h1>
        {lead ? <p className="text-muted">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

const NOTICE: Record<Exclude<Tone, "accent">, { box: string; icon: ReactNode }> = {
  neutral: { box: "border-line bg-sunken text-ink", icon: <Info size={20} weight="duotone" aria-hidden /> },
  ok: { box: "border-ok/40 bg-ok-soft text-ink", icon: <CheckCircle size={20} weight="duotone" className="text-ok" aria-hidden /> },
  warn: { box: "border-warn/40 bg-warn-soft text-ink", icon: <Warning size={20} weight="duotone" className="text-warn" aria-hidden /> },
  fail: { box: "border-fail/40 bg-fail-soft text-ink", icon: <WarningOctagon size={20} weight="duotone" className="text-fail" aria-hidden /> },
};

export function Notice({ tone = "neutral", children }: { tone?: Exclude<Tone, "accent">; children: ReactNode }) {
  return (
    <div role={tone === "fail" ? "alert" : "status"} className={`flex items-start gap-3 rounded-sm border px-4 py-3 ${NOTICE[tone].box}`}>
      <span className="mt-0.5 shrink-0">{NOTICE[tone].icon}</span>
      <div className="grid min-w-0 gap-1">{children}</div>
    </div>
  );
}

/** Estado vazio que ensina: o que está acontecendo, por quê, e o próximo passo. */
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-md border border-dashed border-line-strong px-6 py-8">
      <span className="text-muted">{icon}</span>
      <h2 className="text-[1.07rem] font-bold">{title}</h2>
      {children ? <div className="grid max-w-[60ch] gap-2 text-muted">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** Bloco de espera: mantém a altura da tela enquanto os dados chegam. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="grid gap-3" aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-sm bg-sunken" />
      ))}
    </div>
  );
}

/** A aba que uma tecla escolhe, pelo padrão de abas da ARIA (ativação automática); `null` quando a tecla não é das abas. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export const tabDomId = (base: string, id: string): string => `${base}-tab-${id}`;
export const tabPanelDomId = (base: string, id: string): string => `${base}-panel-${id}`;

/**
 * A lista de abas (desenho 2026-11-26, seção 4.3). Só a aba ativa entra no Tab; as setas, Home e End
 * trocam de aba. A ativa é marcada por um traço na cor do texto, nunca em cobre. Em tela estreita, a
 * lista rola na horizontal, e a ativa rola para a vista.
 */
export function Tabs({ label, base, items, active, onSelect }: { label: string; base: string; items: readonly { id: string; label: string }[]; active: string; onSelect(id: string): void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <div className="min-w-0 border-b border-line">
      <div ref={list} role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto">
        {items.map((item, index) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={tabDomId(base, item.id)}
              aria-selected={selected}
              aria-controls={tabPanelDomId(base, item.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                const next = tabKeyTarget(event.key, index, items.length);
                const target = next === null ? undefined : items[next];
                if (!target) return;
                event.preventDefault();
                onSelect(target.id);
                document.getElementById(tabDomId(base, target.id))?.focus();
              }}
              className="-mb-px shrink-0 cursor-pointer border-b-2 border-transparent px-3 py-2.5 whitespace-nowrap text-muted transition-colors duration-[120ms] ease-out hover:text-ink focus-visible:-outline-offset-2 aria-selected:border-ink aria-selected:font-bold aria-selected:text-ink"
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** O painel de uma aba. Fechado, ele continua montado (com `hidden`, sem a classe de grade que o mostraria): o que está nele não se perde. */
export function TabPanel({ base, id, active, children }: { base: string; id: string; active: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={tabPanelDomId(base, id)} aria-labelledby={tabDomId(base, id)} data-tab={id} tabIndex={0} hidden={!active} className={active ? "grid gap-6" : undefined}>
      {children}
    </div>
  );
}
