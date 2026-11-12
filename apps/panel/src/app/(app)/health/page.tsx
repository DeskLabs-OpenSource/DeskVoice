"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import en from "../../../i18n/en/health";
import es from "../../../i18n/es/health";
import { fill, type Locale } from "../../../i18n/locales";
import ptBR, { type HealthAction, type HealthDictionary } from "../../../i18n/pt-BR/health";
import { useDict, useLocale } from "../../../i18n/provider";
import { api } from "../../../ui/api";
import { formatDateTime } from "../../../ui/format";
import { Badge, Button, Notice, PageHeader, Panel, Skeleton } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { HealthLine, HealthReport } from "../../../ui/types";

// Iguais em todo idioma: são comandos, rodados no servidor, na pasta do DeskVoice.
const compose = (args: string): string => `docker compose -f deploy/docker-compose.yml ${args}`;
const COMMANDS: Partial<Record<HealthAction, string[]>> = {
  database_down: ["bash install/healthcheck.sh"],
  voice_down: ["bash install/healthcheck.sh", compose("logs --tail 50 voice")],
  telephony_down: ["bash install/install.sh"],
  routines_not_listening: [compose("restart routines"), compose("logs --tail 50 routines")],
  routines_late: [compose("logs --tail 50 routines")],
  routines_stuck: [compose("restart routines")],
  agent_never: ["sudo bash install/agent.sh --install"],
  whatsapp_service_down: [compose("--profile whatsapp logs --tail 50 waha")],
  whatsapp_unavailable: ["bash install/update.sh"],
  whatsapp_calls_service_down: [compose("--profile whatsapp-calls logs --tail 50 wacalls")],
  whatsapp_calls_unavailable: ["bash install/update.sh"],
};

const DOT = { ok: "bg-ok", warn: "bg-warn", fail: "bg-fail" } as const;

/** O motivo no idioma da tela. A data chega do servidor em ISO e é formatada aqui. */
function reasonText(line: HealthLine, t: HealthDictionary, locale: Locale): string {
  const params = { ...line.params, ...(typeof line.params.when === "string" && line.params.when && { when: formatDateTime(line.params.when, locale) }) };
  return fill(t.reasons[line.reason], params);
}

function Line({ line, t, locale, administers }: { line: HealthLine; t: HealthDictionary; locale: Locale; administers: boolean }) {
  const commands = line.action ? (COMMANDS[line.action] ?? []) : [];
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <span className={`mt-[9px] size-2.5 rounded-full ${DOT[line.status]}`} aria-hidden />
      <div className="grid gap-1">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold">{t.lines[line.id]}</span>
          <Badge tone={line.status}>{t.status[line.status]}</Badge>
        </span>
        <span className="text-muted">{reasonText(line, t, locale)}</span>
      </div>
      {line.action && administers ? (
        <div className={`col-start-2 grid max-w-prose gap-2 rounded-sm border px-4 py-3 ${line.status === "fail" ? "border-fail/40 bg-fail-soft" : "border-line bg-sunken"}`}>
          <span className="text-[0.87rem] font-bold">{t.whatToDo}</span>
          <span>{t.actions[line.action]}</span>
          {commands.map((command) => (
            <code key={command} className="data block overflow-x-auto rounded-xs bg-surface px-3 py-2 text-[0.87rem] whitespace-pre">
              {command}
            </code>
          ))}
        </div>
      ) : null}
      {line.action && !administers && line.status !== "ok" ? <span className="col-start-2 text-[0.87rem] text-muted">{t.askAdmin}</span> : null}
    </li>
  );
}

export default function HealthPage() {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  // Operador vê cada linha e o estado; o "o que fazer" cita o servidor e é de quem o administra.
  const administers = useCanConfigure();
  const [report, setReport] = useState<HealthReport>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);

  // Sem conferência automática: cada uma pergunta a todos os processos, e quem quer outra clica.
  const check = useCallback(() => {
    setBusy(true);
    api<HealthReport>("/system/health")
      .then(
        (next) => {
          setReport(next);
          setFailed(false);
        },
        () => setFailed(true),
      )
      .finally(() => setBusy(false));
  }, []);
  useEffect(check, [check]);

  const names = (status: "warn" | "fail"): string =>
    (report?.checks ?? [])
      .filter((line) => line.status === status)
      .map((line) => t.lines[line.id])
      .join(", ");

  return (
    <>
      <PageHeader
        title={t.title}
        lead={t.lead}
        actions={
          <Button busy={busy} icon={<ArrowClockwise size={18} aria-hidden />} onClick={check}>
            {t.recheck}
          </Button>
        }
      />
      {failed ? <Notice tone="fail">{t.unreachable}</Notice> : null}
      {report ? (
        <>
          <Notice tone={report.worst}>{report.worst === "ok" ? t.worst.ok : fill(t.worst[report.worst], { names: names(report.worst) })}</Notice>
          <Panel>
            <ul aria-label={t.title} className="grid">
              {report.checks.map((line) => (
                <Line key={line.id} line={line} t={t} locale={locale} administers={administers} />
              ))}
            </ul>
          </Panel>
        </>
      ) : failed ? null : (
        <Skeleton lines={6} />
      )}
    </>
  );
}
