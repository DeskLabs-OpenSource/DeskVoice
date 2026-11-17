"use client";

import { ANALYST_GUIDANCE_MAX, ANALYST_LABEL_MAX, ANALYST_NAME_MAX, ANALYST_OBJECTIONS_MAX } from "@deskvoice/core/analysts";
import { Plus, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import en from "../../../../i18n/en/analysts";
import speechFilterEn from "../../../../i18n/en/speech-filter";
import es from "../../../../i18n/es/analysts";
import speechFilterEs from "../../../../i18n/es/speech-filter";
import { fill } from "../../../../i18n/locales";
import ptBR, { type AnalystsDictionary } from "../../../../i18n/pt-BR/analysts";
import speechFilterPtBR from "../../../../i18n/pt-BR/speech-filter";
import { useDict, useLocale } from "../../../../i18n/provider";
import { ApiFailure, api, useApi } from "../../../../ui/api";
import { useErrorText } from "../../../../ui/errors";
import { formatDateTime } from "../../../../ui/format";
import { Badge, Button, Field, Notice, Panel, Select, Skeleton, Switch, TextArea, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import type { Agent, Analyst, AnalystObjection } from "../../../../ui/types";
import { providerName } from "../speech-filter/notice";
import { WhereTheTextGoes } from "../speech-filter/notice-view";
import { objectionKeyFor } from "./objection-key";
import { type DecisionModelView, isReady, leavesServer, needsConfirmation, offeredModels } from "./rules";

interface Draft {
  name: string;
  decisionModel: string;
  temperature: boolean;
  objections: AnalystObjection[];
}

/** Os erros desta tela que têm frase própria; o resto vai pela frase comum. */
const OWN_ERRORS = { provider_confirmation_required: "confirmRequired", already_exists: "nameTaken" } as const;

function useAction(t: AnalystsDictionary) {
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

/** Quem confirmou o envio ao fornecedor, e quando. */
function ConfirmedBy({ analyst, t }: { analyst: Analyst; t: AnalystsDictionary }) {
  const locale = useLocale();
  if (!analyst.providerConfirmedAt) return null;
  return <p className="text-sm text-muted">{fill(t.confirmedBy, { who: analyst.providerConfirmedByName ?? t.confirmedByGone, when: formatDateTime(analyst.providerConfirmedAt, locale) })}</p>;
}

/** Criar ou editar um analista: o nome, o modelo, a temperatura e as objeções com a orientação. */
function Editor({ editing, models, t, onDone }: { editing: Analyst | null; models: DecisionModelView[]; t: AnalystsDictionary; onDone(saved: boolean): void }) {
  const filterT = useDict(speechFilterPtBR, speechFilterEn, speechFilterEs);
  const offered = offeredModels(models, editing?.decisionModel ?? null);
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? { name: editing.name, decisionModel: editing.decisionModel, temperature: editing.temperature, objections: editing.objections }
      : { name: "", decisionModel: offered.find(isReady)?.id ?? "", temperature: true, objections: [] },
  );
  const [confirmed, setConfirmed] = useState(false);
  const save = useAction(t);
  const model = models.find((each) => each.id === draft.decisionModel);
  const asking = model !== undefined && needsConfirmation(model, editing);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((current) => ({ ...current, [key]: value }));
  const setObjection = (index: number, patch: Partial<AnalystObjection>): void =>
    set(
      "objections",
      draft.objections.map((objection, at) => (at === index ? { ...objection, ...patch } : objection)),
    );

  return (
    <Panel title={editing ? fill(t.editTitle, { name: editing.name }) : t.newTitle}>
      <form
        className="grid max-w-2xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          // Sem a confirmação, não salva: a rota recusaria do mesmo jeito.
          if (asking && !confirmed) return save.fail(t.confirmRequired);
          // A chave nasce do rótulo uma vez, ao salvar a objeção nova; a já gravada não muda.
          const keys: string[] = [];
          const objections = draft.objections.map((objection) => {
            const key = objection.key || objectionKeyFor(objection.label, [...keys, ...draft.objections.map((each) => each.key).filter(Boolean)]);
            keys.push(key);
            return { ...objection, key };
          });
          const body = { ...draft, objections, ...(asking && model && { confirmedProvider: model.provider }) };
          void save.run(() => api(editing ? `/analysts/${editing.id}` : "/analysts", { method: editing ? "PATCH" : "POST", body })).then((ok) => ok && onDone(true));
        }}
      >
        <Field label={t.name} hint={t.nameHint}>
          <TextInput value={draft.name} maxLength={ANALYST_NAME_MAX} required onChange={(event) => set("name", event.target.value)} />
        </Field>
        {offered.length === 0 ? (
          <Notice tone="warn">
            <p>{t.noModel}</p>
            <Link className="font-bold underline underline-offset-4" href="/settings/speech-filter">
              {t.noModelLink}
            </Link>
          </Notice>
        ) : (
          <Field label={t.model} hint={t.modelHint}>
            <Select
              value={draft.decisionModel}
              required
              onChange={(event) => {
                set("decisionModel", event.target.value);
                setConfirmed(false);
              }}
            >
              {offered.map((each) => (
                <option key={each.id} value={each.id}>
                  {isReady(each) ? each.label : `${each.label} (${t.keyMissingOption})`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {editing && !model ? <Notice tone="warn">{fill(t.modelGone, { model: editing.decisionModel })}</Notice> : null}
        {model && !isReady(model) ? <Notice tone="warn">{fill(t.modelNoKey, { model: model.label })}</Notice> : null}
        {model ? <WhereTheTextGoes model={model} t={filterT} /> : null}
        {model && leavesServer(model) ? <p className="text-sm text-muted">{t.confirmWhat}</p> : null}
        {asking && model ? (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>{fill(t.confirm, { provider: providerName(filterT, model.provider) })}</span>
          </label>
        ) : null}
        {editing && model && leavesServer(model) && !asking ? <ConfirmedBy analyst={editing} t={t} /> : null}

        <div className="grid gap-1">
          <Switch checked={draft.temperature} onChange={(next) => set("temperature", next)} label={t.temperature} />
          <p className="text-sm text-muted">{t.temperatureHint}</p>
        </div>

        <fieldset className="grid gap-3">
          <legend className="text-[0.87rem] font-bold">{t.objections}</legend>
          <p className="text-sm text-muted">{fill(t.objectionsHint, { max: ANALYST_OBJECTIONS_MAX })}</p>
          {draft.objections.length === 0 ? <p className="text-sm text-muted">{t.objectionsNone}</p> : null}
          <ol className="grid gap-3">
            {draft.objections.map((objection, index) => (
              // A chave é a identidade da objeção gravada; a nova, ainda sem chave, fica pela posição.
              <li key={objection.key || `new-${index}`} className="grid gap-2 rounded-sm border border-line px-4 py-3">
                <Field label={t.objectionLabel} hint={t.objectionLabelHint}>
                  <TextInput value={objection.label} maxLength={ANALYST_LABEL_MAX} required onChange={(event) => setObjection(index, { label: event.target.value })} />
                </Field>
                <Field label={t.objectionGuidance} hint={fill(t.objectionGuidanceHint, { max: ANALYST_GUIDANCE_MAX })}>
                  <TextArea value={objection.guidance} maxLength={ANALYST_GUIDANCE_MAX} rows={3} required onChange={(event) => setObjection(index, { guidance: event.target.value })} />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {objection.key ? <span className="data text-[0.8rem] text-muted">{fill(t.objectionKey, { key: objection.key })}</span> : <span />}
                  <Button
                    variant="ghost"
                    icon={<Trash size={16} weight="duotone" aria-hidden />}
                    onClick={() =>
                      set(
                        "objections",
                        draft.objections.filter((_, at) => at !== index),
                      )
                    }
                  >
                    {t.removeObjection}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          {draft.objections.length < ANALYST_OBJECTIONS_MAX ? (
            <Button className="justify-self-start" icon={<Plus size={16} weight="bold" aria-hidden />} onClick={() => set("objections", [...draft.objections, { key: "", label: "", guidance: "" }])}>
              {t.addObjection}
            </Button>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={save.busy} disabled={offered.length === 0}>
            {t.save}
          </Button>
          <Button variant="ghost" onClick={() => onDone(false)}>
            {t.cancel}
          </Button>
        </div>
        {save.error ? <Notice tone="fail">{save.error}</Notice> : null}
      </form>
    </Panel>
  );
}

/** Um analista na lista: o resumo, quem confirmou, os agentes que o usam, e apagar nomeando o alvo. */
function AnalystCard({ analyst, models, users, t, onEdit, onDeleted }: { analyst: Analyst; models: DecisionModelView[]; users: Agent[]; t: AnalystsDictionary; onEdit(): void; onDeleted(unlinked: number): void }) {
  const canConfigure = useCanConfigure();
  const remove = useAction(t);
  const [confirming, setConfirming] = useState(false);
  const model = models.find((each) => each.id === analyst.decisionModel);
  const names = users.map((agent) => agent.name).join(", ");
  return (
    <li className="grid gap-2 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[1.07rem] font-bold">{analyst.name}</span>
        <Badge tone={model && isReady(model) ? "neutral" : "warn"}>{model?.label ?? analyst.decisionModel}</Badge>
      </div>
      {!model ? <Notice tone="warn">{fill(t.modelGone, { model: analyst.decisionModel })}</Notice> : !isReady(model) ? <Notice tone="warn">{fill(t.modelNoKey, { model: model.label })}</Notice> : null}
      <p className="text-sm text-muted">
        {analyst.temperature ? t.temperatureOn : t.temperatureOff} · {analyst.objections.length === 1 ? t.objectionsCountOne : fill(t.objectionsCount, { n: analyst.objections.length })}
        {analyst.objections.length > 0 ? `: ${analyst.objections.map((objection) => objection.label).join(", ")}` : ""}
      </p>
      <p className="text-sm text-muted">{users.length > 0 ? fill(t.usedBy, { agents: names }) : t.usedByNone}</p>
      {model && leavesServer(model) ? <ConfirmedBy analyst={analyst} t={t} /> : null}
      {canConfigure && !confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onEdit}>{t.edit}</Button>
          <Button variant="ghost" icon={<Trash size={16} weight="duotone" aria-hidden />} onClick={() => setConfirming(true)}>
            {t.delete}
          </Button>
        </div>
      ) : null}
      {confirming ? (
        <Notice tone="fail">
          <p>{fill(t.deleteConfirm, { name: analyst.name })}</p>
          {/* O que vai junto: os agentes que ficam sem analista, pelo nome. */}
          <p>{users.length > 0 ? fill(t.deleteAgents, { agents: names }) : t.deleteNoAgents}</p>
          <p>{t.deleteTimeline}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button
              variant="danger"
              busy={remove.busy}
              onClick={() =>
                void remove.run(async () => {
                  const answer = await api<{ agentsUnlinked: number }>(`/analysts/${analyst.id}`, { method: "DELETE" });
                  onDeleted(answer.agentsUnlinked);
                })
              }
            >
              {fill(t.deleteYes, { name: analyst.name })}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t.cancel}
            </Button>
          </div>
          {remove.error ? <p className="text-fail">{remove.error}</p> : null}
        </Notice>
      ) : null}
    </li>
  );
}

export default function AnalystsSettings() {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const analysts = useApi<Analyst[]>("/analysts");
  // Os modelos e se cada um tem chave vêm da tela do filtro: a chave é a mesma (desenho R6, seção 3.1),
  // e é gravada lá. Esta tela só lê se ela existe.
  const filter = useApi<{ models: DecisionModelView[] }>("/speech-filter");
  const agents = useApi<Agent[]>("/agents");
  const [editing, setEditing] = useState<Analyst | "new" | null>(null);
  const [done, setDone] = useState("");

  const failure = analysts.error ?? filter.error ?? agents.error;
  if (failure && !(analysts.data && filter.data && agents.data)) return <Notice tone="fail">{errorText(failure)}</Notice>;
  if (!analysts.data || !filter.data || !agents.data) return <Skeleton lines={4} />;
  const models = filter.data.models;
  const usersOf = (analyst: Analyst): Agent[] => agents.data?.filter((agent) => agent.analystId === analyst.id) ?? [];
  const reload = (): void => {
    analysts.reload();
    agents.reload();
  };

  return (
    <>
      <Panel
        title={t.title}
        description={t.lead}
        actions={
          canConfigure && editing === null ? (
            <Button
              icon={<Plus size={16} weight="bold" aria-hidden />}
              onClick={() => {
                setDone("");
                setEditing("new");
              }}
            >
              {t.add}
            </Button>
          ) : null
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-1 text-sm text-muted">
            <p>{t.timelineNote}</p>
            <p>{t.cutNote}</p>
          </div>
          {done ? <Notice tone="ok">{done}</Notice> : null}
          {analysts.data.length === 0 ? (
            <p className="text-muted">{t.empty}</p>
          ) : (
            <ul className="grid">
              {analysts.data.map((analyst) => (
                <AnalystCard
                  key={analyst.id}
                  analyst={analyst}
                  models={models}
                  users={usersOf(analyst)}
                  t={t}
                  onEdit={() => {
                    setDone("");
                    setEditing(analyst);
                  }}
                  onDeleted={(unlinked) => {
                    setDone(unlinked === 0 ? t.deletedNone : unlinked === 1 ? t.deletedOne : fill(t.deleted, { n: unlinked }));
                    if (editing !== null && editing !== "new" && editing.id === analyst.id) setEditing(null);
                    reload();
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </Panel>
      {canConfigure && editing !== null ? (
        <Editor
          key={editing === "new" ? "new" : editing.id}
          editing={editing === "new" ? null : editing}
          models={models}
          t={t}
          onDone={(saved) => {
            setEditing(null);
            if (saved) {
              setDone(t.saved);
              reload();
            }
          }}
        />
      ) : null}
    </>
  );
}
