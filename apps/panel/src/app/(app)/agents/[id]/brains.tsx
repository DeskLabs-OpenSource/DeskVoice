"use client";

import Link from "next/link";
import { useState } from "react";
import { fill } from "../../../../i18n/locales";
import type { AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import { useApi } from "../../../../ui/api";
import { Field, Notice, Panel, Select, TextInput } from "../../../../ui/kit";
import type { Setting } from "../../../../ui/types";
import { matchModels } from "../../settings/brains/search";
import { analysisView, type AnalysisDraft, type AnalysisStatus, type BrainModelOption, type BrainOption } from "./analysis-choice";

// Valores do seletor que não são cérebro: os ids de cérebro são nomes de pasta, sem "@".
const ENGINE_VALUE = "@engine";
const INVALID_VALUE = "@invalid";

/**
 * "Cérebros deste agente" (desenho da R4, fatia 5, §3.4): uma linha por trabalho, com o trabalho no
 * rótulo. Quem conversa é o próprio motor de voz, sem seletor (o cérebro da conversa é da R5). Quem
 * lê a ligação: igual à organização (o padrão, mostrando o que vale hoje), o motor deste agente, ou
 * um cérebro com modelo da lista guardada, só dos cérebros com chave aceita. O analista ao vivo fica
 * no painel dele; aqui só é citado, com o link.
 */
export function AgentBrains({
  agentId,
  t,
  engineLabel,
  analysis,
  onChange,
  costCeilingCents,
  analyst,
  canConfigure,
}: {
  /** `null` no agente novo, que ainda não tem escolha gravada. */
  agentId: string | null;
  t: AgentsDictionary;
  engineLabel: string;
  analysis: AnalysisDraft;
  /** `acceptUnmeasured`: o modelo escolhido não tem preço, e o aviso dele está na tela. */
  onChange(next: AnalysisDraft, acceptUnmeasured: boolean): void;
  costCeilingCents: number;
  analyst: { name: string } | null;
  canConfigure: boolean;
}) {
  const organization = useApi<Setting<{ brain: string; model: string }>>("/settings/calls.analysis_brain");
  // A lista de cérebros é de quem configura (dono e admin); quem só lê vê a escolha em texto, com o
  // rótulo e os avisos da escolha gravada, que `analysis-status` calcula pela mesma `analysisView`.
  const brains = useApi<BrainOption[]>(canConfigure ? "/brains" : null);
  const status = useApi<AnalysisStatus>(canConfigure || agentId === null ? null : `/agents/${encodeURIComponent(agentId)}/analysis-status`);
  const [query, setQuery] = useState("");
  const chosenBrain = analysis.kind === "brain" ? analysis.brain : "";
  const models = useApi<{ models: BrainModelOption[] }>(canConfigure && chosenBrain ? `/brains/${encodeURIComponent(chosenBrain)}/models` : null);

  // Toda regra dos avisos (e o `required` do Modelo) sai de `analysisView`, que tem teste; aqui só se lê.
  const view = analysisView({ analysis, brains: brains.data, models: models.data?.models });
  const { brain, modelId, accepted, models: list, model, required, unmeasuredOf } = view;
  // Para quem só lê, os avisos vêm da rota, que vale para a escolha gravada (a única que essa tela tem).
  const problems = status.data?.problems ?? [];
  const keyGone = canConfigure ? view.keyGone : problems.includes("key_gone");
  const modelGone = canConfigure ? view.modelGone : problems.includes("model_gone");
  const unmeasured = canConfigure ? view.unmeasured : problems.includes("unmeasured");
  const labelOf = (id: string): string => (!canConfigure && id === brain && status.data?.brainLabel ? status.data.brainLabel : view.labelOf(id));
  const shown = matchModels(list, query);

  const orgValue = organization.data?.value ?? null;
  const today = orgValue ? fill(t.readChosen, { brain: labelOf(orgValue.brain), model: orgValue.model }) : t.readOrganizationEngine;
  const followOrganization = organization.data ? fill(t.readOrganization, { current: today }) : fill(t.readOrganization, { current: "…" });
  const selectValue = analysis.kind === "organization" ? "" : analysis.kind === "engine" ? ENGINE_VALUE : analysis.kind === "invalid" ? INVALID_VALUE : brain;

  const readOnlyText =
    analysis.kind === "organization"
      ? followOrganization
      : analysis.kind === "engine"
        ? t.readEngine
        : analysis.kind === "brain"
          ? fill(t.readChosen, { brain: labelOf(analysis.brain), model: analysis.model })
          : t.readInvalidOption;

  return (
    <Panel title={t.brains} description={t.brainsLead}>
      <div className="grid gap-5">
        <Field label={t.talkLabel}>
          <p>{fill(t.talkEngine, { engine: engineLabel })}</p>
        </Field>

        <div className="grid gap-3 border-t border-line pt-5">
          <Field label={t.readLabel} hint={t.readHint}>
            {canConfigure ? (
              <Select
                className="max-w-md"
                value={selectValue}
                onChange={(event) => {
                  const value = event.target.value;
                  // O mesmo cérebro de novo não apaga o modelo escolhido.
                  if (analysis.kind === "brain" && value === analysis.brain) return;
                  setQuery("");
                  onChange(value === "" ? { kind: "organization" } : value === ENGINE_VALUE ? { kind: "engine" } : { kind: "brain", brain: value, model: "" }, false);
                }}
              >
                <option value="">{followOrganization}</option>
                <option value={ENGINE_VALUE}>{t.readEngine}</option>
                {accepted.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                {/* O escolhido que perdeu a chave continua visível, para o aviso abaixo fazer sentido. */}
                {keyGone ? <option value={brain}>{labelOf(brain)}</option> : null}
                {analysis.kind === "invalid" ? (
                  <option value={INVALID_VALUE} disabled>
                    {t.readInvalidOption}
                  </option>
                ) : null}
              </Select>
            ) : (
              <p>{readOnlyText}</p>
            )}
          </Field>
          {analysis.kind === "invalid" ? <Notice tone="fail">{t.readInvalid}</Notice> : null}
          {keyGone ? <Notice tone="fail">{fill(canConfigure ? t.readKeyGone : t.readKeyGoneAsk, { brain: labelOf(brain) })}</Notice> : null}
          {canConfigure && brain && !keyGone ? (
            <div className="grid max-w-md content-start gap-1.5">
              <span className="text-[0.87rem] font-bold">{t.readModel}</span>
              <div className="grid gap-2">
                <TextInput type="search" autoComplete="off" aria-label={t.readSearch} placeholder={t.readSearch} value={query} onChange={(event) => setQuery(event.target.value)} />
                {models.data && shown.length === 0 ? <p className="text-sm text-muted">{t.readSearchEmpty}</p> : null}
                <Select
                  required={required}
                  aria-label={t.readModel}
                  value={model ? modelId : ""}
                  onChange={(event) => {
                    onChange({ kind: "brain", brain, model: event.target.value }, unmeasuredOf(event.target.value));
                  }}
                  disabled={!models.data}
                >
                  <option value="" />
                  {/* O escolhido fica na lista mesmo fora da busca, para o campo não mudar sozinho. */}
                  {(model && !shown.includes(model) ? [model, ...shown] : shown).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label === item.id ? item.id : `${item.label} (${item.id})`}
                      {item.price === undefined ? ` · ${t.readNoPrice}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : null}
          {modelGone ? <Notice tone="fail">{fill(canConfigure ? t.readModelGone : t.readModelGoneAsk, { model: modelId })}</Notice> : null}
          {/* Aviso fixo: aparece ao escolher o modelo sem preço, antes de salvar, e continua depois de salvo. */}
          {unmeasured ? (
            <Notice tone="warn">
              <p>{t.readUnmeasured}</p>
              {costCeilingCents <= 0 ? <p className="font-bold">{t.readUnmeasuredNoCeiling}</p> : null}
            </Notice>
          ) : null}
        </div>

        <p className="border-t border-line pt-5 text-[0.87rem] text-muted">
          {analyst ? (
            <Link href="/settings/analysts" className="font-bold text-ink underline-offset-4 hover:underline">
              {fill(t.liveAnalyst, { name: analyst.name })}
            </Link>
          ) : (
            t.liveAnalystNone
          )}
        </p>
      </div>
    </Panel>
  );
}
