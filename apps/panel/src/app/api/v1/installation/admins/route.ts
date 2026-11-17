import { grantInstallationAdminBy, listInstallationAdmins } from "@deskvoice/core";
import { z } from "zod";
import { ApiError } from "../../../../../server/context";
import { handleInstallation } from "../handle";

/** Quem administra a instalação, e se a lista já é explícita. */
export const GET = handleInstallation({}, async ({ deps }) => listInstallationAdmins(deps.db));

const body = z.object({ email: z.string().trim().toLowerCase().max(320).pipe(z.email()) });

/** Põe uma conta na lista, pelo e-mail. */
export const POST = handleInstallation({ body }, async ({ body, accountId, deps }) => {
  const result = await grantInstallationAdminBy(deps.db, accountId, body.email, deps.clock.now());
  if (result.ok) return result;
  if (result.reason === "email_not_found") throw new ApiError(404, "email_not_found", "No account on this installation uses this e-mail.");
  throw new ApiError(409, "already_granted", "This account already administers the installation.");
});
