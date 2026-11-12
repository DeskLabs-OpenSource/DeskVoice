"use client";

import { useState } from "react";
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
import { QrCodeBox, RemovalConfirm, ServiceStates, useServicePolling, type ServiceData } from "./optional-service";

interface WhatsAppState extends ServiceData {
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
  useServicePolling(data, reload);

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

  const removal = confirming === "remove" ? <RemovalConfirm t={t} busy={act.busy} cancel={common.actions.cancel} onYes={() => run("/whatsapp/service", { wanted: false })} onCancel={() => setConfirming(null)} /> : null;
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
        <ServiceStates data={data} t={t} risk={risk} busy={act.busy} removal={removal} removeButton={removeButton} onInstall={() => run("/whatsapp/service", { wanted: true })} />

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

        {up && data.status === "qr" ? <QrCodeBox qr={data.qr} t={t} /> : null}

        {/* O teste vale para os dois conectores: número conectado por QR Code e endereço do operador. */}
        {up && (data.status === "connected" || data.replaces !== null) ? (
          <>
            {data.status === "connected" ? (
              <div className="grid gap-1">
                <p className={data.phone ? "data text-[1.2rem]" : undefined}>{data.phone ? fill(t.connectedNumber, { phone }) : t.connectedUnknown}</p>
                {data.connectedAt ? <p className="text-muted">{fill(t.since, { when: formatDateTime(data.connectedAt, locale) })}</p> : null}
              </div>
            ) : null}
            {data.status === "connected" && confirming === "disconnect" ? (
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
                  {data.status === "connected" ? (
                    <Button variant="ghost" onClick={() => setConfirming("disconnect")}>
                      {t.disconnect}
                    </Button>
                  ) : null}
                </div>
                {tested ? (
                  <span role="status" className={tested.addressVerified ? "text-ok" : "text-warn"}>
                    {fill(tested.addressVerified ? t.testSent : t.testUnverified, { to: formatPhone(tested.to) })}
                  </span>
                ) : (
                  <p className="text-muted">{data.replaces ? t.testHintConnector : t.testHint}</p>
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
