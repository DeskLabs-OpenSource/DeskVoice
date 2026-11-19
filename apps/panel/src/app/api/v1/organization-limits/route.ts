import { organizationLimitsUsage } from "@deskvoice/core";
import { handle } from "../../../../server/context";

/**
 * Os limites que a administração da instalação definiu para esta organização (seção 3.4 do R8),
 * só para leitura: a organização não escreve em `organization_limits`. Quem muda é a área da
 * instalação (`/installation/organizations/[id]/limits`). Sem limite, os dois vêm nulos.
 */
export const GET = handle({}, async ({ q }) => {
  const view = await organizationLimitsUsage(q);
  return { maxTrunks: view.limits.maxTrunks, maxAgents: view.limits.maxAgents, usage: view.usage };
});
