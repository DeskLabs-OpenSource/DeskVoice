import { renameOrganization } from "@deskvoice/core";
import { z } from "zod";
import { notFound } from "../../../../../../server/context";
import { handleInstallation } from "../../handle";

const body = z.object({ name: z.string().trim().min(1).max(120) });

/** Renomeia a organização. Fica na auditoria da instalação e na da própria organização. */
export const PATCH = handleInstallation({ support: false, body }, async ({ body, params, accountId, deps }) => {
  if (!(await renameOrganization(deps.db, accountId, params.id ?? "", body.name, deps.clock.now()))) throw notFound();
  return { id: params.id, name: body.name };
});
