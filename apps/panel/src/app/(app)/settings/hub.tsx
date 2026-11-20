import { CheckCircle, Circle } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { CallsDictionary } from "../../../i18n/pt-BR/calls";
import type { SettingsDictionary } from "../../../i18n/pt-BR/settings";
import type { FirstStep } from "../../../ui/first-steps";
import { Badge, type Tone } from "../../../ui/kit";
import type { HubState } from "./hub-state";

type Hub = SettingsDictionary["hub"];
type CardKey = keyof Hub["cards"];

/** O que a central desenha, já lido. `null` no estado: o cartão fica sem `Badge`. */
export interface HubView {
  /** Os passos, ou `null` quando o cartão "Primeiros passos" não aparece (tudo feito, ou sem leitura). */
  steps: FirstStep[] | null;
  engines: HubState | null;
  whatsapp: HubState | null;
  webhooks: HubState | null;
  /** O cartão "Sistema" segue a regra da aba: some quando a atualização mora na área da instalação. */
  system: boolean;
}

const STATE_TONE: Record<HubState, Tone> = { ready: "ok", missing: "warn", off: "neutral" };

function Card({ t, card, href, state }: { t: Hub; card: CardKey; href: string; state?: HubState | null }) {
  return (
    <li>
      <Link
        href={href}
        data-card={card}
        className="grid h-full content-start gap-1.5 rounded-md border border-line bg-surface px-5 py-4 transition-shadow duration-200 hover:shadow-sm focus-visible:outline-offset-2"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[1rem] font-bold">{t.cards[card].title}</h3>
          {state ? <Badge tone={STATE_TONE[state]}>{t.state[state]}</Badge> : null}
        </span>
        <span className="text-muted">{t.cards[card].lead}</span>
      </Link>
    </li>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      {title ? <h2 className="text-[1.07rem] font-bold">{title}</h2> : null}
      <ul className="grid gap-3 sm:grid-cols-2">{children}</ul>
    </section>
  );
}

/**
 * A central de Configurações (parte 3 do desenho da central): cada cartão diz o que a área faz,
 * o estado quando há leitura barata dele, e abre a tela que já existe. Só leitura: nada se altera
 * aqui, então o operador vê o mesmo que o dono.
 */
export function SettingsHub({ view, t, steps }: { view: HubView; t: Hub; steps: CallsDictionary["empty"] }) {
  return (
    <div className="grid gap-6">
      {view.steps ? (
        <section aria-labelledby="first-steps" className="grid gap-2 rounded-md border border-accent bg-surface px-5 py-4">
          <h2 id="first-steps" className="text-[1.07rem] font-bold">
            {t.firstSteps.title}
          </h2>
          <p className="max-w-prose text-muted">{t.firstSteps.lead}</p>
          <ul className="mt-1 grid gap-1.5">
            {view.steps.map((step) => (
              <li key={step.key}>
                <Link href={step.href} className="group inline-flex items-center gap-2 text-ink">
                  {step.done ? <CheckCircle size={20} weight="duotone" className="text-ok" aria-hidden /> : <Circle size={20} className="text-line-strong" aria-hidden />}
                  <span className="underline-offset-4 group-hover:underline">{steps.steps[step.key]}</span>
                  <span className="text-[0.87rem] text-muted">{step.done ? steps.done : steps.todo}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Group title={t.groups.ai}>
        <Card t={t} card="engines" href="/settings/ai" state={view.engines} />
        <Card t={t} card="brains" href="/settings/brains" />
        <Card t={t} card="voice" href="/settings/voice" />
        <Card t={t} card="speechFilter" href="/settings/speech-filter" />
      </Group>
      <Group title={t.groups.during}>
        <Card t={t} card="analysts" href="/settings/analysts" />
        {/* Desfecho, análise e transcrição moram hoje na tela de IA; a parte 5 os separa. */}
        <Card t={t} card="outcome" href="/settings/ai" />
      </Group>
      <Group title={t.groups.channels}>
        <Card t={t} card="whatsapp" href="/settings/whatsapp" state={view.whatsapp} />
        <Card t={t} card="webhooks" href="/settings/integrations" state={view.webhooks} />
      </Group>
      <Group>
        <Card t={t} card="rules" href="/settings/calls" />
        <Card t={t} card="privacy" href="/settings/privacy" />
        {view.system ? <Card t={t} card="system" href="/settings/system" /> : null}
      </Group>
    </div>
  );
}
