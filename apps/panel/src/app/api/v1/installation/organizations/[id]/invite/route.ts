import { createFirstOwnerInvite } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, notFound } from "../../../../../../../server/context";
import { handleInstallation } from "../../../handle";

const body = z.object({ email: z.string().trim().toLowerCase().max(320).pipe(z.email()), name: z.string().trim().min(1).max(120) });

/**
 * O convite do primeiro dono de uma organização ainda sem ninguém. É o convite da tela Equipe, aceito
 * pela mesma página; depois do primeiro dono, quem convida é ele.
 */
export const POST = handleInstallation({ body }, async ({ body, params, url, deps }) => {
  const result = await createFirstOwnerInvite(deps.db, params.id ?? "", body, deps.clock.now());
  if (!result.ok) {
    if (result.reason === "not_found") throw notFound();
    if (result.reason === "has_members") throw new ApiError(409, "organization_has_members", "This organization already has people. Its owner invites the others on the Team screen.");
    throw new ApiError(400, "email_taken", "This e-mail already has an account on this installation.");
  }
  // Como na tela Equipe: o endereço público da instalação, ou o que a pessoa usou para abrir o painel.
  const origin = url.host === new URL(deps.publicUrl).host ? new URL(deps.publicUrl).origin : url.origin;
  return { link: `${origin}/invite/${result.token}` };
});
