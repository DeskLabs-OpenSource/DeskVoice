"use client";

import { ArrowRight, CheckCircle, Circle, Microphone, PhoneCall, Play } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import en from "../../../i18n/en/calls";
import enCommon from "../../../i18n/en/common";
import es from "../../../i18n/es/calls";
import esCommon from "../../../i18n/es/common";
import ptBR from "../../../i18n/pt-BR/calls";
import ptBRCommon from "../../../i18n/pt-BR/common";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { useErrorText } from "../../../ui/errors";
import { formatDateTime, formatDuration, formatMoney, formatPhone, secondsBetween } from "../../../ui/format";
import { Badge, Button, EmptyState, Notice, PageHeader, Skeleton, buttonClass, type Tone } from "../../../ui/kit";
import { useLive, useNow } from "../../../ui/live";
import type { Agent, Call, CallStatus, Engine, Trunk } from "../../../ui/types";

const STATUS_TONE: Record<CallStatus, Tone> = { ringing: "accent", in_progress: "accent", transferred: "ok", completed: "neutral", failed: "fail", refused: "warn" };
const isLive = (call: Call): boolean => call.status === "ringing" || call.status === "in_progress";
const ENDED: CallStatus[] = ["completed", "transferred", "failed", "refused"];

export default function CallsPage() {
  const t = useDict(ptBR, en, es);
  const common = useDict(ptBRCommon, enCommon, esCommon);
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const now = useNow();
  const calls = useApi<Call[]>("/calls");
  const agents = useApi<Agent[]>("/agents");
  const trunks = useApi<Trunk[]>("/trunks");
  const engines = useApi<Engine[]>("/engines");
  useLive(calls.reload);
  const [filter, setFilter] = useState<CallStatus | "all">("all");
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");

  const simulate = async (): Promise<void> => {
    setSimulating(true);
    setError("");
    try {
      // A simulação precisa de um agente no motor simulado; sem nenhum, cria o de demonstração.
      const agent =
        agents.data?.find((candidate) => candidate.engine === "simulated" && candidate.enabled) ??
        (await api<Agent>("/agents", { body: { name: t.demoAgent.name, roleLabel: t.demoAgent.role, greeting: t.demoAgent.greeting, instructions: t.demoAgent.instructions, engine: "simulated" } }));
      const { callId } = await api<{ callId: string }>("/calls/simulate", { body: { agentId: agent.id } });
      router.push(`/calls/${callId}`);
    } catch (failure) {
      setError(errorText(failure));
      setSimulating(false);
    }
  };
  const simulateButton = (variant: "primary" | "secondary") => (
    <Button variant={variant} busy={simulating} icon={<Play size={18} weight="duotone" aria-hidden />} onClick={() => void simulate()}>
      {t.simulate}
    </Button>
  );

  const all = calls.data ?? [];
  const live = all.filter(isLive);
  const history = all.filter((call) => !isLive(call) && (filter === "all" || call.status === filter));
  const empty = calls.data !== undefined && all.length === 0;
  const steps = [
    { label: t.empty.steps.agent, href: "/agents", done: (agents.data?.length ?? 0) > 0 },
    { label: t.empty.steps.line, href: "/line", done: (trunks.data?.length ?? 0) > 0 },
    { label: t.empty.steps.engine, href: "/settings", done: engines.data?.some((engine) => engine.requiresKey && engine.keyConfigured) ?? false },
  ];

  return (
    <>
      <PageHeader
        title={t.title}
        lead={t.lead}
        actions={
          <>
            <Link href="/calls/talk" className={buttonClass("primary")}>
              <Microphone size={18} weight="duotone" aria-hidden />
              {t.talk}
            </Link>
            {empty ? null : simulateButton("secondary")}
          </>
        }
      />
      {error ? <Notice tone="fail">{error}</Notice> : null}
      {calls.error && !calls.data ? <Notice tone="fail">{errorText(calls.error)}</Notice> : null}
      {calls.data === undefined && !calls.error ? <Skeleton /> : null}

      {empty ? (
        <EmptyState icon={<PhoneCall size={32} weight="duotone" aria-hidden />} title={t.empty.title} action={simulateButton("secondary")}>
          <p>{t.empty.body}</p>
          <ul className="mt-1 grid gap-1.5">
            {steps.map((step) => (
              <li key={step.href}>
                <Link href={step.href} className="group inline-flex items-center gap-2 text-ink">
                  {step.done ? <CheckCircle size={20} weight="duotone" className="text-ok" aria-hidden /> : <Circle size={20} className="text-line-strong" aria-hidden />}
                  <span className="underline-offset-4 group-hover:underline">{step.label}</span>
                  <span className="text-[0.87rem] text-muted">{step.done ? t.empty.done : t.empty.todo}</span>
                </Link>
              </li>
            ))}
          </ul>
        </EmptyState>
      ) : null}

      {calls.data && !empty ? (
        <>
          <section className="grid gap-3">
            <h2 className="flex items-center gap-2.5 text-[1.07rem] font-bold">
              {t.liveTitle}
              {live.length > 0 ? <span className="data text-accent-strong">{live.length}</span> : null}
            </h2>
            {live.length === 0 ? <p className="text-muted">{t.liveNone}</p> : null}
            {live.map((call) => (
              <Link
                key={call.id}
                href={`/calls/${call.id}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-md border border-accent bg-surface px-5 py-4 transition-shadow duration-200 hover:shadow-sm"
              >
                <span className="live-dot" aria-hidden />
                <div className="grid min-w-0 gap-0.5">
                  <span className="data truncate text-[1.2rem] font-medium">{formatPhone(call.from) || common.unknownCaller}</span>
                  <span className="truncate text-muted">
                    {call.agentName ?? common.noAgent} · {common.callStatus[call.status]}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="data text-[1.2rem] text-accent-strong">{formatDuration(secondsBetween(call.answeredAt ?? call.startedAt, now))}</span>
                  <span className="hidden items-center gap-1.5 font-bold sm:inline-flex">
                    {t.follow}
                    <ArrowRight size={16} weight="bold" aria-hidden />
                  </span>
                </div>
              </Link>
            ))}
          </section>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[1.07rem] font-bold">{t.historyTitle}</h2>
              <div role="group" aria-label={t.filterLabel} className="flex flex-wrap gap-1">
                {(["all", ...ENDED] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={filter === option}
                    onClick={() => setFilter(option)}
                    className={`h-8 cursor-pointer rounded-full border px-3 text-[0.87rem] transition-colors duration-[120ms] ${filter === option ? "border-ink bg-ink font-bold text-bg" : "border-line-strong text-muted hover:border-muted hover:text-ink"}`}
                  >
                    {option === "all" ? t.filterAll : common.callStatus[option]}
                  </button>
                ))}
              </div>
            </div>
            {history.length === 0 ? (
              <p className="text-muted">{t.emptyFilter}</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-line bg-surface">
                <div className="hidden grid-cols-[1.4fr_1.2fr_1fr_1fr_0.7fr_0.7fr] gap-4 border-b border-line px-5 py-2.5 text-[0.8rem] font-bold text-muted md:grid">
                  <span>{t.columns.caller}</span>
                  <span>{t.columns.agent}</span>
                  <span>{t.columns.status}</span>
                  <span>{t.columns.started}</span>
                  <span className="text-right">{t.columns.duration}</span>
                  <span className="text-right">{t.columns.cost}</span>
                </div>
                {history.map((call) => (
                  <Link
                    key={call.id}
                    href={`/calls/${call.id}`}
                    className="grid grid-cols-2 items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken md:grid-cols-[1.4fr_1.2fr_1fr_1fr_0.7fr_0.7fr]"
                  >
                    <span className="data truncate">{formatPhone(call.direction === "outbound" ? call.to : call.from) || common.unknownCaller}</span>
                    <span className="truncate text-right text-muted md:text-left">{call.agentName ?? common.noAgent}</span>
                    <span>
                      <Badge tone={STATUS_TONE[call.status]}>{common.callStatus[call.status]}</Badge>
                    </span>
                    <span className="data text-right text-muted md:text-left">{formatDateTime(call.startedAt, locale)}</span>
                    <span className="data text-muted md:text-right md:text-ink">{call.endedAt ? formatDuration(secondsBetween(call.answeredAt ?? call.startedAt, call.endedAt)) : ""}</span>
                    <span className="data text-right">{formatMoney(call.costCents, locale)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
