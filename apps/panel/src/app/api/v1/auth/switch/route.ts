import { accountOfMember, switchOrganization } from "@deskvoice/core";
import { z } from "zod";
import { handlePublic, notFound, requireSession } from "../../../../../server/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({ organizationId: z.string().max(100) });

/**
 * Leva a sessão para outra organização da mesma conta (`switchOrganization`). O cookie não muda; a
 * tela recarrega. Organização que não existe, sem vínculo, com vínculo desativado ou de suporte, e
 * id malformado dão a mesma resposta: 404.
 */
export const POST = handlePublic({ body }, async ({ request, body, deps }) => {
  const session = await requireSession(request, deps, { allowSuspended: true });
  if (!UUID.test(body.organizationId)) throw notFound();
  const accountId = await accountOfMember(deps.db, session.userId);
  if (!accountId || !(await switchOrganization(deps.db, session.id, accountId, body.organizationId))) throw notFound();
  return null;
});
