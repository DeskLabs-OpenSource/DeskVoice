import { reactivateOrganization, suspendOrganization, suspensionPreview } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, notFound } from "../../../../../../../server/context";
import { handleInstallation } from "../../../handle";

/**
 * Suspender e reativar uma organização (seção 3.3 do desenho do R8, fatia 4b). Só quem administra
 * a instalação (`handleInstallation`), e vale mesmo com a organização da sessão suspensa: senão,
 * ninguém reativa.
 */

/** O que a confirmação diz antes de suspender: quantas tarefas seriam canceladas agora. */
export const GET = handleInstallation({}, async ({ params, deps }) => {
  const preview = await suspensionPreview(deps.db, params.id ?? "");
  if (!preview) throw notFound();
  return preview;
});

// O tamanho do motivo (10 a 500) é conferido em `suspendOrganization`, com resposta própria; aqui só
// o teto que nenhuma tela manda.
const body = z.object({ reason: z.string().max(5000) });

const SUSPEND_REFUSALS = {
  invalid_reason: [400, "invalid_suspension_reason", "The reason must have 10 to 500 characters."],
  own_organization: [409, "suspend_own_organization", "You are in this organization now. Switch to another one before suspending it."],
  already_suspended: [409, "organization_already_suspended", "This organization is already suspended."],
  last_active_organization: [409, "last_active_organization", "This is the last active organization of the installation."],
} as const;

/** Suspende: marca, cancela as tarefas canceláveis e grava nas duas auditorias, numa transação só. */
export const POST = handleInstallation({ support: false, body }, async ({ body, params, accountId, session, deps }) => {
  const result = await suspendOrganization(deps.db, { organizationId: params.id ?? "", actorAccountId: accountId, sessionOrganizationId: session.organizationId, reason: body.reason }, deps.clock.now());
  if (result.ok) return result;
  if (result.reason === "not_found") throw notFound();
  const [status, code, message] = SUSPEND_REFUSALS[result.reason];
  throw new ApiError(status, code, message);
});

/** Reativa. Nada do que a suspensão cancelou volta; o que entrou durante ela é cancelado agora. */
export const DELETE = handleInstallation({ support: false }, async ({ params, accountId, deps }) => {
  const result = await reactivateOrganization(deps.db, { organizationId: params.id ?? "", actorAccountId: accountId }, deps.clock.now());
  if (result.ok) return result;
  if (result.reason === "not_found") throw notFound();
  throw new ApiError(409, "organization_not_suspended", "This organization is not suspended.");
});
