"use client";

import { useEffect, useState } from "react";
import en from "../../../../i18n/en/installation";
import es from "../../../../i18n/es/installation";
import { fill } from "../../../../i18n/locales";
import ptBR, { type InstallationDictionary } from "../../../../i18n/pt-BR/installation";
import { useDict, useLocale } from "../../../../i18n/provider";
import { api, useApi } from "../../../../ui/api";
import { formatDateTime } from "../../../../ui/format";
import { Button, Panel, Skeleton } from "../../../../ui/kit";

interface InstallationEvent {
  id: string;
  at: string;
  kind: keyof InstallationDictionary["audit"]["kinds"];
  actorEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  subjectEmail: string | null;
  payload: Record<string, unknown>;
}

const PAGE = 100;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function sentence(event: InstallationEvent, t: InstallationDictionary["audit"]): string {
  const template = Object.hasOwn(t.kinds, event.kind) ? t.kinds[event.kind] : event.kind;
  const sentence = fill(template, {
    who: event.actorEmail ?? t.someone,
    org: event.organizationName ?? (event.organizationId ? t.gone : t.system),
    subject: event.subjectEmail ?? t.unknownAccount,
    from: text(event.payload.from),
    to: text(event.payload.to),
    target: text(event.payload.target_version),
  });
  const source = text(event.payload.source);
  return Object.hasOwn(t.sources, source) ? `${sentence} (${t.sources[source as keyof typeof t.sources]})` : sentence;
}

/** A auditoria da instalação, só de leitura. */
export default function InstallationAudit() {
  const t = useDict(ptBR, en, es).audit;
  const locale = useLocale();
  const { data } = useApi<InstallationEvent[]>("/installation/events");
  const [older, setOlder] = useState<InstallationEvent[]>([]);
  const [end, setEnd] = useState(false);
  const events = [...(data ?? []), ...older];
  useEffect(() => {
    if (data && data.length < PAGE) setEnd(true);
  }, [data]);
  return (
    <Panel title={t.title} description={t.lead}>
      {!data ? (
        <Skeleton />
      ) : events.length === 0 ? (
        <p className="text-muted">{t.empty}</p>
      ) : (
        <div className="grid gap-3">
          <ol className="grid">
            {events.map((event) => (
              <li key={event.id} className="grid gap-0.5 border-b border-line py-2.5 last:border-b-0">
                <span>{sentence(event, t)}</span>
                <span className="data text-[0.87rem] text-muted">{formatDateTime(event.at, locale)}</span>
              </li>
            ))}
          </ol>
          {end ? null : (
            <div>
              <Button
                variant="ghost"
                onClick={() =>
                  void api<InstallationEvent[]>(`/installation/events?before=${events[events.length - 1]?.id ?? ""}`).then((page) => {
                    setOlder([...older, ...page]);
                    if (page.length < PAGE) setEnd(true);
                  })
                }
              >
                {t.more}
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
