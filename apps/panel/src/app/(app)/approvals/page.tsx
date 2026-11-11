"use client";

import { SealCheck } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect } from "react";
import en from "../../../i18n/en/approvals";
import enCommon from "../../../i18n/en/common";
import es from "../../../i18n/es/approvals";
import esCommon from "../../../i18n/es/common";
import { fill } from "../../../i18n/locales";
import ptBR from "../../../i18n/pt-BR/approvals";
import ptBRCommon from "../../../i18n/pt-BR/common";
import { useDict, useLocale } from "../../../i18n/provider";
import { useApi } from "../../../ui/api";
import { APPROVALS_CHANGED, ApprovalCard, isWaiting } from "../../../ui/approval";
import { useErrorText } from "../../../ui/errors";
import { formatDateTime } from "../../../ui/format";
import { Badge, EmptyState, Notice, PageHeader, Skeleton, type Tone } from "../../../ui/kit";
import { useLive, useNow } from "../../../ui/live";
import type { Approval } from "../../../ui/types";

const TONE: Record<Approval["status"], Tone> = { pending: "accent", approved: "ok", denied: "fail", expired: "neutral" };

export default function ApprovalsPage() {
  const t = useDict(ptBR, en, es);
  const common = useDict(ptBRCommon, enCommon, esCommon);
  const locale = useLocale();
  const errorText = useErrorText();
  const now = useNow();
  const { data, error, reload } = useApi<Approval[]>("/approvals");
  useLive(reload);
  useEffect(() => {
    window.addEventListener(APPROVALS_CHANGED, reload);
    return () => window.removeEventListener(APPROVALS_CHANGED, reload);
  }, [reload]);

  const waiting = (data ?? []).filter((approval) => isWaiting(approval, now)).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const history = (data ?? []).filter((approval) => !isWaiting(approval, now));

  return (
    <>
      <PageHeader title={t.title} lead={t.lead} />
      {error && !data ? <Notice tone="fail">{errorText(error)}</Notice> : null}
      {!data && !error ? <Skeleton /> : null}

      {data && waiting.length === 0 ? (
        <EmptyState icon={<SealCheck size={32} weight="duotone" aria-hidden />} title={t.emptyTitle}>
          <p>{t.emptyBody}</p>
        </EmptyState>
      ) : null}
      {waiting.length > 0 ? (
        <section className="grid gap-4">
          {waiting.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} now={now} unknownCaller={common.unknownCaller} />
          ))}
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-[1.07rem] font-bold">{t.historyTitle}</h2>
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            {history.map((approval) => {
              // Pendente com prazo vencido: a rotina ainda não marcou, mas para quem lê já expirou.
              const status = approval.status === "pending" ? "expired" : approval.status;
              return (
                <Link key={approval.id} href={`/calls/${approval.callId}`} className="grid gap-x-4 gap-y-1 border-b border-line px-5 py-3 transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                  <span className="truncate">{approval.question}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={TONE[status]}>{t.status[status]}</Badge>
                    {approval.decidedByName ? <span className="text-[0.87rem] text-muted">{fill(t.decidedBy, { name: approval.decidedByName })}</span> : null}
                  </span>
                  <span className="data text-muted">{formatDateTime(approval.decidedAt ?? approval.expiresAt, locale)}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
