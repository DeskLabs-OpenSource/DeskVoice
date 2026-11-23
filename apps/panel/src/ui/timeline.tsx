"use client";

import { ArrowsClockwise, ArrowsLeftRight, BellRinging, CheckCircle, ClockCountdown, Coins, DotsNine, Gauge, type Icon, ListChecks, PhoneIncoming, PhoneOutgoing, PhoneX, Record as RecordIcon, SealQuestion, WarningOctagon, Wrench, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import en from "../i18n/en/timeline";
import es from "../i18n/es/timeline";
import { fill } from "../i18n/locales";
import ptBR from "../i18n/pt-BR/timeline";
import { useDict, useLocale } from "../i18n/provider";
import { classifyReasonCode } from "./classify-reason";
import { formatClock, formatDateTime, formatMoney, formatPhone } from "./format";
import type { Analyst, CallEvent, FollowUp, Person } from "./types";

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

type TimelineDictionary = typeof ptBR;
/** O que a linha do tempo diz de um `drop_follow_up`: a ação, ou o motivo de não ter agido. */
type DropFollowUpShown = keyof TimelineDictionary["events"]["drop_follow_up"]["simulated"];
/** O motivo de recusa da religação (`refusalCode`), em frase fixa; o código fora da lista vira `unknown`, nunca texto cru. */
type CallBackRefusalShown = keyof TimelineDictionary["events"]["drop_follow_up_result"]["refusals"];
/** As ações da religação em `drop_follow_up_result` (seção 3.7 do desenho). */
const CALL_BACK_RESULTS = ["call_back_placed", "call_back_refused", "call_back_expired", "call_back_answered", "call_back_not_answered"] as const;
type CallBackResultShown = (typeof CALL_BACK_RESULTS)[number];
const isCallBackResult = (action: unknown): action is CallBackResultShown => (CALL_BACK_RESULTS as readonly unknown[]).includes(action);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Ligação não analisada: <motivo>", do payload de `analysis_not_done`. A mesma frase serve à linha
 * do tempo e ao detalhe da chamada: o teto (ou a falha) não aparece só num dos dois lugares.
 */
export function analysisNotDoneText(e: TimelineDictionary["events"], payload: Record<string, unknown>): string {
  const code = classifyReasonCode(payload);
  const known = Object.hasOwn(e.analysis_not_done_reasons, code) ? e.analysis_not_done_reasons[code] : undefined;
  return fill(e.analysis_not_done, { reason: known ? fill(known, { model: text(payload.model) }) : code });
}

/**
 * As marcas do filtro da fala presas à fala de quem ligou (`read` no payload): "pode ser fundo" e a
 * leitura provável. São sugestão: o texto ouvido fica acima, como foi gravado.
 */
function SpeechMarks({ read, e, confidence }: { read: unknown; e: TimelineDictionary["events"]; confidence(value: number | null): string }) {
  if (typeof read !== "object" || read === null) return null;
  const marks = read as { background?: { confidence?: unknown }; suggestion?: { term?: unknown; confidence?: unknown } };
  const background = typeof marks.background?.confidence === "number" ? marks.background.confidence : null;
  const suggestion = typeof marks.suggestion?.term === "string" && typeof marks.suggestion.confidence === "number" ? marks.suggestion : null;
  if (background === null && suggestion === null) return null;
  return (
    <div className="mt-1 grid gap-0.5 border-t border-line pt-1 text-[0.8rem] text-muted">
      {background !== null ? <p>{fill(e.speech_marks.background, { confidence: confidence(background) })}</p> : null}
      {suggestion !== null ? <p>{fill(e.speech_marks.suggestion, { term: String(suggestion.term), confidence: confidence(Number(suggestion.confidence)) })}</p> : null}
      <p className="italic">{e.speech_marks.note}</p>
    </div>
  );
}

/** "(escolha do agente)" quando o cérebro que leu (ou não leu) a ligação foi o escolhido no agente. */
const byAgent = (e: TimelineDictionary["events"], payload: Record<string, unknown>): string => (payload.choiceFrom === "agent" ? ` ${e.choice_agent}` : "");

const Quiet = ({ children }: { children: ReactNode }) => <p className="pt-1 text-muted">{children}</p>;
/** O lugar do texto que saiu a pedido de quem ligou (`erased` no payload). */
const Erased = ({ children }: { children: ReactNode }) => <p className="text-[0.87rem] text-muted italic">{children}</p>;

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
  analysts,
}: {
  events: CallEvent[];
  live: boolean;
  agentName: string;
  /** As pendências da ligação: o evento leva só o id, e o título e a nota vêm daqui. */
  followUps?: FollowUp[];
  /** Nomes de quem aparece nos eventos de pendência (dono, quem fechou). */
  people?: Person[];
  /**
   * Os analistas de hoje: os eventos do analista guardam só a `key` da objeção, e o rótulo e a
   * orientação vêm do cadastro atual (desenho R6, seção 3.5). Sem a lista (não carregou), a tela diz
   * "uma objeção" e nunca mostra a `key` crua.
   */
  analysts?: Analyst[];
}) {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  const e = t.events;
  const nameOf = (id: unknown): string => people.find((person) => person.id === id)?.name ?? t.removedPerson;
  const reason = (code: unknown): string => {
    const key = text(code);
    return Object.hasOwn(t.reasons, key) ? t.reasons[key as keyof typeof t.reasons] : key;
  };

  // Depois de uma passagem, a fala do agente leva o id de quem falou (`agentId`); o nome vem da
  // própria passagem, que guarda de quem e para quem ela foi.
  const handoffNames = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "agent_handoff") continue;
    for (const side of [event.payload.from, event.payload.to]) {
      if (typeof side === "object" && side !== null && "id" in side && "name" in side) handoffNames.set(text(side.id), text(side.name));
    }
  }
  const speakerOf = (payload: Record<string, unknown>): string => (text(payload.agentId) ? handoffNames.get(text(payload.agentId)) : undefined) ?? (agentName || t.speakers.agent);
  const sideName = (side: unknown): string => (typeof side === "object" && side !== null && "name" in side ? text(side.name) : "");

  const objectionOf = (analystId: unknown, key: unknown) => analysts?.find((analyst) => analyst.id === analystId)?.objections.find((objection) => objection.key === key);
  const objectionName = (analystId: unknown, key: unknown): string => objectionOf(analystId, key)?.label ?? (analysts ? e.analyst_objection_removed : e.analyst_objection_unread);
  // "Este motor ainda não recebe orientação" aparece uma vez por chamada, na primeira objeção não entregue.
  const firstUnsupported = events.find((event) => event.kind === "analyst_guidance" && event.payload.outcome === "engine_unsupported")?.id;

  const confidence = (value: number | null): string => (value ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // A leitura do filtro que chegou a tempo e não deixou observação já está presa à fala, como marca.
  const shown = events.filter((event) => !(event.kind === "caller_speech_read" && event.payload.onTime === true && (event.payload.finished === null || event.payload.finished === undefined)));

  const rows: Row[] = pairTools(shown).map(({ event, result }, index, all): Row => {
    const p = event.payload;
    const base = { key: event.id, at: event.at };
    const previousEvent = all[index - 1]?.event;
    const previous = previousEvent?.kind;
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
              {previous !== event.kind || (!user && text(previousEvent?.payload.agentId) !== text(p.agentId)) ? (
                <span className="text-[0.8rem] font-bold text-muted">{user ? t.speakers.user : speakerOf(p)}</span>
              ) : null}
              {p.purged === true ? <p className="text-muted italic">{p.erased === true ? e.transcript_erased : e.transcript_purged}</p> : <p className="leading-relaxed">{text(p.text)}</p>}
              {p.source === "stt" ? <p className="text-[0.8rem] text-muted">{e.transcript_from_recording}</p> : null}
              {user && p.purged !== true ? <SpeechMarks read={p.read} e={e} confidence={confidence} /> : null}
            </div>
          ),
        };
      }
      case "transcription_failed": {
        // O provedor não devolveu o texto da gravação: o motivo fica na linha do tempo, para a falha
        // não existir só no extrato. O código e o HTTP ficam como detalhe para quem opera.
        const code = classifyReasonCode(p);
        const said = e.transcription_failed_body[code];
        return {
          ...base,
          tone: "fail",
          icon: WarningOctagon,
          body: (
            <Card tone="fail" title={e.transcription_failed}>
              <p className="text-muted">{said ? fill(said, { model: text(p.model) }) : e.transcription_failed_unknown}</p>
              {text(p.reason) ? <p className="data text-[0.87rem] text-muted">{text(p.reason)}{typeof p.status === "number" ? ` · HTTP ${p.status}` : ""}</p> : null}
            </Card>
          ),
        };
      }
      case "call_started": {
        const outbound = p.direction === "outbound";
        const said = outbound ? e.call_started_outbound : p.channel === "whatsapp" ? e.call_started_whatsapp : p.channel === "web" ? e.call_started_web : p.channel === "simulated" ? e.call_started_simulated : e.call_started;
        return { ...base, tone: "neutral", icon: outbound ? PhoneOutgoing : PhoneIncoming, body: <Quiet>{said}</Quiet> };
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
              {p.erased === true || outcome?.payload.erased === true ? <Erased>{e.erased}</Erased> : null}
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
      case "tool_cancelled":
        // O provedor cancelou a chamada (o Gemini, quando quem ligou interrompe): o `tool_result` dela, quando vem, diz o que saiu.
        return { ...base, tone: "neutral", icon: Wrench, body: <Quiet>{fill(e.tool_cancelled, { tool: t.names[text(p.name)] ?? text(p.name) })}</Quiet> };
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
              {p.erased === true ? <Erased>{e.erased}</Erased> : null}
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
              {p.erased === true ? <Erased>{e.erased}</Erased> : null}
            </Card>
          ),
        };
      case "dtmf_sent":
        return { ...base, tone: "neutral", icon: DotsNine, body: <Quiet><span className="font-bold text-ink">{e.dtmf_sent}</span>{text(p.digits) ? <> · <span className="data">{text(p.digits)}</span></> : null}{p.erased === true ? <> · {e.erased}</> : null}</Quiet> };
      case "transfer_started":
        return {
          ...base,
          tone: "accent",
          icon: ArrowsLeftRight,
          body: (
            <Card title={e.transfer_started}>
              {text(p.to) ? <p className="data">{fill(e.transfer_to, { to: formatPhone(text(p.to)) })}</p> : null}
              {/* A transferência pelo menu por teclas grava o código `ivr`, que vira frase; o motivo
                  escrito pelo agente segue como ele escreveu. */}
              {text(p.reason) ? <p className="text-muted">{p.reason === "ivr" ? e.transfer_reason_ivr : text(p.reason)}</p> : null}
              {text(p.summary) ? <p className="text-[0.87rem] text-muted">{text(p.summary)}</p> : null}
              {p.erased === true ? <Erased>{e.erased}</Erased> : null}
            </Card>
          ),
        };
      // O menu por teclas (#223). Só a tecla de uma opção que existe chega aqui (`ivr_option_chosen`);
      // a tecla que não é opção nunca é gravada, e a tela não tem o que mostrar dela.
      case "ivr_started":
        return { ...base, tone: "neutral", icon: DotsNine, body: <Quiet>{e.ivr_started}</Quiet> };
      case "ivr_option_chosen": {
        const action = p.action === "agent" || p.action === "transfer" || p.action === "hangup" ? p.action : null;
        const seconds = Math.max(0, Math.round(Number(p.elapsed_ms) / 1000)) || 0;
        return {
          ...base,
          tone: "accent",
          icon: DotsNine,
          body: (
            <Card title={fill(e.ivr_option_chosen, { digit: text(p.digit), label: text(p.label), seconds })}>{action ? <p className="text-muted">{e.ivr_option_action[action]}</p> : null}</Card>
          ),
        };
      }
      case "ivr_no_choice": {
        const attempt = typeof p.attempt === "number" ? p.attempt : 0;
        return { ...base, tone: "neutral", icon: ClockCountdown, body: <Quiet>{fill(p.kind === "invalid" ? e.ivr_no_choice.invalid : e.ivr_no_choice.timeout, { attempt })}</Quiet> };
      }
      case "ivr_failed": {
        const code = text(p.reason);
        const said = Object.hasOwn(e.ivr_failed_reasons, code) ? e.ivr_failed_reasons[code as keyof typeof e.ivr_failed_reasons] : e.ivr_failed_unknown;
        // As duas falhas que pedem mexer no menu também deixam um aviso no painel (o sino).
        const noticed = code === "prompt_unreadable" || code === "no_person_exit";
        return {
          ...base,
          tone: "fail",
          icon: WarningOctagon,
          body: (
            <Card tone="fail" title={e.ivr_failed}>
              <p className="text-muted">{said}</p>
              {noticed ? <p className="text-[0.87rem] font-bold">{e.ivr_failed_notice}</p> : null}
            </Card>
          ),
        };
      }
      case "ivr_ended": {
        const said =
          p.reason === "no_choice"
            ? p.then === "person"
              ? e.ivr_ended.no_choice_person
              : e.ivr_ended.no_choice_hangup
            : p.reason === "option_hangup" || p.reason === "caller_hangup" || p.reason === "stopped"
              ? e.ivr_ended[p.reason]
              : null;
        return { ...base, tone: "neutral", icon: PhoneX, body: <Quiet>{said ?? e.call_ended}</Quiet> };
      }
      case "agent_handoff":
        // O motivo e o resumo saem com o prazo de guarda e com o apagamento a pedido do titular: o
        // cartão fica só com de quem e para quem.
        return {
          ...base,
          tone: "accent",
          icon: ArrowsLeftRight,
          body: (
            <Card title={fill(e.agent_handoff, { to: sideName(p.to) })}>
              <p className="text-muted">{fill(e.agent_handoff_from, { from: sideName(p.from) })}</p>
              {text(p.reason) ? <p className="text-muted">{text(p.reason)}</p> : null}
              {text(p.summary) ? (
                <details className="text-[0.87rem] text-muted">
                  <summary className="cursor-pointer font-bold hover:text-ink">{e.agent_handoff_summary}</summary>
                  <p className="mt-1 whitespace-pre-line">{text(p.summary)}</p>
                </details>
              ) : null}
            </Card>
          ),
        };
      case "transfer_completed":
        if (p.answered === false) {
          return {
            ...base,
            tone: "fail",
            icon: ArrowsLeftRight,
            body: <Card tone="fail" title={e.transfer_unanswered}>{text(p.status) ? <p className="data text-[0.87rem] text-muted">{text(p.status)}</p> : null}</Card>,
          };
        }
        return { ...base, tone: "ok", icon: ArrowsLeftRight, body: <Quiet>{e.transfer_completed}</Quiet> };
      case "transfer_returned":
        // O fim da transferência não atendida vem logo antes, com o estado; aqui é a volta para o agente.
        return { ...base, tone: "accent", icon: ArrowsLeftRight, body: <Quiet>{fill(e.transfer_returned, { status: text(p.status) || "?" })}</Quiet> };
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
      case "engine_resumed":
        // O motor trocou a conexão com o provedor (o Gemini fecha a dele em cerca de 10 min) e a ligação seguiu.
        return { ...base, tone: "neutral", icon: ArrowsClockwise, body: <Quiet>{e.engine_resumed}</Quiet> };
      case "turn_latency": {
        // Um evento por ligação (item 6 da segunda leva Vapi): do fim da fala de quem ligou ao primeiro
        // áudio do agente na linha, sem os turnos com ferramenta. `transcript` é a medida aproximada do Gemini.
        // Com `guardTurns`, o mais lento é o mais lento medido, e a linha diz quantos turnos ficaram sem
        // medida; com `turns: 0`, só isso.
        const seconds = (ms: unknown): string => (Number(ms) / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const turns = Number(p.turns);
        const guardTurns = Number(p.guardTurns ?? 0);
        const guard = guardTurns === 1 ? e.turn_latency.guardOne : fill(e.turn_latency.guardMany, { count: guardTurns.toLocaleString(locale) });
        const measured =
          turns > 0
            ? fill(guardTurns > 0 ? e.turn_latency.lineMeasured : e.turn_latency.line, {
                engine: Object.hasOwn(e.turn_latency.engines, text(p.engine)) ? (e.turn_latency.engines[text(p.engine)] ?? text(p.engine)) : text(p.engine),
                p50: seconds(p.p50Ms),
                max: seconds(p.maxMs),
                turns: turns === 1 ? e.turn_latency.turnsOne : fill(e.turn_latency.turnsMany, { count: turns.toLocaleString(locale) }),
              }) + (p.source === "transcript" ? ` ${e.turn_latency.approximate}` : "")
            : "";
        const line = [measured, guardTurns > 0 ? guard : ""].filter(Boolean).join(" ");
        return { ...base, tone: "neutral", icon: ClockCountdown, body: <Quiet>{line}</Quiet> };
      }
      case "call_refused":
        return { ...base, tone: "fail", icon: PhoneX, body: <Card tone="fail" title={e.call_refused}><p className="text-muted">{reason(p.reason)}</p></Card> };
      case "voicemail_left": {
        const seconds = typeof p.recordedSeconds === "number" ? Math.max(0, Math.round(p.recordedSeconds)) : 0;
        const left = p.left === true;
        // Decisão 0018, escolha 2A: o recado é transcrito com a chave do agente do número; sem agente, não há chave.
        const noKey = left && p.reason === "no_agent";
        return {
          ...base,
          tone: left ? "ok" : "neutral",
          icon: RecordIcon,
          body: (
            <Quiet>
              <span className="font-bold text-ink">{left ? e.voicemail_left : e.voicemail_none}</span>
              {seconds > 0 ? ` · ${fill(e.voicemail_seconds, { seconds })}` : ""}
              {left ? null : ` — ${e.voicemail_none_body}`}
              {noKey ? ` — ${e.voicemail_no_key}` : null}
            </Quiet>
          ),
        };
      }
      case "voicemail_failed":
        return {
          ...base,
          tone: "fail",
          icon: WarningOctagon,
          body: (
            <Card tone="fail" title={e.voicemail_failed}>
              <p className="text-muted">{e.voicemail_failed_body}</p>
              {text(p.reason) ? <p className="data text-[0.87rem] text-muted">{text(p.reason)}</p> : null}
            </Card>
          ),
        };
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
      case "recording_paused":
        return {
          ...base,
          tone: "neutral",
          icon: RecordIcon,
          body: (
            <Card title={e.recording_paused}>
              <p className="text-muted">{p.by === "human" ? e.recording_paused_human : e.recording_paused_agent}</p>
              {text(p.reason) ? <p className="text-[0.87rem] text-muted">“{text(p.reason)}”</p> : null}
              {p.reasonPurged === true ? <p className="text-[0.87rem] text-muted">{p.erased === true ? e.erased : e.recording_paused_reason_purged}</p> : null}
            </Card>
          ),
        };
      case "recording_saved": {
        // Na linha, o começo da impressão digital; a inteira fica à mão para copiar e conferir uma cópia.
        const sha256 = text(p.sha256);
        const size = (Number(p.bytes) / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 });
        // A leitura para calcular a impressão falhou: a gravação está salva, só a impressão falta (issue 278).
        if (sha256 === "") return { ...base, tone: "neutral", icon: RecordIcon, body: <p className="max-w-[52ch] pt-1 text-muted">{fill(e.recording_saved_no_hash, { size })}</p> };
        return {
          ...base,
          tone: "neutral",
          icon: RecordIcon,
          body: (
            <div className="grid max-w-[52ch] gap-1 pt-1 text-muted">
              <p>{fill(e.recording_saved, { size, hash: sha256.slice(0, 12) })}</p>
              <details className="text-[0.87rem]">
                <summary className="cursor-pointer font-bold hover:text-ink">{e.recording_saved_full}</summary>
                <p className="mt-1.5">{e.recording_saved_body}</p>
                <p className="data mt-1.5 rounded-xs bg-sunken p-2.5 break-all text-ink select-all">{sha256}</p>
              </details>
            </div>
          ),
        };
      }
      case "cost_ceiling_reached":
        return { ...base, tone: "fail", icon: Coins, body: <Card tone="fail" title={e.cost_ceiling_reached}><p className="text-muted">{e.cost_ceiling_body}</p></Card> };
      case "outcome_not_classified": {
        const body = e.outcome_not_classified_body[classifyReasonCode(p)];
        return {
          ...base,
          tone: "fail",
          icon: SealQuestion,
          body: (
            <Card tone="fail" title={`${e.outcome_not_classified}${byAgent(e, p)}`}>
              <p className="text-muted">{body ? fill(body, { model: text(p.model) }) : text(p.reason)}</p>
              {typeof p.status === "number" ? <p className="data text-[0.87rem] text-muted">{fill(e.outcome_not_classified_status, { status: String(p.status) })}</p> : null}
            </Card>
          ),
        };
      }
      case "call_analyzed":
        return { ...base, tone: "ok", icon: Gauge, body: <Quiet><span className="font-bold text-ink">{fill(e.call_analyzed, { score: String(p.score) })}{byAgent(e, p)}</span></Quiet> };
      case "analysis_not_done":
        return {
          ...base,
          tone: "fail",
          icon: Gauge,
          body: (
            <Card tone="fail" title={`${analysisNotDoneText(e, p)}${byAgent(e, p)}`}>
              {typeof p.status === "number" ? <p className="data text-[0.87rem] text-muted">{fill(e.outcome_not_classified_status, { status: String(p.status) })}</p> : null}
            </Card>
          ),
        };
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
      case "webhook_delivered":
        return { ...base, tone: "ok", icon: CheckCircle, body: <Quiet>{fill(e.webhook_delivered, { name: text(p.name), status: String(p.status) })}</Quiet> };
      case "webhook_failed": {
        // O relatório da ligação (fatia 4 da pesquisa Vapi): o motivo no vocabulário fechado, e se a fila tenta de novo.
        const code = text(p.reason);
        const known = Object.hasOwn(e.webhook_failed_reasons, code) ? e.webhook_failed_reasons[code] : undefined;
        const attempt = { attempt: String(p.attempt) };
        const next = code === "not_registered" || code === "erased" ? null : p.retrying === true ? fill(e.webhook_failed_retrying, attempt) : fill(e.webhook_failed_gave_up, attempt);
        return {
          ...base,
          tone: "fail",
          icon: XCircle,
          body: (
            <Card tone="fail" title={fill(e.webhook_failed, { name: text(p.name) })}>
              <p className="text-muted">{known ? fill(known, { status: String(p.status) }) : code}</p>
              {next ? <p className="text-[0.87rem] text-muted">{next}</p> : null}
            </Card>
          ),
        };
      }
      case "caller_unanswered": {
        // A guarda contra o silêncio agiu: o ruído escondeu do provedor o fim da fala de quem ligou.
        const said = p.action === "asked_to_repeat" ? e.caller_unanswered.asked_to_repeat : e.caller_unanswered.turn_closed;
        const seconds = (Number(p.waitedMs) / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });
        return { ...base, tone: "neutral", icon: ClockCountdown, body: <Quiet>{fill(said, { seconds })}</Quiet> };
      }
      case "caller_idle": {
        // O agente terminou de falar e quem ligou ficou calado: a guarda perguntou, lembrou ou encerrou.
        const said = p.action === "ended" ? e.caller_idle.ended : p.action === "asked_again" ? e.caller_idle.asked_again : e.caller_idle.asked;
        const seconds = (Number(p.silentMs) / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });
        return { ...base, tone: "neutral", icon: ClockCountdown, body: <Quiet>{fill(said, { seconds })}</Quiet> };
      }
      case "memory_loaded":
        // Só os ids e o tamanho: o texto das notas fica na tabela delas, onde o prazo o alcança.
        return {
          ...base,
          tone: "neutral",
          icon: ListChecks,
          body: <Quiet>{fill(e.memory_loaded, { notes: Array.isArray(p.noteIds) ? p.noteIds.length : 0, followUps: Array.isArray(p.followUpIds) ? p.followUpIds.length : 0, chars: typeof p.chars === "number" ? p.chars : 0 })}</Quiet>,
        };
      case "analyst_read": {
        // Só números e a chave da objeção: o evento nunca leva texto de quem ligou. A tela troca a chave
        // pelo rótulo do cadastro.
        if (p.onTime !== true) {
          const code = text(p.failure);
          const known = Object.hasOwn(e.analyst_read.failures, code) ? e.analyst_read.failures[code] : undefined;
          return { ...base, tone: "neutral", icon: Gauge, body: <Quiet>{fill(e.analyst_read.failed, { reason: known ? fill(known, { model: text(p.model) }) : code })}</Quiet> };
        }
        const percent = (value: unknown): string => Math.round(Number(value) * 100).toString();
        const temperature = typeof p.temperature === "object" && p.temperature !== null ? (p.temperature as Record<string, unknown>) : null;
        const objection = typeof p.objection === "object" && p.objection !== null ? (p.objection as Record<string, unknown>) : null;
        const parts = [e.analyst_read.read];
        if (temperature) parts.push(fill(e.analyst_read.temperature, { score: Number(temperature.score).toLocaleString(locale, { maximumFractionDigits: 1 }), confidence: percent(temperature.confidence) }));
        if (objection && objection.key === null) parts.push(e.analyst_read.objectionOutside);
        else if (objection && text(objection.key) !== "none") {
          const said = Number(objection.confidence) >= 0.8 ? e.analyst_read.objection : e.analyst_read.objectionBelowCut;
          parts.push(fill(said, { objection: objectionName(p.analystId, objection.key), confidence: percent(objection.confidence) }));
        } else if (objection) parts.push(e.analyst_read.noObjection);
        return { ...base, tone: "neutral", icon: Gauge, body: <Quiet>{parts.join(" ")}</Quiet> };
      }
      case "analyst_guidance": {
        const outcome = p.outcome === "delivered" || p.outcome === "stale" ? p.outcome : "engine_unsupported";
        const said = fill(e.analyst_guidance[outcome], { objection: objectionName(p.analystId, p.objection) });
        // A orientação entregue mostra o texto do cadastro de hoje, com o limite escrito ao lado.
        const current = outcome === "delivered" ? objectionOf(p.analystId, p.objection) : undefined;
        return {
          ...base,
          tone: outcome === "delivered" ? "accent" : "neutral",
          icon: SealQuestion,
          body: (
            <div className="grid max-w-[52ch] gap-1 pt-1 text-muted">
              <p>{said}</p>
              {outcome === "engine_unsupported" && event.id === firstUnsupported ? <p>{e.analyst_guidance.engineUnsupportedWhy}</p> : null}
              {current ? (
                <>
                  <p className="text-ink">{fill(e.analyst_guidance.current, { guidance: current.guidance })}</p>
                  <p className="text-[0.8rem] italic">{e.analyst_guidance.currentNote}</p>
                </>
              ) : null}
            </div>
          ),
        };
      }
      case "analyst_guidance_leaked":
        return { ...base, tone: "fail", icon: WarningOctagon, body: <Quiet>{fill(e.analyst_guidance_leaked, { objection: objectionName(p.analystId, p.objection) })}</Quiet> };
      case "drop_follow_up": {
        // Só campos fixos: o caso e o que foi feito, ou o que teria sido feito na simulada.
        const what = p.case === "engine_failed" ? e.drop_follow_up.engine_failed : e.drop_follow_up.call_dropped;
        // No modo `call_back`, o agendamento e os motivos de não agendar têm frase própria: a do
        // WhatsApp falaria de uma mensagem que nunca existiu.
        const callBack = p.mode === "call_back";
        const skipped = p.action === "skipped" && (p.reason === "do_not_call" || p.reason === "mode_unavailable" || p.reason === "recent_follow_up" || p.reason === "org_limit") ? p.reason : null;
        const action: DropFollowUpShown =
          p.action === "whatsapp_queued"
            ? "whatsapp_queued"
            : p.action === "call_back_scheduled"
              ? "call_back_scheduled"
              : callBack && (skipped === "do_not_call" || skipped === "mode_unavailable" || skipped === "recent_follow_up")
                ? `call_back_${skipped}`
                : skipped ?? "task_opened";
        const done = p.simulated === true ? e.drop_follow_up.simulated[action] : e.drop_follow_up[action];
        return { ...base, tone: "accent", icon: PhoneX, body: <Quiet><span className="font-bold text-ink">{what}</span> {done}</Quiet> };
      }
      case "drop_follow_up_result": {
        if (isCallBackResult(p.action)) {
          // A religação (seção 3.7): cada ação com frase própria, só de campos fixos (tentativa, código,
          // custo), com o link para a religação quando ela chegou a existir. Nada da conversa.
          const r = e.drop_follow_up_result;
          const attempt = typeof p.attempt === "number" ? p.attempt : 1;
          const code = text(p.refusalCode);
          const refusal: CallBackRefusalShown = Object.hasOwn(r.refusals, code) ? (code as CallBackRefusalShown) : "unknown";
          const said = fill(r[p.action], { attempt, reason: r.refusals[refusal] });
          const cost = typeof p.costCents === "number" ? fill(r.cost, { cost: formatMoney(p.costCents, locale) }) : null;
          const callId = text(p.callId);
          const good = p.action === "call_back_answered" || p.action === "call_back_placed";
          return {
            ...base,
            tone: good ? "ok" : p.action === "call_back_not_answered" ? "neutral" : "fail",
            icon: p.action === "call_back_placed" ? PhoneOutgoing : good ? CheckCircle : XCircle,
            body: (
              <Quiet>
                {said}
                {cost ? ` ${cost}` : null}
                {UUID.test(callId) ? (
                  <>
                    {" "}
                    <Link href={`/calls/${callId}`} className="font-bold text-ink underline-offset-4 hover:underline">
                      {r.link}
                    </Link>
                  </>
                ) : null}
              </Quiet>
            ),
          };
        }
        // A mensagem para quem ligou saiu ou não.
        const sent = p.action === "whatsapp_sent";
        return {
          ...base,
          tone: sent ? "ok" : "fail",
          icon: sent ? CheckCircle : XCircle,
          body: <Quiet>{sent ? e.drop_follow_up_result.whatsapp_sent : e.drop_follow_up_result.whatsapp_failed}</Quiet>,
        };
      }
      case "caller_speech_read": {
        // Só o que não virou marca na fala: a decisão tardia (o "terminou", que chega depois do turno),
        // o pedido que venceu o prazo e o filtro que não abriu. Nada disso mudou a ligação.
        const finished = typeof p.finished === "object" && p.finished !== null && "confidence" in p.finished ? Number(p.finished.confidence) : null;
        const code = text(p.failure);
        const known = Object.hasOwn(e.caller_speech_read.reasons, code) ? e.caller_speech_read.reasons[code as keyof typeof e.caller_speech_read.reasons] : code;
        const said = p.onTime === true ? fill(e.caller_speech_read.finished, { confidence: confidence(finished) }) : code === "late" ? e.caller_speech_read.late : fill(e.caller_speech_read.failed, { reason: known });
        return { ...base, tone: "neutral", icon: SealQuestion, body: <Quiet>{said}</Quiet> };
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
