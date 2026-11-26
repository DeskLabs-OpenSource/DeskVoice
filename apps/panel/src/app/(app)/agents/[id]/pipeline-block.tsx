"use client";

import { pricedBrainModels } from "@deskvoice/voice-engine/pipeline-choice";
import type { ProcessingLocation } from "@deskvoice/voice-engine/types";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import enVoice from "../../../../i18n/en/voice";
import esVoice from "../../../../i18n/es/voice";
import { fill, type Locale } from "../../../../i18n/locales";
import type { AgentsDictionary } from "../../../../i18n/pt-BR/agents";
import ptBRVoice, { type VoiceDictionary } from "../../../../i18n/pt-BR/voice";
import { useDict, useLocale } from "../../../../i18n/provider";
import { api, ApiFailure, useApi } from "../../../../ui/api";
import { useErrorText } from "../../../../ui/errors";
import { formatDateTime } from "../../../../ui/format";
import { Badge, Button, Field, Notice, Panel, Select, Skeleton } from "../../../../ui/kit";
import type { Engine, PipelineLatency } from "../../../../ui/types";
import { providerName } from "../../settings/voice/notice";
import { Listen, PIPELINE_BLOCK_ID } from "./voice-field";

/** A voz como `/api/v1/synthesizers` a devolve: o estado da chave e da confirmação da 9.1. */
export interface PipelineSynthesizer {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  configured: boolean;
  /** Quem confirmou o envio e quando. `name` nulo: a pessoa saiu da equipe. */
  consent: { name: string | null; at: string } | null;
}

/** A transcrição como `/api/v1/transcribers` a devolve: a chave que ela usa e a confirmação da 9.1 (fatia 6). */
export interface PipelineTranscriber {
  id: string;
  label: string;
  provider: string;
  processingLocation: ProcessingLocation;
  keyConfigured: boolean;
  consent: { name: string | null; at: string } | null;
}

/** Uma voz da conta, como `/api/v1/synthesizers/[id]/voices` a devolve. `previewUrl` é a amostra hospedada pelo fornecedor. */
export interface PipelineVoice {
  id: string;
  name: string;
  languages: string[];
  previewUrl?: string;
}

/** A lista de vozes de uma voz: carregando, a rota que falhou (com a frase), ou a lista com a falha do fornecedor. */
export type VoicesState = { state: "loading" } | { state: "failed"; text: string } | { state: "ready"; voices: PipelineVoice[]; failure: string | null };

/** O cérebro como `/api/v1/brains` o devolve, com `chat` (fatia 5b-1). */
export interface PipelineBrainOption {
  id: string;
  label: string;
  chat: boolean;
  configured: boolean;
  keyCheck: { result: string } | null;
}

/** Os cérebros que o pipeline pode usar: os que conversam (`chat`), com a chave aceita. */
export const conversationalBrains = (brains: readonly PipelineBrainOption[] | undefined): PipelineBrainOption[] =>
  (brains ?? []).filter((brain) => brain.chat && brain.configured && brain.keyCheck?.result === "accepted");

export interface PipelinePanelProps {
  t: AgentsDictionary;
  voiceT: VoiceDictionary;
  locale: Locale;
  /** O motor pipeline de `/api/v1/engines`, com a marca de indisponível. */
  pipeline: Engine;
  canConfigure: boolean;
  synthesizers: readonly PipelineSynthesizer[] | undefined;
  /** As transcrições de verdade, ou `undefined` enquanto carrega. */
  transcribers?: readonly PipelineTranscriber[] | undefined;
  /** Depois de confirmar ou apagar a confirmação de uma transcrição: relê a lista. */
  onTranscribersChanged?(): void;
  brains: readonly PipelineBrainOption[] | undefined;
  brain: string;
  onBrain(next: string): void;
  /** O valor da lista de modelos do cérebro escolhido (`/api/v1/brains/[brain]/models`), ou `undefined` enquanto carrega. */
  brainModels: unknown;
  model: string;
  onModel(next: string): void;
  /** As vozes de cada voz, pelo id. Ausente, cada voz lê a dela (a tela); os testes passam a lista pronta. */
  voicesOf?: Record<string, VoicesState>;
  /** A leitura que falhou (as vozes, os cérebros ou os modelos), já em frase: o bloco diz, e não fica carregando. */
  loadError?: string;
  /**
   * Quanto o pipeline leva para responder neste agente (fatia 5c), ou `undefined` enquanto carrega. `null`
   * é o agente novo, que ainda não tem ligação: sem medida.
   */
  latency?: PipelineLatency | null;
}

/**
 * O bloco "Pipeline" da tela do agente (fatia 5b-1): as três escolhas, só para ver e ouvir. Nada daqui
 * vai no salvar do agente: os seletores não têm `name`, e o corpo do PATCH sai do rascunho, que não os
 * conhece. Ao lado da voz e da transcrição fica o aviso da seção 9.1, com quem confirmou e quando. A
 * confirmação da transcrição é gravada daqui (fatia 6), porque ela não tem chave própria para gravar.
 */
export function PipelinePanel(props: PipelinePanelProps) {
  const { t, canConfigure } = props;
  return (
    <div id={PIPELINE_BLOCK_ID}>
      <Panel title={t.pipeline} description={t.pipelineLead}>
        {canConfigure ? (
          <div className="grid gap-6">
            {props.loadError ? <Notice tone="fail">{props.loadError}</Notice> : null}
            <LatencyPart t={t} locale={props.locale} latency={props.latency} />
            <TranscriberPart {...props} />
            <BrainPart {...props} />
            <VoicePart {...props} />
          </div>
        ) : (
          <p className="text-muted">{t.pipelineReadOnly}</p>
        )}
      </Panel>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="font-bold">{title}</h3>
      {children}
    </section>
  );
}

/** O aviso da seção 9.1, ao lado da peça que leva o dado de quem ligou para fora do servidor. */
function Consent({ lead, status }: { lead: string; status: string }) {
  return (
    <div className="grid gap-1 rounded-sm border border-line bg-sunken px-4 py-3 text-[0.87rem]" data-testid="pipeline-consent">
      <p>{lead}</p>
      <p className="font-bold">{status}</p>
    </div>
  );
}

/** Milissegundos em segundos, com uma casa: 1 240 ms é "1,2 s". */
const seconds = (ms: number, locale: Locale): string => (ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * A latência medida, ao lado da escolha (fatia 5c): a mediana dos turnos sem ferramenta, com o aviso quando
 * passa da meta, e a dos turnos com ferramenta à parte. Sem turno medido, "sem medida ainda", nunca um zero.
 */
export function LatencyPart({ t, locale, latency }: { t: AgentsDictionary; locale: Locale; latency: PipelineLatency | null | undefined }) {
  if (latency === undefined) return <Skeleton lines={1} />;
  const plain = latency?.withoutTool ?? null;
  const tool = latency?.withTool ?? null;
  return (
    <Part title={t.pipelineLatency}>
      <div className="grid gap-2" data-testid="pipeline-latency">
        <p className="text-[0.87rem] text-muted">{t.pipelineLatencyHint}</p>
        {plain ? (
          <p>{fill(plain.calls === 1 ? t.pipelineLatencyValueOne : t.pipelineLatencyValue, { value: seconds(plain.p50Ms, locale), turns: plain.turns, calls: plain.calls })}</p>
        ) : (
          <p>{tool ? t.pipelineLatencyNoneWithoutTool : t.pipelineLatencyNone}</p>
        )}
        {plain && latency && plain.p50Ms > latency.goalP50Ms ? <Notice tone="warn">{fill(t.pipelineLatencySlow, { goal: seconds(latency.goalP50Ms, locale) })}</Notice> : null}
        {tool ? <p className="text-[0.87rem] text-muted">{fill(t.pipelineLatencyTool, { value: seconds(tool.p50Ms, locale), turns: tool.turns })}</p> : null}
      </div>
    </Part>
  );
}

function TranscriberPart({ t, voiceT, locale, pipeline, transcribers, onTranscribersChanged }: PipelinePanelProps) {
  if (pipeline.unavailable?.reason === "no_live_transcriber")
    return (
      <Part title={t.pipelineTranscriber}>
        <p className="text-muted">{t.pipelineTranscriberNone}</p>
      </Part>
    );
  if (transcribers === undefined) return <Skeleton lines={2} />;
  return (
    <Part title={t.pipelineTranscriber}>
      {transcribers.map((transcriber) => (
        <TranscriberRow key={transcriber.id} t={t} voiceT={voiceT} locale={locale} transcriber={transcriber} onChanged={onTranscribersChanged} />
      ))}
    </Part>
  );
}

/**
 * Uma transcrição: o fornecedor, a chave que ela usa e a confirmação da 9.1 (fatia 6), com o botão que
 * confirma o envio e o que apaga a confirmação, em dois passos.
 */
function TranscriberRow({ t, voiceT, locale, transcriber, onChanged }: { t: AgentsDictionary; voiceT: VoiceDictionary; locale: Locale; transcriber: PipelineTranscriber; onChanged: (() => void) | undefined }) {
  const errorText = useErrorText();
  const [state, setState] = useState<{ busy: boolean; error: string; removing: boolean }>({ busy: false, error: "", removing: false });
  const provider = providerName(voiceT, transcriber.provider);
  const run = (method: "PUT" | "DELETE"): void => {
    setState((previous) => ({ ...previous, busy: true, error: "" }));
    api(`/transcribers/${encodeURIComponent(transcriber.id)}/consent`, { method, ...(method === "PUT" && { body: { confirmedProvider: transcriber.provider } }) }).then(
      () => {
        setState({ busy: false, error: "", removing: false });
        onChanged?.();
      },
      (failure: unknown) => setState({ busy: false, error: errorText(failure), removing: false }),
    );
  };
  const status = transcriber.consent
    ? fill(t.pipelineConfirmedBy, { who: transcriber.consent.name ?? t.pipelineRemovedPerson, when: formatDateTime(transcriber.consent.at, locale) })
    : t.pipelineTranscriberUnconfirmed;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{transcriber.label}</span>
        <Badge>{provider}</Badge>
      </div>
      {transcriber.keyConfigured ? null : <p className="text-[0.87rem]">{t.pipelineTranscriberNoKey}</p>}
      {transcriber.processingLocation.kind === "this-server" ? null : (
        <>
          <Consent lead={fill(t.pipelineTranscriberNotice, { provider })} status={status} />
          <div className="flex flex-wrap gap-2">
            {transcriber.consent === null ? (
              <Button busy={state.busy} onClick={() => run("PUT")}>
                {fill(t.pipelineTranscriberConfirm, { provider })}
              </Button>
            ) : state.removing ? (
              <>
                <span className="self-center text-[0.87rem]">{fill(t.pipelineTranscriberRemoveAsk, { provider })}</span>
                <Button variant="danger" busy={state.busy} onClick={() => run("DELETE")}>
                  {t.pipelineTranscriberRemove}
                </Button>
                <Button variant="secondary" onClick={() => setState((previous) => ({ ...previous, removing: false }))}>
                  {t.pipelineTranscriberKeep}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setState((previous) => ({ ...previous, removing: true }))}>
                {t.pipelineTranscriberRemove}
              </Button>
            )}
          </div>
          {state.error ? <Notice tone="fail">{state.error}</Notice> : null}
        </>
      )}
    </div>
  );
}

function BrainPart({ t, brains, brain, onBrain, brainModels, model, onModel }: PipelinePanelProps) {
  if (brains === undefined) return <Skeleton lines={2} />;
  const options = conversationalBrains(brains);
  const chosen = options.find((option) => option.id === brain) ?? options[0];
  // A mesma regra do preço da gravação e da abertura (`pricePipeline`): só o modelo com preço na lista.
  const priced = brainModels === undefined ? undefined : pricedBrainModels(brainModels);
  return (
    <Part title={t.pipelineBrain}>
      {chosen ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.pipelineBrain} hint={t.pipelineBrainHint}>
            <Select value={chosen.id} onChange={(event) => onBrain(event.target.value)}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          {priced === undefined ? (
            <Skeleton lines={1} />
          ) : priced.length === 0 ? (
            <p className="text-[0.87rem] text-muted">{t.pipelineModelNone}</p>
          ) : (
            <Field label={t.pipelineModel} hint={t.pipelineModelHint}>
              <Select value={priced.includes(model) ? model : priced[0]} onChange={(event) => onModel(event.target.value)}>
                {priced.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      ) : (
        <p className="text-[0.87rem] text-muted">
          {t.pipelineBrainNone}{" "}
          <Link href="/settings/brains" className="font-bold underline underline-offset-4">
            {t.pipelineBrainsLink}
          </Link>
        </p>
      )}
    </Part>
  );
}

function VoicePart({ t, voiceT, locale, synthesizers, voicesOf }: PipelinePanelProps) {
  if (synthesizers === undefined) return <Skeleton lines={3} />;
  return (
    <Part title={t.pipelineVoice}>
      <p className="text-[0.87rem] text-muted">{t.pipelineVoicesNote}</p>
      {synthesizers.map((synthesizer) => {
        const provider = providerName(voiceT, synthesizer.provider);
        const status = synthesizer.consent
          ? fill(t.pipelineConfirmedBy, { who: synthesizer.consent.name ?? t.pipelineRemovedPerson, when: formatDateTime(synthesizer.consent.at, locale) })
          : t.pipelineUnconfirmed;
        return (
          <div key={synthesizer.id} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{synthesizer.label}</span>
              <Badge>{provider}</Badge>
            </div>
            {synthesizer.configured ? (
              voicesOf ? (
                <VoiceRows t={t} provider={provider} state={voicesOf[synthesizer.id] ?? { state: "loading" }} />
              ) : (
                <LoadVoices t={t} voiceT={voiceT} provider={provider} synthesizerId={synthesizer.id} />
              )
            ) : (
              <p className="text-[0.87rem]">
                {fill(t.pipelineVoiceNoKey, { provider })}{" "}
                <Link href="/settings/voice" className="font-bold underline underline-offset-4">
                  {t.pipelineVoiceLink}
                </Link>
              </p>
            )}
            {synthesizer.processingLocation.kind === "this-server" ? null : <Consent lead={fill(voiceT.confirm, { provider })} status={status} />}
          </div>
        );
      })}
    </Part>
  );
}

/** Cada voz da conta com o rótulo do fornecedor e o Ouvir da amostra dele; sem amostra, diz isso. */
export function VoiceRows({ t, provider, state }: { t: AgentsDictionary; provider: string; state: VoicesState }) {
  if (state.state === "loading") return <Skeleton lines={3} />;
  if (state.state === "failed") return <Notice tone="fail">{state.text}</Notice>;
  if (state.failure) return <Notice tone="warn">{state.failure}</Notice>;
  return (
    <ul className="grid max-h-[28rem] overflow-y-auto">
      {state.voices.map((voice) => (
        <li key={voice.id} className="grid gap-1 border-b border-line py-2 last:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{voice.name}</span>
            <Badge>{provider}</Badge>
            {voice.languages.map((language) => (
              <Badge key={language}>{language}</Badge>
            ))}
          </div>
          {voice.previewUrl ? (
            // A amostra é do fornecedor e não gasta crédito; `preload="none"`: nada é pedido antes do clique.
            <Listen
              t={t}
              voice={voice.name}
              sample={{ src: voice.previewUrl, inPortuguese: false }}
              label={fill(t.pipelineVoiceListen, { voice: voice.name })}
              failedText={t.pipelineVoiceSampleFailed}
            />
          ) : (
            <span className="text-[0.87rem] text-muted">{t.pipelineVoiceNoSample}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

interface VoiceList {
  configured: boolean;
  voices: PipelineVoice[];
  failure: { result: keyof VoiceDictionary["results"]; status: number | null } | null;
}

/** Lê as vozes da conta pela rota da fatia 1b. A falha vem no vocabulário fechado, nunca o texto do fornecedor. */
function LoadVoices({ t, voiceT, provider, synthesizerId }: { t: AgentsDictionary; voiceT: VoiceDictionary; provider: string; synthesizerId: string }) {
  const errorText = useErrorText();
  const list = useApi<VoiceList>(`/synthesizers/${encodeURIComponent(synthesizerId)}/voices`);
  let state: VoicesState;
  if (list.error && !list.data) {
    const own = list.error instanceof ApiFailure && Object.hasOwn(voiceT.errors, list.error.code) ? voiceT.errors[list.error.code as keyof VoiceDictionary["errors"]] : null;
    state = { state: "failed", text: own ?? errorText(list.error) };
  } else if (!list.data) state = { state: "loading" };
  else {
    const { failure } = list.data;
    const status = failure && failure.status !== null ? ` ${fill(voiceT.status, { status: failure.status })}` : "";
    state = { state: "ready", voices: list.data.voices, failure: failure ? fill(voiceT.voicesFailed, { result: `${voiceT.results[failure.result]}${status}` }) : null };
  }
  return <VoiceRows t={t} provider={provider} state={state} />;
}

/**
 * O bloco com as leituras: as vozes e os cérebros são de quem configura (as rotas pedem), e quem só lê
 * vê uma linha. A escolha de cérebro e modelo fica só nesta tela: nada é gravado.
 */
export function PipelineBlock({ t, pipeline, canConfigure, agentId }: { t: AgentsDictionary; pipeline: Engine; canConfigure: boolean; agentId: string | null }) {
  const voiceT = useDict(ptBRVoice, enVoice, esVoice);
  const locale = useLocale();
  const synthesizers = useApi<PipelineSynthesizer[]>(canConfigure ? "/synthesizers" : null);
  const brains = useApi<PipelineBrainOption[]>(canConfigure ? "/brains" : null);
  const transcribers = useApi<PipelineTranscriber[]>(canConfigure ? "/transcribers" : null);
  const [brain, setBrain] = useState("");
  const [model, setModel] = useState("");
  const chosen = conversationalBrains(brains.data).find((option) => option.id === brain) ?? conversationalBrains(brains.data)[0];
  const models = useApi<unknown>(canConfigure && chosen ? `/brains/${encodeURIComponent(chosen.id)}/models` : null);
  // A latência medida do agente (fatia 5c). O agente novo não tem ligação: sem medida, sem leitura.
  const latency = useApi<PipelineLatency>(canConfigure && agentId ? `/agents/${encodeURIComponent(agentId)}/pipeline-latency` : null);
  const errorText = useErrorText();
  const failed = synthesizers.error ?? transcribers.error ?? brains.error ?? models.error ?? latency.error;
  return (
    <PipelinePanel
      t={t}
      voiceT={voiceT}
      locale={locale}
      pipeline={pipeline}
      canConfigure={canConfigure}
      synthesizers={synthesizers.data}
      transcribers={transcribers.data}
      onTranscribersChanged={transcribers.reload}
      brains={brains.data}
      brain={brain}
      onBrain={(next) => {
        setBrain(next);
        setModel("");
      }}
      brainModels={models.data}
      model={model}
      onModel={setModel}
      latency={agentId ? latency.data : null}
      {...(failed && { loadError: errorText(failed) })}
    />
  );
}
