"use client";

import { useLocale } from "../../../../i18n/provider";
import type { SpeechFilterDictionary } from "../../../../i18n/pt-BR/speech-filter";
import { noticeOf, type NoticeModel } from "./notice";

/**
 * O aviso de para onde vai o texto: só o que a fonte do fornecedor diz, com a página e a data. O mesmo
 * aviso serve ao filtro de fala e ao analista (desenho R6, seção 2.1: as mesmas condições).
 */
export function WhereTheTextGoes({ model, t }: { model: NoticeModel; t: SpeechFilterDictionary }) {
  const locale = useLocale();
  const notice = noticeOf(t, model, locale);
  return (
    <div className="grid gap-1 rounded-sm border border-line bg-surface px-4 py-3" data-testid="speech-filter-notice">
      <p className="font-bold">{t.noticeTitle}</p>
      {notice.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {notice.sources.map((source) => (
        <p key={source.url} className="text-sm text-muted">
          <a className="underline" href={source.url} target="_blank" rel="noreferrer">
            {source.text}
          </a>
        </p>
      ))}
    </div>
  );
}
