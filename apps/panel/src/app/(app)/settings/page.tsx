"use client";

import { useState } from "react";
import commonEn from "../../../i18n/en/common";
import en from "../../../i18n/en/settings";
import commonEs from "../../../i18n/es/common";
import es from "../../../i18n/es/settings";
import { fill } from "../../../i18n/locales";
import commonPtBR from "../../../i18n/pt-BR/common";
import ptBR, { type SettingsDictionary } from "../../../i18n/pt-BR/settings";
import { useDict, useLocale } from "../../../i18n/provider";
import { api, useApi } from "../../../ui/api";
import { ActionStatus, useAction, useErrorText } from "../../../ui/errors";
import { formatDateTime, formatDay } from "../../../ui/format";
import { Badge, Button, Field, Notice, Panel, Select, Skeleton, Switch, TextInput } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { Engine, KeyCheck, KeyCheckResult, Setting } from "../../../ui/types";
import { URL_PREFIX, put } from "./setting-api";

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

/**
 * Endpoint, modelo e chave da classificação, para quem paga um provedor compatível com OpenAI em vez
 * da OpenAI. Os três vão juntos: a chave é do endpoint, e trocar o endpoint pede a chave de novo.
 */
function ClassifyTarget({ engine, t, onChanged }: { engine: Engine; t: SettingsDictionary; onChanged(): void }) {
  const save = useAction();
  const [baseUrl, setBaseUrl] = useState(engine.baseUrl ?? "");
  const [model, setModel] = useState(engine.classifyModel ?? "");
  const [apiKey, setApiKey] = useState("");
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const target = { baseUrl: baseUrl.trim() || undefined, model: model.trim() || undefined, apiKey: apiKey.trim() || undefined };
        // Tudo em branco apaga a configuração: o motor volta ao endereço, ao modelo e à chave dele.
        void save
          .run(() => put(`engine.${engine.id}.classify_target`, target.baseUrl || target.model || target.apiKey ? target : null))
          .then((ok) => {
            if (!ok) return;
            setApiKey("");
            onChanged();
          });
      }}
    >
      <Field label={t.classifyBaseUrl} hint={t.classifyBaseUrlHint}>
        <TextInput mono type="url" inputMode="url" autoComplete="off" placeholder={URL_PREFIX} className="max-w-md" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </Field>
      <Field label={t.classifyKey} hint={t.classifyKeyHint}>
        <TextInput mono type="password" autoComplete="off" className="max-w-md" placeholder={engine.classifyKeyConfigured ? t.classifyKeyKeep : undefined} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </Field>
      <Field label={t.classifyModel} hint={t.classifyModelHint}>
        <TextInput mono autoComplete="off" className="max-w-md" value={model} onChange={(event) => setModel(event.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" busy={save.busy}>
          {t.classifyTargetSave}
        </Button>
        <ActionStatus action={save} />
      </div>
    </form>
  );
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
      {engine.classifyTarget && canConfigure ? <ClassifyTarget engine={engine} t={t} onChanged={onChanged} /> : null}
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

/** Classificar o desfecho de cada ligação: desligado de fábrica, porque cada uma é uma chamada paga ao provedor. */
function OutcomeSetting({ t }: { t: SettingsDictionary }) {
  const canConfigure = useCanConfigure();
  const setting = useApi<Setting<boolean>>("/settings/calls.outcome_enabled");
  const save = useAction();
  const enabled = setting.data?.value === true;
  return (
    <Panel title={t.outcomeTitle} description={t.outcomeLead}>
      <div className="grid max-w-xl gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={enabled}
            onChange={(next) => void save.run(() => put("calls.outcome_enabled", next || null)).then(setting.reload)}
            label={t.outcomeSwitch}
            disabled={!canConfigure || !setting.data || save.busy}
          />
          <ActionStatus action={save} />
        </div>
        <p>{t.outcomeCost}</p>
        <Notice tone={enabled ? "warn" : "neutral"}>{t.outcomeData}</Notice>
      </div>
    </Panel>
  );
}

/**
 * Analisar cada ligação no fim: desligado de fábrica. A análise inclui o desfecho e sai na mesma
 * chamada paga ao provedor; quem pode ligar é o dono ou um admin (`useCanConfigure`).
 */
function AnalysisSetting({ t }: { t: SettingsDictionary }) {
  const canConfigure = useCanConfigure();
  const setting = useApi<Setting<boolean>>("/settings/calls.analysis_enabled");
  const save = useAction();
  const enabled = setting.data?.value === true;
  return (
    <Panel title={t.analysisTitle} description={t.analysisLead}>
      <div className="grid max-w-xl gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={enabled}
            onChange={(next) => void save.run(() => put("calls.analysis_enabled", next || null)).then(setting.reload)}
            label={t.analysisSwitch}
            disabled={!canConfigure || !setting.data || save.busy}
          />
          <ActionStatus action={save} />
        </div>
        <p>{t.analysisCost}</p>
        <Notice tone={enabled ? "warn" : "neutral"}>{t.analysisData}</Notice>
      </div>
    </Panel>
  );
}

/** Transcrever a gravação de uma chamada sem texto: desligado de fábrica, porque o áudio vai ao provedor e é pago. */
function TranscriptionSetting({ t }: { t: SettingsDictionary }) {
  const canConfigure = useCanConfigure();
  const setting = useApi<Setting<boolean>>("/settings/calls.transcription_enabled");
  const save = useAction();
  const enabled = setting.data?.value === true;
  return (
    <Panel title={t.transcriptionTitle} description={t.transcriptionLead}>
      <div className="grid max-w-xl gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={enabled}
            onChange={(next) => void save.run(() => put("calls.transcription_enabled", next || null)).then(setting.reload)}
            label={t.transcriptionSwitch}
            disabled={!canConfigure || !setting.data || save.busy}
          />
          <ActionStatus action={save} />
        </div>
        <p>{t.transcriptionCost}</p>
        <Notice tone={enabled ? "warn" : "neutral"}>{t.transcriptionData}</Notice>
      </div>
    </Panel>
  );
}

export default function AiSettings() {
  const t = useDict(ptBR, en, es);
  const common = useDict(commonPtBR, commonEn, commonEs);
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const engines = useApi<Engine[]>("/engines");
  const defaultEngine = useApi<Setting<string>>("/settings/engine.default");
  const saveDefault = useAction();

  if (engines.error && !engines.data) return <Notice tone="fail">{errorText(engines.error)}</Notice>;
  if (!engines.data) return <Skeleton lines={4} />;

  return (
    <>
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
      <OutcomeSetting t={t} />
      <AnalysisSetting t={t} />
      <TranscriptionSetting t={t} />
    </>
  );
}
