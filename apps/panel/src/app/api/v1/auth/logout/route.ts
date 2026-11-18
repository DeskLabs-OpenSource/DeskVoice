import { signOutSupportSession } from "@deskvoice/core";
import { Reply, handle, sessionCookie } from "../../../../../server/context";

/**
 * Sai. Na sessão de suporte da instalação, sair encerra o acesso na hora (seção 3.6 do desenho do
 * R8), como `auth/support/end`: o fim fica nas duas auditorias e o vínculo de suporte é desativado.
 */
export const POST = handle(
  {
    allowSuspended: true,
    // Antes da transação da organização: o fim do acesso tem a própria, e apaga a sessão nela.
    before: async ({ session, deps }) => {
      if (session.support && session.supportAccessId) await signOutSupportSession(deps.db, { id: session.id, supportAccessId: session.supportAccessId }, deps.clock.now());
    },
  },
  async ({ q, session, deps }) => {
    await q.exec("delete from sessions where id = $1", [session.id]);
    return new Reply(null, { "set-cookie": sessionCookie("", deps) });
  },
);
