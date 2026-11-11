"use client";

import { Check, HandPalm, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import en from "../i18n/en/approvals";
import es from "../i18n/es/approvals";
import ptBR from "../i18n/pt-BR/approvals";
import { useDict } from "../i18n/provider";
import { api } from "./api";
import { useErrorText } from "./errors";
import { formatDuration, formatPhone, secondsBetween } from "./format";
import { Button } from "./kit";
import type { Approval } from "./types";

/** Avisa os outros blocos da tela (faixa, contador do menu) de que um pedido foi respondido. */
export const APPROVALS_CHANGED = "deskvoice:approvals-changed";

export const isWaiting = (approval: Approval, now: number): boolean => approval.status === "pending" && new Date(approval.expiresAt).getTime() > now;

export function contextText(context: Record<string, unknown>): string {
  return typeof context.text === "string" ? context.text : "";
}

/**
 * Um pedido esperando resposta. É o único bloco do painel inteiro em cobre: há uma pessoa na
 * linha. `compact` é a versão da faixa que aparece no topo de qualquer tela.
 */
export function ApprovalCard({ approval, now, compact = false, unknownCaller }: { approval: Approval; now: number; compact?: boolean; unknownCaller: string }) {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState("");
  const left = Math.max(0, secondsBetween(new Date(now).toISOString(), approval.expiresAt));

  const decide = async (decision: "approved" | "denied"): Promise<void> => {
    setBusy(decision);
    setError("");
    try {
      await api(`/approvals/${approval.id}/decide`, { body: { decision } });
    } catch (failure) {
      setError(errorText(failure));
    }
    setBusy(null);
    window.dispatchEvent(new Event(APPROVALS_CHANGED));
  };

  return (
    <article className={compact ? "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" : "grid gap-4 rounded-md border border-accent bg-surface p-5"}>
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.87rem] text-accent-strong">
          <span className="live-dot" aria-hidden />
          <span className="font-bold">{t.timeLeft}</span>
          <span className="data -ml-1.5 font-bold">
            {formatDuration(left)}
          </span>
          <span className="text-muted">
            {t.onTheLine}: <span className="data text-ink">{formatPhone(approval.from) || unknownCaller}</span>
          </span>
          {approval.agentName ? (
            <span className="text-muted">
              {t.agent}: <span className="text-ink">{approval.agentName}</span>
            </span>
          ) : null}
        </div>
        <p className={`font-bold ${compact ? "text-[1rem]" : "text-[1.2rem] leading-snug"}`}>{approval.question}</p>
        {!compact && contextText(approval.context) ? <p className="max-w-[70ch] whitespace-pre-line text-muted">{contextText(approval.context)}</p> : null}
        {!compact ? (
          <p className="flex items-start gap-2 text-[0.87rem] text-muted">
            <HandPalm size={18} weight="duotone" className="mt-0.5 shrink-0" aria-hidden />
            {t.ifNoAnswer[approval.defaultOnTimeout]}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-fail">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" busy={busy === "approved"} disabled={busy !== null} icon={<Check size={18} weight="bold" aria-hidden />} onClick={() => void decide("approved")}>
          {t.approve}
        </Button>
        <Button busy={busy === "denied"} disabled={busy !== null} icon={<X size={18} weight="bold" aria-hidden />} onClick={() => void decide("denied")}>
          {t.deny}
        </Button>
        {!compact ? (
          <Link href={`/calls/${approval.callId}`} className="ml-auto text-[0.93rem] font-bold text-muted underline-offset-4 hover:text-ink hover:underline">
            {t.openCall}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
