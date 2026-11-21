"use client";

import Link from "next/link";
import { useState } from "react";
import en from "../../../../i18n/en/settings";
import es from "../../../../i18n/es/settings";
import { fill } from "../../../../i18n/locales";
import ptBR, { type SettingsDictionary } from "../../../../i18n/pt-BR/settings";
import { useDict, useLocale } from "../../../../i18n/provider";
import { useApi } from "../../../../ui/api";
import { ActionStatus, useAction } from "../../../../ui/errors";
import { Button, Field, Notice, Panel, Select, Skeleton, Switch, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import type { Setting } from "../../../../ui/types";
import { matchModels } from "../brains/search";
import { put } from "../setting-api";

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

interface BrainChoice {
  brain: string;
  model: string;
}

/** O que a tela de Cérebros sabe de cada um: aqui só valem os que têm chave aceita. */
interface BrainOption {
  id: string;
  label: string;
  configured: boolean;
  keyCheck: { result: string } | null;
}

interface BrainModelOption {
  id: string;
  label: string;
  price?: unknown;
}

/**
 * Os agentes com escolha própria de quem lê a ligação (`analysisBrain` não nulo): para eles, o padrão
 * da organização não vale. Nenhum, nada aparece.
 */
function OwnChoices({ t }: { t: SettingsDictionary }) {
  const locale = useLocale();
  const agents = useApi<Array<{ id: string; name: string; analysisBrain?: unknown }>>("/agents");
  const own = (agents.data ?? []).filter((agent) => agent.analysisBrain !== null && agent.analysisBrain !== undefined);
  if (own.length === 0) return null;
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).formatToParts(own.map((agent) => agent.name));
  let next = 0;
  return (
    <p className="text-sm">
      {own.length === 1 ? t.brainAgentsOwnOne : fill(t.brainAgentsOwnMany, { count: own.length })}{" "}
      {names.map((part, index) => {
        if (part.type !== "element") return <span key={index}>{part.value}</span>;
        const agent = own[next++];
        return agent ? (
          <Link key={index} className="font-bold underline underline-offset-4" href={`/agents/${agent.id}`}>
            {part.value}
          </Link>
        ) : null;
      })}
    </p>
  );
}

/**
 * Quem lê a ligação (desfecho e análise): o motor do agente, que é o de antes, ou um cérebro e um
 * modelo da lista guardada dele. Só cérebros com chave aceita aparecem. Modelo sem preço mostra o
 * aviso fixo antes de salvar, e o aviso continua depois de salvo; a tela só manda
 * `acceptUnmeasured` para o modelo cujo aviso está na tela.
 */
function AnalysisBrain({ t }: { t: SettingsDictionary }) {
  const canConfigure = useCanConfigure();
  const setting = useApi<Setting<BrainChoice>>("/settings/calls.analysis_brain");
  // A lista de cérebros é de quem configura (dono e admin); quem só lê vê a escolha em texto.
  const brains = useApi<BrainOption[]>(canConfigure ? "/brains" : null);
  const saved = setting.data?.value ?? null;
  // `undefined`: ainda o que está salvo. A troca de cérebro limpa o modelo e a busca.
  const [picked, setPicked] = useState<{ brain: string; model: string } | undefined>(undefined);
  const [query, setQuery] = useState("");
  const brain = picked?.brain ?? saved?.brain ?? "";
  const modelId = picked ? picked.model : (saved?.model ?? "");
  const models = useApi<{ models: BrainModelOption[] }>(canConfigure && brain ? `/brains/${encodeURIComponent(brain)}/models` : null);
  const save = useAction();
  if (!setting.data || (canConfigure && !brains.data && !brains.error)) return <Skeleton lines={2} />;

  const accepted = (brains.data ?? []).filter((option) => option.configured && option.keyCheck?.result === "accepted");
  const labelOf = (id: string): string => brains.data?.find((option) => option.id === id)?.label ?? id;
  const list = models.data?.models ?? [];
  const model = list.find((item) => item.id === modelId);
  const unmeasured = model !== undefined && model.price === undefined;
  const shown = matchModels(list, query);
  // O cérebro salvo sem chave aceita, ou o modelo salvo que sumiu da lista: a rotina não lê a
  // ligação (nem cai no motor), e a tela diz isso a quem pode trocar.
  const keyGone = saved !== null && brains.data !== undefined && !accepted.some((option) => option.id === saved.brain);
  const modelGone = saved !== null && !keyGone && models.data !== undefined && brain === saved.brain && !list.some((item) => item.id === saved.model);
  const dirty = picked !== undefined && (picked.brain !== (saved?.brain ?? "") || picked.model !== (saved?.model ?? ""));

  if (!canConfigure)
    return (
      <div className="grid gap-2">
        <Field label={t.brainTitle} hint={t.brainHint}>
          <p>{saved ? fill(t.brainChosen, { brain: saved.brain, model: saved.model }) : t.brainEngine}</p>
        </Field>
        <OwnChoices t={t} />
      </div>
    );

  return (
    <form
      className="grid gap-3 border-t border-line pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const value = brain ? { brain, model: modelId, ...(unmeasured ? { acceptUnmeasured: true } : {}) } : null;
        void save.run(() => put("calls.analysis_brain", value)).then((ok) => {
          if (!ok) return;
          setPicked(undefined);
          setQuery("");
          setting.reload();
        });
      }}
    >
      <Field label={t.brainTitle} hint={t.brainHint}>
        <Select
          className="max-w-md"
          value={brain}
          onChange={(event) => {
            setPicked({ brain: event.target.value, model: "" });
            setQuery("");
          }}
        >
          <option value="">{t.brainEngine}</option>
          {accepted.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          {/* O salvo que perdeu a chave continua visível como escolhido, para o aviso abaixo fazer sentido. */}
          {keyGone && saved ? <option value={saved.brain}>{labelOf(saved.brain)}</option> : null}
        </Select>
      </Field>
      <OwnChoices t={t} />
      {brains.data && accepted.length === 0 && !saved ? <p className="text-sm text-muted">{t.brainNone}</p> : null}
      {keyGone && saved ? <Notice tone="fail">{fill(t.brainKeyGone, { brain: labelOf(saved.brain) })}</Notice> : null}
      {brain && !keyGone ? (
        <div className="grid max-w-md content-start gap-1.5">
          <span className="text-[0.87rem] font-bold">{t.brainModel}</span>
          <div className="grid gap-2">
            <TextInput type="search" autoComplete="off" aria-label={t.brainSearch} placeholder={t.brainSearch} value={query} onChange={(event) => setQuery(event.target.value)} />
            {models.data && shown.length === 0 ? <p className="text-sm text-muted">{t.brainSearchEmpty}</p> : null}
            <Select required aria-label={t.brainModel} value={model ? modelId : ""} onChange={(event) => setPicked({ brain, model: event.target.value })} disabled={!models.data}>
              <option value="" />
              {/* O escolhido fica na lista mesmo fora da busca, para o campo não mudar sozinho. */}
              {(model && !shown.includes(model) ? [model, ...shown] : shown).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label === item.id ? item.id : `${item.label} (${item.id})`}
                  {item.price === undefined ? ` · ${t.brainNoPrice}` : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}
      {modelGone && saved ? <Notice tone="fail">{fill(t.brainModelGone, { model: saved.model })}</Notice> : null}
      {/* Aviso fixo: aparece ao escolher o modelo sem preço, antes de salvar, e continua depois de salvo. */}
      {brain && unmeasured ? <Notice tone="warn">{t.brainUnmeasured}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" busy={save.busy} disabled={!dirty || (brain !== "" && !model)}>
          {t.brainSave}
        </Button>
        <ActionStatus action={save} />
      </div>
    </form>
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
        <AnalysisBrain t={t} />
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
  // A automática só age com a transcrição ligada, que é a licença do áudio sair para o provedor.
  const auto = useApi<Setting<boolean>>("/settings/calls.auto_transcription_enabled");
  const saveAuto = useAction();
  const autoEnabled = enabled && auto.data?.value === true;
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
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={autoEnabled}
            onChange={(next) => void saveAuto.run(() => put("calls.auto_transcription_enabled", next || null)).then(auto.reload)}
            label={t.autoTranscriptionSwitch}
            disabled={!canConfigure || !enabled || !auto.data || saveAuto.busy}
          />
          <ActionStatus action={saveAuto} />
        </div>
        <p>{t.autoTranscriptionCost}</p>
        {!enabled && <p>{t.autoTranscriptionNeedsManual}</p>}
      </div>
    </Panel>
  );
}

/**
 * Durante e depois da ligação (parte 5 do desenho da central): os opcionais com custo, que saíram da
 * tela de IA. Os componentes vieram de lá sem mudar: as mesmas chaves e as mesmas rotas de API.
 */
export default function AfterCallSettings() {
  const t = useDict(ptBR, en, es);
  return (
    <>
      <OutcomeSetting t={t} />
      <AnalysisSetting t={t} />
      <TranscriptionSetting t={t} />
    </>
  );
}
