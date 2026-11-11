import { z } from "zod";
import { ApiError, handle } from "../../../../../../server/context";
import { roleName } from "../../../../../../server/shapes";
import { loadMember, requireAnotherOwner, requireOwnerToManage } from "../../../../../../server/team";

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
  // Desativar derruba na hora quem está com o painel aberto.
  if (disabled) await q.exec("delete from sessions where user_id = $1", [member.id]);
  return person;
});

// Remover de vez só quem nunca decidiu uma aprovação: o histórico precisa continuar dizendo quem
// decidiu. Para os outros, o caminho é desativar.
export const DELETE = handle({ configure: true }, async ({ q, session, params }) => {
  const member = await loadMember(q, params.id);
  requireOwnerToManage(session, member.role);
  await requireAnotherOwner(q, member);
  if (await q.one("select 1 from approvals where decided_by = $1 limit 1", [member.id])) {
    throw new ApiError(409, "has_history", "This person decided approvals. Disable the account instead of removing it.");
  }
  await q.exec("delete from users where id = $1", [member.id]);
  return null;
});
