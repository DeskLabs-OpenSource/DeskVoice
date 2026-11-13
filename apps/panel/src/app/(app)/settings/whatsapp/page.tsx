"use client";

import { useEffect, useState } from "react";
import commonEn from "../../../../i18n/en/common";
import en from "../../../../i18n/en/settings";
import commonEs from "../../../../i18n/es/common";
import es from "../../../../i18n/es/settings";
import { fill } from "../../../../i18n/locales";
import commonPtBR from "../../../../i18n/pt-BR/common";
import ptBR from "../../../../i18n/pt-BR/settings";
import { useDict } from "../../../../i18n/provider";
import { useApi } from "../../../../ui/api";
import { ActionStatus, useAction } from "../../../../ui/errors";
import { Button, Field, Notice, Panel, Select, Switch, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import type { Setting } from "../../../../ui/types";
import { URL_PREFIX, put } from "../setting-api";
import { WhatsAppCallsPanel } from "../whatsapp-calls-panel";
import { WhatsAppPanel } from "../whatsapp-panel";

// `waha` é o número conectado por QR Code: não tem endereço e não se edita por este formulário.
type Connector = { type: "deskcomm" | "webhook"; url: string } | { type: "waha" };

export default function WhatsAppSettings() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const canConfigure = useCanConfigure();
  const connector = useApi<Setting<Connector>>("/settings/whatsapp.connector");
  const trustCaller = useApi<Setting<boolean>>("/settings/whatsapp.trust_caller_id");
  const saveConnector = useAction();
  const saveTrustCaller = useAction();
  const [whatsapp, setWhatsapp] = useState({ type: "deskcomm", url: "", token: "" });
  // A remoção espera confirmação: o botão só abre o pedido, nunca remove.
  const [removingConnector, setRemovingConnector] = useState(false);

  useEffect(() => {
    const value = connector.data?.value;
    if (value && value.type !== "waha") setWhatsapp({ type: value.type, url: value.url, token: "" });
  }, [connector.data]);

  const connectorValue = connector.data?.value;
  const connectedByQr = connectorValue?.type === "waha";
  const savedConnector = connectorValue && connectorValue.type !== "waha" ? connectorValue : undefined;
  const connectorMoved = savedConnector != null && (savedConnector.url !== whatsapp.url || savedConnector.type !== whatsapp.type);

  return (
    <>
      <WhatsAppPanel onChanged={connector.reload} />

      <Panel title={t.whatsappTitle} description={t.whatsappLead}>
        {connectedByQr ? (
          <Notice>{t.connectorIsWaha}</Notice>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const { token, ...rest } = whatsapp;
              void saveConnector.run(() => put("whatsapp.connector", { ...rest, ...(token && { token }) })).then(connector.reload);
            }}
          >
            <fieldset disabled={!canConfigure} className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
              <Field label={t.connectorType}>
                <Select value={whatsapp.type} onChange={(event) => setWhatsapp({ ...whatsapp, type: event.target.value })}>
                  <option value="deskcomm">{t.typeDeskcomm}</option>
                  <option value="webhook">{t.typeWebhook}</option>
                </Select>
              </Field>
              <Field label={t.url}>
                <TextInput mono type="url" placeholder={URL_PREFIX} value={whatsapp.url} onChange={(event) => setWhatsapp({ ...whatsapp, url: event.target.value })} required />
              </Field>
              <Field label={t.token} hint={connectorMoved ? t.tokenAgain : savedConnector ? t.tokenKept : undefined}>
                <TextInput mono type="password" autoComplete="off" value={whatsapp.token} onChange={(event) => setWhatsapp({ ...whatsapp, token: event.target.value })} required={!savedConnector || connectorMoved} />
              </Field>
            </fieldset>
            {canConfigure ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" busy={saveConnector.busy}>
                  {t.saveConnector}
                </Button>
                {savedConnector && !removingConnector ? (
                  <Button variant="ghost" onClick={() => setRemovingConnector(true)}>
                    {t.removeConnector}
                  </Button>
                ) : null}
                <ActionStatus action={saveConnector} />
              </div>
            ) : null}
            {canConfigure && savedConnector && removingConnector ? (
              <Notice tone="fail">
                <p>{fill(t.removeConnectorConfirm, { url: savedConnector.url })}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    busy={saveConnector.busy}
                    onClick={() =>
                      void saveConnector.run(() => put("whatsapp.connector", null)).then((ok) => {
                        if (ok) {
                          setWhatsapp({ type: "deskcomm", url: "", token: "" });
                          setRemovingConnector(false);
                        }
                        connector.reload();
                      })
                    }
                  >
                    {t.removeConnectorYes}
                  </Button>
                  <Button variant="ghost" onClick={() => setRemovingConnector(false)}>
                    {common.actions.cancel}
                  </Button>
                </div>
              </Notice>
            ) : null}
          </form>
        )}
        <div className="mt-5 grid gap-3 border-t border-line pt-5">
          <h3 className="font-bold">{t.trustCallerTitle}</h3>
          <p className="max-w-prose text-muted">{t.trustCallerLead}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              label={t.trustCallerSwitch}
              disabled={!canConfigure || saveTrustCaller.busy}
              checked={trustCaller.data?.value === true}
              onChange={(next) => void saveTrustCaller.run(() => put("whatsapp.trust_caller_id", next)).then(trustCaller.reload)}
            />
            <ActionStatus action={saveTrustCaller} />
          </div>
        </div>
      </Panel>

      <WhatsAppCallsPanel />
    </>
  );
}
