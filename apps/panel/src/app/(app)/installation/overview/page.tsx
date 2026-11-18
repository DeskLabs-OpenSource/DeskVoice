"use client";

import type { ReactNode } from "react";
import en from "../../../../i18n/en/installation";
import es from "../../../../i18n/es/installation";
import { fill } from "../../../../i18n/locales";
import ptBR from "../../../../i18n/pt-BR/installation";
import { useDict } from "../../../../i18n/provider";
import { useApi } from "../../../../ui/api";
import { Badge, Panel, Skeleton, type Tone } from "../../../../ui/kit";
import { Amount } from "../../costs/amount-view";

type Status = "ok" | "warn" | "fail";
interface Row {
  id: string;
  name: string;
  suspendedAt: string | null;
  calls: { count: number };
  cost: { cents: number; unmeasuredCount: number; estimatedCount: number };
  trunk: { connected: number; attention: number; down: number; check: { status: Status } } | null;
  engine: { state: "own_key" | "no_key" | "key_failed"; check: { status: Status } };
  queue: { late: number; failedLast24h: number };
}
interface Overview {
  voiceAnswered: boolean;
  organizations: Row[];
}

const ENGINE_TONE: Record<Row["engine"]["state"], Tone> = { own_key: "ok", no_key: "warn", key_failed: "fail" };

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[0.87rem] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A visão geral da instalação (seção 3.7 do desenho do R8): uma linha por organização, com os números
 * que a tela de cada uma mostra. Só de leitura e sem exportação.
 */
export default function InstallationOverview() {
  const t = useDict(ptBR, en, es).overview;
  const { data } = useApi<Overview>("/installation/overview");
  return (
    <Panel title={t.title} description={t.lead}>
      {!data ? (
        <Skeleton />
      ) : data.organizations.length === 0 ? (
        <p className="text-muted">{t.empty}</p>
      ) : (
        <ul className="grid">
          {data.organizations.map((row) => (
            <li key={row.id} className="grid gap-2 border-b border-line py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-bold">{row.name}</span>
                {row.suspendedAt ? <Badge tone="warn">{t.suspended}</Badge> : <Badge tone="ok">{t.active}</Badge>}
              </div>
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
                <Cell label={t.calls}>{row.calls.count}</Cell>
                <Cell label={t.cost}>
                  <Amount cents={row.cost.cents} unmeasuredCount={row.cost.unmeasuredCount} estimatedCount={row.cost.estimatedCount} />
                </Cell>
                <Cell label={t.trunk}>
                  {row.trunk === null ? (
                    <Badge tone="warn">{t.voiceDown}</Badge>
                  ) : row.trunk.connected + row.trunk.attention + row.trunk.down === 0 ? (
                    <span className="text-muted">{t.trunkNone}</span>
                  ) : (
                    <Badge tone={row.trunk.check.status}>
                      {fill(t.trunkCounts, { connected: row.trunk.connected, down: row.trunk.down })}
                      {row.trunk.attention > 0 ? fill(t.trunkAttention, { attention: row.trunk.attention }) : null}
                    </Badge>
                  )}
                </Cell>
                <Cell label={t.engine}>
                  <Badge tone={ENGINE_TONE[row.engine.state]}>{t.engineStates[row.engine.state]}</Badge>
                </Cell>
                <Cell label={t.queue}>
                  <span className={row.queue.late + row.queue.failedLast24h > 0 ? "text-warn" : undefined}>{fill(t.queueCounts, { late: row.queue.late, failed: row.queue.failedLast24h })}</span>
                </Cell>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
