import { FOLLOW_UP_OVERDUE_AFTER_MS, type OrgQuery } from "@deskvoice/core";
import { ApiError, CONFIG_ROLES, notFound, type Session } from "./context";

/** As colunas que a tela lê de uma pendência, com os nomes de quem é dono e de quem fechou. */
const FOLLOW_UP_SELECT = `
  select f.id, f.call_id as "callId", f.caller_e164 as "caller", f.title, f.details, f.owner_user_id as "ownerUserId",
         o.name as "ownerName", f.due_at as "dueAt", f.status, f.closed_at as "closedAt", f.closed_by as "closedBy",
         c.name as "closedByName", f.closing_note as "closingNote", f.created_at as "createdAt"
    from follow_ups f left join users o on o.id = f.owner_user_id left join users c on c.id = f.closed_by`;

/**
 * Confere que a pessoa pode mexer na pendência: operador mexe nas próprias e nas da equipe; dono e
 * administrador, em qualquer uma. A de outra organização não existe para quem pergunta.
 */
export const canChangeFollowUp = (session: Session, ownerUserId: string | null): boolean =>
  CONFIG_ROLES.includes(session.role) || ownerUserId === null || ownerUserId === session.userId;

export async function requireFollowUpAccess(q: OrgQuery, id: string, session: Session): Promise<void> {
  // `for update`: a linha fica presa até a rota gravar, na mesma transação. Sem a trava, em read
  // committed, o operador fecharia a pendência que um administrador acabou de passar a outra pessoa:
  // a conferência leria o dono antigo, e o `update` esperaria e gravaria por cima.
  const row = await q.one<{ owner: string | null }>("select owner_user_id as owner from follow_ups where id = $1 for update", [id]);
  if (!row) throw notFound();
  if (!canChangeFollowUp(session, row.owner)) throw new ApiError(403, "forbidden", "This follow-up belongs to another person. Ask an owner or admin.");
}

/**
 * A pendência como a tela a recebe: com `canChange`, para não oferecer o botão que a API recusaria,
 * e `overdueAt`, a hora em que ela passa a ser vencida (a mesma regra da rotina que avisa).
 */
export async function followUpsFor(q: OrgQuery, session: Session, where: string, params: unknown[]): Promise<Array<Record<string, unknown>>> {
  const rows = await q.many<{ ownerUserId: string | null; dueAt: Date }>(`${FOLLOW_UP_SELECT} where ${where}`, params);
  return rows.map((row) => ({ ...row, overdueAt: new Date(row.dueAt.getTime() + FOLLOW_UP_OVERDUE_AFTER_MS), canChange: canChangeFollowUp(session, row.ownerUserId) }));
}
