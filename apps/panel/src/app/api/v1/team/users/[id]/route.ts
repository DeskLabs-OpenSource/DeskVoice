import { deleteAccountIfOrphan, returnFollowUpsToTeam } from "@deskvoice/core";
import { z } from "zod";
import { ApiError, handle } from "../../../../../../server/context";
import { roleName } from "../../../../../../server/shapes";
import { loadMember, requireAnotherOwner, requireOwnerToManage, revokeInvitesCreatedBy } from "../../../../../../server/team";

const PERSON = `id, name, email::text as email, role, disabled_at is null as active`;

export const PATCH = handle({ body: z.object({ role: roleName.optional(), disabled: z.boolean().optional() }), configure: true }, async ({ q, session, params, body, deps }) => {
  const member = await loadMember(q, params.id);
  requireOwnerToManage(session, member.role, body.role);
  const role = body.role ?? member.role;
  const disabled = body.disabled ?? member.disabled;
  // Trocar o próprio papel é sempre recusado: quem se rebaixa por engano não consegue desfazer.
  if (member.id === session.userId && role !== member.role) throw new ApiError(400, "cannot_change_self_role", "You cannot change your own role. Ask another owner.");
  if (role !== "owner" || disabled) await requireAnotherOwner(q, member);

  const person = await q.one(`update users set role = $2, disabled_at = case when $3 then coalesce(disabled_at, $4) else null end where id = $1 returning ${PERSON}`, [
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
  return person;
});

// Remover de vez só quem nunca decidiu uma aprovação nem fechou uma pendência: o histórico precisa
// continuar dizendo quem decidiu e quem fechou (a chave estrangeira zeraria `closed_by`). Para os
// outros, o caminho é desativar. A pendência fechada que sai pelo prazo de guarda deixa de contar.
export const DELETE = handle(
  {
    configure: true,
    // A conta fica fora do alcance de `deskvoice_app`: ela só sai depois que o vínculo saiu, pelo
    // papel de sistema. Sem isso, o e-mail fica preso numa conta sem vínculo e o convite novo para
    // ele cai em `email_taken`. Se este passo falhar, a remoção do vínculo já valeu.
    after: async (removed: Removed, { deps, session }) => {
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
    const actor = await q.one<{ accountId: string }>("select account_id as \"accountId\" from users where id = $1", [session.userId]);
    return { accountId: removed.accountId, actorAccountId: actor?.accountId ?? null };
  },
);

interface Removed {
  accountId: string;
  actorAccountId: string | null;
}
