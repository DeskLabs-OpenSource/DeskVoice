"use client";

import { useState } from "react";
import en from "../../../i18n/en/costs";
import es from "../../../i18n/es/costs";
import { fill } from "../../../i18n/locales";
import ptBR, { type CostsDictionary } from "../../../i18n/pt-BR/costs";
import { useDict, useLocale } from "../../../i18n/provider";
import { useApi } from "../../../ui/api";
import { useErrorText } from "../../../ui/errors";
import { formatDay, formatMoney } from "../../../ui/format";
import { Badge, Notice, PageHeader, Panel, Skeleton } from "../../../ui/kit";
import type { Costs } from "../../../ui/types";
import { amountShown } from "./amount";

const PERIODS = [7, 30, 90];
const isoDay = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Barra proporcional ao maior valor da lista. Em sage: cobre é só para o que está vivo. */
function Bar({ share }: { share: number }) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-sunken">
      <span className="block h-full rounded-full bg-ok" style={{ width: `${Math.max(share * 100, 1.5)}%` }} />
    </span>
  );
}

/**
 * Um valor do extrato. Com linha de custo não medido, o zero não é grátis: sem nada medido aparece
 * só "não medido", e com parte medida o valor vem com a marca de que falta uma parte.
 */
function Amount({ cents, unmeasured, t }: { cents: number; unmeasured: boolean; t: CostsDictionary }) {
  const locale = useLocale();
  const shown = amountShown(cents, unmeasured);
  if (shown === "unmeasured") return <Badge tone="warn">{t.unmeasured}</Badge>;
  return (
    <>
      {formatMoney(cents, locale)}
      {shown === "money-and-unmeasured" ? (
        <>
          {" "}
          <Badge tone="warn">{t.unmeasuredPart}</Badge>
        </>
      ) : null}
    </>
  );
}

export default function CostsPage() {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  const errorText = useErrorText();
  const [days, setDays] = useState(30);
  const [today] = useState(() => new Date());
  const from = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)));
  const { data, error } = useApi<Costs>(`/system/costs?from=${from}&to=${isoDay(today)}`);
  const max = (values: number[]): number => Math.max(1, ...values);

  return (
    <>
      <PageHeader
        title={t.title}
        lead={t.lead}
        actions={
          <div role="group" aria-label={t.period} className="flex gap-1">
            {PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={days === option}
                onClick={() => setDays(option)}
                className={`h-8 cursor-pointer rounded-full border px-3 text-[0.87rem] transition-colors duration-[120ms] ${days === option ? "border-ink bg-ink font-bold text-bg" : "border-line-strong text-muted hover:border-muted hover:text-ink"}`}
              >
                {fill(t.lastDays, { n: option })}
              </button>
            ))}
          </div>
        }
      />
      {error && !data ? <Notice tone="fail">{errorText(error)}</Notice> : null}
      {!data && !error ? <Skeleton /> : null}

      {data ? (
        <>
          <div className="grid gap-1 border-y border-line py-5">
            <span className="text-[0.8rem] font-bold text-muted">{t.total}</span>
            <span className="data text-[2.4rem] leading-none font-medium tracking-[-0.03em]">
              <Amount cents={data.totalCents} unmeasured={data.unmeasured.calls > 0} t={t} />
            </span>
          </div>
          {data.unmeasured.calls > 0 ? <Notice tone="warn">{data.unmeasured.calls === 1 ? t.unmeasuredNoteOne : fill(t.unmeasuredNote, { n: data.unmeasured.calls })}</Notice> : null}
          <Notice>{t.estimate}</Notice>
          {data.byDay.length === 0 ? <p className="text-muted">{t.empty}</p> : null}

          {data.byDay.length > 0 ? (
            <>
              <Panel title={t.byDay}>
                <ul className="grid gap-2.5">
                  {data.byDay.map((row) => (
                    <li key={row.day} className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(5.5rem,auto)] items-center gap-4">
                      <span className="data text-muted">{formatDay(row.day, locale)}</span>
                      <Bar share={row.costCents / max(data.byDay.map((entry) => entry.costCents))} />
                      <span className="data text-right">
                        <Amount cents={row.costCents} unmeasured={data.unmeasured.days.includes(row.day)} t={t} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <div className="grid gap-6 md:grid-cols-2">
                <Panel title={t.byAgent} description={t.handoffCounts}>
                  <ul className="grid gap-4">
                    {data.byAgent.map((row) => (
                      <li key={row.agentId ?? "deleted"} className="grid gap-1.5">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-bold">{row.name ?? t.deletedAgent}</span>
                          <span className="data">
                            <Amount cents={row.costCents} unmeasured={data.unmeasured.agentIds.includes(row.agentId)} t={t} />
                          </span>
                        </span>
                        <Bar share={row.costCents / max(data.byAgent.map((entry) => entry.costCents))} />
                        <span className="text-[0.87rem] text-muted">{fill(t.calls, { n: row.calls })}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel title={t.byEngine}>
                  <ul className="grid gap-4">
                    {data.byEngine.map((row) => (
                      <li key={row.engine} className="grid gap-1.5">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-bold">{row.label}</span>
                          <span className="data">
                            <Amount cents={row.costCents} unmeasured={data.unmeasured.engines.includes(row.engine)} t={t} />
                          </span>
                        </span>
                        <Bar share={row.costCents / max(data.byEngine.map((entry) => entry.costCents))} />
                        <span className="text-[0.87rem] text-muted">
                          {fill(t.minutes, { n: Math.round(row.callSeconds / 60) })}
                          {row.priceCheckedOn ? ` · ${fill(t.priceChecked, { date: formatDay(row.priceCheckedOn, locale) })}` : ""}
                        </span>
                        {row.priceSource?.startsWith("http") ? (
                          <a href={row.priceSource} target="_blank" rel="noreferrer" className="justify-self-start text-[0.87rem] text-muted underline underline-offset-4 hover:text-ink">
                            {t.priceSource}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
