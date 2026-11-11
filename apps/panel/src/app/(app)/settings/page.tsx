"use client";

import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import en from "../../../i18n/en/settings";
import es from "../../../i18n/es/settings";
import { fill } from "../../../i18n/locales";
import ptBR, { type SettingsDictionary } from "../../../i18n/pt-BR/settings";
import { useDict } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus, ReadOnlyNotice, useAction, useErrorText } from "../../../ui/errors";
import { formatPhone } from "../../../ui/format";
import { Badge, Button, Field, Notice, PageHeader, Panel, Select, Skeleton, Switch, TextArea, TextInput } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { Engine, Me, Setting } from "../../../ui/types";

// Igual em todo idioma: não é frase, é o começo de um endereço.
const URL_PREFIX = "https://";
const put = (key: string, value: unknown): Promise<unknown> => api(`/settings/${key}`, { method: "PUT", body: { value } });

/** Chave de um motor: a tela só sabe se existe. Para trocar, cola-se a nova. */
function EngineKey({ engine, t, onChanged }: { engine: Engine; t: SettingsDictionary; onChanged(): void }) {
  const canConfigure = useCanConfigure();
  const save = useAction();
  const [key, setKey] = useState("");
  const settingKey = `engine.${engine.id}.api_key`;
  const change = (value: string | null): void => {
    void save.run(() => put(settingKey, value)).then((ok) => {
      if (ok) setKey("");
      onChanged();
    });
  };
  return (
    <li className="grid gap-3 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">{engine.label}</span>
        {engine.requiresKey ? <Badge tone={engine.keyConfigured ? "ok" : "warn"}>{engine.keyConfigured ? t.keyConfigured : t.keyMissing}</Badge> : <Badge>{t.keyNotNeeded}</Badge>}
      </div>
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
            <Button variant="ghost" onClick={() => change(null)}>
              {t.keyRemove}
            </Button>
          ) : null}
          <ActionStatus action={save} />
        </form>
      ) : null}
    </li>
  );
}

interface Connector {
  type: "deskcomm" | "webhook";
  url: string;
}
interface Hook {
  name: string;
  url: string;
  token?: string;
  tokenKept?: boolean;
}

export default function SettingsPage() {
  const t = useDict(ptBR, en, es);
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
  const saveDefault = useAction();
  const saveConnector = useAction();
  const saveTrustCaller = useAction();
  const saveHooks = useAction();
  const saveRecording = useAction();
  const [whatsapp, setWhatsapp] = useState({ type: "deskcomm", url: "", token: "" });
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (connector.data?.value) setWhatsapp({ type: connector.data.value.type, url: connector.data.value.url, token: "" });
  }, [connector.data]);
  useEffect(() => {
    if (webhooks.data) setHooks((webhooks.data.value ?? []).map((hook) => ({ name: hook.name, url: hook.url, tokenKept: hook.token.configured })));
  }, [webhooks.data]);
  useEffect(() => setNotice(recording.data?.value ?? ""), [recording.data]);
  useEffect(() => {
    if (me.data) setContact({ name: me.data.name, phone: formatPhone(me.data.phone), whatsapp: formatPhone(me.data.whatsapp) });
  }, [me.data]);

  const savedConnector = connector.data?.value;
  const connectorMoved = savedConnector != null && (savedConnector.url !== whatsapp.url || savedConnector.type !== whatsapp.type);
  if (engines.error && !engines.data) return <Notice tone="fail">{errorText(engines.error)}</Notice>;
  if (!engines.data) return <Skeleton lines={4} />;
  const setHook = (index: number, patch: Partial<Hook>): void => setHooks(hooks.map((hook, position) => (position === index ? { ...hook, ...patch } : hook)));

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
            <EngineKey key={engine.id} engine={engine} t={t} onChanged={engines.reload} />
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

      <Panel title={t.whatsappTitle} description={t.whatsappLead}>
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
              {connector.data?.value ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void saveConnector.run(() => put("whatsapp.connector", null)).then(() => {
                      setWhatsapp({ type: "deskcomm", url: "", token: "" });
                      connector.reload();
                    })
                  }
                >
                  {t.removeConnector}
                </Button>
              ) : null}
              <ActionStatus action={saveConnector} />
            </div>
          ) : null}
        </form>
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
              <div key={index} className="grid items-end gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
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
                  onClick={() => setHooks(hooks.filter((_, position) => position !== index))}
                >
                  <X size={16} weight="bold" aria-hidden />
                </button>
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
    </>
  );
}
