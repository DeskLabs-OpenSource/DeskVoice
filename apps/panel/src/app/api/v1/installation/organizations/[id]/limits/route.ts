import { organizationLimitsView, setOrganizationLimits } from "@deskvoice/core";
import { z } from "zod";
import { notFound } from "../../../../../../../server/context";
import { handleInstallation } from "../../../handle";

/**
 * Os limites de uma organização (seção 3.4 do desenho do R8, fatia 7a): quantas linhas telefônicas e
 * quantos agentes ela cria. Só quem administra a instalação, e nunca pela sessão de suporte. A
 * organização vê os dela em Configurações, só para leitura (`/settings/limits`).
 */

/** Os limites e quanto a organização já usa de cada um. */
export const GET = handleInstallation({ support: false }, async ({ params, deps }) => {
  const view = await organizationLimitsView(deps.db, params.id ?? "");
  if (!view) throw notFound();
  return { maxTrunks: view.limits.maxTrunks, maxAgents: view.limits.maxAgents, usage: view.usage };
});

// `null` tira o limite. Campo desconhecido é recusado: a saída e o teto do mês entram com as fatias deles.
const limit = z.number().int().min(0).max(1_000_000).nullable();
const body = z.object({ maxTrunks: limit, maxAgents: limit }).strict();

/** Grava os dois limites e `organization_limits_changed` na auditoria da instalação. */
export const PUT = handleInstallation({ support: false, body }, async ({ body, params, accountId, deps }) => {
  const result = await setOrganizationLimits(deps.db, params.id ?? "", body, accountId, deps.clock.now());
  if (!result.ok) throw notFound();
  return { maxTrunks: result.limits.maxTrunks, maxAgents: result.limits.maxAgents };
});
