import { startSupportAccess } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, notFound } from "../../../../../../../server/context";
import { handleInstallation } from "../../../handle";

// O prazo (15, 30 ou 60) e o tamanho do motivo (10 a 500) são conferidos em `startSupportAccess`,
// com resposta própria; aqui só a forma e o teto que nenhuma tela manda.
const body = z.object({ reason: z.string().max(5000), minutes: z.number() });

const REFUSALS = {
  invalid_minutes: [400, "invalid_support_minutes", "The support access lasts 15, 30 or 60 minutes."],
  invalid_reason: [400, "invalid_support_reason", "The reason must have 10 to 500 characters."],
  already_member: [409, "already_member", "You are already on this organization's team. Switch to it from the organization menu."],
  support_access_active: [409, "support_access_active", "You already have a support access open in this organization."],
  not_installation_admin: [403, "forbidden", "Only who administers the installation can do this."],
  session_not_found: [401, "unauthenticated", "Sign in to continue."],
} as const;

/**
 * Entra numa organização como suporte da instalação (seção 3.6 do desenho do R8), com motivo e
 * prazo: a sessão de quem pede passa para lá, por um vínculo `support` com papel `admin`, até o
 * prazo ou até `auth/support/end`. O rastro fica na auditoria da organização e na da instalação.
 * Uma sessão de suporte não abre outra.
 */
export const POST = handleInstallation({ support: false, body }, async ({ body, params, accountId, session, deps }) => {
  const result = await startSupportAccess(
    deps.db,
    { actorAccountId: accountId, sessionId: session.id, organizationId: params.id ?? "", reason: body.reason, minutes: body.minutes },
    deps.clock.now(),
  );
  if (result.ok) return { supportAccessId: result.supportAccessId, organizationId: params.id, expiresAt: result.expiresAt };
  if (result.reason === "not_found") throw notFound();
  const [status, code, message] = REFUSALS[result.reason];
  throw new ApiError(status, code, message);
});
