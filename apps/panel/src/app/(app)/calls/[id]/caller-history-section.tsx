"use client";

import Link from "next/link";
import type { CommonDictionary } from "../../../../i18n/pt-BR/common";
import type { TimelineDictionary } from "../../../../i18n/pt-BR/timeline";
import { fill, type Locale } from "../../../../i18n/locales";
import { formatDateTime } from "../../../../ui/format";
import type { CallerHistory } from "../../../../ui/types";

/**
 * "Este número": as ligações anteriores do telefone do outro lado e as pendências abertas dele, para
 * quem atende não precisar procurar na lista de Chamadas (fatia 2 do desenho de 13/11, registro
 * 0020). Chamada sem número não mostra o bloco. A chamada apagada a pedido do titular aparece sem
 * conteúdo, e o resumo que saiu com o prazo aparece como a frase do prazo. A simulada aparece com a
 * marca "Simulada": é um teste da equipe, e qualquer pessoa da equipe pode simular com o número de um
 * cliente. A pendência e a nota nascidas numa simulada levam a mesma marca (#291). Cada nota do agente
 * traz o link da ligação em que nasceu, e o texto dela aparece como texto puro.
 */
export function CallerHistorySection({ history, t, common, locale }: { history: CallerHistory | undefined; t: TimelineDictionary; common: CommonDictionary; locale: Locale }) {
  if (!history?.phone) return null;
  const h = t.callerHistory;
  const empty = history.callCount === 0 && history.openFollowUpCount === 0 && history.noteCount === 0;
  const simulatedMark = <span className="rounded border border-line px-1.5 text-[0.8rem] font-bold">{common.channel.simulated}</span>;
  return (
    <section className="grid max-w-[72ch] gap-3" aria-labelledby="caller-history-title">
      <div className="grid gap-0.5">
        <h2 id="caller-history-title" className="text-[0.8rem] font-bold text-muted">
          {h.title}
        </h2>
        <p className="text-[0.85rem] text-muted">{h.hint}</p>
      </div>
      {empty ? <p className="text-muted">{h.first}</p> : null}

      {history.openFollowUpCount > 0 ? (
        <div className="grid gap-1.5">
          <h3 className="text-[0.87rem] font-bold">{fill(h.followUps, { count: String(history.openFollowUpCount) })}</h3>
          <ul className="grid gap-1.5">
            {history.openFollowUps.map((followUp) => (
              <li key={followUp.id} className="grid gap-0.5 border-l-2 border-line pl-3">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{followUp.title}</span>
                  {followUp.simulated ? simulatedMark : null}
                </p>
                <p className="flex flex-wrap gap-x-3 text-[0.85rem] text-muted">
                  <span className="data">{fill(h.due, { value: formatDateTime(followUp.dueAt, locale) })}</span>
                  <span>{followUp.ownerName ?? h.team}</span>
                  {followUp.callId ? (
                    <Link href={`/calls/${followUp.callId}`} className="underline hover:text-ink">
                      {h.origin}
                    </Link>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
          {history.openFollowUpCount > history.openFollowUps.length ? (
            <p className="text-[0.85rem] text-muted">{fill(h.more, { count: String(history.openFollowUpCount - history.openFollowUps.length) })}</p>
          ) : null}
        </div>
      ) : null}

      {history.noteCount > 0 ? (
        <div className="grid gap-1.5">
          <h3 className="text-[0.87rem] font-bold">{fill(h.notes, { count: String(history.noteCount) })}</h3>
          <ul className="grid gap-1.5">
            {history.notes.map((note) => (
              <li key={note.id} className="grid gap-0.5 border-l-2 border-line pl-3">
                {/* Texto puro: a nota é o que a pessoa disse, escrito pelo modelo. Nunca HTML nem markdown. */}
                <p className="break-words whitespace-pre-line">{note.text}</p>
                <p className="flex flex-wrap items-baseline gap-x-3 text-[0.85rem] text-muted">
                  <span className="data">{formatDateTime(note.createdAt, locale)}</span>
                  {note.simulated ? simulatedMark : null}
                  <Link href={`/calls/${note.callId}`} className="underline hover:text-ink">
                    {h.origin}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
          {history.noteCount > history.notes.length ? <p className="text-[0.85rem] text-muted">{fill(h.more, { count: String(history.noteCount - history.notes.length) })}</p> : null}
        </div>
      ) : null}

      {history.callCount > 0 ? (
        <div className="grid gap-1.5">
          <h3 className="text-[0.87rem] font-bold">{fill(h.calls, { count: String(history.callCount) })}</h3>
          <ul className="grid gap-1.5">
            {history.calls.map((call) => (
              <li key={call.id} className="grid gap-0.5 border-l-2 border-line pl-3">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <Link href={`/calls/${call.id}`} className="data font-medium underline hover:text-ink">
                    {formatDateTime(call.startedAt, locale)}
                  </Link>
                  <span>{call.agentName ?? common.noAgent}</span>
                  {call.simulated ? simulatedMark : null}
                  <span className="text-[0.85rem] text-muted">
                    {t.direction[call.direction]} · {common.callStatus[call.status]}
                    {call.outcome ? ` · ${(t.outcomes as Record<string, string>)[call.outcome] ?? t.outcomes.unknown}` : ""}
                  </span>
                </p>
                {call.erased ? (
                  <p className="text-[0.85rem] text-muted italic">{h.erased}</p>
                ) : call.summaryPurged ? (
                  <p className="text-[0.85rem] text-muted italic">{t.summaryPurged}</p>
                ) : call.summary ? (
                  <p className="line-clamp-3 text-[0.85rem] whitespace-pre-line text-muted">{call.summary}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {history.callCount > history.calls.length ? <p className="text-[0.85rem] text-muted">{fill(h.more, { count: String(history.callCount - history.calls.length) })}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
