import { administersInstallationSql, createMember } from "./accounts";
import { hashToken } from "./password";
import type { Db } from "./types";
import { withSystem } from "./with-org";

export const TEAM_ROLES = ["owner", "admin", "operator"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/**
 * Quem gere quem na equipe: a única fonte dessa regra. Dono gere todos; administrador gere
 * administrador e operador; operador não gere ninguém. "Gerir" vale para convidar, alterar,
 * desativar e remover, e também para manter vivo um convite já criado.
 */
export function canManageRole(actor: TeamRole, target: TeamRole): boolean {
  return actor === "owner" || (actor === "admin" && target !== "owner");
}

export interface InviteSummary {
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
  role: TeamRole;
}

export type AcceptInviteResult = { ok: true; userId: string; organizationId: string } | { ok: false; reason: "invalid" | "email_taken" };

// Quem aceita um convite ainda não tem sessão: a organização só se descobre pelo token. Por isso
// estas duas funções atravessam organizações (papel de sistema) e moram aqui, com teste, em vez
// de espalhadas no painel. A busca é sempre pelo resumo do token; o token em claro só existe no link.
//
// Um convite só vale enquanto quem o criou está ativo na equipe. Sem isso, a pessoa cria um
// convite para si mesma, é desativada e volta pelo link. O painel já revoga os convites ao
// desativar ou remover alguém; a condição aqui é a defesa que vale mesmo se um caminho novo
// esquecer de revogar. Criador removido deixa `created_by` nulo, e nulo também não vale.
//
// E só vale enquanto o papel ATUAL do criador ainda gere o papel do convite: um dono que convidou
// outro dono e foi rebaixado não deixa para trás um convite que hoje não poderia emitir.
// A expressão abaixo é `canManageRole` escrita em SQL; o teste dos nove pares de papel compara as
// duas, para que nunca divirjam.
//
// A exceção é o convite do primeiro dono, gerado pela administração da instalação (seção 3.3 do
// desenho do R8), que não tem vínculo na organização e por isso não tem criador NELA. Ele guarda a
// conta que o gerou (`created_by_account`) e vale só enquanto:
// - a organização não tem nenhum vínculo `member` (o primeiro aceite o encerra, e o de qualquer
//   outro convite da administração também);
// - essa conta ainda administra a instalação, pela mesma regra de `isInstallationAdmin`. Conta que
//   saiu da lista, ou que foi apagada (a coluna fica nula), não deixa link vivo para trás.
// Ele é marcado por coluna própria, e não pelo `created_by` nulo, que continua querendo dizer "o
// criador saiu da equipe". Os dois ramos são exclusivos: o da equipe exige que não haja a marca, e o
// banco recusa a marca junto com um criador da equipe.
const CREATOR_STILL_MANAGES = `((not i.installation_invite and exists (select from users c
   where c.organization_id = i.organization_id and c.id = i.created_by and c.disabled_at is null
     and (c.role = 'owner' or (c.role = 'admin' and i.role <> 'owner'))))
   or (i.installation_invite and i.role = 'owner' and i.created_by is null and i.created_by_account is not null
       and ${administersInstallationSql("i.created_by_account")}
       and not exists (select from users m where m.organization_id = i.organization_id and m.kind = 'member')))`;

/**
 * O convite que este token abre, ou `null`. Inexistente, vencido, já aceito, revogado e de
 * criador que saiu da equipe dão a mesma resposta: quem tenta adivinhar um token não aprende
 * nada sobre o que existe.
 */
export function findInviteByToken(db: Db, token: string, now: Date): Promise<InviteSummary | null> {
  return withSystem(db, (q) =>
    q.one<InviteSummary>(
      `select i.organization_id as "organizationId", o.name as "organizationName", i.email::text as email, i.name, i.role
         from invites i join organizations o on o.id = i.organization_id
        where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > $2 and ${CREATOR_STILL_MANAGES}`,
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
      const invite = await q.one<{ id: string; organizationId: string; email: string; role: TeamRole }>(
        `update invites i set accepted_at = $2
          where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > $2 and ${CREATOR_STILL_MANAGES}
          returning id, organization_id as "organizationId", email::text as email, role`,
        [hashToken(token), now],
      );
      if (!invite) return { ok: false, reason: "invalid" };

      const member = await createMember(q, {
        organizationId: invite.organizationId,
        email: invite.email,
        name: account.name,
        passwordHash: account.passwordHash,
        role: invite.role,
      });
      // O e-mail já tem conta. Lançar desfaz a marca de aceito: o convite continua valendo para
      // quando o conflito for resolvido. Aceitar com a conta que já existe é da fatia 3 do R8.
      if (!member) throw new EmailTaken();
      await q.exec("update invites set accepted_user_id = $2 where id = $1", [invite.id, member.userId]);
      return { ok: true, userId: member.userId, organizationId: invite.organizationId };
    });
  } catch (error) {
    if (error instanceof EmailTaken) return { ok: false, reason: "email_taken" };
    throw error;
  }
}
