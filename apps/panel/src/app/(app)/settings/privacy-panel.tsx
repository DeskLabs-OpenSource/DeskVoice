"use client";

import { useEffect, useState } from "react";
import commonEn from "../../../i18n/en/common";
import en from "../../../i18n/en/privacy";
import commonEs from "../../../i18n/es/common";
import es from "../../../i18n/es/privacy";
import { fill } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import ptBR, { type PrivacyDictionary } from "../../../i18n/pt-BR/privacy";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus, useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatPhone } from "../../../ui/format";
import { Button, Field, Notice, Panel, Skeleton, Switch, TextInput } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";

type Kind = keyof PrivacyDictionary["history"];
interface Entry {
  id: string;
  at: string;
  kind: Kind;
  actorName: string | null;
  payload: Record<string, unknown>;
}
interface Privacy {
  retentionDays: number | null;
  recording: boolean;
  minDays: number;
  maxDays: number;
  history: Entry[];
}
interface Exported {
  phone: string;
  exportedAt: string;
  counts: { calls: number; events: number; doNotCall: boolean };
  content: string;
}

const numberOf = (value: unknown): number => (typeof value === "number" ? value : 0);

/** Uma linha do registro, na voz da tela. */
function describe(entry: Entry, t: PrivacyDictionary): string {
  const p = entry.payload;
  const span = (value: unknown): string => (typeof value === "number" ? fill(t.days, { n: value }) : t.forever);
  const who = entry.actorName ?? t.removedPerson;
  switch (entry.kind) {
    case "transcript_retention_changed":
      return fill(t.history.transcript_retention_changed, { who, from: span(p.from), to: span(p.to) });
    case "transcripts_purged": {
      const line = fill(t.history.transcripts_purged, { days: numberOf(p.retentionDays), count: numberOf(p.count) });
      return numberOf(p.recordings) > 0 ? `${line} ${fill(t.purgedRecordings, { count: numberOf(p.recordings) })}` : line;
    }
    case "caller_data_exported":
      return fill(t.history.caller_data_exported, { who, phone: formatPhone(typeof p.phone === "string" ? p.phone : ""), calls: numberOf(p.calls), events: numberOf(p.events) });
    case "call_recording_changed":
      return fill(t.history.call_recording_changed, { who, state: p.to === true ? t.recordingStates.on : t.recordingStates.off });
  }
}

/** O arquivo sai do navegador: o telefone nunca vai num endereço, que acabaria no log do servidor. */
function download(result: Exported, t: PrivacyDictionary): void {
  const url = URL.createObjectURL(new Blob([result.content], { type: "application/x-ndjson" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fill(t.fileName, { phone: result.phone.replace(/\D/g, ""), date: result.exportedAt.slice(0, 10) });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Os direitos de quem ligou, pela tela (registros 0014 e 0016): a gravação do áudio, o prazo de
 * guarda da transcrição e a exportação do que a organização guarda sobre um telefone, com o
 * registro de cada um. Só dono ou administrador; para o operador a seção não aparece.
 */
export function PrivacyPanel() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const locale = useLocale();
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const state = useApi<Privacy>(canConfigure ? "/privacy" : null);
  const save = useAction();
  const recorder = useAction();
  const exporter = useAction();
  const [days, setDays] = useState("");
  // O prazo que espera confirmação: gravar um prazo que apaga só abre o pedido.
  const [confirming, setConfirming] = useState<number | null>(null);
  const [phone, setPhone] = useState("");
  const [exported, setExported] = useState<Exported | null>(null);

  useEffect(() => {
    if (state.data) setDays(state.data.retentionDays === null ? "" : String(state.data.retentionDays));
  }, [state.data]);

  if (!canConfigure) return null;
  if (state.error && !state.data) return <Notice tone="fail">{errorText(state.error)}</Notice>;
  if (!state.data) return <Skeleton lines={2} />;
  const { retentionDays: current, recording, minDays, maxDays, history } = state.data;

  const store = (next: number | null): void =>
    void save.run(() => api("/privacy/retention", { method: "PUT", body: { days: next } })).then((ok) => {
      if (ok) setConfirming(null);
      state.reload();
    });

  // Ligar e desligar não apagam nada (o que já foi gravado segue o prazo): sem confirmação.
  const setRecording = (enabled: boolean): void =>
    void recorder.run(() => api("/privacy/recording", { method: "PUT", body: { enabled } })).then(state.reload);

  return (
    <>
      <Panel title={t.recordingTitle} description={t.recordingLead}>
        <div className="grid max-w-xl gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={recording} onChange={setRecording} label={t.recordingSwitch} disabled={recorder.busy} />
            <ActionStatus action={recorder} />
          </div>
          <p>{t.recordingDisk}</p>
          <Notice>{t.recordingKeeps}</Notice>
        </div>
      </Panel>

      <Panel title={t.retentionTitle} description={t.retentionLead}>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const next = days.trim() === "" ? null : Number(days);
            // Apaga quando passa a ter prazo ou quando o prazo encurta. Alongar ou voltar a "para sempre" não apaga nada.
            if (next !== null && (current === null || next < current)) setConfirming(next);
            else store(next);
          }}
        >
          <p>{current === null ? t.currentForever : fill(t.currentDays, { days: current })}</p>
          <Field label={t.retentionDays} hint={fill(t.retentionHint, { min: minDays })}>
            <TextInput mono type="number" className="max-w-40" min={minDays} max={maxDays} step={1} value={days} onChange={(event) => setDays(event.target.value)} />
          </Field>
          <Notice tone="warn">{t.irreversible}</Notice>
          {confirming === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={save.busy}>
                {t.save}
              </Button>
              <ActionStatus action={save} />
            </div>
          ) : (
            <Notice tone="fail">
              <p className="font-bold">{fill(t.confirmTitle, { days: confirming })}</p>
              <p>{t.confirmBody}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button variant="danger" busy={save.busy} onClick={() => store(confirming)}>
                  {fill(t.confirmYes, { days: confirming })}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  {common.actions.cancel}
                </Button>
              </div>
              {save.error ? <p>{save.error}</p> : null}
            </Notice>
          )}
        </form>
      </Panel>

      <Panel title={t.exportTitle} description={t.exportLead}>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setExported(null);
            void exporter
              .run(async () => {
                const result = await api<Exported>("/privacy/export", { body: { phone } });
                if (result.counts.calls > 0 || result.counts.doNotCall) download(result, t);
                setExported(result);
              })
              .then(state.reload);
          }}
        >
          <Field label={t.exportPhone} hint={t.exportPhoneHint}>
            <TextInput mono type="tel" className="max-w-60" value={phone} onChange={(event) => setPhone(event.target.value)} required />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" busy={exporter.busy}>
              {t.exportRun}
            </Button>
          </div>
          {exporter.error ? <Notice tone="fail">{exporter.error}</Notice> : null}
          {exported && exported.counts.calls === 0 && !exported.counts.doNotCall ? <Notice>{fill(t.exportEmpty, { phone: formatPhone(exported.phone) })}</Notice> : null}
          {exported && (exported.counts.calls > 0 || exported.counts.doNotCall) ? (
            <Notice tone="ok">
              <p>{fill(t.exportDone, { phone: formatPhone(exported.phone), calls: exported.counts.calls, events: exported.counts.events })}</p>
              {exported.counts.doNotCall ? <p>{t.exportDoneDnc}</p> : null}
              <p>{t.exportCare}</p>
            </Notice>
          ) : null}
        </form>
      </Panel>

      <Panel title={t.historyTitle} description={t.historyLead}>
        {history.length === 0 ? (
          <p className="text-muted">{t.historyEmpty}</p>
        ) : (
          <ul className="grid">
            {history.map((entry) => (
              <li key={entry.id} className="grid gap-0.5 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-4">
                <span className="data text-[0.87rem] text-muted">{formatDateTime(entry.at, locale)}</span>
                <span>{describe(entry, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
