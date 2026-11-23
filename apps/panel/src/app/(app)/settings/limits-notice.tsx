"use client";

import en from "../../../i18n/en/settings";
import es from "../../../i18n/es/settings";
import { fill } from "../../../i18n/locales";
import ptBR from "../../../i18n/pt-BR/settings";
import { useDict, useLocale } from "../../../i18n/provider";
import { useApi } from "../../../ui/api";
import { formatMoney } from "../../../ui/format";
import { Panel } from "../../../ui/kit";

interface OrganizationLimits {
  maxTrunks: number | null;
  maxAgents: number | null;
  /** O teto de gasto do mês (7c), em centavos de dólar; com ele, o gasto do mês, a soma da tela de Custos. */
  monthlySpendCapCents: number | null;
  monthCost: { cents: number } | null;
  usage: { trunks: number; agents: number };
}

/**
 * Os limites que a administração da instalação definiu para esta organização (seção 3.4 do desenho
 * do R8), só para leitura, com a trava da saída (fatia 7b), que vem de `/outbound-policy`, e o teto de
 * gasto do mês (7c), com o gasto do mês. Sem limite nenhum e sem trava, nada aparece: quem já instalou
 * não vê diferença.
 */
export function LimitsNotice() {
  const t = useDict(ptBR, en, es).limits;
  const locale = useLocale();
  const { data } = useApi<OrganizationLimits>("/organization-limits");
  const outbound = useApi<{ lockedByInstallation: boolean }>("/outbound-policy");
  const outboundLocked = outbound.data?.lockedByInstallation === true;
  if (!data || (data.maxTrunks === null && data.maxAgents === null && data.monthlySpendCapCents === null && !outboundLocked)) return null;
  return (
    <Panel title={t.title} description={t.lead}>
      <ul className="grid gap-1">
        {data.maxTrunks === null ? null : <li>{fill(t.trunks, { used: data.usage.trunks, limit: data.maxTrunks })}</li>}
        {data.maxAgents === null ? null : <li>{fill(t.agents, { used: data.usage.agents, limit: data.maxAgents })}</li>}
        {outboundLocked ? <li>{t.outboundLocked}</li> : null}
        {data.monthlySpendCapCents === null ? null : (
          <li>{fill(t.spendCap, { spent: formatMoney(data.monthCost?.cents ?? 0, locale), cap: formatMoney(data.monthlySpendCapCents, locale) })}</li>
        )}
      </ul>
    </Panel>
  );
}
