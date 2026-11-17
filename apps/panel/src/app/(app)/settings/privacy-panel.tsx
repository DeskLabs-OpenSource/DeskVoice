"use client";

import { useEffect, useState } from "react";
import commonEn from "../../../i18n/en/common";
import en from "../../../i18n/en/privacy";
import commonEs from "../../../i18n/es/common";
import speechFilterEn from "../../../i18n/en/speech-filter";
import speechFilterEs from "../../../i18n/es/speech-filter";
import speechFilterPtBR from "../../../i18n/pt-BR/speech-filter";
import es from "../../../i18n/es/privacy";
import { fill, type Locale } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import ptBR, { type PrivacyDictionary } from "../../../i18n/pt-BR/privacy";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus, useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatPhone } from "../../../ui/format";
import { Button, Field, Notice, Panel, Skeleton, Switch, TextInput } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import { forgetTarget } from "../../../ui/forget-target";
import { notesRetentionNeedsConfirm, notesRetentionProblem } from "../../../ui/notes-retention";

type Kind = keyof PrivacyDictionary["history"];
export interface Entry {
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
  notesRetention: NotesRetention;
  callerMemoryAgent: boolean;
  history: Entry[];
}
interface NotesRetention {
  configured: number | null;
  days: number;
  effective: number;
  defaultDays: number;
  minDays: number;
  maxDays: number;
}
interface Exported {
  phone: string;
  exportedAt: string;
  counts: { calls: number; events: number; doNotCall: boolean; followUps: number; notes: number };
  content: string;
}

interface Forgotten {
  phone: string;
  notes: number;
  followUps: number;
}

interface ErasureCounts {
  calls: number;
  events: number;
  followUps: number;
  notifications: number;
  approvals: number;
  notes: number;
  recordings: number;
}
interface ErasurePreview extends ErasureCounts {
  phone: string;
  live: boolean;
}

const numberOf = (value: unknown): number => (typeof value === "number" ? value : 0);
const hasRecord = (counts: Exported["counts"]): boolean => counts.calls > 0 || counts.doNotCall || counts.followUps > 0 || counts.notes > 0;
const hasErasable = (counts: ErasureCounts): boolean => counts.calls + counts.followUps + counts.notifications + counts.approvals + counts.notes + counts.recordings > 0;

const countsLine = ({ calls, events, followUps, notifications, approvals, notes, recordings }: ErasureCounts, t: PrivacyDictionary): string =>
  fill(t.erasureCounts, { calls, events, followUps, notifications, approvals, notes, recordings });

/**
 * O nome do fornecedor como a tela o escreve (o mesmo do aviso do filtro e do analista), e nunca o id
 * gravado no recibo: "TypeSafe", e não "typesafe". Fornecedor sem nome conhecido sai como foi gravado.
 */
const PROVIDER_NAMES: Record<Locale, Record<string, string>> = { "pt-BR": speechFilterPtBR.providers, en: speechFilterEn.providers, es: speechFilterEs.providers };
export const providerLabel = (provider: string, locale: Locale): string => PROVIDER_NAMES[locale][provider] ?? provider;

/** Uma linha do registro, na voz da tela. */
export function describe(entry: Entry, t: PrivacyDictionary, locale: Locale): string {
  const p = entry.payload;
  const span = (value: unknown): string => (typeof value === "number" ? fill(t.days, { n: value }) : t.forever);
  const who = entry.actorName ?? t.removedPerson;
  switch (entry.kind) {
    case "transcript_retention_changed":
      return fill(t.history.transcript_retention_changed, { who, from: span(p.from), to: span(p.to) });
    case "transcripts_purged": {
      const line = fill(t.history.transcripts_purged, { days: numberOf(p.retentionDays), count: numberOf(p.count) });
      const extra = [
        numberOf(p.recordings) > 0 ? fill(t.purgedRecordings, { count: numberOf(p.recordings) }) : null,
        numberOf(p.followUps) > 0 ? fill(t.purgedFollowUps, { count: numberOf(p.followUps) }) : null,
        numberOf(p.notes) > 0 ? fill(t.purgedNotes, { count: numberOf(p.notes) }) : null,
      ];
      return [line, ...extra].filter(Boolean).join(" ");
    }
    case "caller_data_exported":
      return fill(t.history.caller_data_exported, { who, phone: formatPhone(typeof p.phone === "string" ? p.phone : ""), calls: numberOf(p.calls), events: numberOf(p.events) });
    case "call_recording_changed":
      return fill(t.history.call_recording_changed, { who, state: p.to === true ? t.recordingStates.on : t.recordingStates.off });
    case "caller_data_erased":
      return fill(t.history.caller_data_erased, { who, suffix: typeof p.phoneSuffix === "string" ? p.phoneSuffix : "", calls: numberOf(p.calls), recordings: numberOf(p.recordings) });
    case "caller_recordings_erased": {
      const line = fill(t.history.caller_recordings_erased, { removed: numberOf(p.removed) });
      return numberOf(p.left) > 0 ? `${line} ${fill(t.erasedRecordingsLeft, { left: numberOf(p.left) })}` : line;
    }
    case "share_created":
      return fill(t.history.share_created, { who, until: typeof p.expiresAt === "string" ? formatDateTime(p.expiresAt, locale) : "", uses: numberOf(p.maxUses) });
    case "share_downloaded":
      return fill(t.history.share_downloaded, { use: numberOf(p.use), uses: numberOf(p.maxUses) });
    case "share_revoked":
      return fill(t.history.share_revoked, { who, count: numberOf(p.revoked) });
    case "caller_notes_purged":
      return fill(t.history.caller_notes_purged, { days: numberOf(p.retentionDays), count: numberOf(p.count) });
    case "caller_notes_deleted":
      // Sem final de telefone: uma nota apagada pelo botão do bloco "Este número". Com ele: "Esquecer este número".
      return typeof p.phoneSuffix === "string"
        ? fill(t.history.caller_notes_deleted, { who, suffix: p.phoneSuffix, notes: numberOf(p.notes), followUps: numberOf(p.followUps) })
        : fill(t.noteDeleted, { who });
    case "caller_notes_retention_changed": {
      // `from` nulo: a organização nunca tinha escolhido, e valia o prazo de fábrica.
      const notesSpan = (value: unknown, fallback: string): string => (typeof value === "number" ? fill(t.days, { n: value }) : fallback);
      return fill(t.history.caller_notes_retention_changed, { who, from: notesSpan(p.from, t.factoryDefault), to: notesSpan(p.to, t.factoryDefault) });
    }
    case "caller_memory_changed":
      return fill(t.history.caller_memory_changed, { who, state: p.to === true ? t.memoryStates.on : t.memoryStates.off });
    case "analyst_provider_confirmed":
      // O nome de quem confirmou vem do recibo, gravado no momento: a pessoa pode ter saído da equipe.
      return fill(t.history.analyst_provider_confirmed, {
        who: typeof p.confirmedByName === "string" ? p.confirmedByName : who,
        analyst: typeof p.analystName === "string" ? p.analystName : "",
        provider: typeof p.provider === "string" ? providerLabel(p.provider, locale) : "",
      });
    case "decision_model_provider_confirmed":
      // O recibo do filtro de fala: fica mesmo depois de desligar ou trocar de modelo.
      return fill(t.history.decision_model_provider_confirmed, {
        who: typeof p.confirmedByName === "string" ? p.confirmedByName : who,
        provider: typeof p.provider === "string" ? providerLabel(p.provider, locale) : "",
      });
    // Feitos pela administração da instalação, que não tem vínculo aqui: a frase não tem "quem".
    case "organization_created":
      return fill(t.history.organization_created, { name: typeof p.name === "string" ? p.name : "" });
    case "organization_renamed":
      return fill(t.history.organization_renamed, { from: typeof p.from === "string" ? p.from : "", to: typeof p.to === "string" ? p.to : "" });
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
 * Os direitos de quem ligou, pela tela (registros 0014, 0016 e 0020): a gravação do áudio, o prazo de
 * guarda da transcrição, o prazo da memória entre chamadas (as notas do agente), a exportação e o apagamento a pedido do titular do que a organização
 * guarda sobre um telefone, com o registro de cada um. Só dono ou administrador; para o operador a seção não aparece.
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
  const previewer = useAction();
  const eraser = useAction();
  const [erasePhone, setErasePhone] = useState("");
  // A prévia é o pedido de confirmação: o botão que apaga só existe com ela na tela, e nomeia o telefone dela.
  const [preview, setPreview] = useState<ErasurePreview | null>(null);
  const [erased, setErased] = useState<{ phone: string; counts: ErasureCounts } | null>(null);
  const forgetter = useAction();
  const [forgetPhone, setForgetPhone] = useState("");
  // O telefone que espera confirmação: o botão que apaga só existe com ele na tela, e o nomeia.
  const [forgetConfirming, setForgetConfirming] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState<Forgotten | null>(null);
  const [forgetInvalid, setForgetInvalid] = useState<string | null>(null);
  const notesSaver = useAction();
  const memorySaver = useAction();
  const [notesDays, setNotesDays] = useState("");
  const [notesProblem, setNotesProblem] = useState<string | null>(null);
  // O prazo da memória que espera confirmação: encurtar apaga as notas mais velhas.
  const [notesConfirming, setNotesConfirming] = useState<number | null>(null);

  useEffect(() => {
    if (state.data) setDays(state.data.retentionDays === null ? "" : String(state.data.retentionDays));
    if (state.data) setNotesDays(String(state.data.notesRetention.days));
  }, [state.data]);

  if (!canConfigure) return null;
  if (state.error && !state.data) return <Notice tone="fail">{errorText(state.error)}</Notice>;
  if (!state.data) return <Skeleton lines={2} />;
  const { retentionDays: current, recording, minDays, maxDays, notesRetention, callerMemoryAgent, history } = state.data;

  const store = (next: number | null): void =>
    void save.run(() => api("/privacy/retention", { method: "PUT", body: { days: next } })).then((ok) => {
      if (ok) setConfirming(null);
      state.reload();
    });

  const storeNotes = (next: number): void =>
    void notesSaver.run(() => api("/privacy/caller-notes-retention", { method: "PUT", body: { days: next } })).then((ok) => {
      if (ok) setNotesConfirming(null);
      state.reload();
    });

  // Ligar e desligar não apagam nada (o que já foi gravado segue o prazo): sem confirmação.
  const setRecording = (enabled: boolean): void =>
    void recorder.run(() => api("/privacy/recording", { method: "PUT", body: { enabled } })).then(state.reload);

  // Ligar e desligar não apagam nota: sem confirmação. O aviso do número forjado fica sempre à vista.
  const setCallerMemory = (enabled: boolean): void =>
    void memorySaver.run(() => api("/privacy/caller-memory", { method: "PUT", body: { enabled } })).then(state.reload);

  return (
    <>
      <Panel title={t.recordingTitle} description={t.recordingLead}>
        <div className="grid max-w-xl gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={recording} onChange={setRecording} label={t.recordingSwitch} disabled={recorder.busy} />
            <ActionStatus action={recorder} />
          </div>
          <p>{t.recordingDisk}</p>
          {recording && current === null ? <Notice tone="warn">{t.recordingForever}</Notice> : null}
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

      <Panel title={t.notesTitle} description={t.notesLead}>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const problem = notesRetentionProblem(notesDays, { minDays: notesRetention.minDays, maxDays: notesRetention.maxDays, transcriptDays: current }, t);
            setNotesProblem(problem);
            if (problem) return;
            const next = Number(notesDays);
            // Encurtar apaga as notas mais velhas: pede confirmação. Alongar não apaga nada.
            if (notesRetentionNeedsConfirm(next, notesRetention.days)) setNotesConfirming(next);
            else storeNotes(next);
          }}
        >
          <p>{fill(notesRetention.configured === null ? t.notesCurrentDefault : t.notesCurrent, { days: notesRetention.days })}</p>
          {notesRetention.effective < notesRetention.days ? <Notice tone="warn">{fill(t.notesEffective, { days: notesRetention.effective })}</Notice> : null}
          <Field label={t.notesDays} hint={fill(t.notesHint, { min: notesRetention.minDays, max: notesRetention.maxDays, default: notesRetention.defaultDays })}>
            <TextInput
              mono
              type="number"
              className="max-w-40"
              min={notesRetention.minDays}
              max={current === null ? notesRetention.maxDays : Math.min(notesRetention.maxDays, current)}
              step={1}
              value={notesDays}
              onChange={(event) => {
                setNotesDays(event.target.value);
                setNotesProblem(null);
              }}
              required
            />
          </Field>
          {notesProblem ? <Notice tone="fail">{notesProblem}</Notice> : null}
          {notesConfirming === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={notesSaver.busy}>
                {t.notesSave}
              </Button>
              <ActionStatus action={notesSaver} />
            </div>
          ) : (
            <Notice tone="fail">
              <p className="font-bold">{fill(t.notesConfirmTitle, { days: notesConfirming })}</p>
              <p>{t.notesConfirmBody}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button variant="danger" busy={notesSaver.busy} onClick={() => storeNotes(notesConfirming)}>
                  {fill(t.notesConfirmYes, { days: notesConfirming })}
                </Button>
                <Button variant="ghost" onClick={() => setNotesConfirming(null)}>
                  {common.actions.cancel}
                </Button>
              </div>
              {notesSaver.error ? <p>{notesSaver.error}</p> : null}
            </Notice>
          )}
        </form>
      </Panel>

      <Panel title={t.memoryTitle} description={t.memoryLead}>
        <div className="grid max-w-xl gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={callerMemoryAgent} onChange={setCallerMemory} label={t.memorySwitch} disabled={memorySaver.busy} />
            <ActionStatus action={memorySaver} />
          </div>
          <Notice tone="warn">{t.memorySpoofed}</Notice>
          <Notice>{t.memoryCost}</Notice>
        </div>
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
                if (hasRecord(result.counts)) download(result, t);
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
          {exported && !hasRecord(exported.counts) ? <Notice>{fill(t.exportEmpty, { phone: formatPhone(exported.phone) })}</Notice> : null}
          {exported && hasRecord(exported.counts) ? (
            <Notice tone="ok">
              <p>{fill(t.exportDone, { phone: formatPhone(exported.phone), calls: exported.counts.calls, events: exported.counts.events })}</p>
              {exported.counts.followUps > 0 ? <p>{fill(t.exportDoneFollowUps, { count: exported.counts.followUps })}</p> : null}
              {exported.counts.notes > 0 ? <p>{fill(t.exportDoneNotes, { count: exported.counts.notes })}</p> : null}
              {exported.counts.doNotCall ? <p>{t.exportDoneDnc}</p> : null}
              <p>{t.exportCare}</p>
            </Notice>
          ) : null}
        </form>
      </Panel>

      <Panel title={t.forgetTitle} description={t.forgetLead}>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setForgotten(null);
            // A confirmação nomeia o número como o servidor o vai usar; o inválido não chega a abrir.
            const target = forgetTarget(forgetPhone);
            setForgetInvalid(target === null ? fill(t.forgetInvalid, { phone: forgetPhone.trim() }) : null);
            setForgetConfirming(target);
          }}
        >
          <Field label={t.forgetPhone} hint={t.forgetPhoneHint} error={forgetInvalid ?? undefined}>
            <TextInput
              mono
              type="tel"
              className="max-w-60"
              value={forgetPhone}
              onChange={(event) => {
                setForgetPhone(event.target.value);
                setForgetConfirming(null);
                setForgetInvalid(null);
              }}
              required
            />
          </Field>
          {forgetConfirming === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit">{t.forgetRun}</Button>
            </div>
          ) : (
            <Notice tone="fail">
              <p className="font-bold">{fill(t.forgetConfirmTitle, { phone: formatPhone(forgetConfirming) })}</p>
              <p>{fill(t.forgetConfirmBody, { phone: formatPhone(forgetConfirming) })}</p>
              <p>{t.forgetKeeps}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  busy={forgetter.busy}
                  onClick={() =>
                    void forgetter
                      .run(async () => {
                        setForgotten(await api<Forgotten>("/privacy/forget", { body: { phone: forgetConfirming } }));
                        setForgetConfirming(null);
                      })
                      .then(state.reload)
                  }
                >
                  {fill(t.forgetConfirmYes, { phone: formatPhone(forgetConfirming) })}
                </Button>
                <Button variant="ghost" onClick={() => setForgetConfirming(null)}>
                  {common.actions.cancel}
                </Button>
              </div>
              {forgetter.error ? <p>{forgetter.error}</p> : null}
            </Notice>
          )}
          {forgotten ? (
            <Notice tone="ok">{fill(t.forgetDone, { phone: formatPhone(forgotten.phone), notes: forgotten.notes, followUps: forgotten.followUps })}</Notice>
          ) : null}
        </form>
      </Panel>

      <Panel title={t.erasureTitle} description={t.erasureLead}>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPreview(null);
            setErased(null);
            void previewer.run(async () => setPreview(await api<ErasurePreview>("/privacy/erasure/preview", { body: { phone: erasePhone } })));
          }}
        >
          <Field label={t.erasurePhone} hint={t.erasurePhoneHint}>
            <TextInput
              mono
              type="tel"
              className="max-w-60"
              value={erasePhone}
              onChange={(event) => {
                setErasePhone(event.target.value);
                setPreview(null);
              }}
              required
            />
          </Field>
          <Notice tone="warn">{t.erasureBackups}</Notice>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" busy={previewer.busy}>
              {t.erasurePreview}
            </Button>
          </div>
          {previewer.error ? <Notice tone="fail">{previewer.error}</Notice> : null}
          {preview?.live ? <Notice tone="warn">{fill(t.erasureLive, { phone: formatPhone(preview.phone) })}</Notice> : null}
          {preview && !preview.live && !hasErasable(preview) ? <Notice>{fill(t.erasureEmpty, { phone: formatPhone(preview.phone) })}</Notice> : null}
          {preview && !preview.live && hasErasable(preview) ? (
            <Notice tone="fail">
              <p className="font-bold">{fill(t.erasureConfirmTitle, { phone: formatPhone(preview.phone) })}</p>
              <p>{countsLine(preview, t)}</p>
              <p>{t.erasureConfirmBody}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  busy={eraser.busy}
                  onClick={() =>
                    void eraser
                      .run(async () => {
                        const counts = await api<ErasureCounts>("/privacy/erasure", { body: { phone: preview.phone } });
                        setErased({ phone: preview.phone, counts });
                        setPreview(null);
                      })
                      .then(state.reload)
                  }
                >
                  {fill(t.erasureConfirmYes, { phone: formatPhone(preview.phone) })}
                </Button>
                <Button variant="ghost" onClick={() => setPreview(null)}>
                  {common.actions.cancel}
                </Button>
              </div>
              {eraser.error ? <p>{eraser.error}</p> : null}
            </Notice>
          ) : null}
          {erased ? (
            <Notice tone="ok">
              <p>{fill(t.erasureDone, { phone: formatPhone(erased.phone) })}</p>
              <p>{countsLine(erased.counts, t)}</p>
              {erased.counts.recordings > 0 ? <p>{t.erasureDoneRecordings}</p> : null}
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
                <span>{describe(entry, t, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
