import { listInstallationEvents } from "@deskvoice/core";
import { ApiError } from "../../../../../server/context";
import { handleInstallation } from "../handle";

/** A auditoria da instalação, só de leitura, da mais nova para a mais antiga. `?before=<id>` traz a página seguinte. */
export const GET = handleInstallation({}, async ({ url, deps }) => {
  const before = url.searchParams.get("before") ?? undefined;
  if (before !== undefined && !/^[1-9][0-9]{0,18}$/.test(before)) throw new ApiError(400, "validation_error", "before: must be an event id.");
  return listInstallationEvents(deps.db, before);
});
