"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { use, useState } from "react";
import enCommon from "../../../../i18n/en/common";
import en from "../../../../i18n/en/timeline";
import esCommon from "../../../../i18n/es/common";
import es from "../../../../i18n/es/timeline";
import { fill } from "../../../../i18n/locales";
import ptBRCommon from "../../../../i18n/pt-BR/common";
import ptBR from "../../../../i18n/pt-BR/timeline";
import { useDict, useLocale } from "../../../../i18n/provider";
import { api, useApi } from "../../../../ui/api";
import { useErrorText } from "../../../../ui/errors";
import { formatDateTime, formatDuration, formatMoney, formatPhone, secondsBetween } from "../../../../ui/format";
import { Badge, Button, Notice, Skeleton, TextInput, type Tone } from "../../../../ui/kit";
import { useLive, useNow } from "../../../../ui/live";
import { Timeline } from "../../../../ui/timeline";
import type { Call, CallEvent, CallStatus, Engine, FollowUpList } from "../../../../ui/types";

const STATUS_TONE: Record<CallStatus, Tone> = { ringing: "accent", in_progress: "accent", transferred: "ok", completed: "neutral", failed: "fail", refused: "warn" };

export default function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useDict(ptBR, en, es);
  const common = useDict(ptBRCommon, enCommon, esCommon);
  const locale = useLocale();
  const errorText = useErrorText();
  const now = useNow();
  const call = useApi<Call>(`/calls/${id}`);
  const events = useApi<CallEvent[]>(`/calls/${id}/events`);
  const engines = useApi<Engine[]>("/engines");
  const followUps = useApi<FollowUpList>(`/follow-ups?callId=${id}`);
  useLive((signal) => {
    if (signal.callId !== id) return;
    call.reload();
    events.reload();
    followUps.reload();
  });

  const back = (
    <Link href="/calls" className="inline-flex items-center gap-1.5 justify-self-start text-[0.93rem] font-bold text-muted hover:text-ink">
      <ArrowLeft size={16} weight="bold" aria-hidden />
      {t.back}
    </Link>
  );
  if (call.error && !call.data) {
    return (
      <>
        {back}
        <Notice tone="fail">{call.error.code === "not_found" ? t.notFound : errorText(call.error)}</Notice>
      </>
    );
  }
  if (!call.data) return <Skeleton lines={5} />;

  const data = call.data;
  const live = data.status === "ringing" || data.status === "in_progress";
  const seconds = secondsBetween(data.answeredAt ?? data.startedAt, data.endedAt ?? now);
  const facts: Array<[string, string, boolean]> = [
    [t.facts.agent, data.agentName ?? common.noAgent, false],
    [t.facts.engine, engines.data?.find((engine) => engine.id === data.engine)?.label ?? data.engine ?? "", false],
    [t.facts.duration, formatDuration(seconds), true],
    [t.facts.cost, formatMoney(data.costCents, locale), true],
    [t.facts.started, formatDateTime(data.startedAt, locale), true],
  ];

  return (
    <>
      <header className="grid gap-5">
        {back}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="data text-[1.75rem] leading-tight font-medium tracking-[-0.02em]">{formatPhone(data.direction === "outbound" ? data.to : data.from) || common.unknownCaller}</h1>
          <Badge tone={STATUS_TONE[data.status]} live={live}>
            {common.callStatus[data.status]}
          </Badge>
          <span className="text-muted">{t.direction[data.direction]}</span>
        </div>
        {/* Métricas em linha, separadas por fio: sem grade de cartões. */}
        <dl className="grid grid-cols-2 gap-4 border-y border-line py-4 sm:flex sm:flex-wrap">
          {facts.map(([label, value, mono]) => (
            <div key={label} className="grid min-w-[9rem] gap-0.5 border-line sm:pr-6 sm:not-last:mr-6 sm:not-last:border-r">
              <dt className="text-[0.8rem] font-bold text-muted">{label}</dt>
              <dd className={`${mono ? "data" : ""} ${live && label === t.facts.duration ? "text-accent-strong" : ""}`}>
                {value}
                {label === t.facts.cost && data.costCeilingCents ? <span className="ml-2 font-sans text-[0.8rem] text-muted">{fill(t.facts.ceiling, { value: formatMoney(data.costCeilingCents, locale) })}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {data.outcome ? (
        <section className="grid max-w-[72ch] gap-1.5">
          <h2 className="text-[0.8rem] font-bold text-muted">{t.outcomeTitle}</h2>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="rounded-full border border-line px-2 py-0.5 text-[0.8rem] font-bold">{(t.outcomes as Record<string, string>)[data.outcome] ?? t.outcomes.unknown}</span>
            {typeof data.outcomeConfidence === "string" ? (
              <span className="text-[0.8rem] text-muted">{fill(t.outcomeConfidence, { value: String(Math.round(Number(data.outcomeConfidence) * 100)) })}</span>
            ) : null}
          </p>
          {data.outcomeEvidence ? <p className="text-[0.8rem] leading-relaxed text-muted">“{data.outcomeEvidence}”</p> : null}
        </section>
      ) : null}

      {data.summary || !live ? (
        <section className="grid max-w-[72ch] gap-1.5">
          <h2 className="text-[0.8rem] font-bold text-muted">{t.summaryTitle}</h2>
          <p className={data.summary ? "text-[1.07rem] leading-relaxed whitespace-pre-line" : "text-muted"}>{data.summary ?? t.summaryPending}</p>
        </section>
      ) : null}

      {live ? (
        <StopRecording
          id={id}
          title={t.stopRecordingTitle}
          why={t.stopRecordingWhy}
          send={t.stopRecordingSend}
          done={t.stopRecordingDone}
          hint={t.stopRecordingHint}
        />
      ) : (
        <Recording id={id} title={t.recordingTitle} missing={t.recordingMissing} />
      )}

      {events.error && !events.data ? <Notice tone="fail">{errorText(events.error)}</Notice> : null}
      {events.data ? <Timeline events={events.data} live={live} agentName={data.agentName ?? ""} followUps={followUps.data?.items} people={followUps.data?.people} /> : <Skeleton lines={4} />}
    </>
  );
}

/** A gravação da chamada, quando existe. Sem arquivo (chamada antiga, ou gravação desligada), diz isso. */
function Recording({ id, title, missing }: { id: string; title: string; missing: string }) {
  const [absent, setAbsent] = useState(false);
  return (
    <section className="grid max-w-[72ch] gap-1.5">
      <h2 className="text-[0.8rem] font-bold text-muted">{title}</h2>
      {absent ? <p className="text-muted">{missing}</p> : <audio controls preload="metadata" src={`/api/v1/calls/${id}/recording`} onError={() => setAbsent(true)} className="w-full" />}
    </section>
  );
}

/**
 * Durante a chamada, quem atende pode pedir para parar a gravação — porque a pessoa na linha pediu.
 * O pedido vai para a chamada, que aplica; o trecho do pedido fica gravado, como prova.
 */
function StopRecording({ id, title, why, send, done, hint }: { id: string; title: string; why: string; send: string; done: string; hint: string }) {
  const errorText = useErrorText();
  const [reason, setReason] = useState("");
  const [estado, setEstado] = useState<"livre" | "enviando" | "feito">("livre");
  const [erro, setErro] = useState<string | null>(null);

  const pedir = (): void => {
    setEstado("enviando");
    setErro(null);
    void api(`/calls/${id}/recording/pause`, { method: "POST", body: { reason: reason.trim() || null } })
      .then(() => setEstado("feito"))
      .catch((error: unknown) => {
        setEstado("livre");
        setErro(errorText(error));
      });
  };

  return (
    <section className="grid max-w-[72ch] gap-1.5">
      <h2 className="text-[0.8rem] font-bold text-muted">{title}</h2>
      {estado === "feito" ? (
        <Notice tone="ok">{done}</Notice>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <TextInput
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={why}
            aria-label={why}
            className="min-w-[16rem] flex-1"
          />
          <Button variant="secondary" busy={estado === "enviando"} onClick={pedir}>
            {send}
          </Button>
        </div>
      )}
      {erro ? <Notice tone="fail">{erro}</Notice> : null}
      <p className="text-[0.85rem] text-muted">{hint}</p>
    </section>
  );
}
