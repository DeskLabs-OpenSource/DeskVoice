import { addMembership, administersInstallationSql, createMember, deleteOrphanAccount } from "./accounts";
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
  /**
   * Se o e-mail do convite já tem conta, e a página pede a senha dela em vez de uma nova. Só existe
   * quando o token vale: quem não tem um convite válido não aprende nada sobre quem tem conta. A
   * conta sem nenhum vínculo (a órfã que a remoção de um membro não conseguiu apagar) conta como
   * sem conta.
   */
  existingAccount: boolean;
}

/**
 * Como aceitar: com a conta nova (a senha nova, já em resumo) ou com a conta que o e-mail já tem
 * (a senha dela, conferida aqui por `verify`, sem que o resumo saia deste pacote).
 */
export type AcceptInviteInput =
  | { account: "new"; name: string; passwordHash: string }
  | { account: "existing"; name: string; password: string; verify: (password: string, stored: string) => Promise<boolean> };

/**
 * `invalid`: o token não vale. `existing_account`: o e-mail ganhou conta e a pessoa precisa entrar
 * com a senha dela. `no_account`: a conta deixou de existir (ou ficou sem vínculo) e a pessoa
 * define uma senha nova. `invalid_credentials`: a senha da conta não confere. `already_member`: a
 * conta já tem vínculo nesta organização, ativo ou desativado. Em todas, o convite não é gasto.
 */
export type AcceptInviteResult =
  | { ok: true; userId: string; organizationId: string; accountId: string }
  | { ok: false; reason: "invalid" | "existing_account" | "no_account" | "invalid_credentials" | "already_member" };

// Quem aceita um convite ainda não tem sessão: a organização só se descobre pelo token. Por isso
// estas duas funções atravessam organizações (papel de sistema) e moram aqui, com teste, em vez
// de espalhadas no painel. A busca é sempre pelo resumo do token; o token em claro só existe no link.
//
// Um convite só vale enquanto quem o criou está ativo na equipe, num vínculo da equipe (`kind = 'member'`). Sem isso, a pessoa cria um
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
   where c.organization_id = i.organization_id and c.id = i.created_by and c.kind = 'member' and c.disabled_at is null
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
      `select i.organization_id as "organizationId", o.name as "organizationName", i.email::text as email, i.name, i.role,
              exists (select from accounts a where a.email = i.email and ${HAS_LINK("a.id")}) as "existingAccount"
         from invites i join organizations o on o.id = i.organization_id
        where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > $2 and ${CREATOR_STILL_MANAGES}`,
      [hashToken(token), now],
    ),
  );
}

/** A conta tem pelo menos um vínculo, de qualquer `kind`. Sem nenhum, ela é a órfã e conta como sem conta. */
const HAS_LINK = (account: string): string => `exists (select from users u where u.account_id = ${account})`;

const PENDING = `token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > $2 and ${CREATOR_STILL_MANAGES}`;

/** Desfaz a transação do aceite (e a marca de aceito) e diz por quê: o convite continua valendo. */
class Refused extends Error {
  constructor(readonly reason: Exclude<AcceptInviteResult, { ok: true }>["reason"]) {
    super(reason);
  }
}

/**
 * Aceita o convite e gasta o token, tudo numa transação. De dois aceites simultâneos do mesmo token
 * só um vence: marcar o convite como aceito é uma atualização condicional, e a segunda já não
 * encontra convite pendente.
 *
 * - **Conta nova** (o e-mail não tem conta, ou só tem a órfã): cria a conta e o vínculo `member`.
 *   A órfã é apagada antes, pela regra de `deleteAccountIfOrphan`, e a marca de quem administra a
 *   instalação, se ela tinha, vai junto para a auditoria (`orphan_on_invite`). Nada da órfã passa
 *   para a conta nova. Se o e-mail ganhou uma conta com vínculo desde que a página abriu, nada é
 *   gravado e a resposta é `existing_account`.
 * - **Conta que já existe:** confere a senha dela FORA da transação (é lenta de propósito) e,
 *   dentro, confere de novo que é a mesma conta, com a mesma senha e ainda com vínculo. Cria só o
 *   vínculo `member`, sem tocar a senha. A conta que já tem vínculo nesta organização dá
 *   `already_member`. O limite de tentativas é de quem chama: o mesmo do login.
 *
 * Nos dois casos `last_organization_id` passa a ser a organização do convite: a sessão que nasce
 * do aceite está nela, e o próximo login volta para ela.
 */
export async function acceptInvite(db: Db, token: string, input: AcceptInviteInput, now: Date): Promise<AcceptInviteResult> {
  let verified: { accountId: string; passwordHash: string } | null = null;
  if (input.account === "existing") {
    const found = await withSystem(db, (q) =>
      q.one<{ accountId: string | null; passwordHash: string | null }>(
        `select a.id as "accountId", a.password_hash as "passwordHash"
           from invites i left join accounts a on a.email = i.email and ${HAS_LINK("a.id")}
          where ${PENDING}`,
        [hashToken(token), now],
      ),
    );
    if (!found) return { ok: false, reason: "invalid" };
    if (!found.accountId || !found.passwordHash) return { ok: false, reason: "no_account" };
    if (!(await input.verify(input.password, found.passwordHash))) return { ok: false, reason: "invalid_credentials" };
    verified = { accountId: found.accountId, passwordHash: found.passwordHash };
  }

  try {
    return await withSystem(db, async (q) => {
      const invite = await q.one<{ id: string; organizationId: string; email: string; role: TeamRole }>(
        `update invites i set accepted_at = $2 where ${PENDING} returning id, organization_id as "organizationId", email::text as email, role`,
        [hashToken(token), now],
      );
      if (!invite) return { ok: false, reason: "invalid" };

      // A conta do e-mail, travada até o fim: um vínculo novo para ela (que pede `key share` nesta
      // linha) espera esta transação, e a conferência abaixo não fica velha antes do fim.
      const account = await q.one<{ id: string; passwordHash: string; linked: boolean }>(
        `select a.id, a.password_hash as "passwordHash", ${HAS_LINK("a.id")} as linked from accounts a where a.email = $1 for update`,
        [invite.email],
      );

      let accountId: string;
      let userId: string;
      if (verified) {
        if (!account?.linked) throw new Refused("no_account");
        // Outra conta com o mesmo e-mail, ou a senha trocada desde a conferência: a senha conferida já não vale.
        if (account.id !== verified.accountId || account.passwordHash !== verified.passwordHash) throw new Refused("invalid_credentials");
        if (await q.one("select 1 from users where organization_id = $1 and account_id = $2", [invite.organizationId, account.id])) throw new Refused("already_member");
        accountId = account.id;
        userId = await addMembership(q, { organizationId: invite.organizationId, accountId, name: input.name, role: invite.role });
      } else {
        if (input.account !== "new") throw new Error("acceptInvite: unreachable");
        if (account?.linked) throw new Refused("existing_account");
        if (account) await deleteOrphanAccount(q, account.id, now, { organizationId: invite.organizationId, source: "orphan_on_invite" });
        const member = await createMember(q, { organizationId: invite.organizationId, email: invite.email, name: input.name, passwordHash: input.passwordHash, role: invite.role });
        // Outro aceite criou a conta deste e-mail ao mesmo tempo: agora ela existe, com vínculo.
        if (!member) throw new Refused("existing_account");
        ({ accountId, userId } = member);
      }
      await q.exec("update accounts set last_organization_id = $2 where id = $1", [accountId, invite.organizationId]);
      await q.exec("update invites set accepted_user_id = $2 where id = $1", [invite.id, userId]);
      return { ok: true, userId, organizationId: invite.organizationId, accountId };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  }
}
