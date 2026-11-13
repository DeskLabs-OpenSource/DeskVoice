"use client";

import { CheckCircle, ListChecks, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import enCommon from "../../../i18n/en/common";
import en from "../../../i18n/en/follow-ups";
import esCommon from "../../../i18n/es/common";
import es from "../../../i18n/es/follow-ups";
import { fill } from "../../../i18n/locales";
import ptBRCommon from "../../../i18n/pt-BR/common";
import ptBR from "../../../i18n/pt-BR/follow-ups";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatPhone } from "../../../ui/format";
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Select, Skeleton, TextInput } from "../../../ui/kit";
import { useLive, useNow } from "../../../ui/live";
import type { FollowUp, FollowUpList, Person } from "../../../ui/types";

const VIEWS = ["open", "mine", "overdue", "closed"] as const;
type View = (typeof VIEWS)[number];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * As pendências que as ligações deixaram: quem cuida, até quando, e o fecho. Fechar pede uma nota
 * curta; o fecho aparece na linha do tempo da ligação de origem.
 */
export default function FollowUpsPage() {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const [view, setView] = useState<View>("open");
  const list = useApi<FollowUpList>(`/follow-ups?view=${view}`);
  const owners = useApi<Person[]>("/follow-ups/owners");
  // O fecho e a troca de dono viram eventos de chamada: a lista acompanha o que outra pessoa fez.
  useLive(list.reload);
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader title={t.title} lead={t.lead} />
      <div role="group" aria-label={t.title} className="flex flex-wrap gap-1">
        {VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
            className={`h-8 cursor-pointer rounded-full border px-3 text-[0.87rem] transition-colors duration-[120ms] ${view === option ? "border-ink bg-ink font-bold text-bg" : "border-line-strong text-muted hover:border-muted hover:text-ink"}`}
          >
            {t.views[option]}
          </button>
        ))}
      </div>
      {list.error && !list.data ? <Notice tone="fail">{errorText(list.error)}</Notice> : null}
      {list.data === undefined && !list.error ? <Skeleton /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState icon={<ListChecks size={32} weight="duotone" aria-hidden />} title={t.empty[view]}>
          <p>{t.emptyBody}</p>
        </EmptyState>
      ) : null}
      <ul className="grid gap-3">
        {items.map((item) => (
          <FollowUpItem key={item.id} item={item} people={owners.data ?? []} retentionDays={list.data?.retentionDays ?? null} onChanged={list.reload} />
        ))}
      </ul>
    </>
  );
}

function FollowUpItem({ item, people, retentionDays, onChanged }: { item: FollowUp; people: Person[]; retentionDays: number | null; onChanged(): void }) {
  const t = useDict(ptBR, en, es);
  const common = useDict(ptBRCommon, enCommon, esCommon);
  const locale = useLocale();
  const now = useNow();
  const action = useAction();
  const [closing, setClosing] = useState<"done" | "canceled" | null>(null);
  const [note, setNote] = useState("");
  const open = item.status === "open";
  const overdue = open && new Date(item.dueAt).getTime() <= now;
  const olderThanRetention = open && retentionDays !== null && now - new Date(item.createdAt).getTime() > retentionDays * DAY_MS;
  const run = (task: () => Promise<unknown>): void =>
    void action.run(task).then((ok) => {
      if (ok) setClosing(null);
      onChanged();
    });

  return (
    <li className="grid gap-3 rounded-md border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="max-w-[60ch] text-[1.07rem] leading-snug font-bold">{item.title}</h2>
        <Badge tone={!open ? "neutral" : overdue ? "fail" : "accent"}>{overdue ? t.overdue : t.status[item.status]}</Badge>
      </div>
      {item.details ? <p className="max-w-[72ch] whitespace-pre-line text-muted">{item.details}</p> : null}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[0.87rem]">
        <div className="flex gap-1.5">
          <dt className="text-muted">{t.owner}</dt>
          <dd className="font-bold">{item.ownerName ?? t.team}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">{t.due}</dt>
          <dd className="data">{formatDateTime(item.dueAt, locale)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">{t.caller}</dt>
          <dd className="data">{formatPhone(item.caller) || common.unknownCaller}</dd>
        </div>
        {item.callId ? (
          <Link href={`/calls/${item.callId}`} className="font-bold text-muted underline-offset-4 hover:text-ink hover:underline">
            {t.openCall}
          </Link>
        ) : null}
      </dl>
      {olderThanRetention ? <Notice tone="warn">{fill(t.olderThanRetention, { days: retentionDays ?? 0 })}</Notice> : null}

      {!open ? (
        <div className="grid gap-1 border-t border-line pt-3">
          <p className="text-[0.87rem] text-muted">
            {fill(t.closedBy, { status: t.status[item.status], name: item.closedByName ?? t.removedPerson, when: item.closedAt ? formatDateTime(item.closedAt, locale) : "" })}
          </p>
          {item.closingNote ? <p className="whitespace-pre-line">{item.closingNote}</p> : null}
        </div>
      ) : null}

      {open && !item.canChange ? <p className="text-[0.87rem] text-muted">{t.notYours}</p> : null}
      {open && item.canChange && closing === null ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <Field label={t.changeOwner}>
            <Select value={item.ownerUserId ?? ""} disabled={action.busy} onChange={(event) => run(() => api(`/follow-ups/${item.id}`, { method: "PATCH", body: { ownerUserId: event.target.value || null } }))}>
              <option value="">{t.team}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" icon={<CheckCircle size={18} weight="duotone" aria-hidden />} onClick={() => setClosing("done")}>
            {t.done}
          </Button>
          <Button variant="ghost" icon={<XCircle size={18} weight="duotone" aria-hidden />} onClick={() => setClosing("canceled")}>
            {t.cancel}
          </Button>
        </div>
      ) : null}
      {open && closing !== null ? (
        <form
          className="grid gap-3 border-t border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => api(`/follow-ups/${item.id}/close`, { body: { status: closing, note } }));
          }}
        >
          <Field label={closing === "done" ? t.noteDone : t.noteCancel} hint={closing === "done" ? t.noteDoneHint : t.noteCancelHint}>
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} required maxLength={500} autoFocus />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={closing === "done" ? "primary" : "danger"} busy={action.busy}>
              {closing === "done" ? t.confirmDone : t.confirmCancel}
            </Button>
            <Button variant="ghost" onClick={() => setClosing(null)}>
              {t.keepOpen}
            </Button>
          </div>
        </form>
      ) : null}
      {action.error ? <Notice tone="fail">{action.error}</Notice> : null}
    </li>
  );
}
