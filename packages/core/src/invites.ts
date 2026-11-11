import { hashToken } from "./password";
import type { Db } from "./types";
import { withSystem } from "./with-org";

export interface InviteSummary {
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "operator";
}

export type AcceptInviteResult = { ok: true; userId: string; organizationId: string } | { ok: false; reason: "invalid" | "email_taken" };

// Quem aceita um convite ainda não tem sessão: a organização só se descobre pelo token. Por isso
// estas duas funções atravessam organizações (papel de sistema) e moram aqui, com teste, em vez
// de espalhadas no painel. A busca é sempre pelo resumo do token; o token em claro só existe no link.

/**
 * O convite que este token abre, ou `null`. Inexistente, vencido, já aceito e revogado dão a
 * mesma resposta: quem tenta adivinhar um token não aprende nada sobre o que existe.
 */
export function findInviteByToken(db: Db, token: string, now: Date): Promise<InviteSummary | null> {
  return withSystem(db, (q) =>
    q.one<InviteSummary>(
      `select i.organization_id as "organizationId", o.name as "organizationName", i.email::text as email, i.name, i.role
         from invites i join organizations o on o.id = i.organization_id
        where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > $2`,
      [hashToken(token), now],
    ),
  );
}

class EmailTaken extends Error {}

/**
 * Cria a conta da pessoa convidada, na organização e com o papel do convite, e gasta o convite,
 * tudo numa transação. De dois aceites simultâneos do mesmo token só um vence: marcar o convite
 * como aceito é uma atualização condicional, e a segunda já não encontra convite pendente.
 */
export async function acceptInvite(db: Db, token: string, account: { name: string; passwordHash: string }, now: Date): Promise<AcceptInviteResult> {
  try {
    return await withSystem(db, async (q) => {
      const invite = await q.one<{ id: string; organizationId: string; email: string; role: string }>(
        `update invites set accepted_at = $2
          where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > $2
          returning id, organization_id as "organizationId", email::text as email, role`,
        [hashToken(token), now],
      );
      if (!invite) return { ok: false, reason: "invalid" };

      const user = await q.one<{ id: string }>(
        `insert into users (organization_id, email, name, password_hash, role) values ($1, $2, $3, $4, $5)
         on conflict (email) do nothing returning id`,
        [invite.organizationId, invite.email, account.name, account.passwordHash, invite.role],
      );
      // O e-mail é único na instalação. Lançar desfaz a marca de aceito: o convite continua valendo
      // para quando o conflito for resolvido.
      if (!user) throw new EmailTaken();
      await q.exec("update invites set accepted_user_id = $2 where id = $1", [invite.id, user.id]);
      return { ok: true, userId: user.id, organizationId: invite.organizationId };
    });
  } catch (error) {
    if (error instanceof EmailTaken) return { ok: false, reason: "email_taken" };
    throw error;
  }
}
