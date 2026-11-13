"use client";

import { PhoneOutgoing, ShieldCheck, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import commonEn from "../../../i18n/en/common";
import en from "../../../i18n/en/outbound";
import commonEs from "../../../i18n/es/common";
import es from "../../../i18n/es/outbound";
import { fill } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import ptBR from "../../../i18n/pt-BR/outbound";
import { useDict } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus, ReadOnlyNotice, useAction, useErrorText } from "../../../ui/errors";
import { formatPhone } from "../../../ui/format";
import { Button, Field, Notice, PageHeader, Panel, Skeleton, TextArea, TextInput } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { OutboundPolicy } from "../../../ui/types";

interface Blocked {
  e164: string;
  reason: string | null;
}

export default function OutboundPage() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const policy = useApi<OutboundPolicy>("/outbound-policy");
  const blocked = useApi<Blocked[]>("/do-not-call");
  const [draft, setDraft] = useState<OutboundPolicy | null>(null);
  const [paste, setPaste] = useState({ numbers: "", reason: "" });
  const toggle = useAction();
  const limits = useAction();
  const add = useAction();
  const remove = useAction();
  // O número cuja remoção espera confirmação: o botão da linha só abre o pedido, nunca remove.
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    if (policy.data) setDraft(policy.data);
  }, [policy.data]);

  if (policy.error && !policy.data) return <Notice tone="fail">{errorText(policy.error)}</Notice>;
  if (!draft || !policy.data) return <Skeleton lines={4} />;
  const enabled = policy.data.enabled;
  const set = <K extends keyof OutboundPolicy>(key: K, value: OutboundPolicy[K]): void => setDraft({ ...draft, [key]: value });
  const put = (body: Partial<OutboundPolicy>) => async (): Promise<void> => {
    await api("/outbound-policy", { method: "PUT", body });
    policy.reload();
  };

  return (
    <>
      <PageHeader title={t.title} lead={t.lead} />
      <ReadOnlyNotice />

      <Panel title={enabled ? t.onTitle : t.offTitle} tone={enabled ? "accent" : undefined}>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void toggle.run(put({ enabled: true, purpose: draft.purpose, legalBasis: draft.legalBasis }));
          }}
        >
          <div className="grid max-w-[72ch] gap-3 text-muted">
            <p className="flex items-start gap-3">
              <ShieldCheck size={22} weight="duotone" className="mt-0.5 shrink-0" aria-hidden />
              {t.why}
            </p>
            <p className="pl-[34px]">{t.noMass}</p>
          </div>
          <fieldset disabled={!canConfigure} className="grid gap-4 md:grid-cols-2">
            <Field label={t.purpose} hint={t.purposeHint}>
              <TextArea value={draft.purpose ?? ""} onChange={(event) => set("purpose", event.target.value)} rows={3} required />
            </Field>
            <Field label={t.legalBasis} hint={t.legalBasisHint}>
              <TextArea value={draft.legalBasis ?? ""} onChange={(event) => set("legalBasis", event.target.value)} rows={3} required />
            </Field>
          </fieldset>
          {canConfigure ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant={enabled ? "secondary" : "primary"} busy={toggle.busy} icon={enabled ? null : <PhoneOutgoing size={18} weight="duotone" aria-hidden />}>
                {enabled ? t.saveDeclaration : t.turnOn}
              </Button>
              {enabled ? (
                <Button variant="ghost" onClick={() => void toggle.run(put({ enabled: false }))}>
                  {t.turnOff}
                </Button>
              ) : null}
              <ActionStatus action={toggle} />
            </div>
          ) : null}
        </form>
      </Panel>

      {enabled ? (
        <Panel title={t.limitsTitle} description={t.limitsLead}>
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              const { dailyCapPerLine, windowStart, windowEnd, maxAttemptsPerContact, timezone } = draft;
              void limits.run(put({ dailyCapPerLine, windowStart, windowEnd, maxAttemptsPerContact, timezone }));
            }}
          >
            <fieldset disabled={!canConfigure} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label={t.dailyCap}>
                <TextInput mono type="number" min={1} max={2000} value={draft.dailyCapPerLine} onChange={(event) => set("dailyCapPerLine", Number(event.target.value))} required />
              </Field>
              <Field label={t.attempts}>
                <TextInput mono type="number" min={1} max={10} value={draft.maxAttemptsPerContact} onChange={(event) => set("maxAttemptsPerContact", Number(event.target.value))} required />
              </Field>
              <Field label={t.windowStart}>
                <TextInput mono type="time" value={draft.windowStart} onChange={(event) => set("windowStart", event.target.value)} required />
              </Field>
              <Field label={t.windowEnd}>
                <TextInput mono type="time" value={draft.windowEnd} onChange={(event) => set("windowEnd", event.target.value)} required />
              </Field>
              <Field label={t.timezone}>
                <TextInput mono value={draft.timezone} onChange={(event) => set("timezone", event.target.value)} required />
              </Field>
            </fieldset>
            {canConfigure ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" busy={limits.busy}>
                  {t.saveLimits}
                </Button>
                <ActionStatus action={limits} />
              </div>
            ) : null}
          </form>
        </Panel>
      ) : null}

      <Panel title={t.dncTitle} description={t.dncLead}>
        <div className="grid gap-5">
          {canConfigure ? (
            <form
              className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
              onSubmit={(event) => {
                event.preventDefault();
                const numbers = paste.numbers.split(/[\n,;]+/).map((entry) => entry.trim()).filter(Boolean);
                void add.run(() => api("/do-not-call", { body: { numbers, reason: paste.reason } })).then((ok) => {
                  if (ok) setPaste({ numbers: "", reason: "" });
                  blocked.reload();
                });
              }}
            >
              <Field label={t.dncNumbers} hint={t.dncNumbersHint}>
                <TextArea className="data" rows={3} value={paste.numbers} onChange={(event) => setPaste({ ...paste, numbers: event.target.value })} required />
              </Field>
              <div className="grid content-start gap-4">
                <Field label={t.dncReason}>
                  <TextInput value={paste.reason} onChange={(event) => setPaste({ ...paste, reason: event.target.value })} maxLength={200} />
                </Field>
                <Button type="submit" busy={add.busy} className="justify-self-start">
                  {t.dncAdd}
                </Button>
              </div>
            </form>
          ) : null}
          {add.error ? <Notice tone="fail">{add.error}</Notice> : null}
          {remove.error ? <Notice tone="fail">{remove.error}</Notice> : null}

          {blocked.data?.length === 0 ? (
            <div className="grid gap-1 text-muted">
              <p>{t.dncEmpty}</p>
              {/* Sem permissão de configurar não há campo para colar: o próximo passo não é dele. */}
              {canConfigure ? <p>{t.dncEmptyNext}</p> : null}
            </div>
          ) : null}
          {blocked.data?.length ? (
            <div className="grid gap-2">
              <p className="text-[0.87rem] font-bold text-muted">{fill(t.dncCount, { n: blocked.data.length })}</p>
              <ul className="grid gap-x-8 sm:grid-cols-2">
                {blocked.data.map((entry) => {
                  const pretty = formatPhone(entry.e164);
                  return (
                    <li key={entry.e164} className="grid gap-2 border-b border-line py-2">
                      <div className="flex items-center gap-3">
                        <span className="data">{pretty}</span>
                        <span className="mr-auto truncate text-[0.87rem] text-muted">{entry.reason}</span>
                        {canConfigure ? (
                          <button
                            type="button"
                            aria-label={fill(t.dncRemove, { number: pretty })}
                            className="grid size-8 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-fail"
                            onClick={() => setRemoving(removing === entry.e164 ? null : entry.e164)}
                          >
                            <X size={16} weight="bold" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                      {canConfigure && removing === entry.e164 ? (
                        <Notice tone="fail">
                          <p>{fill(t.dncRemoveConfirm, { number: pretty })}</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <Button
                              variant="danger"
                              busy={remove.busy}
                              onClick={() =>
                                void remove.run(() => api("/do-not-call", { method: "DELETE", body: { number: entry.e164 } })).then((ok) => {
                                  if (ok) setRemoving(null);
                                  blocked.reload();
                                })
                              }
                            >
                              {fill(t.dncRemoveYes, { number: pretty })}
                            </Button>
                            <Button variant="ghost" onClick={() => setRemoving(null)}>
                              {common.actions.cancel}
                            </Button>
                          </div>
                        </Notice>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </Panel>
    </>
  );
}
