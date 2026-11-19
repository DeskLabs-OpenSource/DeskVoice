import { organizationLimitsView, setOrganizationLimits } from "@deskvoice/core";
import { z } from "zod";
import { notFound } from "../../../../../../../server/context";
import { centsOf } from "../../../../../../../server/costs";
import { handleInstallation } from "../../../handle";

/**
 * Os limites de uma organização (seção 3.4 do desenho do R8, fatias 7a, 7b e 7c): quantas linhas
 * telefônicas e quantos agentes ela cria, se ela pode ligar para fora e o teto de gasto do mês. Só quem administra a
 * instalação, e nunca pela sessão de suporte. A organização vê os dela em Configurações, só para
 * leitura (`/settings/limits`).
 */

/**
 * Os limites, quanto a organização já usa de cada um, e a escolha dela sobre a saída
 * (`outboundPolicyEnabled`), lida para a tela dizer como a saída volta quando a trava sai, e o gasto do
 * mês (`monthCost`), a mesma soma da tela de Custos e do teto, ao lado do teto.
 */
export const GET = handleInstallation({ support: false }, async ({ params, deps }) => {
  const view = await organizationLimitsView(deps.db, params.id ?? "", deps.clock.now());
  if (!view) throw notFound();
  const { from, to, microcents, unmeasuredCount, estimatedCount } = view.monthCost;
  return {
    maxTrunks: view.limits.maxTrunks,
    maxAgents: view.limits.maxAgents,
    outboundAllowed: view.limits.outboundAllowed,
    monthlySpendCapCents: view.limits.monthlySpendCapCents,
    outboundPolicyEnabled: view.outboundPolicyEnabled,
    usage: view.usage,
    monthCost: { from, to, cents: centsOf(microcents), unmeasuredCount, estimatedCount },
  };
});

// `null` tira o limite. `outboundAllowed` é sim ou não, nunca nulo (a coluna é `not null`). O teto do
// mês é em centavos (de dólar, a moeda do extrato), até o maior `integer` do Postgres. Campo
// desconhecido é recusado.
const limit = z.number().int().min(0).max(1_000_000).nullable();
const spendCap = z.number().int().min(0).max(2_147_483_647).nullable();
const body = z.object({ maxTrunks: limit, maxAgents: limit, outboundAllowed: z.boolean().optional(), monthlySpendCapCents: spendCap.optional() }).strict();

/**
 * Grava os limites e `organization_limits_changed` na auditoria da instalação. A trava da saída não
 * escreve em `outbound_policy`: a escolha da organização fica como ela deixou.
 */
export const PUT = handleInstallation({ support: false, body }, async ({ body, params, accountId, deps }) => {
  const result = await setOrganizationLimits(deps.db, params.id ?? "", body, accountId, deps.clock.now());
  if (!result.ok) throw notFound();
  return { maxTrunks: result.limits.maxTrunks, maxAgents: result.limits.maxAgents, outboundAllowed: result.limits.outboundAllowed, monthlySpendCapCents: result.limits.monthlySpendCapCents };
});
