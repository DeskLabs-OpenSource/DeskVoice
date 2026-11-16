"use client";

import { useState } from "react";
import en from "../../../../i18n/en/brains";
import es from "../../../../i18n/es/brains";
import { fill, type Locale } from "../../../../i18n/locales";
import ptBR, { type BrainsDictionary } from "../../../../i18n/pt-BR/brains";
import { useDict, useLocale } from "../../../../i18n/provider";
import { ApiFailure, api, useApi } from "../../../../ui/api";
import { useErrorText } from "../../../../ui/errors";
import { formatDateTime, formatDay } from "../../../../ui/format";
import { Badge, Button, Notice, Panel, Skeleton, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import { matchModels } from "./search";

type CheckResult = keyof BrainsDictionary["results"];

interface KeyCheck {
  result: CheckResult;
  status: number | null;
  checkedAt: string;
}

interface BrainView {
  id: string;
  label: string;
  keyUrl: string;
  configured: boolean;
  keyCheck: KeyCheck | null;
  modelCount: number | null;
  fetchedAt: string | null;
}

interface Model {
  id: string;
  label: string;
  contextTokens?: number;
  price?: { centsPerMillionInputTokens: number; centsPerMillionOutputTokens: number; source: string; checkedOn: string };
}

interface ModelList {
  fetchedAt: string | null;
  models: Model[];
  stale: boolean;
}

const CHECK_TONE: Record<CheckResult, "ok" | "warn" | "fail"> = {
  accepted: "ok",
  rejected: "fail",
  no_credit: "fail",
  region_unavailable: "fail",
  rate_limited: "warn",
  unreachable: "warn",
  unexpected_response: "warn",
};

/** Preço por milhão de tokens: até quatro casas, porque há modelo de frações de centavo. */
const formatPrice = (cents: number, locale: Locale): string =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(cents / 100);

/** O estado de um botão, com as falhas desta tela traduzidas pelo dicionário dela. */
function useBrainAction(t: BrainsDictionary) {
  const errorText = useErrorText();
  const [state, setState] = useState({ busy: false, error: "" });
  const run = async (task: () => Promise<unknown>): Promise<boolean> => {
    setState({ busy: true, error: "" });
    try {
      await task();
      setState({ busy: false, error: "" });
      return true;
    } catch (failure) {
      const own = failure instanceof ApiFailure && Object.hasOwn(t.errors, failure.code) ? t.errors[failure.code as keyof BrainsDictionary["errors"]] : null;
      setState({ busy: false, error: own ?? errorText(failure) });
      return false;
    }
  };
  return { ...state, run };
}

/** O último teste da chave em frase: o que fazer, e o status HTTP entre parênteses. Nunca o texto do provedor. */
function CheckStatus({ check, t }: { check: KeyCheck | null; t: BrainsDictionary }) {
  const locale = useLocale();
  if (!check) return <p className="text-sm text-muted">{t.neverTested}</p>;
  const status = check.result !== "accepted" && check.status !== null ? ` ${fill(t.status, { status: check.status })}` : "";
  return <Notice tone={CHECK_TONE[check.result]}>{fill(t.tested, { when: formatDateTime(check.checkedAt, locale), result: `${t.results[check.result]}${status}` })}</Notice>;
}

function ModelRow({ model, t }: { model: Model; t: BrainsDictionary }) {
  const locale = useLocale();
  const price = model.price;
  return (
    <li className="grid gap-0.5 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{model.label}</span>
        {model.label !== model.id ? <code className="text-sm text-muted">{model.id}</code> : null}
        {model.contextTokens ? <span className="text-sm text-muted">{fill(t.context, { tokens: model.contextTokens.toLocaleString(locale) })}</span> : null}
      </div>
      {price ? (
        <p className="text-sm">
          {fill(t.price, { input: formatPrice(price.centsPerMillionInputTokens, locale), output: formatPrice(price.centsPerMillionOutputTokens, locale) })}
          {" · "}
          {/^https:\/\//.test(price.source) ? (
            <a className="underline" href={price.source} target="_blank" rel="noreferrer">
              {fill(t.priceSource, { date: formatDay(price.checkedOn, locale) })}
            </a>
          ) : (
            <span>{fill(t.priceSource, { date: formatDay(price.checkedOn, locale) })}</span>
          )}
        </p>
      ) : (
        // A marca fica na linha, à vista, e nunca vira preço zero.
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="warn">{t.noPrice}</Badge>
          <span className="text-muted">{t.noPriceHint}</span>
        </p>
      )}
    </li>
  );
}

function Models({ brain, t, version }: { brain: BrainView; t: BrainsDictionary; version: string }) {
  const locale = useLocale();
  const errorText = useErrorText();
  // `version` muda a cada gravação ou releitura: a lista é pedida de novo, e a de uma chave antiga some.
  const list = useApi<ModelList>(`/brains/${brain.id}/models?v=${encodeURIComponent(version)}`);
  const [query, setQuery] = useState("");
  if (list.error && !list.data) return <Notice tone="fail">{errorText(list.error)}</Notice>;
  if (!list.data) return <Skeleton lines={3} />;
  const { fetchedAt, models, stale } = list.data;
  if (!fetchedAt) return <p className="text-sm text-muted">{t.modelsNotRead}</p>;
  const shown = matchModels(models, query);
  return (
    <div className="grid gap-2">
      {stale ? <Notice tone="warn">{t.modelsStale}</Notice> : null}
      <p className="text-sm text-muted">{models.length === 0 ? t.modelsNone : fill(t.modelsCount, { count: models.length, when: formatDateTime(fetchedAt, locale) })}</p>
      {models.length > 0 ? (
        <>
          <TextInput type="search" autoComplete="off" className="max-w-md" aria-label={t.search} placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)} />
          {shown.length === 0 ? (
            <p className="text-sm text-muted">{t.searchEmpty}</p>
          ) : (
            <ul className="grid max-h-[28rem] overflow-y-auto">
              {shown.map((model) => (
                <ModelRow key={model.id} model={model} t={t} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Um cérebro: a chave (só se existe; nunca o valor), o último teste e a lista de modelos. */
function BrainCard({ brain, t, onChanged }: { brain: BrainView; t: BrainsDictionary; onChanged(): void }) {
  const canConfigure = useCanConfigure();
  const save = useBrainAction(t);
  const refresh = useBrainAction(t);
  const [key, setKey] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [postponed, setPostponed] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [version, setVersion] = useState(0);
  const changed = (): void => {
    setVersion((value) => value + 1);
    onChanged();
  };
  const saveKey = (): void => {
    setPostponed(false);
    void save
      .run(async () => {
        const answer = await api<{ check: KeyCheck | null }>(`/brains/${brain.id}/key`, { method: "PUT", body: { apiKey: key } });
        setPostponed(answer.check === null);
      })
      .then((ok) => {
        // O campo nunca é preenchido de volta: depois de salvar, ele fica vazio.
        if (ok) setKey("");
        changed();
      });
  };
  const removeKey = (): void => {
    void save.run(() => api(`/brains/${brain.id}/key`, { method: "DELETE" })).then((ok) => {
      if (ok) {
        setConfirming(false);
        setPostponed(false);
      }
      changed();
    });
  };
  return (
    <li className="grid gap-3 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-bold">{brain.label}</span>
        <Badge tone={brain.configured ? "ok" : "warn"}>{brain.configured ? t.keySaved : t.keyMissing}</Badge>
        <a className="text-sm underline" href={brain.keyUrl} target="_blank" rel="noreferrer">
          {t.keyLink}
        </a>
      </div>
      {canConfigure ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            saveKey();
          }}
        >
          <TextInput
            mono
            type="password"
            autoComplete="off"
            className="max-w-md"
            aria-label={fill(t.keyOf, { brain: brain.label })}
            placeholder={brain.configured ? t.keyNew : undefined}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            required
          />
          <Button type="submit" busy={save.busy}>
            {t.keySave}
          </Button>
          {brain.configured ? (
            <Button variant="secondary" busy={refresh.busy} onClick={() => void refresh.run(() => api(`/brains/${brain.id}/models/refresh`, { method: "POST" })).then(changed)}>
              {t.refresh}
            </Button>
          ) : null}
          {brain.configured && !confirming ? (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t.remove}
            </Button>
          ) : null}
        </form>
      ) : null}
      {save.error ? <Notice tone="fail">{save.error}</Notice> : null}
      {refresh.error ? <Notice tone="fail">{refresh.error}</Notice> : null}
      {postponed ? <Notice tone="warn">{t.savedNotTested}</Notice> : null}
      {brain.configured ? <CheckStatus check={brain.keyCheck} t={t} /> : null}
      {canConfigure && brain.configured && confirming ? (
        <Notice tone="fail">
          <p>{fill(t.removeConfirm, { brain: brain.label })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={save.busy} onClick={removeKey}>
              {fill(t.removeYes, { brain: brain.label })}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t.cancel}
            </Button>
          </div>
        </Notice>
      ) : null}
      {brain.configured ? (
        <div className="grid gap-2">
          <div>
            <Button variant="ghost" onClick={() => setShowModels((value) => !value)} aria-expanded={showModels}>
              {showModels ? t.modelsHide : t.modelsShow}
            </Button>
          </div>
          {showModels ? <Models brain={brain} t={t} version={`${version}:${brain.fetchedAt ?? ""}`} /> : null}
        </div>
      ) : null}
    </li>
  );
}

export default function BrainsSettings() {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const brains = useApi<BrainView[]>("/brains");
  if (brains.error && !brains.data) return <Notice tone="fail">{errorText(brains.error)}</Notice>;
  if (!brains.data) return <Skeleton lines={4} />;
  return (
    <Panel title={t.title} description={t.lead}>
      <ul className="grid">
        {brains.data.map((brain) => (
          <BrainCard key={brain.id} brain={brain} t={t} onChanged={brains.reload} />
        ))}
      </ul>
    </Panel>
  );
}
