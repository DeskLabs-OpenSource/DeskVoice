import type { ReactNode } from "react";
import { fill } from "../../../../i18n/locales";
import type { InstallationDictionary } from "../../../../i18n/pt-BR/installation";
import { Badge } from "../../../../ui/kit";
import { Amount } from "../../costs/amount-view";

type Status = "ok" | "warn" | "fail";
export interface OverviewRowView {
  id: string;
  name: string;
  suspendedAt: string | null;
  calls: { count: number };
  cost: { cents: number; unmeasuredCount: number; estimatedCount: number };
  trunk: { connected: number; attention: number; down: number; check: { status: Status } } | null;
  engine: { state: "own_key" | "no_key" | "key_failed"; check: { status: Status } };
  queue: { late: number; failedLast24h: number };
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[0.87rem] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A linha de uma organização na visão geral, sem buscar nada: recebe a linha da rota e o dicionário.
 * As cores da Linha e do Motor são as da Saúde da organização (`check.status`); o texto do Motor vem
 * do estado da chave.
 */
export function OverviewRow({ row, t }: { row: OverviewRowView; t: InstallationDictionary["overview"] }) {
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-b-0">
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
          <Badge tone={row.engine.check.status}>{t.engineStates[row.engine.state]}</Badge>
        </Cell>
        <Cell label={t.queue}>
          <span className={row.queue.late + row.queue.failedLast24h > 0 ? "text-warn" : undefined}>{fill(t.queueCounts, { late: row.queue.late, failed: row.queue.failedLast24h })}</span>
        </Cell>
      </dl>
    </li>
  );
}
