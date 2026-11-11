"use client";

import { ArrowLeft, ArrowRight, CheckCircle, Headphones, Microphone, MicrophoneSlash, Phone, PhoneDisconnect, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MicError, openMicrophone, startVoiceCall, type VoiceCall } from "../../../../audio/call";
import { voiceSocketUrl, type VoiceSocketTarget } from "../../../../audio/ws-url";
import enCommon from "../../../../i18n/en/common";
import en from "../../../../i18n/en/talk";
import esCommon from "../../../../i18n/es/common";
import es from "../../../../i18n/es/talk";
import ptBRCommon from "../../../../i18n/pt-BR/common";
import ptBR from "../../../../i18n/pt-BR/talk";
import { useDict, useLocale } from "../../../../i18n/provider";
import { ApiFailure, api, useApi } from "../../../../ui/api";
import { formatDuration, formatMoney } from "../../../../ui/format";
import { Badge, Button, EmptyState, Field, Notice, Panel, Select, Skeleton, buttonClass, type Tone } from "../../../../ui/kit";
import { useLive, useNow } from "../../../../ui/live";
import { Timeline } from "../../../../ui/timeline";
import type { Agent, Call, CallEvent, CallStatus, Engine } from "../../../../ui/types";

type Phase = "idle" | "starting" | "live" | "ended";
const LAST_AGENT = "dv_talk_agent";
const STATUS_TONE: Record<CallStatus, Tone> = { ringing: "accent", in_progress: "accent", transferred: "ok", completed: "neutral", failed: "fail", refused: "warn" };

/** Uma linha do preparo: o que está certo, ou o que falta e onde consertar. */
function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5">
      {ok ? <CheckCircle size={20} weight="duotone" className="mt-0.5 text-ok" aria-hidden /> : <Warning size={20} weight="duotone" className="mt-0.5 text-warn" aria-hidden />}
      <div className={ok ? "text-muted" : ""}>{children}</div>
    </li>
  );
}

const FixLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="font-bold underline underline-offset-4">
    {children}
  </Link>
);

export default function TalkPage() {
  const t = useDict(ptBR, en, es);
  const common = useDict(ptBRCommon, enCommon, esCommon);
  const locale = useLocale();
  const now = useNow();
  const agents = useApi<Agent[]>("/agents");
  const engines = useApi<Engine[]>("/engines");

  const [phase, setPhase] = useState<Phase>("idle");
  const [agentId, setAgentId] = useState("");
  const [callId, setCallId] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [muted, setMuted] = useState(false);
  const [meter, setMeter] = useState({ micLevel: 0, agentSpeaking: false });
  const [span, setSpan] = useState<{ from: number; to: number | null } | null>(null);
  const [secure, setSecure] = useState(true);
  const voice = useRef<VoiceCall | null>(null);
  const answered = useRef(false);

  const call = useApi<Call>(callId ? `/calls/${callId}` : null);
  const events = useApi<CallEvent[]>(callId ? `/calls/${callId}/events` : null);
  useLive((signal) => {
    if (signal.callId !== callId) return;
    call.reload();
    events.reload();
  });

  const enabled = (agents.data ?? []).filter((candidate) => candidate.enabled);
  const agent = enabled.find((candidate) => candidate.id === agentId) ?? enabled[0];
  const engine = engines.data?.find((candidate) => candidate.id === agent?.engine);
  const blocked = !agent || !engine || !secure || !engine.requiresKey || !engine.keyConfigured;

  useEffect(() => {
    setSecure(window.isSecureContext);
    setAgentId(window.localStorage.getItem(LAST_AGENT) ?? "");
    // Sair da tela desliga: ninguém deixa um agente falando sozinho.
    return () => voice.current?.dispose();
  }, []);

  const start = async (): Promise<void> => {
    if (!agent) return;
    setPhase("starting");
    setProblem("");
    setMuted(false);
    setSpan(null);
    setCallId(null);
    answered.current = false;
    window.localStorage.setItem(LAST_AGENT, agent.id);
    let stream: MediaStream | undefined;
    try {
      // Microfone primeiro: sem ele não vale a pena abrir uma chamada no agente.
      stream = await openMicrophone();
      const invite = await api<{ callId: string; token: string; ws: VoiceSocketTarget }>("/calls/web", { body: { agentId: agent.id } });
      setCallId(invite.callId);
      voice.current = await startVoiceCall(stream, voiceSocketUrl(window.location, invite.ws, invite.token), {
        onReady: () => {
          answered.current = true;
          setSpan({ from: Date.now(), to: null });
          setPhase("live");
        },
        onMeter: setMeter,
        onEnded: (end) => {
          voice.current = null;
          // Cair antes de a conversa começar não é a internet de quem ligou: o painel abriu e o
          // serviço de voz não foi alcançado no mesmo endereço. Depois de começar, é conexão.
          if ("problem" in end) setProblem(end.problem === "connection_lost" && !answered.current ? "voice_unreachable" : end.problem);
          setSpan((current) => (current ? { ...current, to: Date.now() } : current));
          // Caiu antes de o agente atender: não houve chamada para resumir, volta ao começo com o motivo.
          setPhase(answered.current ? "ended" : "idle");
          call.reload();
          events.reload();
        },
      });
    } catch (failure) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      setProblem(failure instanceof MicError ? failure.problem : failure instanceof ApiFailure ? failure.code : "unavailable");
      setPhase("idle");
    }
  };

  const problemText = problem ? (Object.hasOwn(t.errors, problem) ? t.errors[problem as keyof typeof t.errors] : common.errors.fallback) : "";
  const problemFix =
    problem === "engine_not_configured" ? (
      <FixLink href="/settings">{t.fix.settings}</FixLink>
    ) : (problem === "engine_simulated" || problem === "agent_disabled") && agent ? (
      <FixLink href={`/agents/${agent.id}`}>{t.fix.agent}</FixLink>
    ) : problem === "agent_not_found" ? (
      <FixLink href="/agents">{t.fix.agents}</FixLink>
    ) : null;
  const notice = problemText ? (
    <Notice tone="fail">
      <p>{problemText}</p>
      {problemFix}
    </Notice>
  ) : null;

  const seconds = span ? ((span.to ?? now) - span.from) / 1000 : 0;
  const stateLabel = phase === "starting" ? t.state.connecting : muted ? t.state.muted : meter.agentSpeaking ? t.state.agentSpeaking : t.state.listening;
  const conversation = callId ? (
    <section className="grid gap-4">
      <h2 className="text-[1.07rem] font-bold">{t.transcript}</h2>
      {events.data?.length === 0 && phase !== "ended" ? <p className="text-muted">{t.transcriptWaiting}</p> : null}
      {events.data ? <Timeline events={events.data} live={phase === "live"} agentName={agent?.name ?? ""} /> : <Skeleton lines={2} />}
    </section>
  ) : null;

  return (
    <>
      <header className="grid gap-3">
        <Link href="/calls" className="inline-flex items-center gap-1.5 justify-self-start text-[0.93rem] font-bold text-muted hover:text-ink">
          <ArrowLeft size={16} weight="bold" aria-hidden />
          {t.back}
        </Link>
        <div className="grid max-w-[64ch] gap-1">
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{t.title}</h1>
          {phase === "idle" ? <p className="text-muted">{t.lead}</p> : null}
        </div>
      </header>

      {!agents.data || !engines.data ? <Skeleton /> : null}

      {phase === "idle" && agents.data && engines.data && enabled.length === 0 ? (
        <EmptyState
          icon={<Phone size={32} weight="duotone" aria-hidden />}
          title={t.noAgentsTitle}
          action={
            <Link href="/agents" className={buttonClass("primary")}>
              {t.noAgentsLink}
            </Link>
          }
        >
          <p>{t.noAgentsBody}</p>
        </EmptyState>
      ) : null}

      {phase === "idle" && agent && engines.data ? (
        <div className="grid max-w-[640px] gap-5">
          {notice}
          <Panel>
            <div className="grid gap-6">
              <Field label={t.agent}>
                <Select value={agent.id} onChange={(event) => setAgentId(event.target.value)}>
                  {enabled.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.roleLabel ? `${option.name} · ${option.roleLabel}` : option.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-2.5">
                <h2 className="text-[0.87rem] font-bold">{t.ready.title}</h2>
                <ul className="grid gap-2">
                  {engine && !engine.requiresKey ? (
                    <Check ok={false}>
                      <p>{t.ready.simulated}</p>
                      <FixLink href={`/agents/${agent.id}`}>{t.ready.simulatedLink}</FixLink>
                    </Check>
                  ) : (
                    <>
                      <Check ok>
                        {t.ready.engine}: <span className="text-ink">{engine?.label ?? agent.engine}</span>
                      </Check>
                      <Check ok={engine?.keyConfigured === true}>
                        <p>{engine?.keyConfigured ? t.ready.keyOk : t.ready.keyMissing}</p>
                        {engine?.keyConfigured ? null : <FixLink href="/settings">{t.ready.keyLink}</FixLink>}
                      </Check>
                    </>
                  )}
                  <Check ok={secure}>{secure ? t.ready.micOk : t.ready.insecure}</Check>
                </ul>
              </div>

              <div className="grid gap-3 border-t border-line pt-5">
                <Button variant="primary" className="h-12 px-6 text-[1.07rem] sm:justify-self-start" disabled={blocked} icon={<Phone size={20} weight="duotone" aria-hidden />} onClick={() => void start()}>
                  {t.call}
                </Button>
                <p className="flex items-start gap-2 text-[0.87rem] text-muted">
                  <Headphones size={18} weight="duotone" className="mt-0.5 shrink-0" aria-hidden />
                  {t.headphones}
                </p>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {phase === "starting" || phase === "live" ? (
        <>
          <section className="grid gap-6 rounded-md border border-accent bg-surface p-5 sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="grid gap-2">
                <span className="text-[1.2rem] font-bold">{agent?.name}</span>
                <span className="flex items-center gap-3 text-accent-strong" role="status">
                  <span className="voice-bars" data-active={phase === "live" && meter.agentSpeaking} aria-hidden>
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className={`font-bold ${phase === "live" && meter.agentSpeaking ? "" : "text-muted"}`}>{stateLabel}</span>
                </span>
              </div>
              <span className="data text-[3.5rem] leading-none font-medium tracking-[-0.04em]" aria-live="off">
                {formatDuration(seconds)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-line pt-5">
              <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                {muted ? <MicrophoneSlash size={20} weight="duotone" className="shrink-0 text-muted" aria-hidden /> : <Microphone size={20} weight="duotone" className="shrink-0 text-muted" aria-hidden />}
                <div role="meter" aria-label={t.micLevel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, meter.micLevel * 6) * 100)} className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-ok transition-[width] duration-[120ms] ease-out" style={{ width: `${Math.min(1, meter.micLevel * 6) * 100}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  aria-pressed={muted}
                  disabled={phase !== "live"}
                  icon={muted ? <Microphone size={18} weight="duotone" aria-hidden /> : <MicrophoneSlash size={18} weight="duotone" aria-hidden />}
                  onClick={() => {
                    voice.current?.setMuted(!muted);
                    setMuted(!muted);
                  }}
                >
                  {muted ? t.unmute : t.mute}
                </Button>
                <Button variant="danger" icon={<PhoneDisconnect size={18} weight="duotone" aria-hidden />} onClick={() => voice.current?.hangup()}>
                  {t.hangUp}
                </Button>
              </div>
            </div>
          </section>
          {conversation}
        </>
      ) : null}

      {phase === "ended" ? (
        <>
          {notice}
          <section className="grid gap-5 rounded-md border border-line bg-surface p-5 sm:p-7">
            <h2 className="text-[1.2rem] font-bold">{t.ended.title}</h2>
            <dl className="grid grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:gap-x-12">
              <div className="grid gap-1">
                <dt className="text-[0.8rem] font-bold text-muted">{t.ended.outcome}</dt>
                <dd>{call.data ? <Badge tone={STATUS_TONE[call.data.status]}>{common.callStatus[call.data.status]}</Badge> : null}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[0.8rem] font-bold text-muted">{t.ended.duration}</dt>
                <dd className="data text-[1.2rem]">{formatDuration(seconds)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[0.8rem] font-bold text-muted">{t.ended.cost}</dt>
                <dd className="data text-[1.2rem]">{call.data ? formatMoney(call.data.costCents, locale) : ""}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <Button variant="primary" icon={<Phone size={18} weight="duotone" aria-hidden />} onClick={() => void start()}>
                {t.ended.again}
              </Button>
              {callId ? (
                <Link href={`/calls/${callId}`} className={buttonClass("secondary")}>
                  {t.ended.fullTimeline}
                  <ArrowRight size={16} weight="bold" aria-hidden />
                </Link>
              ) : null}
            </div>
          </section>
          {conversation}
        </>
      ) : null}
    </>
  );
}
