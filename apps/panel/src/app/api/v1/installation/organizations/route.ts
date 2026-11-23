import { addOrganization, listOrganizations, previewNewOrganization } from "@deskvoice/core";
import { z } from "zod";
import { ApiError } from "../../../../../server/context";
import { handleInstallation } from "../handle";

/** A lista de organizações e o que criar mais uma faria com a lista de quem administra a instalação. */
export const GET = handleInstallation({}, async ({ session, deps }) => ({
  // `current`: a organização em que quem pede está agora, que não pode ser suspensa por ela (seção 3.3).
  organizations: (await listOrganizations(deps.db)).map((organization) => ({ ...organization, current: organization.id === session.organizationId })),
  creation: await previewNewOrganization(deps.db),
}));

const ids = z.array(z.uuid()).max(200);
const body = z.object({ name: z.string().trim().min(1).max(120), shown: z.object({ granted: ids, losing: ids }), keep: ids });

/**
 * Cria a organização. Na segunda, a lista de quem administra fica explícita na mesma transação
 * (seção 3.2, item 3), e `shown` é o que a tela mostrou antes de confirmar.
 */
export const POST = handleInstallation({ support: false, body }, async ({ body, accountId, deps }) => {
  const result = await addOrganization(deps.db, { name: body.name, actorAccountId: accountId, shown: body.shown, keep: body.keep }, deps.clock.now());
  if (result.ok) return result;
  if (result.reason === "admins_changed") throw new ApiError(409, "installation_admins_changed", "Who administers the installation changed since this screen was opened. Reload and confirm again.");
  throw new ApiError(400, "invalid_keep", "Only the founding organization's admins listed on this screen can be kept.");
});
