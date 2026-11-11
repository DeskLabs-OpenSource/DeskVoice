"use client";

import { ArrowLeft, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import en from "../../../../i18n/en/agents";
import enCommon from "../../../../i18n/en/common";
import es from "../../../../i18n/es/agents";
import esCommon from "../../../../i18n/es/common";
import { fill } from "../../../../i18n/locales";
import ptBR from "../../../../i18n/pt-BR/agents";
import ptBRCommon from "../../../../i18n/pt-BR/common";
import { useDict } from "../../../../i18n/provider";
import { api, useApi } from "../../../../ui/api";
import { ActionStatus, ReadOnlyNotice, useAction, useErrorText } from "../../../../ui/errors";
import { formatPhone } from "../../../../ui/format";
import { Button, Field, Notice, Panel, Select, Skeleton, Switch, TextArea, TextInput } from "../../../../ui/kit";
import { useCanConfigure } from "../../../../ui/me";
import type { Agent, Engine, Setting, ToolInfo } from "../../../../ui/types";

interface Draft {
  name: string;
  roleLabel: string;
  greeting: string;
  instructions: string;
  engine: string;
  voiceId: string;
  language: string;
  tools: string[];
  transferTo: string;
  maxMinutes: string;
  costCeiling: string;
  enabled: boolean;
}

const BLANK: Draft = { name: "", roleLabel: "", greeting: "", instructions: "", engine: "", voiceId: "", language: "pt-BR", tools: [], transferTo: "", maxMinutes: "10", costCeiling: "5.00", enabled: true };

const toDraft = (agent: Agent): Draft => ({
  name: agent.name,
  roleLabel: agent.roleLabel ?? "",
  greeting: agent.greeting ?? "",
  instructions: agent.instructions,
  engine: agent.engine,
  voiceId: agent.voiceId ?? "",
  language: agent.language,
  tools: agent.tools,
  transferTo: formatPhone(agent.transferTo),
  maxMinutes: String(Math.round(agent.maxCallSeconds / 60)),
  costCeiling: (agent.costCeilingCents / 100).toFixed(2),
  enabled: agent.enabled,
});

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const t = useDict(ptBR, en, es);
  const common = useDict(ptBRCommon, enCommon, esCommon);
  const router = useRouter();
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const agent = useApi<Agent>(isNew ? null : `/agents/${id}`);
  const engines = useApi<Engine[]>("/engines");
  const tools = useApi<ToolInfo[]>("/tools");
  const defaultEngine = useApi<Setting<string>>(isNew ? "/settings/engine.default" : null);
  const save = useAction();
  const remove = useAction();
  const [draft, setDraft] = useState<Draft | null>(isNew ? BLANK : null);
  const [confirming, setConfirming] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((current) => (current ? { ...current, [key]: value } : current));

  useEffect(() => {
    if (agent.data) setDraft(toDraft(agent.data));
  }, [agent.data]);
  // Agente novo já nasce com o motor padrão da instalação; sem padrão, o primeiro da lista.
  const fallbackEngine = defaultEngine.data?.value ?? engines.data?.[0]?.id ?? "";
  useEffect(() => {
    if (isNew && fallbackEngine) setDraft((current) => (current && current.engine === "" ? { ...current, engine: fallbackEngine } : current));
  }, [isNew, fallbackEngine]);

  const back = (
    <Link href="/agents" className="inline-flex items-center gap-1.5 justify-self-start text-[0.93rem] font-bold text-muted hover:text-ink">
      <ArrowLeft size={16} weight="bold" aria-hidden />
      {t.back}
    </Link>
  );
  if (agent.error && !agent.data) {
    return (
      <>
        {back}
        <Notice tone="fail">{agent.error.code === "not_found" ? t.notFound : errorText(agent.error)}</Notice>
      </>
    );
  }
  if (!draft) return <Skeleton lines={5} />;

  const engine = engines.data?.find((candidate) => candidate.id === draft.engine);
  const submit = (): Promise<boolean> =>
    save.run(async () => {
      const body = {
        name: draft.name,
        roleLabel: draft.roleLabel,
        greeting: draft.greeting,
        instructions: draft.instructions,
        engine: draft.engine,
        voiceId: draft.voiceId,
        language: draft.language,
        tools: draft.tools,
        transferTo: draft.transferTo,
        maxCallSeconds: Math.round(Number(draft.maxMinutes) * 60),
        costCeilingCents: Math.round(Number(draft.costCeiling.replace(",", ".")) * 100),
        enabled: draft.enabled,
      };
      const saved = await api<Agent>(isNew ? "/agents" : `/agents/${id}`, { method: isNew ? "POST" : "PATCH", body });
      if (isNew) router.replace(`/agents/${saved.id}`);
      else setDraft(toDraft(saved));
    });

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <header className="grid gap-3">
        {back}
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.01em]">{isNew ? t.newTitle : draft.name || t.newTitle}</h1>
      </header>
      <ReadOnlyNotice />

      <fieldset disabled={!canConfigure} className="grid gap-6">
        <Panel title={t.identity}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t.name}>
              <TextInput value={draft.name} onChange={(event) => set("name", event.target.value)} required maxLength={80} />
            </Field>
            <Field label={t.role} hint={t.roleHint}>
              <TextInput value={draft.roleLabel} onChange={(event) => set("roleLabel", event.target.value)} maxLength={80} />
            </Field>
          </div>
          <div className="mt-5 grid gap-1.5 border-t border-line pt-5">
            <Switch checked={draft.enabled} onChange={(next) => set("enabled", next)} label={t.enabledLabel} />
            <p className="text-[0.87rem] text-muted">{t.enabledHint}</p>
          </div>
        </Panel>

        <Panel title={t.conversation}>
          <div className="grid gap-4">
            <Field label={t.greeting} hint={t.greetingHint}>
              <TextInput value={draft.greeting} onChange={(event) => set("greeting", event.target.value)} maxLength={1000} />
            </Field>
            <Field label={t.instructions} hint={t.instructionsHint}>
              <TextArea value={draft.instructions} onChange={(event) => set("instructions", event.target.value)} rows={9} />
            </Field>
          </div>
        </Panel>

        <Panel title={t.voice}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t.engine}>
              <Select value={draft.engine} onChange={(event) => set("engine", event.target.value)} required>
                {engines.data?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.voiceId} hint={t.voiceHint}>
              <TextInput value={draft.voiceId} onChange={(event) => set("voiceId", event.target.value)} maxLength={80} />
            </Field>
            <Field label={t.language}>
              <TextInput mono value={draft.language} onChange={(event) => set("language", event.target.value)} required maxLength={20} />
            </Field>
          </div>
          {engine && engine.requiresKey && !engine.keyConfigured ? (
            <div className="mt-4">
              <Notice tone="warn">
                <p>{t.engineNoKey}</p>
                <Link href="/settings" className="font-bold underline underline-offset-4">
                  {t.engineKeyLink}
                </Link>
              </Notice>
            </div>
          ) : null}
          {engine && !engine.requiresKey ? <p className="mt-4 text-[0.87rem] text-muted">{t.engineSimulated}</p> : null}
        </Panel>

        <Panel title={t.tools} description={t.toolsLead}>
          {tools.data?.length === 0 ? <p className="text-muted">{t.toolsEmpty}</p> : null}
          <ul className="grid gap-1">
            {tools.data?.map((tool) => {
              const checked = draft.tools.includes(tool.name);
              return (
                <li key={tool.name}>
                  <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-sm px-3 py-2.5 transition-colors duration-[120ms] hover:bg-sunken has-checked:bg-sunken">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-(--dv-accent)"
                      checked={checked}
                      onChange={() => set("tools", checked ? draft.tools.filter((name) => name !== tool.name) : [...draft.tools, tool.name])}
                    />
                    <span className="data font-medium">{tool.name}</span>
                    <span className="col-start-2 text-[0.87rem] text-muted">{tool.description}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="grid gap-6 md:grid-cols-2">
          <Panel title={t.transfer}>
            <Field label={t.transferTo} hint={t.transferHint}>
              <TextInput mono type="tel" value={draft.transferTo} onChange={(event) => set("transferTo", event.target.value)} />
            </Field>
          </Panel>
          <Panel title={t.limits} description={t.limitsLead}>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t.maxMinutes}>
                <TextInput mono type="number" min={1} max={120} value={draft.maxMinutes} onChange={(event) => set("maxMinutes", event.target.value)} required />
              </Field>
              <Field label={t.costCeiling}>
                <TextInput mono inputMode="decimal" value={draft.costCeiling} onChange={(event) => set("costCeiling", event.target.value)} required />
              </Field>
            </div>
          </Panel>
        </div>
      </fieldset>

      {canConfigure ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-bg px-4 py-3 lg:-mx-10 lg:px-10">
          <Button type="submit" variant="primary" busy={save.busy}>
            {common.actions.save}
          </Button>
          <ActionStatus action={save} />
          {!isNew && !confirming ? (
            <Button variant="ghost" className="ml-auto" icon={<Trash size={18} weight="duotone" aria-hidden />} onClick={() => setConfirming(true)}>
              {t.delete}
            </Button>
          ) : null}
        </div>
      ) : null}

      {confirming ? (
        <Notice tone="fail">
          <p>{fill(t.deleteConfirm, { name: draft.name })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="danger" busy={remove.busy} onClick={() => void remove.run(() => api(`/agents/${id}`, { method: "DELETE" })).then((ok) => ok && router.replace("/agents"))}>
              {fill(t.deleteYes, { name: draft.name })}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {common.actions.cancel}
            </Button>
          </div>
          {remove.error ? <p className="text-fail">{remove.error}</p> : null}
        </Notice>
      ) : null}
    </form>
  );
}
