"use client";

import { useState } from "react";
import commonEn from "../../../i18n/en/common";
import en from "../../../i18n/en/whatsapp-calls";
import commonEs from "../../../i18n/es/common";
import es from "../../../i18n/es/whatsapp-calls";
import { fill } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import ptBR from "../../../i18n/pt-BR/whatsapp-calls";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatPhone } from "../../../ui/format";
import { Badge, Button, Field, Notice, Panel, Select, Skeleton } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { Agent } from "../../../ui/types";
import { QrCodeBox, RemovalConfirm, ServiceStates, useServicePolling, type ServiceData } from "./optional-service";

interface WhatsAppCallsState extends ServiceData {
  failure: "logged_out" | "qr_expired" | "missing" | null;
  phone: string | null;
  connectedAt: string | null;
  agentId: string | null;
  qr: string | null;
  messagesPhone: string | null;
}

/**
 * Ligação pelo WhatsApp: instalar o serviço, conectar o número por QR Code e escolher o agente que
 * atende. Só `owner` e `admin` veem o bloco.
 */
export function WhatsAppCallsPanel() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const locale = useLocale();
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const state = useApi<WhatsAppCallsState>(canConfigure ? "/whatsapp-calls" : null);
  const agents = useApi<Agent[]>(canConfigure ? "/agents" : null);
  const act = useAction();
  const [confirming, setConfirming] = useState<"disconnect" | "remove" | null>(null);
  const { data, reload } = state;
  const up = data?.available === true && data.service === "running";
  useServicePolling(data, reload);

  if (!canConfigure) return null;
  if (!data) return <Panel title={t.title}>{state.error ? <Notice tone="fail">{errorText(state.error)}</Notice> : <Skeleton lines={2} />}</Panel>;

  const run = (path: string, body: unknown = {}, method?: string): void => {
    void act.run(() => api(path, { method, body })).then((ok) => {
      if (ok) setConfirming(null);
      reload();
    });
  };
  const phone = data.phone ? formatPhone(data.phone) : t.thisNumber;
  const risk = (
    <Notice tone="warn">
      <strong>{t.riskTitle}</strong>
      <p className="max-w-prose">{t.risk}</p>
      <p className="max-w-prose">{t.devices}</p>
      {data.messagesPhone && data.status !== "connected" ? <p className="max-w-prose">{fill(t.messagesNumber, { phone: formatPhone(data.messagesPhone) })}</p> : null}
    </Notice>
  );
  const removal =
    confirming === "remove" ? (
      <RemovalConfirm
        t={{ ...t, removeServiceConfirm: data.phone ? fill(t.removeServiceConfirmPhone, { phone }) : t.removeServiceConfirm }}
        busy={act.busy}
        cancel={common.actions.cancel}
        onYes={() => run("/whatsapp-calls/service", { wanted: false })}
        onCancel={() => setConfirming(null)}
      />
    ) : null;
  const removeButton = (
    <Button variant="ghost" onClick={() => setConfirming("remove")}>
      {t.removeService}
    </Button>
  );
  const connectRow = (label: string) =>
    removal ?? (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" busy={act.busy} onClick={() => run("/whatsapp-calls/connect")}>
          {label}
        </Button>
        {removeButton}
      </div>
    );

  return (
    <Panel title={t.title} description={t.lead} actions={up && data.status === "connected" ? <Badge tone="ok">{t.connected}</Badge> : null}>
      <div className="grid gap-4">
        {state.error ? <Notice tone="fail">{errorText(state.error)}</Notice> : null}
        <p className="max-w-prose text-muted">{t.howItWorks}</p>
        <ServiceStates data={data} t={t} risk={risk} busy={act.busy} removal={removal} removeButton={removeButton} onInstall={() => run("/whatsapp-calls/service", { wanted: true })} />

        {up && data.status === "disconnected" ? (
          <>
            {risk}
            {connectRow(t.connect)}
          </>
        ) : null}

        {up && data.status === "starting" ? <Notice>{t.starting}</Notice> : null}

        {up && data.status === "qr" ? <QrCodeBox qr={data.qr} t={t} /> : null}

        {up && data.status === "connected" ? (
          <>
            <div className="grid gap-1">
              <p className={data.phone ? "data text-[1.2rem]" : undefined}>{data.phone ? fill(t.connectedNumber, { phone }) : t.connectedUnknown}</p>
              {data.connectedAt ? <p className="text-muted">{fill(t.since, { when: formatDateTime(data.connectedAt, locale) })}</p> : null}
            </div>
            {data.phone && data.phone === data.messagesPhone ? <Notice tone="warn">{t.sameNumber}</Notice> : null}
            <Field label={t.answeredBy}>
              <Select value={data.agentId ?? ""} disabled={act.busy} onChange={(event) => run("/whatsapp-calls", { agentId: event.target.value || null }, "PATCH")}>
                <option value="">{t.nobody}</option>
                {agents.data?.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </Field>
            {data.agentId ? null : <Notice tone="warn">{t.noAgent}</Notice>}
            {confirming === "disconnect" ? (
              <Notice tone="fail">
                <p>{fill(t.disconnectConfirm, { phone })}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button variant="danger" busy={act.busy} onClick={() => run("/whatsapp-calls/disconnect")}>
                    {fill(t.disconnectYes, { phone })}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    {common.actions.cancel}
                  </Button>
                </div>
              </Notice>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={() => setConfirming("disconnect")}>
                  {t.disconnect}
                </Button>
              </div>
            )}
          </>
        ) : null}

        {up && data.status === "failed" ? (
          <>
            <Notice tone="fail">
              <p className="max-w-prose">{t.failed[data.failure ?? "logged_out"]}</p>
            </Notice>
            {connectRow(data.failure === "qr_expired" ? t.newCode : t.reconnect)}
          </>
        ) : null}

        {act.error ? <Notice tone="fail">{act.error}</Notice> : null}
      </div>
    </Panel>
  );
}
