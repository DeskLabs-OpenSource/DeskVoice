import { revokeInstallationAdmin } from "@deskvoice/core";
import { ApiError, notFound } from "../../../../../../server/context";
import { handleInstallation } from "../../handle";

/** Tira uma conta da lista. A última pessoa nunca sai. */
export const DELETE = handleInstallation({ support: false }, async ({ params, accountId, deps }) => {
  const result = await revokeInstallationAdmin(deps.db, accountId, params.id ?? "", deps.clock.now());
  if (result.ok) return null;
  if (result.reason === "not_found") throw notFound();
  throw new ApiError(409, "last_installation_admin", "This is the last person who administers the installation. Add someone else first.");
});
