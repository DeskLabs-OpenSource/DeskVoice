import { accountOfMember, listMemberships } from "@deskvoice/core";
import { handlePublic, notFound, requireSession } from "../../../../../server/context";

/**
 * As organizações em que a conta da sessão tem vínculo `member` ativo, e qual é a de agora. O
 * seletor do topo só aparece com mais de uma. A leitura atravessa organizações e por isso mora em
 * `packages/core` (`listMemberships`); aqui, só a sessão. Sem `handle`, para não segurar uma
 * transação da organização enquanto a do sistema roda.
 */
export const GET = handlePublic({}, async ({ request, deps }) => {
  const session = await requireSession(request, deps);
  const accountId = await accountOfMember(deps.db, session.userId);
  if (!accountId) throw notFound();
  const memberships = await listMemberships(deps.db, accountId);
  return memberships.map((membership) => ({ ...membership, current: membership.organizationId === session.organizationId }));
});
