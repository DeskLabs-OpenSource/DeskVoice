"use client";

import { useEffect, useState } from "react";
import commonEn from "../../../i18n/en/common";
import settingsEn from "../../../i18n/en/settings";
import en from "../../../i18n/en/whatsapp";
import commonEs from "../../../i18n/es/common";
import settingsEs from "../../../i18n/es/settings";
import es from "../../../i18n/es/whatsapp";
import { fill } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import settingsPtBR from "../../../i18n/pt-BR/settings";
import ptBR from "../../../i18n/pt-BR/whatsapp";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatPhone } from "../../../ui/format";
import { Badge, Button, Notice, Panel, Skeleton } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";

// O QR Code do WhatsApp vale 20 segundos depois do primeiro. Com 5 segundos entre as consultas a
// tela nunca mostra um código vencido por mais de um quarto da vida dele; mais que isso atrapalha
// a leitura. A consulta só existe enquanto se espera o código ou a leitura, e para ao conectar.
const POLL_MS = 5000;
// Instalar e remover o serviço é trabalho do agente do servidor, que passa uma vez por minuto.
const SERVICE_POLL_MS = 15000;
const QR_SIZE = 264;
// Iguais em todo idioma: são comandos, não frases.
const RUN_AGENT = "bash install/agent.sh";
const RUN_UPDATE = "bash install/update.sh";
/** MB em GB com uma casa, no formato do idioma. */
const gigabytes = (megabytes: number, locale: string): string => (megabytes / 1024).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface WhatsAppState {
  available: boolean;
  service: "absent" | "preparing" | "running" | "failed" | "removing";
  serviceReason: "no_disk" | "pull_failed" | "start_failed" | "remove_failed" | null;
  serviceWarning: "low_memory" | "image_kept" | null;
  disk: { freeMb: number; neededMb: number } | null;
  agent: "responding" | "silent" | "never";
  status: "disconnected" | "starting" | "qr" | "connected" | "failed";
  failure: "FAILED" | "STOPPED" | "missing" | "qr_expired" | null;
  phone: string | null;
  connectedAt: string | null;
  qr: string | null;
  replaces: { type: "deskcomm" | "webhook"; url: string } | null;
}

/**
 * Conexão do WhatsApp por QR Code. Só `owner` e `admin` veem o bloco: quem lê o código passa a
 * enviar pelo número. A imagem vem do painel; o navegador nunca fala com o serviço de WhatsApp.
 */
export function WhatsAppPanel({ onChanged }: { onChanged(): void }) {
  const t = useDict(ptBR, en, es);
  const settings = useDict(settingsPtBR, settingsEn, settingsEs);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const locale = useLocale();
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const state = useApi<WhatsAppState>(canConfigure ? "/whatsapp" : null);
  const act = useAction();
  const test = useAction();
  const [confirming, setConfirming] = useState<"replace" | "disconnect" | "remove" | null>(null);
  const [tested, setTested] = useState<{ to: string; addressVerified: boolean } | null>(null);
  const { data, reload } = state;
  const up = data?.available === true && data.service === "running";
  // Espera o QR Code ou a leitura (consulta curta), ou espera o agente do servidor (consulta longa).
  const interval = up && (data.status === "starting" || data.status === "qr") ? POLL_MS : data?.service === "preparing" || data?.service === "removing" || data?.service === "failed" ? SERVICE_POLL_MS : 0;
  useEffect(() => {
    if (interval === 0) return;
    // Aba em segundo plano não consulta: ninguém está olhando.
    const timer = setInterval(() => !document.hidden && reload(), interval);
    return () => clearInterval(timer);
  }, [interval, reload]);

  if (!canConfigure) return null;
  if (!data) return <Panel title={t.title}>{state.error ? <Notice tone="fail">{errorText(state.error)}</Notice> : <Skeleton lines={2} />}</Panel>;

  const run = (path: string, body: unknown = {}): void => {
    setTested(null);
    void act.run(() => api(path, { body })).then((ok) => {
      if (ok) setConfirming(null);
      reload();
      // Conectar e desconectar trocam o conector da organização: o bloco do conector externo relê.
      onChanged();
    });
  };
  const connect = (): void => (data.replaces && confirming !== "replace" ? setConfirming("replace") : run("/whatsapp/connect", { replace: data.replaces !== null }));
  const phone = data.phone ? formatPhone(data.phone) : t.thisNumber;
  const gb = (megabytes: number): string => gigabytes(megabytes, locale);
  const risk = (
    <Notice tone="warn">
      <strong>{t.riskTitle}</strong>
      <p className="max-w-prose">{t.risk}</p>
      <p className="max-w-prose">{t.riskStrangers}</p>
    </Notice>
  );
  const replace =
    data.replaces && confirming === "replace" ? (
      <Notice tone="fail">
        <p>{fill(t.replaceConfirm, { type: data.replaces.type === "deskcomm" ? settings.typeDeskcomm : settings.typeWebhook, url: data.replaces.url })}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="danger" busy={act.busy} onClick={connect}>
            {fill(t.replaceYes, { url: data.replaces.url })}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            {common.actions.cancel}
          </Button>
        </div>
      </Notice>
    ) : null;

  // Quem instala e remove é o agente do servidor. Calado ou ausente, a tela diz e mostra o comando.
  const agent =
    data.agent === "responding" ? null : (
      <Notice tone="warn">
        <p className="max-w-prose">{data.agent === "never" ? t.agentNever : t.agentSilent}</p>
        <code className="data">{RUN_AGENT}</code>
      </Notice>
    );
  const removal =
    confirming === "remove" ? (
      <Notice tone="fail">
        <p className="max-w-prose">{t.removeServiceConfirm}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="danger" busy={act.busy} onClick={() => run("/whatsapp/service", { wanted: false })}>
            {t.removeServiceYes}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            {common.actions.cancel}
          </Button>
        </div>
      </Notice>
    ) : null;
  const removeButton = (
    <Button variant="ghost" onClick={() => setConfirming("remove")}>
      {t.removeService}
    </Button>
  );

  return (
    <Panel title={t.title} description={t.lead} actions={up && data.status === "connected" ? <Badge tone="ok">{t.connected}</Badge> : null}>
      <div className="grid gap-4">
        {/* Uma falha de consulta com a tela já aberta não apaga o que ela mostrava. */}
        {state.error ? <Notice tone="fail">{errorText(state.error)}</Notice> : null}
        {!data.available ? (
          <Notice>
            <p className="max-w-prose">{t.unavailable}</p>
            <code className="data">{RUN_UPDATE}</code>
          </Notice>
        ) : null}

        {data.available && data.service === "absent" ? (
          <>
            <div className="grid max-w-prose gap-1">
              <p className="font-bold">{t.serviceAbsent}</p>
              <p className="text-muted">{t.serviceCost}</p>
            </div>
            {data.serviceWarning === "image_kept" ? (
              <Notice tone="warn">
                <p className="max-w-prose">{t.imageKept}</p>
                <code className="data">{RUN_AGENT}</code>
              </Notice>
            ) : null}
            {risk}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" busy={act.busy} onClick={() => run("/whatsapp/service", { wanted: true })}>
                {t.installService}
              </Button>
            </div>
          </>
        ) : null}

        {data.available && data.service === "preparing" ? (
          <>
            <Notice>{t.servicePreparing}</Notice>
            {agent}
            {removal ?? <div className="flex flex-wrap items-center gap-3">{removeButton}</div>}
          </>
        ) : null}

        {data.available && data.service === "failed" ? (
          <>
            <Notice tone="fail">
              <p className="max-w-prose">{data.disk ? fill(t.noDisk, { free: gb(data.disk.freeMb), needed: gb(data.disk.neededMb), missing: gb(data.disk.neededMb - data.disk.freeMb) }) : t.serviceFailed[data.serviceReason ?? "unknown"]}</p>
              <p className="max-w-prose">{t.serviceRetry}</p>
            </Notice>
            {agent}
            {removal ?? <div className="flex flex-wrap items-center gap-3">{removeButton}</div>}
          </>
        ) : null}

        {data.available && data.service === "removing" ? (
          <>
            <Notice>{t.serviceRemoving}</Notice>
            {agent}
          </>
        ) : null}

        {up && data.serviceWarning === "low_memory" ? <Notice tone="warn">{t.lowMemory}</Notice> : null}

        {up && data.status === "disconnected" ? (
          <>
            {risk}
            {replace ?? removal ?? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" busy={act.busy} onClick={connect}>
                  {t.connect}
                </Button>
                {removeButton}
              </div>
            )}
          </>
        ) : null}

        {up && data.status === "starting" ? <Notice>{t.starting}</Notice> : null}

        {up && data.status === "qr" ? (
          <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
            {/* Fundo claro nos dois temas (token fixo): a câmera precisa do contraste do código também no tema escuro. */}
            <div className="grid place-items-center rounded-sm border border-line bg-qr-surface p-3 text-qr-ink" style={{ width: QR_SIZE, height: QR_SIZE }}>
              {data.qr ? <img src={data.qr} alt={t.qrAlt} width={QR_SIZE - 24} height={QR_SIZE - 24} /> : <span className="text-center text-[0.87rem]">{t.qrBetween}</span>}
            </div>
            <div className="grid gap-3">
              <h3 className="font-bold">{t.qrTitle}</h3>
              <ol className="grid max-w-prose list-decimal gap-1 pl-5">
                {t.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="max-w-prose text-muted">{t.qrRenew}</p>
            </div>
          </div>
        ) : null}

        {up && data.status === "connected" ? (
          <>
            <div className="grid gap-1">
              <p className={data.phone ? "data text-[1.2rem]" : undefined}>{data.phone ? fill(t.connectedNumber, { phone }) : t.connectedUnknown}</p>
              {data.connectedAt ? <p className="text-muted">{fill(t.since, { when: formatDateTime(data.connectedAt, locale) })}</p> : null}
            </div>
            {confirming === "disconnect" ? (
              <Notice tone="fail">
                <p>{fill(t.disconnectConfirm, { phone })}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button variant="danger" busy={act.busy} onClick={() => run("/whatsapp/disconnect")}>
                    {fill(t.disconnectYes, { phone })}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    {common.actions.cancel}
                  </Button>
                </div>
              </Notice>
            ) : (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    busy={test.busy}
                    onClick={() => {
                      setTested(null);
                      void test.run(async () => setTested(await api<{ to: string; addressVerified: boolean }>("/whatsapp/test", { body: { locale } })));
                    }}
                  >
                    {t.sendTest}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming("disconnect")}>
                    {t.disconnect}
                  </Button>
                </div>
                {tested ? (
                  <span role="status" className={tested.addressVerified ? "text-ok" : "text-warn"}>
                    {fill(tested.addressVerified ? t.testSent : t.testUnverified, { to: formatPhone(tested.to) })}
                  </span>
                ) : (
                  <p className="text-muted">{t.testHint}</p>
                )}
                {test.error ? <Notice tone="fail">{test.error}</Notice> : null}
              </div>
            )}
          </>
        ) : null}

        {up && data.status === "failed" ? (
          <>
            <Notice tone="fail">
              <p className="max-w-prose">{t.failed[data.failure ?? "FAILED"]}</p>
              <p className="max-w-prose">{t.failedEffect}</p>
            </Notice>
            {replace ?? removal ?? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" busy={act.busy} onClick={connect}>
                    {data.failure === "qr_expired" ? t.newCode : t.reconnect}
                  </Button>
                  {removeButton}
                </div>
                {data.failure === "qr_expired" ? null : <p className="text-muted">{t.reconnectHint}</p>}
              </div>
            )}
          </>
        ) : null}

        {act.error ? <Notice tone="fail">{act.error}</Notice> : null}
      </div>
    </Panel>
  );
}
