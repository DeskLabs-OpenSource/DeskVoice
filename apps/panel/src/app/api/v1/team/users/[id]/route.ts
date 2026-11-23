import { deleteAccountIfOrphan, endSupportAccessesIfNotAllowed, returnFollowUpsToTeam, type OrgQuery } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../../server/context";
import { roleName } from "../../../../../../server/shapes";
import { loadMember, requireAnotherOwner, requireOwnerToManage, revokeInvitesCreatedBy } from "../../../../../../server/team";

const PERSON = `id, name, email::text as email, role, disabled_at is null as active`;

// Papel ou situação novos podem tirar da conta o suporte da instalação (o último vínculo `member`
// ativo, ou a administração pela regra da fundadora): o `after` confere pelo papel de sistema, que
// enxerga as outras organizações, e encerra o acesso com `revoked`.
export const PATCH = handle(
  {
    support: false,
    body: z.object({ role: roleName.optional(), disabled: z.boolean().optional() }),
    configure: true,
    after: async (changed: Changed, { deps }) => {
      if (changed.changed) await endSupportAccessesIfNotAllowed(deps.db, changed.accountId, deps.clock.now(), changed.actorAccountId);
      return changed.person;
    },
  },
  async ({ q, session, params, body, deps }): Promise<Changed> => {
    const member = await loadMember(q, params.id);
    requireOwnerToManage(session, member.role, body.role);
    const role = body.role ?? member.role;
    const disabled = body.disabled ?? member.disabled;
    // Trocar o próprio papel é sempre recusado: quem se rebaixa por engano não consegue desfazer.
    if (member.id === session.userId && role !== member.role) throw new ApiError(400, "cannot_change_self_role", "You cannot change your own role. Ask another owner.");
    if (role !== "owner" || disabled) await requireAnotherOwner(q, member);

    const person = await q.one<Record<string, unknown> & { accountId: string }>(`update users set role = $2, disabled_at = case when $3 then coalesce(disabled_at, $4) else null end where id = $1 returning ${PERSON}, account_id as "accountId"`, [
      member.id,
      role,
      disabled,
      deps.clock.now(),
    ]);
    // Desativar derruba na hora quem está com o painel aberto, e os convites que a pessoa criou.
    if (disabled) {
      await q.exec("delete from sessions where user_id = $1", [member.id]);
      await revokeInvitesCreatedBy(q, member.id, deps.clock.now());
      // Quem saiu não cumpre mais o combinado: as pendências abertas dela voltam para a equipe, e os
      // agentes que a tinham como dono das pendências passam a entregá-las à equipe.
      await returnFollowUpsToTeam(q, member.id, deps.clock.now());
      await q.exec("update agents set follow_up_owner_user_id = null where follow_up_owner_user_id = $1", [member.id]);
    } else if (role !== member.role) {
      // Papel novo: caem os convites que a pessoa criou e que, com ele, não poderia mais emitir.
      await revokeInvitesCreatedBy(q, member.id, deps.clock.now(), role);
    }
    if (!person) throw new ApiError(404, "not_found", "Not found.");
    const { accountId, ...shown } = person;
    return { person: shown, accountId, actorAccountId: await accountOfUser(q, session.userId), changed: role !== member.role || disabled !== member.disabled };
  },
);

// Remover de vez só quem nunca decidiu uma aprovação nem fechou uma pendência: o histórico precisa
// continuar dizendo quem decidiu e quem fechou (a chave estrangeira zeraria `closed_by`). Para os
// outros, o caminho é desativar. A pendência fechada que sai pelo prazo de guarda deixa de contar.
export const DELETE = handle(
  {
    support: false,
    configure: true,
    // A conta fica fora do alcance de `deskvoice_app`: ela só sai depois que o vínculo saiu, pelo
    // papel de sistema. Sem isso, o e-mail fica preso numa conta sem vínculo e o convite novo para
    // ele cai em `email_taken`. Se este passo falhar, a remoção do vínculo já valeu.
    after: async (removed: Removed, { deps, session }) => {
      // Sem este vínculo, a conta pode ter perdido o último `member` ativo: o suporte dela acaba.
      await endSupportAccessesIfNotAllowed(deps.db, removed.accountId, deps.clock.now(), removed.actorAccountId);
      await deleteAccountIfOrphan(deps.db, removed.accountId, deps.clock.now(), { actorAccountId: removed.actorAccountId, organizationId: session.organizationId });
      return null;
    },
  },
  async ({ q, session, params, deps }): Promise<Removed> => {
    const member = await loadMember(q, params.id);
    requireOwnerToManage(session, member.role);
    await requireAnotherOwner(q, member);
    if (await q.one("select 1 from approvals where decided_by = $1 union all select 1 from follow_ups where closed_by = $1 limit 1", [member.id])) {
      throw new ApiError(409, "has_history", "This person decided approvals or closed follow-ups. Disable the account instead of removing it.");
    }
    // Antes de apagar: a remoção zera `created_by` nos convites, e depois disso não daria mais para achá-los.
    await revokeInvitesCreatedBy(q, member.id, deps.clock.now());
    const removed = await q.one<{ accountId: string }>("delete from users where id = $1 returning account_id as \"accountId\"", [member.id]);
    if (!removed) throw new ApiError(404, "not_found", "Not found.");
    return { accountId: removed.accountId, actorAccountId: await accountOfUser(q, session.userId) };
  },
);

async function accountOfUser(q: OrgQuery, userId: string): Promise<string | null> {
  return (await q.one<{ accountId: string }>("select account_id as \"accountId\" from users where id = $1", [userId]))?.accountId ?? null;
}

interface Changed {
  person: Record<string, unknown>;
  accountId: string;
  actorAccountId: string | null;
  changed: boolean;
}

interface Removed {
  accountId: string;
  actorAccountId: string | null;
}
