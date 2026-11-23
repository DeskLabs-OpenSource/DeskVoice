import { monthCost, organizationLimitsUsage } from "@deskvoice/core";
import { handle } from "../../../../server/context";
import { centsOf } from "../../../../server/costs";

/**
 * Os limites que a administração da instalação definiu para esta organização (seção 3.4 do R8),
 * só para leitura: a organização não escreve em `organization_limits`. Quem muda é a área da
 * instalação (`/installation/organizations/[id]/limits`). Sem limite, vêm nulos. O teto do mês vem
 * com o gasto do mês (`monthCost`, a mesma soma da tela de Custos e do teto), lido só quando há teto.
 */
export const GET = handle({}, async ({ q, deps }) => {
  const view = await organizationLimitsUsage(q);
  const cap = view.limits.monthlySpendCapCents;
  const month = cap === null ? null : await monthCost(q, deps.clock.now());
  return {
    maxTrunks: view.limits.maxTrunks,
    maxAgents: view.limits.maxAgents,
    monthlySpendCapCents: cap,
    monthCost: month && { from: month.from, to: month.to, cents: centsOf(month.microcents), unmeasuredCount: month.unmeasuredCount, estimatedCount: month.estimatedCount },
    usage: view.usage,
  };
});
