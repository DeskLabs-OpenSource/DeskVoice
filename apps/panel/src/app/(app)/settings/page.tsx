"use client";

import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import commonEn from "../../../i18n/en/common";
import en from "../../../i18n/en/settings";
import commonEs from "../../../i18n/es/common";
import es from "../../../i18n/es/settings";
import { fill } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import ptBR, { type SettingsDictionary } from "../../../i18n/pt-BR/settings";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus, ReadOnlyNotice, useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatDay, formatPhone } from "../../../ui/format";
import { Badge, Button, Field, Notice, PageHeader, Panel, Select, Skeleton, Switch, TextArea, TextInput } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { Engine, KeyCheck, KeyCheckResult, Me, Setting } from "../../../ui/types";
import { PrivacyPanel } from "./privacy-panel";
import { UpdatePanel } from "./update-panel";
import { WhatsAppCallsPanel } from "./whatsapp-calls-panel";
import { WhatsAppPanel } from "./whatsapp-panel";

// Igual em todo idioma: não é frase, é o começo de um endereço.
const URL_PREFIX = "https://";
const put = (key: string, value: unknown): Promise<unknown> => api(`/settings/${key}`, { method: "PUT", body: { value } });

const KEY_CHECK_TONE: Record<KeyCheckResult, "ok" | "warn" | "fail" | "neutral"> = {
  accepted: "ok",
  rejected: "fail",
  model_unavailable: "fail",
  no_credit: "fail",
  region_unavailable: "fail",
  rate_limited: "warn",
  unreachable: "warn",
  unexpected_response: "warn",
  not_needed: "neutral",
};

/** O último teste da chave em vigor, ou que ela ainda não foi testada. */
function KeyCheckStatus({ check, t }: { check: KeyCheck | null; t: SettingsDictionary }) {
  const locale = useLocale();
  if (!check) return <p className="text-sm text-muted">{t.keyNeverTested}</p>;
  const result = fill(t.keyResults[check.result], { model: check.model ?? "" });
  return <Notice tone={KEY_CHECK_TONE[check.result]}>{fill(t.keyTested, { when: formatDateTime(check.checkedAt, locale), result })}</Notice>;
}

/** Chave de um motor: a tela só sabe se existe e o resultado do último teste. Para trocar, cola-se a nova. */
function EngineKey({ engine, t, cancel, onChanged }: { engine: Engine; t: SettingsDictionary; cancel: string; onChanged(): void }) {
  const canConfigure = useCanConfigure();
  const save = useAction();
  const test = useAction();
  const [key, setKey] = useState("");
  const [confirming, setConfirming] = useState(false);
  // A gravação testa a chave nova; `check: null` diz que o limite de testes adiou o teste.
  const [testPostponed, setTestPostponed] = useState(false);
  const settingKey = `engine.${engine.id}.api_key`;
  const location = engine.processingLocation;
  const locale = useLocale();
  const change = (value: string | null): void => {
    setTestPostponed(false);
    void save.run(async () => setTestPostponed((await api<{ check?: unknown }>(`/settings/${settingKey}`, { method: "PUT", body: { value } })).check === null)).then((ok) => {
      if (ok) {
        setKey("");
        setConfirming(false);
      }
      onChanged();
    });
  };
  return (
    <li className="grid gap-3 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">{engine.label}</span>
        {engine.requiresKey ? <Badge tone={engine.keyConfigured ? "ok" : "warn"}>{engine.keyConfigured ? t.keyConfigured : t.keyMissing}</Badge> : <Badge>{t.keyNotNeeded}</Badge>}
      </div>
      {/* Onde o áudio vai: país declarado com fonte, "neste servidor", ou "não declara". */}
      <p className="text-muted">
        {fill(t.engineWhere, {
          where:
            location.kind === "this-server" ? t.engineHere : location.kind === "undeclared" ? t.engineUnknown : `${location.country} (${engine.provider})`,
        })}
        {location.kind === "country" ? (
          <>
            {" · "}
            <a className="underline" href={location.source.url} target="_blank" rel="noreferrer">
              {fill(t.engineSourceChecked, { date: formatDay(location.source.checkedOn, locale) })}
            </a>
          </>
        ) : null}
      </p>
      {engine.requiresKey && canConfigure ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            change(key);
          }}
        >
          <TextInput mono type="password" autoComplete="off" className="max-w-md" aria-label={fill(t.keyOf, { engine: engine.label })} placeholder={engine.keyConfigured ? t.keyNew : undefined} value={key} onChange={(event) => setKey(event.target.value)} required />
          <Button type="submit" busy={save.busy}>
            {t.keySave}
          </Button>
          {engine.keyConfigured ? (
            <Button variant="secondary" busy={test.busy} onClick={() => void test.run(() => api(`/engines/${engine.id}/key-check`, { method: "POST" })).then(onChanged)}>
              {t.keyTest}
            </Button>
          ) : null}
          {engine.keyConfigured && !confirming ? (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t.keyRemove}
            </Button>
          ) : null}
          <ActionStatus action={save} />
        </form>
      ) : null}
      {engine.requiresKey && engine.keyConfigured ? <KeyCheckStatus check={engine.keyCheck} t={t} /> : null}
      {testPostponed ? <Notice tone="warn">{t.keySavedNotTested}</Notice> : null}
      {test.error ? <Notice tone="fail">{test.error}</Notice> : null}
      {canConfigure && engine.keyConfigured && confirming ? (
        <Notice tone="fail">
          <p>{fill(t.keyRemoveConfirm, { engine: engine.label })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={save.busy} onClick={() => change(null)}>
              {fill(t.keyRemoveYes, { engine: engine.label })}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {cancel}
            </Button>
          </div>
        </Notice>
      ) : null}
    </li>
  );
}

// `waha` é o número conectado por QR Code: não tem endereço e não se edita por este formulário.
type Connector = { type: "deskcomm" | "webhook"; url: string } | { type: "waha" };
interface Hook {
  name: string;
  url: string;
  token?: string;
  tokenKept?: boolean;
}

export default function SettingsPage() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const engines = useApi<Engine[]>("/engines");
  const defaultEngine = useApi<Setting<string>>("/settings/engine.default");
  const connector = useApi<Setting<Connector>>("/settings/whatsapp.connector");
  const trustCaller = useApi<Setting<boolean>>("/settings/whatsapp.trust_caller_id");
  const webhooks = useApi<Setting<Array<{ name: string; url: string; token: { configured: boolean } }>>>("/settings/webhooks.allowed");
  const recording = useApi<Setting<string>>("/settings/recording_notice.text");
  const me = useApi<Me>("/auth/me");
  const onTimeout = useApi<Setting<"denied" | "approved">>("/settings/approvals.default_on_timeout");
  const saveContact = useAction();
  const saveOnTimeout = useAction();
  const [contact, setContact] = useState({ name: "", phone: "", whatsapp: "" });
  const savePassword = useAction();
  const [password, setPassword] = useState({ current: "", next: "", repeat: "" });
  const saveDefault = useAction();
  const saveConnector = useAction();
  const saveTrustCaller = useAction();
  const saveHooks = useAction();
  const saveRecording = useAction();
  const [whatsapp, setWhatsapp] = useState({ type: "deskcomm", url: "", token: "" });
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [notice, setNotice] = useState("");
  const inboundLimit = useApi<Setting<number>>("/settings/inbound.max_concurrent_calls");
  const saveInboundLimit = useAction();
  const [limit, setLimit] = useState("");
  // Remoções que esperam confirmação: o botão só abre o pedido, nunca remove.
  const [removingConnector, setRemovingConnector] = useState(false);
  const [removingHook, setRemovingHook] = useState<number | null>(null);

  useEffect(() => {
    const value = connector.data?.value;
    if (value && value.type !== "waha") setWhatsapp({ type: value.type, url: value.url, token: "" });
  }, [connector.data]);
  useEffect(() => {
    if (webhooks.data) setHooks((webhooks.data.value ?? []).map((hook) => ({ name: hook.name, url: hook.url, tokenKept: hook.token.configured })));
  }, [webhooks.data]);
  useEffect(() => setNotice(recording.data?.value ?? ""), [recording.data]);
  useEffect(() => {
    if (inboundLimit.data?.value != null) setLimit(String(inboundLimit.data.value));
  }, [inboundLimit.data]);
  useEffect(() => {
    if (me.data) setContact({ name: me.data.name, phone: formatPhone(me.data.phone), whatsapp: formatPhone(me.data.whatsapp) });
  }, [me.data]);

  const connectorValue = connector.data?.value;
  const connectedByQr = connectorValue?.type === "waha";
  const savedConnector = connectorValue && connectorValue.type !== "waha" ? connectorValue : undefined;
  const connectorMoved = savedConnector != null && (savedConnector.url !== whatsapp.url || savedConnector.type !== whatsapp.type);
  if (engines.error && !engines.data) return <Notice tone="fail">{errorText(engines.error)}</Notice>;
  if (!engines.data) return <Skeleton lines={4} />;
  const setHook = (index: number, patch: Partial<Hook>): void => setHooks(hooks.map((hook, position) => (position === index ? { ...hook, ...patch } : hook)));
  const dropHook = (index: number): void => {
    setHooks(hooks.filter((_, position) => position !== index));
    setRemovingHook(null);
  };

  return (
    <>
      <PageHeader title={t.title} lead={t.lead} />

      {/* O próprio contato qualquer papel edita: é para onde vão os avisos fora do painel. */}
      <Panel title={t.contactTitle} description={t.contactLead}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveContact.run(() => api("/auth/me", { method: "PATCH", body: contact })).then(me.reload);
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t.contactName}>
              <TextInput value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} required maxLength={120} autoComplete="name" />
            </Field>
            <Field label={t.contactPhone}>
              <TextInput mono type="tel" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} autoComplete="tel" />
            </Field>
            <Field label={t.contactWhatsapp} hint={t.contactHint}>
              <TextInput mono type="tel" value={contact.whatsapp} onChange={(event) => setContact({ ...contact, whatsapp: event.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={saveContact.busy} disabled={!me.data}>
              {t.saveContact}
            </Button>
            <ActionStatus action={saveContact} />
          </div>
        </form>
      </Panel>

      <Panel title={t.passwordTitle} description={t.passwordLead}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void savePassword.run(() => api("/auth/password", { body: { current: password.current, new: password.next } })).then((ok) => ok && setPassword({ current: "", next: "", repeat: "" }));
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t.passwordCurrent}>
              <TextInput type="password" autoComplete="current-password" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} required />
            </Field>
            <Field label={t.passwordNew} hint={t.passwordNewHint}>
              <TextInput type="password" autoComplete="new-password" minLength={10} value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} required />
            </Field>
            <Field label={t.passwordRepeat} error={password.repeat !== "" && password.repeat !== password.next ? t.passwordMismatch : undefined}>
              <TextInput type="password" autoComplete="new-password" minLength={10} value={password.repeat} onChange={(event) => setPassword({ ...password, repeat: event.target.value })} required />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" busy={savePassword.busy} disabled={password.repeat !== password.next}>
              {t.savePassword}
            </Button>
            <ActionStatus action={savePassword} />
          </div>
        </form>
      </Panel>

      <ReadOnlyNotice />

      <Panel title={t.approvalTitle} description={t.approvalLead}>
        <div className="grid max-w-md gap-3">
          <Field label={t.approvalChoice}>
            <Select
              disabled={!canConfigure}
              value={onTimeout.data?.value ?? "denied"}
              onChange={(event) => void saveOnTimeout.run(() => put("approvals.default_on_timeout", event.target.value)).then(onTimeout.reload)}
            >
              <option value="denied">{t.approvalDenied}</option>
              <option value="approved">{t.approvalApproved}</option>
            </Select>
          </Field>
          {onTimeout.data?.value === "approved" ? <Notice tone="warn">{t.approvalWarning}</Notice> : null}
          <ActionStatus action={saveOnTimeout} />
        </div>
      </Panel>

      <Panel title={t.enginesTitle} description={t.enginesLead}>
        <ul className="grid">
          {engines.data.map((engine) => (
            <EngineKey key={engine.id} engine={engine} t={t} cancel={common.actions.cancel} onChanged={engines.reload} />
          ))}
        </ul>
        <div className="mt-5 grid max-w-md gap-3 border-t border-line pt-5">
          <Field label={t.defaultEngine} hint={t.defaultEngineHint}>
            <Select
              disabled={!canConfigure}
              value={defaultEngine.data?.value ?? ""}
              onChange={(event) => void saveDefault.run(() => put("engine.default", event.target.value || null)).then(defaultEngine.reload)}
            >
              <option value="" />
              {engines.data.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.label}
                </option>
              ))}
            </Select>
          </Field>
          <ActionStatus action={saveDefault} />
        </div>
      </Panel>

      <Panel title={t.inboundLimitTitle} description={t.inboundLimitLead}>
        <form
          className="grid max-w-md gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveInboundLimit.run(() => put("inbound.max_concurrent_calls", Number(limit))).then(inboundLimit.reload);
          }}
        >
          <Field label={t.inboundLimit} hint={t.inboundLimitHint}>
            <TextInput mono type="number" min={1} max={50} step={1} disabled={!canConfigure} value={limit} onChange={(event) => setLimit(event.target.value)} required />
          </Field>
          {canConfigure ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={saveInboundLimit.busy}>
                {t.saveInboundLimit}
              </Button>
              <ActionStatus action={saveInboundLimit} />
            </div>
          ) : null}
        </form>
      </Panel>

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

      <Panel title={t.webhooksTitle} description={t.webhooksLead}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = hooks.map((hook) => ({ name: hook.name, url: hook.url, ...(hook.token && { token: hook.token }) }));
            void saveHooks.run(() => put("webhooks.allowed", value)).then(webhooks.reload);
          }}
        >
          {hooks.length === 0 ? <p className="text-muted">{t.hooksEmpty}</p> : null}
          <fieldset disabled={!canConfigure} className="grid gap-4">
            {hooks.map((hook, index) => (
              <div key={index} className="grid gap-3">
                <div className="grid items-end gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
                  <Field label={t.hookName}>
                    <TextInput value={hook.name} onChange={(event) => setHook(index, { name: event.target.value, tokenKept: false })} required maxLength={60} />
                  </Field>
                  <Field label={t.hookUrl}>
                    <TextInput mono type="url" placeholder={URL_PREFIX} value={hook.url} onChange={(event) => setHook(index, { url: event.target.value, tokenKept: false })} required />
                  </Field>
                  <Field label={t.hookToken}>
                    <TextInput mono type="password" autoComplete="off" placeholder={hook.tokenKept ? t.hookTokenKept : undefined} value={hook.token ?? ""} onChange={(event) => setHook(index, { token: event.target.value })} />
                  </Field>
                  <button
                    type="button"
                    aria-label={fill(t.removeHook, { name: hook.name })}
                    className="grid size-10 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-fail"
                    // Linha em branco não tem o que perder; o resto pede confirmação com o nome.
                    onClick={() => (hook.name === "" && hook.url === "" ? dropHook(index) : setRemovingHook(removingHook === index ? null : index))}
                  >
                    <X size={16} weight="bold" aria-hidden />
                  </button>
                </div>
                {removingHook === index ? (
                  <Notice tone="fail">
                    <p>{fill(t.removeHookConfirm, { name: hook.name || hook.url })}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Button variant="danger" onClick={() => dropHook(index)}>
                        {fill(t.removeHookYes, { name: hook.name || hook.url })}
                      </Button>
                      <Button variant="ghost" onClick={() => setRemovingHook(null)}>
                        {common.actions.cancel}
                      </Button>
                    </div>
                  </Notice>
                ) : null}
              </div>
            ))}
          </fieldset>
          {canConfigure ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" icon={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setHooks([...hooks, { name: "", url: "" }])}>
                {t.addHook}
              </Button>
              <Button type="submit" busy={saveHooks.busy}>
                {t.saveHooks}
              </Button>
              <ActionStatus action={saveHooks} />
            </div>
          ) : null}
        </form>
      </Panel>

      <Panel title={t.recordingTitle} description={t.recordingLead}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveRecording.run(() => put("recording_notice.text", notice.trim() || null)).then(recording.reload);
          }}
        >
          <Field label={t.recordingText}>
            <TextArea rows={3} disabled={!canConfigure} placeholder={t.recordingExample} value={notice} onChange={(event) => setNotice(event.target.value)} maxLength={500} />
          </Field>
          {canConfigure ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={saveRecording.busy}>
                {t.saveRecording}
              </Button>
              <ActionStatus action={saveRecording} />
            </div>
          ) : null}
        </form>
      </Panel>

      <PrivacyPanel />

      <UpdatePanel />
    </>
  );
}
