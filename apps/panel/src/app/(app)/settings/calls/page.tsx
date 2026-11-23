"use client";

import { useEffect, useState } from "react";
import en from "../../../../i18n/en/settings";
import es from "../../../../i18n/es/settings";
import ptBR from "../../../../i18n/pt-BR/settings";
import { useDict } from "../../../../i18n/provider";
import { useApi } from "../../../../ui/api";
import { ActionStatus, useAction } from "../../../../ui/errors";
import { Button, Field, Notice, Panel, Select, Switch, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import type { Setting } from "../../../../ui/types";
import { put } from "../setting-api";

export default function CallsSettings() {
  const t = useDict(ptBR, en, es);
  const canConfigure = useCanConfigure();
  const inboundLimit = useApi<Setting<number>>("/settings/inbound.max_concurrent_calls");
  const onTimeout = useApi<Setting<"denied" | "approved">>("/settings/approvals.default_on_timeout");
  const voicemail = useApi<Setting<boolean>>("/settings/voicemail.enabled");
  const voicemailSeconds = useApi<Setting<number>>("/settings/voicemail.max_seconds");
  const voicemailLanguage = useApi<Setting<"pt-BR" | "en" | "es">>("/settings/voicemail.language");
  // A caixa postal só atende com a gravação ligada (decisão 0018): a tela diz quando ela está desligada.
  const privacy = useApi<{ recording: boolean }>(canConfigure ? "/privacy" : null);
  const saveInboundLimit = useAction();
  const saveOnTimeout = useAction();
  const saveVoicemail = useAction();
  const saveVoicemailSeconds = useAction();
  const saveVoicemailLanguage = useAction();
  const [limit, setLimit] = useState("");
  const [maxSeconds, setMaxSeconds] = useState("");

  useEffect(() => {
    if (inboundLimit.data?.value != null) setLimit(String(inboundLimit.data.value));
  }, [inboundLimit.data]);
  useEffect(() => {
    if (voicemailSeconds.data?.value != null) setMaxSeconds(String(voicemailSeconds.data.value));
  }, [voicemailSeconds.data]);

  return (
    <>
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

      <Panel title={t.voicemailTitle} description={t.voicemailLead}>
        <div className="grid max-w-md gap-4">
          <Notice>
            {t.voicemailTerms.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </Notice>
          <Switch
            label={t.voicemailSwitch}
            disabled={!canConfigure || saveVoicemail.busy}
            checked={voicemail.data?.value === true}
            onChange={(next) => void saveVoicemail.run(() => put("voicemail.enabled", next)).then(voicemail.reload)}
          />
          <ActionStatus action={saveVoicemail} />
          {voicemail.data?.value === true && privacy.data?.recording === false ? <Notice tone="warn">{t.voicemailNeedsRecording}</Notice> : null}
          <Field label={t.voicemailLanguage} hint={t.voicemailLanguageHint}>
            <Select
              disabled={!canConfigure}
              value={voicemailLanguage.data?.value ?? "pt-BR"}
              onChange={(event) => void saveVoicemailLanguage.run(() => put("voicemail.language", event.target.value)).then(voicemailLanguage.reload)}
            >
              <option value="pt-BR">{t.voicemailLanguages["pt-BR"]}</option>
              <option value="en">{t.voicemailLanguages.en}</option>
              <option value="es">{t.voicemailLanguages.es}</option>
            </Select>
          </Field>
          <ActionStatus action={saveVoicemailLanguage} />
          <form
            className="grid gap-4 border-t border-line pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveVoicemailSeconds.run(() => put("voicemail.max_seconds", Number(maxSeconds))).then(voicemailSeconds.reload);
            }}
          >
            <Field label={t.voicemailMaxSeconds} hint={t.voicemailMaxSecondsHint}>
              <TextInput mono type="number" min={5} max={300} step={1} disabled={!canConfigure} value={maxSeconds} onChange={(event) => setMaxSeconds(event.target.value)} required />
            </Field>
            {canConfigure ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" busy={saveVoicemailSeconds.busy}>
                  {t.saveVoicemail}
                </Button>
                <ActionStatus action={saveVoicemailSeconds} />
              </div>
            ) : null}
          </form>
        </div>
      </Panel>

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
    </>
  );
}
