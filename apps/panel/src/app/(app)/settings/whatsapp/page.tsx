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
import { Advanced } from "../advanced";
import { DeskcommCrm } from "../deskcomm-crm";
import { URL_PREFIX, put } from "../setting-api";
import { WhatsAppPanel } from "../whatsapp-panel";

// `waha` é o número conectado por QR Code: não tem endereço e não se edita por este formulário.
// O `deskcomm` com `crmUrl` fala o contrato do CRM (#330, fatia 2); sem ele, manda para a `url`.
type Connector = { type: "deskcomm" | "webhook"; url: string; crmUrl?: string; channelSessionId?: string; channelLabel?: string } | { type: "waha" };
// Como o `deskcomm` fala: pelo contrato do CRM, ou pelo formato antigo, num endereço próprio.
type Mode = "crm" | "legacy";
const sameAddress = (a: string, b: string): boolean => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export default function WhatsAppSettings() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const canConfigure = useCanConfigure();
  const connector = useApi<Setting<Connector>>("/settings/whatsapp.connector");
  const trustCaller = useApi<Setting<boolean>>("/settings/whatsapp.trust_caller_id");
  const saveConnector = useAction();
  const saveTrustCaller = useAction();
  const ownerNotice = useApi<Setting<boolean>>("/settings/whatsapp.notify_owner_on_call_end");
  const saveOwnerNotice = useAction();
  const [whatsapp, setWhatsapp] = useState<{ type: string; url: string; token: string; mode: Mode }>({ type: "deskcomm", url: "", token: "", mode: "crm" });
  // A remoção espera confirmação: o botão só abre o pedido, nunca remove.
  const [removingConnector, setRemovingConnector] = useState(false);

  useEffect(() => {
    const value = connector.data?.value;
    if (value && value.type !== "waha") setWhatsapp({ type: value.type, url: value.crmUrl ?? value.url, token: "", mode: value.type === "deskcomm" && value.crmUrl === undefined ? "legacy" : "crm" });
  }, [connector.data]);

  const connectorValue = connector.data?.value;
  const connectedByQr = connectorValue?.type === "waha";
  const savedConnector = connectorValue && connectorValue.type !== "waha" ? connectorValue : undefined;
  const toCrm = whatsapp.type === "deskcomm" && whatsapp.mode === "crm";
  const savedCrm = savedConnector?.type === "deskcomm" && savedConnector.crmUrl !== undefined ? { ...savedConnector, crmUrl: savedConnector.crmUrl } : undefined;
  // O destino do token: o tipo, o endereço e se o endereço é do CRM, como no servidor.
  const connectorMoved =
    savedConnector != null && (savedConnector.type !== whatsapp.type || !sameAddress(savedConnector.crmUrl ?? savedConnector.url, whatsapp.url) || (savedConnector.crmUrl !== undefined) !== toCrm);

  return (
    <>
      <WhatsAppPanel onChanged={connector.reload} />

      <Panel title={t.whatsappTitle} description={t.whatsappLead}>
        {/* O conector externo e "Confiar no número": no Avançado, fechado ao abrir a tela. O aviso do agente aponta para #avancado. */}
        <Advanced>
          {connectedByQr ? (
            <Notice>{t.connectorIsWaha}</Notice>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const { token, type, url } = whatsapp;
                // O canal continua enquanto o CRM for o mesmo; outro CRM começa pela regra dele.
                const channel = toCrm && savedCrm && sameAddress(savedCrm.crmUrl, whatsapp.url) && savedCrm.channelSessionId ? { channelSessionId: savedCrm.channelSessionId, ...(savedCrm.channelLabel && { channelLabel: savedCrm.channelLabel }) } : {};
                void saveConnector.run(() => put("whatsapp.connector", { type, url, ...(toCrm && { crmUrl: whatsapp.url, ...channel }), ...(token && { token }) })).then(connector.reload);
              }}
            >
              <fieldset disabled={!canConfigure} className="grid gap-4 md:grid-cols-2">
                <Field label={t.connectorType}>
                  <Select value={whatsapp.type} onChange={(event) => setWhatsapp({ ...whatsapp, type: event.target.value })}>
                    <option value="deskcomm">{t.typeDeskcomm}</option>
                    <option value="webhook">{t.typeWebhook}</option>
                  </Select>
                </Field>
                {whatsapp.type === "deskcomm" ? (
                  <Field label={t.crmMode}>
                    <Select value={whatsapp.mode} onChange={(event) => setWhatsapp({ ...whatsapp, mode: event.target.value === "legacy" ? "legacy" : "crm" })}>
                      <option value="crm">{t.crmModeCrm}</option>
                      <option value="legacy">{t.crmModeLegacy}</option>
                    </Select>
                  </Field>
                ) : null}
                <Field label={toCrm ? t.crmUrl : t.url} hint={toCrm ? t.crmUrlHint : whatsapp.type === "deskcomm" ? t.crmLegacyHint : undefined}>
                  <TextInput mono type="url" placeholder={URL_PREFIX} value={whatsapp.url} onChange={(event) => setWhatsapp({ ...whatsapp, url: event.target.value })} required />
                </Field>
                <Field label={t.token} hint={connectorMoved ? t.tokenAgain : savedConnector ? t.tokenKept : undefined}>
                  <TextInput mono type="password" autoComplete="off" value={whatsapp.token} onChange={(event) => setWhatsapp({ ...whatsapp, token: event.target.value })} required={!savedConnector || connectorMoved} />
                </Field>
              </fieldset>
              {toCrm ? <p className="max-w-prose text-muted">{t.crmTokenHint}</p> : null}
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
                            setWhatsapp({ type: "deskcomm", url: "", token: "", mode: "crm" });
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
          {savedCrm && !connectedByQr ? <DeskcommCrm saved={savedCrm} canConfigure={canConfigure} onSaved={connector.reload} /> : null}
          <div className="grid gap-3 border-t border-line pt-5">
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
        </Advanced>
        <div className="mt-5 grid gap-3 border-t border-line pt-5">
          <h3 className="font-bold">{t.ownerNoticeTitle}</h3>
          <p className="max-w-prose text-muted">{t.ownerNoticeLead}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              label={t.ownerNoticeSwitch}
              disabled={!canConfigure || saveOwnerNotice.busy}
              checked={ownerNotice.data?.value === true}
              onChange={(next) => void saveOwnerNotice.run(() => put("whatsapp.notify_owner_on_call_end", next)).then(ownerNotice.reload)}
            />
            <ActionStatus action={saveOwnerNotice} />
          </div>
        </div>
      </Panel>
    </>
  );
}
