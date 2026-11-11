import { findInviteByToken } from "@deskvoice/core";
import { handlePublic } from "../../../../../server/context";
import { INVALID_INVITE, guardInviteAttempt } from "../../../../../server/invite-guard";

// Pública: quem abre o link ainda não tem conta. Inexistente, vencido, aceito e revogado dão a
// mesma resposta.
export const GET = handlePublic({}, async ({ request, params, deps }) => {
  const forgive = guardInviteAttempt(request, deps);
  const invite = await findInviteByToken(deps.db, params.token ?? "", deps.clock.now());
  if (!invite) throw INVALID_INVITE();
  forgive();
  return { organizationName: invite.organizationName, email: invite.email, name: invite.name, role: invite.role };
});
