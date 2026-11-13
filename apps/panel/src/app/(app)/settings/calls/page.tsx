"use client";

import { useEffect, useState } from "react";
import en from "../../../../i18n/en/settings";
import es from "../../../../i18n/es/settings";
import ptBR from "../../../../i18n/pt-BR/settings";
import { useDict } from "../../../../i18n/provider";
import { useApi } from "../../../../ui/api";
import { ActionStatus, useAction } from "../../../../ui/errors";
import { Button, Field, Notice, Panel, Select, TextArea, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import type { Setting } from "../../../../ui/types";
import { put } from "../setting-api";

export default function CallsSettings() {
  const t = useDict(ptBR, en, es);
  const canConfigure = useCanConfigure();
  const inboundLimit = useApi<Setting<number>>("/settings/inbound.max_concurrent_calls");
  const onTimeout = useApi<Setting<"denied" | "approved">>("/settings/approvals.default_on_timeout");
  const recording = useApi<Setting<string>>("/settings/recording_notice.text");
  const saveInboundLimit = useAction();
  const saveOnTimeout = useAction();
  const saveRecording = useAction();
  const [limit, setLimit] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (inboundLimit.data?.value != null) setLimit(String(inboundLimit.data.value));
  }, [inboundLimit.data]);
  useEffect(() => setNotice(recording.data?.value ?? ""), [recording.data]);

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
