"use client";

import { CALLER_MESSAGE_ORG_PER_DAY, CALLER_MESSAGE_ORG_PER_HOUR, DROP_FOLLOW_UP_MESSAGE_MAX, dropFollowUpDefaultMessage } from "@deskvoice/core/drop-follow-up";
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
import { proposedLanguage } from "../../../../ui/proposed-language";
import { GUIDED_ENGINES } from "../../settings/analysts/rules";
import type { Agent, Analyst, DropFollowUp, Engine, ListeningEnvironment, Me, Person, Setting, ToolInfo } from "../../../../ui/types";
import { readVocabulary, vocabularyCountText, vocabularyErrorText } from "../../../../ui/vocabulary";
import { analysisPatch, toAnalysisDraft, type AnalysisDraft } from "./analysis-choice";
import { AgentBrains } from "./brains";

/** O agente como a API devolve, com quem lê a ligação dele (R4, fatia 5): nulo segue a organização. */
type AgentWithBrain = Agent & { analysisBrain?: unknown };

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
  /** Vazio: as pendências do agente são da equipe. */
  followUpOwner: string;
  listeningEnvironment: ListeningEnvironment;
  /** O texto da caixa, um termo por linha. Vazio grava `[]`. */
  vocabulary: string;
  /** Para quem o agente pode passar a ligação; vazia de fábrica. */
  handoffTargets: string[];
  /** O que acontece quando a ligação cai. */
  dropFollowUp: DropFollowUp;
  /** O texto do WhatsApp para quem ligou; vazio vale o padrão. */
  dropFollowUpMessage: string;
  /** O analista ao vivo; vazio é "Nenhum", o de fábrica. */
  analystId: string;
  /** Quem lê a ligação depois que ela termina; de fábrica, igual à organização. */
  analysis: AnalysisDraft;
}

const BLANK: Draft = { name: "", roleLabel: "", greeting: "", instructions: "", engine: "", voiceId: "", language: "pt-BR", tools: [], transferTo: "", maxMinutes: "10", costCeiling: "5.00", enabled: true, followUpOwner: "", listeningEnvironment: "normal", vocabulary: "", handoffTargets: [], dropFollowUp: "off", dropFollowUpMessage: "", analystId: "", analysis: { kind: "organization" } };

const VOCABULARY_FIELD_ID = "agent-vocabulary";

/** Os modos de "Quando a ligação cai" que a tela oferece: os outros só aparecem quando o caminho deles existir. */
const DROP_FOLLOW_UP_OFFERED: readonly DropFollowUp[] = ["off", "task", "whatsapp", "call_back"];

/** Motores em que a sessão em Barulhento foi provada numa instalação real (a sessão abre; o efeito no ruído não foi medido). */
const NOISY_PROVEN_ENGINES: readonly string[] = ["openai-realtime", "gemini-live"];

const toDraft = (agent: AgentWithBrain): Draft => ({
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
  followUpOwner: agent.followUpOwnerUserId ?? "",
  listeningEnvironment: agent.listeningEnvironment ?? "normal",
  vocabulary: (agent.vocabulary ?? []).join("\n"),
  handoffTargets: agent.agentHandoffTargets ?? [],
  dropFollowUp: agent.dropFollowUp ?? "off",
  dropFollowUpMessage: agent.dropFollowUpMessage ?? "",
  analystId: agent.analystId ?? "",
  analysis: toAnalysisDraft(agent.analysisBrain),
});

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const t = useDict(ptBR, en, es);
  const common = useDict(ptBRCommon, enCommon, esCommon);
  const router = useRouter();
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const agent = useApi<AgentWithBrain>(isNew ? null : `/agents/${id}`);
  const engines = useApi<Engine[]>("/engines");
  const tools = useApi<ToolInfo[]>("/tools");
  const owners = useApi<Person[]>("/follow-ups/owners");
  // Os outros agentes da organização, para "Pode passar a ligação para". A lista vem da sessão (`withOrg`).
  const team = useApi<Agent[]>("/agents");
  const analysts = useApi<Analyst[]>("/analysts");
  const defaultEngine = useApi<Setting<string>>(isNew ? "/settings/engine.default" : null);
  // O pré-requisito da mensagem no WhatsApp para quem ligou: conector e confiança no número exibido.
  const whatsAppConnector = useApi<Setting<unknown>>("/settings/whatsapp.connector");
  const trustCaller = useApi<Setting<boolean>>("/settings/whatsapp.trust_caller_id");
  // O pré-requisito da religação: as ligações de saída ligadas (`outbound_policy.enabled`).
  const outboundPolicy = useApi<{ enabled: boolean }>("/outbound-policy");
  // O nome da organização entra no texto padrão da mensagem para quem ligou.
  const me = useApi<Me>("/auth/me");
  const save = useAction();
  const remove = useAction();
  // O agente novo espera `/auth/me`: o idioma que ele propõe é o da organização (R8, fatia 8a).
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  // O que está gravado no servidor. `agent.data` não se atualiza sozinho depois de salvar, então o
  // aviso de rascunho precisa da cópia que o próprio salvar devolve.
  const [savedEnvironment, setSavedEnvironment] = useState<ListeningEnvironment>("normal");
  // O modo gravado: o salvar só manda o modo quando ele mudou. Um agente já em `whatsapp` cujo
  // pré-requisito foi desligado depois continua salvando os outros campos, e a rota não o recusa.
  const [savedDropFollowUp, setSavedDropFollowUp] = useState<DropFollowUp>("off");
  // Quem lê a ligação, como está gravado: o salvar só manda a escolha quando ela mudou.
  const [savedAnalysis, setSavedAnalysis] = useState<AnalysisDraft>({ kind: "organization" });
  // O modelo escolhido não tem preço e o aviso dele está na tela: só então o salvar manda `acceptUnmeasured`.
  const [acceptUnmeasured, setAcceptUnmeasured] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((current) => (current ? { ...current, [key]: value } : current));

  useEffect(() => {
    if (agent.data) {
      setDraft(toDraft(agent.data));
      setSavedEnvironment(agent.data.listeningEnvironment ?? "normal");
      setSavedDropFollowUp(agent.data.dropFollowUp ?? "off");
      setSavedAnalysis(toAnalysisDraft(agent.data.analysisBrain));
    }
  }, [agent.data]);
  // Agente novo propõe o idioma da organização (`organizations.language`, copiado do padrão da
  // instalação quando ela foi criada); sem ele, pt-BR, como sempre. Se `/auth/me` falhar, pt-BR também.
  const meLoaded = me.data !== undefined || me.error !== undefined;
  const organizationLanguage = me.data?.organizationLanguage;
  useEffect(() => {
    if (isNew && meLoaded) setDraft((current) => current ?? { ...BLANK, language: proposedLanguage(organizationLanguage) });
  }, [isNew, meLoaded, organizationLanguage]);
  // Agente novo já nasce com o motor padrão da instalação; sem padrão, o primeiro da lista.
  const fallbackEngine = defaultEngine.data?.value ?? engines.data?.[0]?.id ?? "";
  const hasDraft = draft !== null;
  useEffect(() => {
    if (isNew && fallbackEngine) setDraft((current) => (current && current.engine === "" ? { ...current, engine: fallbackEngine } : current));
  }, [isNew, fallbackEngine, hasDraft]);

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

  // O próprio agente nunca aparece: ele não passa a ligação para si mesmo.
  const others = team.data?.filter((candidate) => candidate.id !== id) ?? [];
  // Os agentes que podem passar a ligação para este: apagá-lo o tira da lista deles.
  const handingOffHere = others.filter((other) => other.agentHandoffTargets?.includes(id));
  const engine = engines.data?.find((candidate) => candidate.id === draft.engine);
  // Barulhento foi provado no OpenAI Realtime e no Gemini Live. Em outro motor, a opção some; um agente que já
  // está em Barulhento continua vendo o campo, com um aviso, para não guardar a escolha escondida.
  const noisyProven = NOISY_PROVEN_ENGINES.includes(draft.engine);
  // "Voltar para Normal" mexe só no rascunho: até salvar, o agente atende em Barulhento.
  const backToNormalPending = savedEnvironment === "noisy" && draft.listeningEnvironment === "normal";
  // Por que a mensagem no WhatsApp está indisponível, a mesma ordem da rota; `undefined` enquanto carrega.
  const whatsAppBlock: "not_connected" | "not_trusted" | null | undefined =
    whatsAppConnector.data === undefined || trustCaller.data === undefined
      ? undefined
      : whatsAppConnector.data.value === null
        ? "not_connected"
        : trustCaller.data.value !== true
          ? "not_trusted"
          : null;
  // Por que a religação está indisponível, a mesma conferência da rota; `undefined` enquanto carrega.
  const callBackBlock: "outbound_disabled" | null | undefined = outboundPolicy.data === undefined ? undefined : outboundPolicy.data.enabled ? null : "outbound_disabled";
  // A regra é a da API (`checkVocabulary`): a tela diz o erro ao lado do campo e não manda nada.
  const vocabulary = readVocabulary(draft.vocabulary);
  const vocabularyError = vocabulary.result.ok ? undefined : vocabularyErrorText(vocabulary.result.problem, t);
  const submit = (): Promise<boolean> => {
    if (!vocabulary.result.ok) {
      document.getElementById(VOCABULARY_FIELD_ID)?.focus();
      return Promise.resolve(false);
    }
    const terms = vocabulary.result.terms;
    return save.run(async () => {
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
        followUpOwnerUserId: draft.followUpOwner === "" ? null : draft.followUpOwner,
        listeningEnvironment: draft.listeningEnvironment,
        vocabulary: terms,
        agentHandoffTargets: draft.handoffTargets,
        // Um modo que a tela não oferece (gravado fora dela) não volta no salvar: fica como está. O modo
        // que não mudou também não vai: a rota confere o pré-requisito de quem escolhe o `whatsapp`.
        ...(DROP_FOLLOW_UP_OFFERED.includes(draft.dropFollowUp) && (isNew || draft.dropFollowUp !== savedDropFollowUp) && { dropFollowUp: draft.dropFollowUp }),
        dropFollowUpMessage: draft.dropFollowUpMessage,
        analystId: draft.analystId === "" ? null : draft.analystId,
        ...analysisPatch(draft.analysis, savedAnalysis, acceptUnmeasured),
      };
      const saved = await api<AgentWithBrain>(isNew ? "/agents" : `/agents/${id}`, { method: isNew ? "POST" : "PATCH", body });
      setSavedEnvironment(saved.listeningEnvironment ?? "normal");
      setSavedDropFollowUp(saved.dropFollowUp ?? "off");
      setSavedAnalysis(toAnalysisDraft(saved.analysisBrain));
      if (isNew) router.replace(`/agents/${saved.id}`);
      else setDraft(toDraft(saved));
    });
  };

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

        <Panel title={t.vocabulary} description={t.vocabularyLead}>
          <div className="max-w-xl">
            <Field label={t.vocabularyField} hint={vocabularyCountText(vocabulary.count, t)} error={vocabularyError}>
              <TextArea
                id={VOCABULARY_FIELD_ID}
                value={draft.vocabulary}
                onChange={(event) => set("vocabulary", event.target.value)}
                rows={6}
                spellCheck={false}
                aria-invalid={vocabularyError ? true : undefined}
              />
            </Field>
          </div>
        </Panel>

        <Panel title={t.voice}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t.engine}>
              <Select
                value={draft.engine}
                onChange={(event) => {
                  const next = engines.data?.find((candidate) => candidate.id === event.target.value);
                  set("engine", event.target.value);
                  // A voz de um motor não existe no outro: trocar de motor volta para a voz padrão.
                  if (!next?.voices.some((voice) => voice.id === draft.voiceId)) set("voiceId", "");
                }}
                required
              >
                {engines.data?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.voiceId} hint={t.voiceHint}>
              <Select value={draft.voiceId} onChange={(event) => set("voiceId", event.target.value)}>
                <option value="">{engine?.defaultVoice ? fill(t.voiceDefault, { voice: engine.defaultVoice }) : t.voiceDefaultNone}</option>
                {engine?.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {[voice.id, voice.style, voice.recommended ? t.voiceRecommended : null].filter(Boolean).join(" · ")}
                  </option>
                ))}
                {draft.voiceId && !engine?.voices.some((voice) => voice.id === draft.voiceId) ? <option value={draft.voiceId}>{fill(t.voiceCustom, { voice: draft.voiceId })}</option> : null}
              </Select>
            </Field>
            <Field label={t.language}>
              <TextInput mono value={draft.language} onChange={(event) => set("language", event.target.value)} required maxLength={20} />
            </Field>
          </div>
          {noisyProven || draft.listeningEnvironment === "noisy" ? (
            <div className="mt-4 max-w-md">
              <Field label={t.listeningEnvironment} hint={t.listeningEnvironmentHint}>
                <Select value={draft.listeningEnvironment} onChange={(event) => set("listeningEnvironment", event.target.value === "noisy" ? "noisy" : "normal")}>
                  <option value="normal">{t.listeningEnvironmentNormal}</option>
                  <option value="noisy">{t.listeningEnvironmentNoisy}</option>
                </Select>
              </Field>
              {noisyProven ? null : (
                <div className="mt-2">
                  <Notice tone="warn">
                    <p>{fill(t.listeningEnvironmentUnproven, { engine: engine?.label ?? draft.engine })}</p>
                    <div>
                      <Button type="button" onClick={() => set("listeningEnvironment", "normal")}>
                        {t.listeningEnvironmentBackToNormal}
                      </Button>
                    </div>
                  </Notice>
                </div>
              )}
            </div>
          ) : (
            // Sem o campo, a linha fica: é ela que conta a quem usa outro motor que o modo existe.
            <p className="mt-4 max-w-md text-[0.87rem] text-muted">{t.listeningEnvironmentOnlyProven}</p>
          )}
          {backToNormalPending ? (
            <div className="mt-2 max-w-md">
              <Notice tone="warn">
                <p>{t.listeningEnvironmentUnsaved}</p>
              </Notice>
            </div>
          ) : null}
          {engine && engine.requiresKey && !engine.keyConfigured ? (
            <div className="mt-4">
              <Notice tone="warn">
                <p>{t.engineNoKey}</p>
                <Link href="/settings/ai" className="font-bold underline underline-offset-4">
                  {t.engineKeyLink}
                </Link>
              </Notice>
            </div>
          ) : null}
          {engine && !engine.requiresKey ? <p className="mt-4 text-[0.87rem] text-muted">{t.engineSimulated}</p> : null}
        </Panel>

        <AgentBrains
          agentId={isNew ? null : id}
          t={t}
          engineLabel={engine?.label ?? draft.engine}
          analysis={draft.analysis}
          onChange={(next, accept) => {
            set("analysis", next);
            setAcceptUnmeasured(accept);
          }}
          costCeilingCents={Math.round(Number(draft.costCeiling.replace(",", ".")) * 100)}
          analyst={analysts.data?.find((candidate) => candidate.id === draft.analystId) ?? null}
          canConfigure={canConfigure}
        />

        <Panel title={t.analyst} description={t.analystLead}>
          <Field label={t.analyst} hint={t.analystHint}>
            <Select value={draft.analystId} onChange={(event) => set("analystId", event.target.value)} className="max-w-sm">
              <option value="">{t.analystNone}</option>
              {analysts.data?.map((analyst) => (
                <option key={analyst.id} value={analyst.id}>
                  {analyst.name}
                </option>
              ))}
            </Select>
          </Field>
          {/* O motor sem `guide` (o Gemini Live, desenho R6, seção 3.3): o analista lê, mas a orientação não chega. */}
          {draft.analystId !== "" && draft.engine !== "" && !GUIDED_ENGINES.includes(draft.engine) ? (
            <div className="mt-4 max-w-md">
              <Notice tone="warn">
                <p>{fill(t.analystEngineUnsupported, { engine: engine?.label ?? draft.engine })}</p>
              </Notice>
            </div>
          ) : null}
          <Link href="/settings/analysts" className="mt-4 inline-block text-[0.87rem] font-bold text-muted underline-offset-4 hover:text-ink hover:underline">
            {t.analystLink}
          </Link>
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

        <Panel title={t.handoff} description={t.handoffLead}>
          {team.data && others.length === 0 ? <p className="text-muted">{t.handoffEmpty}</p> : null}
          <ul className="grid gap-1" aria-label={t.handoff}>
            {others.map((other) => {
              const checked = draft.handoffTargets.includes(other.id);
              return (
                <li key={other.id}>
                  <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-sm px-3 py-2.5 transition-colors duration-[120ms] hover:bg-sunken has-checked:bg-sunken">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-(--dv-accent)"
                      checked={checked}
                      onChange={() => set("handoffTargets", checked ? draft.handoffTargets.filter((target) => target !== other.id) : [...draft.handoffTargets, other.id])}
                    />
                    <span className="font-medium">{other.name}</span>
                    {other.roleLabel ? <span className="col-start-2 text-[0.87rem] text-muted">{other.roleLabel}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
          <ul className="mt-4 grid list-disc gap-1 pl-5 text-[0.87rem] text-muted">
            <li>{t.handoffWhen}</li>
            <li>{t.handoffLimits}</li>
            <li>{t.handoffMax}</li>
          </ul>
        </Panel>

        <Panel title={t.followUps} description={t.followUpsLead}>
          <Field label={t.followUpOwner} hint={t.followUpOwnerHint}>
            <Select value={draft.followUpOwner} onChange={(event) => set("followUpOwner", event.target.value)} className="max-w-sm">
              <option value="">{t.followUpOwnerTeam}</option>
              {owners.data?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-4">
            <Field label={t.dropFollowUp} hint={t.dropFollowUpDefinition}>
              <Select
                value={draft.dropFollowUp}
                onChange={(event) => set("dropFollowUp", DROP_FOLLOW_UP_OFFERED.find((mode) => mode === event.target.value) ?? "off")}
                className="max-w-sm"
              >
                <option value="off">{t.dropFollowUpOff}</option>
                <option value="task">{t.dropFollowUpTask}</option>
                {/* Indisponível: desabilitada, e o motivo e o caminho aparecem logo abaixo. Já escolhida, continua visível. */}
                <option value="whatsapp" disabled={whatsAppBlock !== null && draft.dropFollowUp !== "whatsapp"}>
                  {whatsAppBlock ? `${t.dropFollowUpWhatsApp} (${t.dropFollowUpWhatsAppUnavailable})` : t.dropFollowUpWhatsApp}
                </option>
                <option value="call_back" disabled={callBackBlock !== null && draft.dropFollowUp !== "call_back"}>
                  {callBackBlock ? `${t.dropFollowUpCallBack} (${t.dropFollowUpWhatsAppUnavailable})` : t.dropFollowUpCallBack}
                </option>
                {DROP_FOLLOW_UP_OFFERED.includes(draft.dropFollowUp) ? null : (
                  <option value={draft.dropFollowUp} disabled>
                    {t.dropFollowUpOther}
                  </option>
                )}
              </Select>
            </Field>
          </div>
          {whatsAppBlock ? (
            // O motivo da opção desabilitada e o caminho para resolver. Vira alerta só quando o modo
            // escolhido é o que ficou indisponível: aí a mensagem não sai, e cada queda vira pendência.
            draft.dropFollowUp === "whatsapp" ? (
              <div className="mt-3 max-w-prose">
                <Notice tone="fail">
                  <p>{whatsAppBlock === "not_connected" ? t.dropFollowUpNotConnected : t.dropFollowUpNotTrusted}</p>
                  <Link href={whatsAppBlock === "not_connected" ? "/settings/whatsapp" : "/settings/whatsapp#avancado"} className="font-bold underline-offset-4 hover:underline">
                    {t.dropFollowUpFixLink}
                  </Link>
                </Notice>
              </div>
            ) : (
              <p className="mt-2 max-w-prose text-[0.87rem] text-muted">
                {whatsAppBlock === "not_connected" ? t.dropFollowUpNotConnected : t.dropFollowUpNotTrusted}{" "}
                <Link href={whatsAppBlock === "not_connected" ? "/settings/whatsapp" : "/settings/whatsapp#avancado"} className="font-bold text-ink underline-offset-4 hover:underline">
                  {t.dropFollowUpFixLink}
                </Link>
              </p>
            )
          ) : null}
          {callBackBlock ? (
            // Como o WhatsApp: o motivo e o caminho; alerta só quando a religação já é o modo escolhido.
            draft.dropFollowUp === "call_back" ? (
              <div className="mt-3 max-w-prose">
                <Notice tone="fail">
                  <p>{t.dropFollowUpOutboundDisabled}</p>
                  <Link href="/outbound" className="font-bold underline-offset-4 hover:underline">
                    {t.dropFollowUpOutboundLink}
                  </Link>
                </Notice>
              </div>
            ) : (
              <p className="mt-2 max-w-prose text-[0.87rem] text-muted">
                {t.dropFollowUpOutboundDisabled}{" "}
                <Link href="/outbound" className="font-bold text-ink underline-offset-4 hover:underline">
                  {t.dropFollowUpOutboundLink}
                </Link>
              </p>
            )
          ) : null}
          {draft.dropFollowUp === "call_back" ? (
            // Quantas tentativas e quando (fixos no código, seção 3.6), e a lista de não ligar.
            <div className="mt-4 grid max-w-prose gap-2">
              <p className="text-[0.87rem] text-muted">{t.dropFollowUpCallBackHow}</p>
              <p className="text-[0.87rem] text-muted">{t.dropFollowUpCallBackDoNotCall}</p>
            </div>
          ) : null}
          {draft.dropFollowUp === "whatsapp" ? (
            <div className="mt-4 grid max-w-prose gap-2">
              <p className="text-[0.87rem] text-muted">{t.dropFollowUpBlockRisk}</p>
              <Field label={t.dropFollowUpMessage} hint={t.dropFollowUpMessageWarning}>
                <TextArea
                  value={draft.dropFollowUpMessage}
                  onChange={(event) => set("dropFollowUpMessage", event.target.value)}
                  placeholder={me.data?.organizationName === undefined ? undefined : dropFollowUpDefaultMessage(draft.language, me.data.organizationName)}
                  maxLength={DROP_FOLLOW_UP_MESSAGE_MAX}
                  rows={3}
                />
              </Field>
              <p className="text-[0.87rem] text-muted">{fill(t.dropFollowUpMessageLimits, { perHour: CALLER_MESSAGE_ORG_PER_HOUR, perDay: CALLER_MESSAGE_ORG_PER_DAY })}</p>
            </div>
          ) : null}
        </Panel>
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
          {/* O que vai junto: o agente sai da lista de destinos de quem o tinha marcado. */}
          {handingOffHere.length > 0 ? <p>{fill(t.deleteHandoffTargets, { name: draft.name, agents: handingOffHere.map((other) => other.name).join(", ") })}</p> : null}
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
