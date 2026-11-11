import type { OrgQuery } from "@deskvoice/core";
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

/** Só um dono mexe em dono, ou cria um: administrador gere administradores e operadores. */
export function requireOwnerToManage(session: Session, ...roles: Array<Role | undefined>): void {
  if (session.role !== "owner" && roles.includes("owner")) {
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
