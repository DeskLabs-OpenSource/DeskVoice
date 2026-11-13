"use client";

import { ArrowsLeftRight, BellRinging, CheckCircle, ClockCountdown, Coins, type Icon, ListChecks, PhoneIncoming, PhoneOutgoing, PhoneX, Record as RecordIcon, SealQuestion, WarningOctagon, Wrench, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { fill } from "../i18n/locales";
import ptBR from "../i18n/pt-BR/timeline";
import { useDict, useLocale } from "../i18n/provider";
import { formatClock, formatDateTime, formatPhone } from "./format";
import type { CallEvent, FollowUp, Person } from "./types";

type NodeTone = "neutral" | "accent" | "ok" | "fail" | "speech" | "speech-agent";
interface Row {
  key: string;
  at: string;
  tone: NodeTone;
  icon?: Icon;
  side?: "left";
  body: ReactNode;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Junta cada `tool_called` com o `tool_result` que o responde: na tela são uma coisa só. */
function pairTools(events: CallEvent[]): Array<{ event: CallEvent; result?: CallEvent }> {
  const used = new Set<string>();
  const out: Array<{ event: CallEvent; result?: CallEvent }> = [];
  events.forEach((event, index) => {
    if (used.has(event.id)) return;
    if (event.kind !== "tool_called") return void out.push({ event });
    const result = events.slice(index + 1).find((next) => next.kind === "tool_result" && next.payload.name === event.payload.name && !used.has(next.id));
    if (result) used.add(result.id);
    out.push({ event, result });
  });
  return out;
}

function Card({ title, tone, children }: { title: ReactNode; tone?: "accent" | "fail"; children?: ReactNode }) {
  const border = tone === "accent" ? "border-accent" : tone === "fail" ? "border-fail/50" : "border-line";
  return (
    <div className={`grid max-w-[52ch] gap-1.5 rounded-sm border bg-surface px-4 py-3 ${border}`}>
      <p className="font-bold">{title}</p>
      {children}
    </div>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="pt-1 text-muted">{children}</p>;

/**
 * A linha do tempo de uma chamada: cada evento de `call_events` vira um item legível preso ao fio.
 * Falas são conversa (quem ligou de um lado, agente do outro); o resto são marcos com ícone.
 */
export function Timeline({
  events,
  live,
  agentName,
  followUps = [],
  people = [],
}: {
  events: CallEvent[];
  live: boolean;
  agentName: string;
  /** As pendências da ligação: o evento leva só o id, e o título e a nota vêm daqui. */
  followUps?: FollowUp[];
  /** Nomes de quem aparece nos eventos de pendência (dono, quem fechou). */
  people?: Person[];
}) {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  const e = t.events;
  const nameOf = (id: unknown): string => people.find((person) => person.id === id)?.name ?? t.removedPerson;
  const reason = (code: unknown): string => {
    const key = text(code);
    return Object.hasOwn(t.reasons, key) ? t.reasons[key as keyof typeof t.reasons] : key;
  };

  const rows: Row[] = pairTools(events).map(({ event, result }, index, all): Row => {
    const p = event.payload;
    const base = { key: event.id, at: event.at };
    const previous = all[index - 1]?.event.kind;
    switch (event.kind) {
      case "transcript_user":
      case "transcript_agent": {
        const user = event.kind === "transcript_user";
        return {
          ...base,
          tone: user ? "speech" : "speech-agent",
          side: user ? "left" : undefined,
          body: (
            <div className={`grid max-w-[46ch] gap-0.5 rounded-md px-4 py-2.5 ${user ? "bg-sunken" : "border border-line bg-surface"}`}>
              {previous !== event.kind ? <span className="text-[0.8rem] font-bold text-muted">{user ? t.speakers.user : agentName || t.speakers.agent}</span> : null}
              {p.purged === true ? <p className="text-muted italic">{e.transcript_purged}</p> : <p className="leading-relaxed">{text(p.text)}</p>}
            </div>
          ),
        };
      }
      case "call_started": {
        const outbound = p.direction === "outbound";
        return { ...base, tone: "neutral", icon: outbound ? PhoneOutgoing : PhoneIncoming, body: <Quiet>{outbound ? e.call_started_outbound : e.call_started}</Quiet> };
      }
      case "call_answered":
        return { ...base, tone: "ok", icon: CheckCircle, body: <Quiet>{e.call_answered}</Quiet> };
      case "recording_notice":
        return { ...base, tone: "neutral", icon: RecordIcon, body: <Quiet>{e.recording_notice}{text(p.text) ? `: ${text(p.text)}` : ""}</Quiet> };
      case "tool_called":
      case "tool_result": {
        const outcome = event.kind === "tool_result" ? event : result;
        const failed = outcome?.payload.ok === false;
        // Ferramenta cujos argumentos são texto sobre quem ligou: a linha do tempo não os guarda.
        const omitted = event.kind === "tool_called" && typeof p.args === "object" && p.args !== null && "omitted" in p.args;
        const hasArgs = event.kind === "tool_called" && !omitted && p.args !== null && p.args !== undefined && Object.keys(p.args).length > 0;
        return {
          ...base,
          tone: failed ? "fail" : "neutral",
          icon: Wrench,
          body: (
            <Card tone={failed ? "fail" : undefined} title={<>{e.tool} <span className="font-medium">{t.names[text(p.name)] ?? text(p.name)}</span></>}>
              <p className={failed ? "text-fail" : "text-muted"}>{outcome ? text(outcome.payload.message) : e.tool_running}</p>
              {text(outcome?.payload.error) ? <p className="text-[0.87rem] text-muted">{e.tool_operator_detail}: <span className="data">{text(outcome?.payload.error)}</span></p> : null}
              {omitted ? <p className="text-[0.87rem] text-muted">{e.tool_args_omitted}</p> : null}
              {hasArgs ? (
                <details className="text-[0.87rem] text-muted">
                  <summary className="cursor-pointer font-bold hover:text-ink">{e.tool_args}</summary>
                  <pre className="data mt-1.5 overflow-x-auto rounded-xs bg-sunken p-2.5 whitespace-pre-wrap text-ink">{JSON.stringify(p.args, null, 2)}</pre>
                </details>
              ) : null}
            </Card>
          ),
        };
      }
      case "approval_requested":
        return {
          ...base,
          tone: "accent",
          icon: SealQuestion,
          body: (
            <Card tone="accent" title={e.approval_requested}>
              <p className="text-[1.07rem] leading-snug">{text(p.question)}</p>
              {text(p.context) ? <p className="whitespace-pre-line text-muted">{text(p.context)}</p> : null}
              {p.defaultOnTimeout === "approved" || p.defaultOnTimeout === "denied" ? <p className="text-[0.87rem] text-muted">{e.approval_default[p.defaultOnTimeout]}</p> : null}
            </Card>
          ),
        };
      case "approval_decided": {
        const outcome = p.outcome === "approved" || p.outcome === "denied" ? p.outcome : "expired";
        const decision = p.decision === "approved" || p.decision === "denied" ? p.decision : undefined;
        return {
          ...base,
          tone: outcome === "approved" ? "ok" : outcome === "denied" ? "fail" : "neutral",
          icon: outcome === "approved" ? CheckCircle : outcome === "denied" ? XCircle : ClockCountdown,
          body: <Card title={e.approval_decided[outcome]}>{outcome === "expired" && decision ? <p className="text-muted">{e.approval_applied[decision]}</p> : null}</Card>,
        };
      }
      case "human_notified":
        return {
          ...base,
          tone: "neutral",
          icon: BellRinging,
          body: (
            <Card title={e.human_notified}>
              <p className="whitespace-pre-line text-muted">{text(p.message) || text(p.body)}</p>
              {Array.isArray(p.channels) && p.channels.length > 0 ? <p className="text-[0.87rem] text-muted">{fill(e.human_notified_channels, { channels: p.channels.join(", ") })}</p> : null}
            </Card>
          ),
        };
      case "transfer_started":
        return {
          ...base,
          tone: "accent",
          icon: ArrowsLeftRight,
          body: (
            <Card title={e.transfer_started}>
              {text(p.to) ? <p className="data">{fill(e.transfer_to, { to: formatPhone(text(p.to)) })}</p> : null}
              {text(p.reason) ? <p className="text-muted">{text(p.reason)}</p> : null}
              {text(p.summary) ? <p className="text-[0.87rem] text-muted">{text(p.summary)}</p> : null}
            </Card>
          ),
        };
      case "transfer_completed":
        return { ...base, tone: "ok", icon: ArrowsLeftRight, body: <Quiet>{e.transfer_completed}</Quiet> };
      case "engine_failed":
        return {
          ...base,
          tone: "fail",
          icon: WarningOctagon,
          body: (
            <Card tone="fail" title={e.engine_failed}>
              <p className="text-muted">{e.engine_failed_body}</p>
              {text(p.reason) || text(p.error) ? <p className="data text-[0.87rem] text-muted">{text(p.reason) || text(p.error)}</p> : null}
            </Card>
          ),
        };
      case "call_refused":
        return { ...base, tone: "fail", icon: PhoneX, body: <Card tone="fail" title={e.call_refused}><p className="text-muted">{reason(p.reason)}</p></Card> };
      case "recording_skipped": {
        const mb = (value: unknown): string => Math.floor(Number(value) / 1e6).toLocaleString(locale);
        const lowDisk = p.reason === "low_disk";
        return {
          ...base,
          tone: "fail",
          icon: RecordIcon,
          body: (
            <Card tone="fail" title={e.recording_skipped}>
              <p className="text-muted">{lowDisk ? fill(e.recording_skipped_low_disk, { free: mb(p.freeBytes), min: mb(p.minFreeBytes) }) : e.recording_skipped_unavailable}</p>
              {!lowDisk && text(p.error) ? <p className="data text-[0.87rem] text-muted">{text(p.error)}</p> : null}
            </Card>
          ),
        };
      }
      case "recording_failed": {
        const body = p.reason === "disk_full" ? e.recording_failed_disk_full : p.reason === "disk_too_slow" ? e.recording_failed_disk_too_slow : e.recording_failed_write_failed;
        return {
          ...base,
          tone: "fail",
          icon: RecordIcon,
          body: (
            <Card tone="fail" title={e.recording_failed}>
              <p className="text-muted">{body}</p>
              {text(p.error) ? <p className="data text-[0.87rem] text-muted">{text(p.error)}</p> : null}
            </Card>
          ),
        };
      }
      case "cost_ceiling_reached":
        return { ...base, tone: "fail", icon: Coins, body: <Card tone="fail" title={e.cost_ceiling_reached}><p className="text-muted">{e.cost_ceiling_body}</p></Card> };
      case "call_ended":
        return { ...base, tone: "neutral", icon: PhoneX, body: <Quiet><span className="font-bold text-ink">{e.call_ended}</span>{reason(p.reason) ? ` · ${reason(p.reason)}` : ""}</Quiet> };
      case "task_queued":
        return { ...base, tone: "neutral", icon: ClockCountdown, body: <Quiet>{e.task_queued}{text(p.title) || text(p.kind) ? `: ${text(p.title) || (t.names[text(p.kind)] ?? text(p.kind))}` : ""}</Quiet> };
      case "follow_up_created":
      case "follow_up_assigned":
      case "follow_up_closed": {
        const followUp = followUps.find((candidate) => candidate.id === p.followUpId);
        const closed = event.kind === "follow_up_closed";
        const status = p.status === "canceled" ? "canceled" : "done";
        const owner = p.ownerUserId === null || p.ownerUserId === undefined ? e.follow_up_team : fill(e.follow_up_owner, { name: nameOf(p.ownerUserId) });
        return {
          ...base,
          tone: closed ? (status === "done" ? "ok" : "neutral") : "accent",
          icon: closed ? (status === "done" ? CheckCircle : XCircle) : ListChecks,
          body: (
            <Card title={closed ? e.follow_up_closed[status] : event.kind === "follow_up_created" ? e.follow_up_created : e.follow_up_assigned}>
              {followUp ? <p className="text-[1.07rem] leading-snug">{followUp.title}</p> : <p className="text-muted italic">{e.follow_up_gone}</p>}
              {closed ? (
                <>
                  {followUp?.closingNote ? <p className="whitespace-pre-line">{followUp.closingNote}</p> : null}
                  <p className="text-[0.87rem] text-muted">{fill(e.follow_up_closed_by, { name: nameOf(p.closedBy) })}</p>
                </>
              ) : (
                <p className="text-[0.87rem] text-muted">
                  {p.reason === "owner_disabled" ? e.follow_up_owner_disabled : owner}
                  {event.kind === "follow_up_created" && text(p.dueAt) ? ` · ${fill(e.follow_up_due, { when: formatDateTime(text(p.dueAt), locale) })}` : ""}
                </p>
              )}
              {followUp ? (
                <Link href="/follow-ups" className="text-[0.87rem] font-bold text-muted underline-offset-4 hover:text-ink hover:underline">
                  {e.follow_up_link}
                </Link>
              ) : null}
            </Card>
          ),
        };
      }
      case "task_finished": {
        const failed = p.outcome === "failed" || text(p.error) !== "";
        return { ...base, tone: failed ? "fail" : "ok", icon: failed ? XCircle : CheckCircle, body: <Quiet>{failed ? e.task_failed : e.task_finished}{text(p.kind) ? `: ${t.names[text(p.kind)] ?? text(p.kind)}` : ""}</Quiet> };
      }
      default:
        return { ...base, tone: "neutral", body: <Quiet>{e.unknown} <span className="data">{event.kind}</span></Quiet> };
    }
  });

  if (rows.length === 0 && !live) return <p className="text-muted">{t.empty}</p>;

  return (
    <ol className="thread" data-live={live}>
      {rows.map((row) => {
        const IconComponent = row.icon;
        return (
          <li key={row.key} className="thread-row" data-side={row.side}>
            <span className="thread-node" data-tone={row.tone}>
              {IconComponent ? <IconComponent size={16} weight="duotone" aria-hidden /> : null}
            </span>
            <div className="thread-body">{row.body}</div>
            <time className="thread-time data" dateTime={row.at}>
              {formatClock(row.at, locale)}
            </time>
          </li>
        );
      })}
      {live ? (
        <li className="thread-row">
          <span className="thread-node" data-tone="accent">
            <span className="live-dot" />
          </span>
          <div className="thread-body grid gap-0.5 pt-1">
            <p className="font-bold text-accent-strong">{t.live}</p>
            <p className="text-[0.87rem] text-muted">{t.liveHint}</p>
          </div>
        </li>
      ) : null}
    </ol>
  );
}
