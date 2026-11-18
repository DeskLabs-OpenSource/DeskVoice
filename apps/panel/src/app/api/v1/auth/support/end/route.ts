import { endSupportAccess } from "@deskvoice/core";
import { handlePublic, notFound, requireSession } from "../../../../../../server/context";

/**
 * Encerra o acesso de suporte da própria sessão (seção 3.6 do desenho do R8): grava o fim nas duas
 * auditorias, desativa o vínculo de suporte e leva a sessão de volta para a organização da conta.
 * O cookie não muda; a tela recarrega. Fora de uma sessão de suporte, 404. Vale com a organização
 * suspensa: o suporte serve justamente a ela.
 */
export const POST = handlePublic({}, async ({ request, deps }) => {
  const session = await requireSession(request, deps, { allowSuspended: true });
  if (!session.support || !session.supportAccessId) throw notFound();
  await endSupportAccess(deps.db, session.supportAccessId, deps.clock.now(), "ended");
  return null;
});
