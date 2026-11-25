// As peças da tela dos testes do agente (fatia 7c) que só desenham: a lista, os botões e o resultado
// de uma rodada. Tudo chega por propriedade, para o teste de componente desenhar no servidor.
import type { AgentTestTurns, TurnFailure } from "@deskvoice/core";
import type { ReactNode } from "react";
import { fill, type Locale } from "../../../../../i18n/locales";
import type { AgentTestsDictionary } from "../../../../../i18n/pt-BR/agent-tests";
import { formatDateTime } from "../../../../../ui/format";
import { Badge, Button, Notice, type Tone } from "../../../../../ui/kit";
import type { RunStatus } from "./poll";

export interface RunSummary {
  id: string;
  status: RunStatus;
  errorCode: string | null;
  configHash: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface ListedTest {
  id: string;
  name: string;
  turns: AgentTestTurns;
  updatedAt: string;
  lastRun: RunSummary | null;
  /** A última rodada é de outra configuração (seção 5.2): "não rodado com a configuração atual". */
  stale: boolean;
}

export interface TestsList {
  /** `null`: o processo de voz não respondeu. */
  textMode: boolean | null;
  configHash: string | null;
  tests: ListedTest[];
}

/** Um turno da rodada, como o processo de voz grava. */
export interface RunTurn {
  user: string;
  says: string;
  tools: { name: string; args: unknown; result: unknown }[];
  verdict: { passed: boolean; failures: TurnFailure[] };
}

export interface RunDetail extends RunSummary {
  testId: string;
  engine: string;
  turns: RunTurn[];
}

const STATUS_TONE: Record<RunStatus, Tone> = { running: "accent", passed: "ok", failed: "fail", error: "warn" };

export function RunBadge({ status, t }: { status: RunStatus | null; t: AgentTestsDictionary }) {
  if (status === null) return <Badge>{t.status.never}</Badge>;
  return (
    <Badge tone={STATUS_TONE[status]} live={status === "running"}>
      {t.status[status]}
    </Badge>
  );
}

/**
 * A frase de custo e o motivo do botão desligado: estão na tela antes do primeiro clique. Quem só vê
 * o agente não tem botão, e então também não tem a frase de custo.
 */
export function RunControls({
  t,
  canConfigure,
  textMode,
  busy,
  hasTests,
  onNew,
  onRunAll,
}: {
  t: AgentTestsDictionary;
  canConfigure: boolean;
  textMode: boolean | null;
  busy: boolean;
  hasTests: boolean;
  onNew(): void;
  onRunAll(): void;
}) {
  if (!canConfigure) return null;
  return (
    <div className="grid gap-3">
      <Notice>{t.costNotice}</Notice>
      {textMode === false ? <Notice tone="warn">{t.noTextMode}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" onClick={onNew} disabled={busy}>
          {t.newTest}
        </Button>
        <Button type="button" onClick={onRunAll} disabled={busy || textMode === false || !hasTests} title={textMode === false ? t.noTextMode : undefined}>
          {busy ? t.running : t.runAll}
        </Button>
      </div>
    </div>
  );
}

export function TestRow({
  test,
  t,
  locale,
  canConfigure,
  textMode,
  busy,
  open,
  onRun,
  onEdit,
  onDelete,
  onToggle,
  children,
}: {
  test: ListedTest;
  t: AgentTestsDictionary;
  locale: Locale;
  canConfigure: boolean;
  textMode: boolean | null;
  busy: boolean;
  open: boolean;
  onRun(): void;
  onEdit(): void;
  onDelete(): void;
  onToggle(): void;
  /** O resultado aberto, abaixo da linha. */
  children?: ReactNode;
}) {
  return (
    <li className="grid gap-3 border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{test.name}</span>
            <RunBadge status={test.lastRun?.status ?? null} t={t} />
          </span>
          {test.lastRun ? <span className="text-[0.87rem] text-muted">{fill(t.ranAt, { when: formatDateTime(test.lastRun.startedAt, locale) })}</span> : null}
          {test.stale ? (
            <span className="text-[0.87rem] font-bold text-warn" title={t.staleHint}>
              {t.stale}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {test.lastRun ? (
            <Button type="button" variant="ghost" onClick={onToggle}>
              {open ? t.hideResult : t.showResult}
            </Button>
          ) : null}
          {canConfigure ? (
            <>
              <Button type="button" onClick={onRun} disabled={busy || textMode === false} title={textMode === false ? t.noTextMode : undefined}>
                {t.run}
              </Button>
              <Button type="button" variant="ghost" onClick={onEdit} disabled={busy}>
                {t.edit}
              </Button>
              <Button type="button" variant="ghost" onClick={onDelete} disabled={busy}>
                {t.delete}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {test.stale ? <p className="text-[0.87rem] text-muted">{t.staleHint}</p> : null}
      {children}
    </li>
  );
}

/** O valor como a tela mostra: texto como está, o resto em JSON legível. */
export const shown = (value: unknown): string => (typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value)));

function Value({ value }: { value: unknown }) {
  return <pre className="data overflow-x-auto rounded-sm bg-sunken p-2 text-[0.83rem] whitespace-pre-wrap">{shown(value)}</pre>;
}

/** Uma reprovação, com o esperado e o que veio lado a lado. */
export function FailureView({ failure, t }: { failure: TurnFailure; t: AgentTestsDictionary }) {
  return (
    <div className="grid gap-2 rounded-sm border border-fail/40 p-3">
      <p className="font-bold">{t.result.reasons[failure.reason]}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <span className="text-[0.8rem] font-bold text-muted uppercase">{t.result.expected}</span>
          <Value value={failure.detail.expected} />
        </div>
        <div className="grid gap-1">
          <span className="text-[0.8rem] font-bold text-muted uppercase">{t.result.got}</span>
          <Value value={failure.detail.got} />
        </div>
      </div>
    </div>
  );
}

const errorText = (code: string | null, t: AgentTestsDictionary): string =>
  code !== null && Object.hasOwn(t.result.errors, code) ? t.result.errors[code as keyof AgentTestsDictionary["result"]["errors"]] : t.result.unknownError;

/**
 * O resultado de uma rodada: o veredito, a frase do que o teste não cobre e a conversa turno a
 * turno, com as ferramentas pedidas e cada reprovação lado a lado. Os turnos do teste que a rodada
 * não alcançou (ela parou com erro) aparecem como não rodados.
 */
export function RunResult({ run, testTurns, t, gaveUp = false }: { run: RunDetail; testTurns: AgentTestTurns; t: AgentTestsDictionary; gaveUp?: boolean }) {
  const headline =
    run.status === "running" ? (
      <Notice>{gaveUp ? t.result.gaveUp : t.result.running}</Notice>
    ) : run.status === "passed" ? (
      <Notice tone="ok">{t.result.passed}</Notice>
    ) : run.status === "failed" ? (
      <Notice tone="fail">{t.result.failed}</Notice>
    ) : (
      <Notice tone="warn">{errorText(run.errorCode, t)}</Notice>
    );
  const missing = run.status === "running" ? [] : testTurns.slice(run.turns.length);
  return (
    <section className="grid gap-4 rounded-md border border-line p-4" aria-label={t.result.title}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">{t.result.title}</h3>
        <RunBadge status={run.status} t={t} />
      </div>
      {headline}
      {/* O verde não garante a ligação: a frase fica no resultado, e não só na ajuda (fatia 7c). */}
      <p className="text-[0.93rem] font-bold">{t.scope}</p>
      <ol className="grid gap-4">
        {run.turns.map((turn, index) => (
          <li key={index} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{fill(t.result.turn, { n: index + 1 })}</span>
              <Badge tone={turn.verdict.passed ? "ok" : "fail"}>{turn.verdict.passed ? t.result.turnPassed : t.result.turnFailed}</Badge>
            </div>
            <p>
              <span className="font-bold">{t.result.caller}: </span>
              {turn.user}
            </p>
            <p>
              <span className="font-bold">{t.result.agent}: </span>
              {turn.says.trim() !== "" ? turn.says : t.result.agentSilent}
            </p>
            <div className="grid gap-2">
              <span className="text-[0.87rem] font-bold text-muted">{t.result.toolCalls}</span>
              {turn.tools.length === 0 ? <span className="text-[0.87rem] text-muted">{t.result.noToolCalls}</span> : null}
              {turn.tools.map((tool, toolIndex) => (
                <div key={toolIndex} className="grid gap-2 md:grid-cols-2">
                  <div className="grid gap-1">
                    <span className="data font-bold">{tool.name}</span>
                    <span className="text-[0.8rem] text-muted">{t.result.toolArgs}</span>
                    <Value value={tool.args} />
                  </div>
                  <div className="grid gap-1">
                    <span className="text-[0.8rem] text-muted">{t.result.toolAnswer}</span>
                    <Value value={tool.result} />
                  </div>
                </div>
              ))}
            </div>
            {turn.verdict.failures.map((failure, failureIndex) => (
              <FailureView key={failureIndex} failure={failure} t={t} />
            ))}
          </li>
        ))}
        {missing.map((turn, index) => (
          <li key={`missing-${index}`} className="grid gap-1 text-muted">
            <span className="font-bold">{fill(t.result.turn, { n: run.turns.length + index + 1 })}</span>
            <p>
              <span className="font-bold">{t.result.caller}: </span>
              {turn.user}
            </p>
            <p className="text-[0.87rem]">{t.result.notReached}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
