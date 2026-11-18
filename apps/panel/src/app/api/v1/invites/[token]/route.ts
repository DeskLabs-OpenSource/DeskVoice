import { findInviteByToken } from "@deskvoice/core";
import { handlePublic } from "../../../../../server/context";
import { INVALID_INVITE, guardInviteAttempt } from "../../../../../server/invite-guard";

// Pública: quem abre o link ainda não tem sessão. Inexistente, vencido, aceito e revogado dão a
// mesma resposta. A resposta do convite válido é a mesma para todo e-mail: a página não muda
// conforme o e-mail, e o caso só se decide no aceite, depois do envio da senha.
export const GET = handlePublic({}, async ({ request, params, deps }) => {
  const forgive = guardInviteAttempt(request, deps);
  const invite = await findInviteByToken(deps.db, params.token ?? "", deps.clock.now());
  if (!invite) throw INVALID_INVITE();
  forgive();
  return { organizationName: invite.organizationName, email: invite.email, name: invite.name, role: invite.role };
});
