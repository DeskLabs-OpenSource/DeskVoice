import { TEAM_ROLES, canManageRole, type OrgQuery } from "@deskvoice/core";
import { ApiError, notFound, type Role, type Session } from "./context";

export interface TeamMember {
  id: string;
  role: Role;
  disabled: boolean;
}

/**
 * A pessoa da equipe, travada para alteração. Quem é de outra organização não aparece (RLS): 404.
 *
 * Os donos ativos são travados na mesma consulta, sempre na mesma ordem: a regra do último dono
 * precisa deles, e travar "a pessoa, depois os donos" fazia dois donos que se desativam ao mesmo
 * tempo se esperarem um ao outro até o banco abortar um deles com erro.
 */
export async function loadMember(q: OrgQuery, id: string | undefined): Promise<TeamMember> {
  const locked = await q.many<TeamMember>(
    `select id, role, disabled_at is not null as disabled from users
      where id = $1 or (role = 'owner' and disabled_at is null) order by id for update`,
    [id],
  );
  const member = locked.find((row) => row.id === id);
  if (!member) throw notFound();
  return member;
}

/**
 * Quem faz o pedido precisa gerir todos os papéis envolvidos (o atual e o novo da pessoa, o do
 * convite que existe e o do que vai ser criado). A regra em si é `canManageRole`, do core: aqui
 * ela só vira erro. Na prática: só um dono mexe em dono, ou cria um.
 */
export function requireOwnerToManage(session: Session, ...roles: Array<Role | undefined>): void {
  if (roles.some((role) => role !== undefined && !canManageRole(session.role, role))) {
    throw new ApiError(403, "cannot_manage_owner", "Only an owner can invite, change, disable or remove an owner.");
  }
}

/**
 * Sempre sobra um dono ativo. Chamar antes de qualquer mudança que tire de `member` a condição
 * de dono ativo (rebaixar, desativar, remover), inclusive quando a pessoa faz isso consigo mesma.
 * Os donos ativos já estão travados por `loadMember`: de dois donos se rebaixando um ao outro ao
 * mesmo tempo, só o primeiro passa, e o segundo recebe `last_owner`.
 */
export async function requireAnotherOwner(q: OrgQuery, member: TeamMember): Promise<void> {
  if (member.role !== "owner" || member.disabled) return;
  const owners = await q.many<{ id: string }>("select id from users where role = 'owner' and disabled_at is null");
  if (!owners.some((owner) => owner.id !== member.id)) {
    throw new ApiError(409, "last_owner", "This is the only active owner. Make another person an owner first.");
  }
}

/**
 * Revoga os convites pendentes que a pessoa criou e que ela não poderia mais emitir. Chamar na
 * mesma transação em que ela é desativada, removida ou muda de papel: quem sai da equipe (ou
 * perde poder) não deixa para trás uma porta aberta com o poder antigo. Reativar ou promover de
 * volta não desfaz isto.
 *
 * Sem `roleNow` (desativada ou removida) caem todos. Com `roleNow`, caem os convites de papéis
 * que esse papel não gere, pela mesma `canManageRole`: rebaixada a administrador perde os de
 * dono; a operador, todos; promovida, nenhum.
 */
export async function revokeInvitesCreatedBy(q: OrgQuery, userId: string, now: Date, roleNow?: Role): Promise<void> {
  const lost = TEAM_ROLES.filter((role) => roleNow === undefined || !canManageRole(roleNow, role));
  await q.exec("update invites set revoked_at = $2 where created_by = $1 and accepted_at is null and revoked_at is null and role = any($3)", [userId, now, lost]);
}
