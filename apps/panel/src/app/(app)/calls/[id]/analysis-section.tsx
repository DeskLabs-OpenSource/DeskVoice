"use client";

import type { CriterionStatus, StoredCallAnalysis } from "@deskvoice/core";
import { fill } from "../../../../i18n/locales";
import type { TimelineDictionary } from "../../../../i18n/pt-BR/timeline";
import { CRITERION_MAX, analysisView } from "../../../../ui/analysis";
import { Badge, Notice, type Tone } from "../../../../ui/kit";
import { analysisNotDoneText } from "../../../../ui/timeline";
import type { CallDetail, CallEvent } from "../../../../ui/types";

const STATUS_TONE: Record<CriterionStatus, Tone> = { met: "ok", partial: "warn", missed: "fail" };
const HANDLED_TONE = { addressed: "ok", partial: "warn", ignored: "fail" } as const satisfies Record<string, Tone>;

const Heading = ({ children }: { children: string }) => <h3 className="text-[0.8rem] font-bold text-muted">{children}</h3>;

/**
 * A seção "Análise" do detalhe da chamada (desenho `docs/specs/2026-11-13-analise-da-ligacao.md`,
 * seção 3.7). Com análise gravada, mostra a nota ao lado da régua inteira que a soma. Com a análise
 * ligada e nada gravado, diz o motivo do último `analysis_not_done`, com a mesma frase da linha do
 * tempo. Apagada no meio da análise, só a nota, com o motivo. Com a análise desligada e nada
 * gravado (o de fábrica), não aparece.
 */
export function AnalysisSection({ call, events, enabled, live, t }: { call: CallDetail; events: CallEvent[] | undefined; enabled: boolean; live: boolean; t: TimelineDictionary }) {
  const a = t.analysis;
  if (call.analysis) return <AnalysisBody analysis={call.analysis} erased={call.erased} t={t} />;
  // Apagada no meio da análise: a rotina guarda a nota e deixa `analysis` nula (`case when erased_at
  // is null`), e o apagamento não refaz nada. A nota que a lista e a linha do tempo mostram aparece
  // aqui também, com o motivo de não haver régua, e nenhum `analysis_not_done` antigo é lido.
  if (call.analysisScore !== null && call.erased && !call.analysisUnreadable) {
    return (
      <section className="grid max-w-[72ch] gap-1">
        <h2 className="text-[0.8rem] font-bold text-muted">{a.title}</h2>
        <p className="text-[1.5rem] leading-tight font-medium">{fill(a.score, { score: String(call.analysisScore) })}</p>
        <p className="text-[0.87rem] text-muted italic">{a.erasedMidway}</p>
      </section>
    );
  }
  let body;
  if (call.analysisUnreadable) body = <Notice tone="warn">{a.unreadable}</Notice>;
  else if (enabled && !live && events) {
    const notDone = events.findLast((event) => event.kind === "analysis_not_done");
    body = notDone ? <Notice tone="fail">{analysisNotDoneText(t.events, notDone.payload)}</Notice> : <p className="text-muted">{a.pending}</p>;
  } else return null;
  return (
    <section className="grid max-w-[72ch] gap-1.5">
      <h2 className="text-[0.8rem] font-bold text-muted">{a.title}</h2>
      {body}
    </section>
  );
}

function AnalysisBody({ analysis, erased, t }: { analysis: StoredCallAnalysis; erased: boolean; t: TimelineDictionary }) {
  const a = t.analysis;
  const view = analysisView(analysis);
  const purged = "purged" in analysis;
  return (
    <section className="grid max-w-[72ch] gap-4">
      <div className="grid gap-1">
        <h2 className="text-[0.8rem] font-bold text-muted">{a.title}</h2>
        <p className="text-[1.5rem] leading-tight font-medium">{fill(a.score, { score: String(view.score) })}</p>
        <p className="text-[0.85rem] text-muted">{fill(a.rubric, { version: String(analysis.rubricVersion), model: analysis.model })}</p>
        {/* Expurgada: nenhum texto de fala, só a régua, a temperatura e a contagem. */}
        {purged ? <p className="text-[0.87rem] text-muted italic">{erased ? a.erased : a.purged}</p> : null}
      </div>

      <ol className="grid rounded-md border border-line bg-surface">
        {view.rows.map((row) => {
          const criterion = a.criteria[row.id];
          return (
            <li key={row.id} className="grid gap-1 border-b border-line px-4 py-3 last:border-b-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{criterion?.name ?? row.id}</span>
                <Badge tone={STATUS_TONE[row.status]}>{a.status[row.status]}</Badge>
                <span className="data ml-auto">{fill(a.points, { points: String(row.points), max: String(CRITERION_MAX) })}</span>
              </p>
              {criterion ? (
                <p className="text-[0.87rem] text-muted">
                  <span className="font-bold">{a.side[row.side]}:</span> {criterion[row.side]}
                </p>
              ) : null}
              {row.evidence ? <p className="text-[0.87rem] leading-relaxed">“{row.evidence}”</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-1.5">
        <Heading>{a.temperatureTitle}</Heading>
        <ol className="flex flex-wrap gap-x-6 gap-y-1">
          {(["start", "middle", "end"] as const).map((step) => (
            <li key={step} className="grid gap-0.5">
              <span className="text-[0.8rem] text-muted">{a.temperatureSteps[step]}</span>
              <span className="font-bold">{a.temperatures[analysis.temperature[step]]}</span>
            </li>
          ))}
        </ol>
      </div>

      {"purged" in analysis ? (
        <p className="text-muted">{fill(a.objectionCount, { count: String(analysis.objectionCount) })}</p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Heading>{a.objectionsTitle}</Heading>
            {analysis.objections.length === 0 ? <p className="text-muted">{a.objectionsNone}</p> : null}
            <ul className="grid gap-2">
              {analysis.objections.map((objection, index) => (
                <li key={index} className="grid gap-1 rounded-sm border border-line bg-surface px-4 py-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{objection.objection}</span>
                    <Badge tone={HANDLED_TONE[objection.handled]}>{a.handled[objection.handled]}</Badge>
                  </p>
                  {objection.quote ? <p className="text-[0.87rem] leading-relaxed">“{objection.quote}”</p> : null}
                  {objection.response ? <p className="text-[0.87rem] text-muted">{fill(a.objectionResponse, { response: objection.response })}</p> : null}
                </li>
              ))}
            </ul>
            {analysis.droppedObjections > 0 ? <p className="text-[0.85rem] text-muted">{fill(a.objectionsDropped, { count: String(analysis.droppedObjections) })}</p> : null}
          </div>
          <TextList title={a.strengthsTitle} items={analysis.strengths} empty={a.nothing} />
          <TextList title={a.weaknessesTitle} items={analysis.weaknesses} empty={a.nothing} />
          <div className="grid gap-1.5">
            <Heading>{a.nextStepTitle}</Heading>
            <p className={analysis.nextStep ? "" : "text-muted"}>{analysis.nextStep || a.nextStepNone}</p>
          </div>
        </>
      )}
    </section>
  );
}

function TextList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="grid gap-1.5">
      <Heading>{title}</Heading>
      {items.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="grid list-disc gap-1 pl-5">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
