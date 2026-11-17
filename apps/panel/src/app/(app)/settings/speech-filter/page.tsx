"use client";

import type { ProcessingLocation } from "@deskvoice/voice-engine/types";
import { useEffect, useState } from "react";
import en from "../../../../i18n/en/speech-filter";
import es from "../../../../i18n/es/speech-filter";
import { fill } from "../../../../i18n/locales";
import ptBR, { type SpeechFilterDictionary } from "../../../../i18n/pt-BR/speech-filter";
import { useDict, useLocale } from "../../../../i18n/provider";
import { ApiFailure, api, useApi } from "../../../../ui/api";
import { useErrorText } from "../../../../ui/errors";
import { formatDateTime } from "../../../../ui/format";
import { Badge, Button, Field, Notice, Panel, Select, Skeleton, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import { noticeOf, providerName } from "./notice";

type CheckResult = keyof SpeechFilterDictionary["results"];

interface KeyCheck {
  result: CheckResult;
  checkedAt: string;
}

interface ModelView {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  keyless: boolean;
  key: { configured: boolean };
  keyCheck: KeyCheck | null;
}

interface SpeechFilterView {
  model: string | null;
  confirmation: { provider: string; name: string; at: string } | null;
  models: ModelView[];
}

const CHECK_TONE: Record<CheckResult, "ok" | "warn" | "fail"> = {
  accepted: "ok",
  not_needed: "ok",
  rejected: "fail",
  model_unavailable: "fail",
  no_credit: "fail",
  region_unavailable: "fail",
  rate_limited: "warn",
  unreachable: "warn",
  unexpected_response: "warn",
};

/** Os erros desta tela que têm frase própria; o resto vai pela frase comum. */
const OWN_ERRORS = { provider_confirmation_required: "confirmRequired", decision_model_key_missing: "keyNeeded", decision_model_in_use: "removeInUse" } as const;

function useAction(t: SpeechFilterDictionary) {
  const errorText = useErrorText();
  const [state, setState] = useState({ busy: false, error: "" });
  const run = async (task: () => Promise<unknown>): Promise<boolean> => {
    setState({ busy: true, error: "" });
    try {
      await task();
      setState({ busy: false, error: "" });
      return true;
    } catch (failure) {
      const own = failure instanceof ApiFailure && Object.hasOwn(OWN_ERRORS, failure.code) ? t[OWN_ERRORS[failure.code as keyof typeof OWN_ERRORS]] : null;
      setState({ busy: false, error: own ?? errorText(failure) });
      return false;
    }
  };
  return { ...state, run, fail: (error: string) => setState({ busy: false, error }) };
}

/** O aviso de para onde vai o texto: só o que a fonte do fornecedor diz, com a página e a data. */
function WhereTheTextGoes({ model, t }: { model: ModelView; t: SpeechFilterDictionary }) {
  const locale = useLocale();
  const notice = noticeOf(t, model, locale);
  return (
    <div className="grid gap-1 rounded-sm border border-line bg-surface px-4 py-3" data-testid="speech-filter-notice">
      <p className="font-bold">{t.noticeTitle}</p>
      {notice.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {notice.sources.map((source) => (
        <p key={source.url} className="text-sm text-muted">
          <a className="underline" href={source.url} target="_blank" rel="noreferrer">
            {source.text}
          </a>
        </p>
      ))}
    </div>
  );
}

/** A chave de um modelo: só se existe (nunca o valor), o último teste, e trocar ou remover. */
function KeyCard({ model, t, onChanged }: { model: ModelView; t: SpeechFilterDictionary; onChanged(): void }) {
  const locale = useLocale();
  const canConfigure = useCanConfigure();
  const action = useAction(t);
  const [key, setKey] = useState("");
  const [postponed, setPostponed] = useState(false);
  const check = model.keyCheck;
  return (
    <li className="grid gap-2 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">{fill(t.keyOf, { model: model.label })}</span>
        <Badge tone={model.key.configured ? "ok" : "warn"}>{model.key.configured ? t.keySaved : t.keyMissing}</Badge>
      </div>
      {canConfigure ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPostponed(false);
            void action
              .run(async () => {
                const answer = await api<{ check: KeyCheck | null }>(`/speech-filter/${model.id}/key`, { method: "PUT", body: { apiKey: key } });
                setPostponed(answer.check === null);
              })
              .then((ok) => {
                // O campo nunca volta preenchido: depois de salvar, fica vazio.
                if (ok) setKey("");
                onChanged();
              });
          }}
        >
          <TextInput
            mono
            type="password"
            autoComplete="off"
            className="max-w-md"
            aria-label={fill(t.keyOf, { model: model.label })}
            placeholder={model.key.configured ? t.keyNew : undefined}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            required
          />
          <Button type="submit" busy={action.busy}>
            {t.keySave}
          </Button>
          {model.key.configured ? (
            <Button variant="ghost" busy={action.busy} onClick={() => void action.run(() => api(`/speech-filter/${model.id}/key`, { method: "DELETE" })).then(onChanged)}>
              {t.remove}
            </Button>
          ) : null}
        </form>
      ) : null}
      {action.error ? <Notice tone="fail">{action.error}</Notice> : null}
      {postponed ? <Notice tone="warn">{t.savedNotTested}</Notice> : null}
      {model.key.configured ? (
        check ? (
          <Notice tone={CHECK_TONE[check.result]}>{fill(t.tested, { when: formatDateTime(check.checkedAt, locale), result: t.results[check.result] })}</Notice>
        ) : (
          <p className="text-sm text-muted">{t.neverTested}</p>
        )
      ) : null}
    </li>
  );
}

export default function SpeechFilterSettings() {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const filter = useApi<SpeechFilterView>("/speech-filter");
  const save = useAction(t);
  const [chosen, setChosen] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setChosen(filter.data?.model ?? "");
    setConfirmed(false);
  }, [filter.data]);

  if (filter.error && !filter.data) return <Notice tone="fail">{errorText(filter.error)}</Notice>;
  if (!filter.data) return <Skeleton lines={4} />;
  const view = filter.data;
  const model = view.models.find((each) => each.id === chosen);
  const leaves = model !== undefined && model.processingLocation.kind !== "this-server";
  // Ligar de novo, ou trocar de modelo, pede a confirmação outra vez; salvar o mesmo, já confirmado, não.
  const alreadyConfirmed = model !== undefined && view.model === model.id && view.confirmation?.provider === model.provider;
  const keyed = view.models.filter((each) => !each.keyless);

  return (
    <>
      <Panel title={t.title} description={t.lead}>
        <form
          className="grid max-w-2xl gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            if (leaves && !alreadyConfirmed && !confirmed) return save.fail(t.confirmRequired);
            const body = model ? { model: model.id, ...(leaves && confirmed && { confirmedProvider: model.provider }) } : { model: null };
            void save.run(() => api("/speech-filter", { method: "PUT", body })).then((ok) => {
              setSaved(ok);
              filter.reload();
            });
          }}
        >
          <Field label={t.model}>
            <Select
              disabled={!canConfigure}
              value={chosen}
              onChange={(event) => {
                setChosen(event.target.value);
                setConfirmed(false);
                setSaved(false);
              }}
            >
              <option value="">{t.none}</option>
              {view.models.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.label}
                </option>
              ))}
            </Select>
          </Field>
          {model ? <WhereTheTextGoes model={model} t={t} /> : null}
          {leaves && model && !model.key.configured ? <Notice tone="warn">{t.keyNeeded}</Notice> : null}
          {leaves && model && canConfigure && !alreadyConfirmed ? (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>{fill(t.confirm, { provider: providerName(t, model.provider) })}</span>
            </label>
          ) : null}
          {view.model !== null && view.confirmation ? (
            <p className="text-sm text-muted">{fill(t.confirmedBy, { who: view.confirmation.name, when: formatDateTime(view.confirmation.at, locale) })}</p>
          ) : null}
          {canConfigure ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={save.busy}>
                {t.save}
              </Button>
              {saved ? <span className="text-sm text-muted">{t.saved}</span> : null}
            </div>
          ) : null}
          {save.error ? <Notice tone="fail">{save.error}</Notice> : null}
          <p className="text-sm text-muted">{t.guide}</p>
        </form>
      </Panel>
      {keyed.length > 0 ? (
        <Panel title={t.keysTitle}>
          <ul className="grid">
            {keyed.map((each) => (
              <KeyCard key={each.id} model={each} t={t} onChanged={filter.reload} />
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
