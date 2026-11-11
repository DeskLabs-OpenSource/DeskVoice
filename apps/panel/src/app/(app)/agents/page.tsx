"use client";

import { Headset, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import en from "../../../i18n/en/agents";
import es from "../../../i18n/es/agents";
import { fill } from "../../../i18n/locales";
import ptBR from "../../../i18n/pt-BR/agents";
import { useDict } from "../../../i18n/provider";
import { useApi } from "../../../ui/api";
import { ReadOnlyNotice, useErrorText } from "../../../ui/errors";
import { formatPhone } from "../../../ui/format";
import { Badge, EmptyState, Notice, PageHeader, Skeleton, buttonClass } from "../../../ui/kit";
import { useCanConfigure } from "../../../ui/me";
import type { Agent, Engine } from "../../../ui/types";

export default function AgentsPage() {
  const t = useDict(ptBR, en, es);
  const errorText = useErrorText();
  const canConfigure = useCanConfigure();
  const agents = useApi<Agent[]>("/agents");
  const engines = useApi<Engine[]>("/engines");
  const create = canConfigure ? (
    <Link href="/agents/new" className={buttonClass("primary")}>
      <Plus size={18} weight="bold" aria-hidden />
      {t.create}
    </Link>
  ) : null;

  return (
    <>
      <PageHeader title={t.title} lead={t.lead} actions={agents.data?.length ? create : null} />
      <ReadOnlyNotice />
      {agents.error && !agents.data ? <Notice tone="fail">{errorText(agents.error)}</Notice> : null}
      {!agents.data && !agents.error ? <Skeleton /> : null}
      {agents.data?.length === 0 ? (
        <EmptyState icon={<Headset size={32} weight="duotone" aria-hidden />} title={t.emptyTitle} action={create}>
          <p>{t.emptyBody}</p>
        </EmptyState>
      ) : null}
      {agents.data?.length ? (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          {agents.data.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line px-5 py-4 transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
              <span className="grid min-w-0">
                <span className="truncate text-[1.07rem] font-bold">{agent.name}</span>
                <span className="truncate text-muted">{agent.roleLabel}</span>
              </span>
              <span className="hidden min-w-0 text-muted md:grid">
                <span className="truncate">{engines.data?.find((engine) => engine.id === agent.engine)?.label ?? agent.engine}</span>
                <span className="data truncate">{formatPhone(agent.transferTo)}</span>
              </span>
              <span className="hidden text-muted md:block">{fill(t.toolsCount, { n: agent.tools.length })}</span>
              <Badge tone={agent.enabled ? "ok" : "neutral"}>{agent.enabled ? t.on : t.off}</Badge>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
