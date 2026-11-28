"use client";

// A tela dos testes do agente (item 7 da pesquisa Vapi, fatia 7c, seção 5.6 de
// docs/specs/2026-11-21-testes-do-agente.md). Quem pode editar o agente cria, edita, apaga e roda;
// quem só vê o agente vê os testes e os resultados, sem os botões. Rodar é sempre um clique: nada
// roda sozinho ao salvar as instruções, e o aviso "não rodado com a configuração atual" cobre o
// esquecimento. Desde a fatia 1 das abas (desenho 2026-11-26), ela é a aba Testes da tela do agente, e
// o endereço antigo (`page.tsx` ao lado) leva para lá.
import { useEffect, useRef, useState } from "react";
import en from "../../../../../i18n/en/agent-tests";
import es from "../../../../../i18n/es/agent-tests";
import { fill } from "../../../../../i18n/locales";
import ptBR from "../../../../../i18n/pt-BR/agent-tests";
import { useDict, useLocale } from "../../../../../i18n/provider";
import { api, useApi } from "../../../../../ui/api";
import { useErrorText } from "../../../../../ui/errors";
import { Button, EmptyState, Notice, Panel, Skeleton } from "../../../../../ui/kit";
import { useCanConfigure } from "../../../../../ui/me";
import type { Agent } from "../../../../../ui/types";
import { TestEditor } from "./editor";
import { blankTest, draftProblems, toDraft, toolChoices, toTurns, type DraftProblem, type TestDraft } from "./form";
import { pollRun } from "./poll";
import { refusalText } from "./refusal";
import { RunControls, RunResult, TestRow, type ListedTest, type RunDetail, type TestsList } from "./view";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Editing {
  testId: string | null;
  draft: TestDraft;
}

/** A aba Testes. O cabeçalho, o voltar e o aviso de só leitura são os da tela do agente. */
export function AgentTestsTab({ id }: { id: string }) {
  const t = useDict(ptBR, en, es);
  const locale = useLocale();
  const canConfigure = useCanConfigure();
  const errorText = useErrorText();
  const agent = useApi<Agent>(`/agents/${id}`);
  const list = useApi<TestsList>(`/agents/${id}/tests`);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [runs, setRuns] = useState<Record<string, { run: RunDetail; gaveUp: boolean }>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<ListedTest | null>(null);
  // A página saiu: a consulta da rodada para.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Acompanha uma rodada até ela acabar, mostrando cada resposta. Devolve o fim dela. */
  const follow = async (testId: string, runId: string): Promise<void> => {
    setOpen((current) => ({ ...current, [testId]: true }));
    const outcome = await pollRun(
      async () => {
        const run = await api<RunDetail>(`/agents/${id}/tests/${testId}/runs/${runId}`);
        if (alive.current) setRuns((current) => ({ ...current, [testId]: { run, gaveUp: false } }));
        return run;
      },
      { sleep, cancelled: () => !alive.current },
    );
    const last = outcome.run;
    if (!outcome.finished && outcome.reason === "gave_up" && last && alive.current) setRuns((current) => ({ ...current, [testId]: { run: last, gaveUp: true } }));
  };

  const runOne = async (test: ListedTest): Promise<void> => {
    const { runId } = await api<{ runId: string }>(`/agents/${id}/tests/${test.id}/run`, { method: "POST" });
    await follow(test.id, runId);
  };

  /** Roda os testes, um por vez e nunca em paralelo. A primeira recusa (o teto do mês, por exemplo) para a fila. */
  const run = async (tests: ListedTest[]): Promise<void> => {
    setBusy(true);
    setActionError("");
    try {
      for (const test of tests) {
        if (!alive.current) return;
        await runOne(test);
      }
    } catch (error) {
      setActionError(refusalText(error, t, errorText));
    } finally {
      setBusy(false);
      list.reload();
    }
  };

  const toggle = (test: ListedTest): void => {
    const next = !open[test.id];
    setOpen((current) => ({ ...current, [test.id]: next }));
    // O resultado da última rodada é lido ao abrir; rodando (em outra aba), a tela acompanha.
    if (next && test.lastRun && runs[test.id]?.run.id !== test.lastRun.id) {
      follow(test.id, test.lastRun.id).catch((error: unknown) => setActionError(refusalText(error, t, errorText)));
    }
  };

  const save = async (): Promise<void> => {
    if (!editing) return;
    const found = draftProblems(editing.draft);
    setProblems(found);
    setSaveError("");
    if (found.length > 0) return;
    setSaving(true);
    try {
      const body = { name: editing.draft.name.trim(), turns: toTurns(editing.draft) };
      if (editing.testId === null) await api(`/agents/${id}/tests`, { method: "POST", body });
      else await api(`/agents/${id}/tests/${editing.testId}`, { method: "PATCH", body });
      setEditing(null);
      setProblems([]);
      list.reload();
    } catch (error) {
      setSaveError(refusalText(error, t, errorText));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (test: ListedTest): Promise<void> => {
    setBusy(true);
    setActionError("");
    try {
      await api(`/agents/${id}/tests/${test.id}`, { method: "DELETE" });
      setDeleting(null);
      setRuns(({ [test.id]: _gone, ...rest }) => rest);
      list.reload();
    } catch (error) {
      setActionError(refusalText(error, t, errorText));
    } finally {
      setBusy(false);
    }
  };

  if ((agent.error && !agent.data) || (list.error && !list.data)) {
    const error = agent.error ?? list.error;
    return <Notice tone="fail">{error?.code === "not_found" ? t.notFound : errorText(error)}</Notice>;
  }
  if (!agent.data || !list.data) {
    return <Skeleton lines={6} />;
  }

  const tests = list.data.tests;
  const handoff = (agent.data.agentHandoffTargets ?? []).length > 0;
  return (
    <div className="grid gap-6">
      <div className="grid max-w-[64ch] gap-1">
        <h2 className="text-[1.25rem] leading-snug font-bold">{t.tabTitle}</h2>
        <p className="text-muted">{t.lead}</p>
      </div>
      <RunControls
        t={t}
        canConfigure={canConfigure}
        textMode={list.data.textMode}
        busy={busy || editing !== null}
        hasTests={tests.length > 0}
        onNew={() => {
          setEditing({ testId: null, draft: blankTest() });
          setProblems([]);
          setSaveError("");
        }}
        onRunAll={() => void run(tests)}
      />
      {list.data.textMode === null ? <Notice tone="warn">{t.voiceUnavailable}</Notice> : null}
      {actionError ? <Notice tone="fail">{actionError}</Notice> : null}

      {editing && canConfigure ? (
        <TestEditor
          draft={editing.draft}
          onChange={(draft) => setEditing({ ...editing, draft })}
          t={t}
          tools={toolChoices(agent.data.tools, handoff, editing.draft)}
          isNew={editing.testId === null}
          problems={problems}
          saving={saving}
          error={saveError}
          onSave={() => void save()}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <Notice tone="warn">
          <span className="grid gap-3">
            <span>{fill(t.deleteConfirm, { name: deleting.name })}</span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" variant="danger" busy={busy} onClick={() => void remove(deleting)}>
                {t.deleteYes}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
                {t.cancel}
              </Button>
            </span>
          </span>
        </Notice>
      ) : null}

      <Panel>
        {tests.length === 0 ? (
          <EmptyState icon={null} title={t.empty}>
            {t.emptyBody}
          </EmptyState>
        ) : (
          <ul className="grid">
            {tests.map((test) => {
              const shown = runs[test.id];
              return (
                <TestRow
                  key={test.id}
                  test={test}
                  t={t}
                  locale={locale}
                  canConfigure={canConfigure}
                  textMode={list.data?.textMode ?? null}
                  busy={busy || editing !== null}
                  open={open[test.id] === true}
                  onRun={() => void run([test])}
                  onEdit={() => {
                    setEditing({ testId: test.id, draft: toDraft(test.name, test.turns) });
                    setProblems([]);
                    setSaveError("");
                  }}
                  onDelete={() => setDeleting(test)}
                  onToggle={() => toggle(test)}
                >
                  {open[test.id] && shown ? <RunResult run={shown.run} testTurns={test.turns} t={t} gaveUp={shown.gaveUp} /> : null}
                </TestRow>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
