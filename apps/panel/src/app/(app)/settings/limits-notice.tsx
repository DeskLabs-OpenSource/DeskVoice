"use client";

import en from "../../../i18n/en/settings";
import es from "../../../i18n/es/settings";
import { fill } from "../../../i18n/locales";
import ptBR from "../../../i18n/pt-BR/settings";
import { useDict } from "../../../i18n/provider";
import { useApi } from "../../../ui/api";
import { Panel } from "../../../ui/kit";

interface OrganizationLimits {
  maxTrunks: number | null;
  maxAgents: number | null;
  usage: { trunks: number; agents: number };
}

/**
 * Os limites que a administração da instalação definiu para esta organização (seção 3.4 do desenho
 * do R8), só para leitura. Sem limite nenhum, nada aparece: quem já instalou não vê diferença.
 */
export function LimitsNotice() {
  const t = useDict(ptBR, en, es).limits;
  const { data } = useApi<OrganizationLimits>("/organization-limits");
  if (!data || (data.maxTrunks === null && data.maxAgents === null)) return null;
  return (
    <Panel title={t.title} description={t.lead}>
      <ul className="grid gap-1">
        {data.maxTrunks === null ? null : <li>{fill(t.trunks, { used: data.usage.trunks, limit: data.maxTrunks })}</li>}
        {data.maxAgents === null ? null : <li>{fill(t.agents, { used: data.usage.agents, limit: data.maxAgents })}</li>}
      </ul>
    </Panel>
  );
}
