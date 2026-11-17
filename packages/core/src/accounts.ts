import { ADMINS_EXPLICIT_KEY, FOUNDING_ORGANIZATION_KEY, recordInstallationEvent } from "./installation";
import type { TeamRole } from "./invites";
import type { Db, OrgQuery } from "./types";
import { withSystem } from "./with-org";

/**
 * Contas (seção 3.1 do desenho do R8). A conta guarda o e-mail, a senha e a marca de quem
 * administra a instalação; `users` é o VÍNCULO da conta com uma organização, com o papel dela ali.
 *
 * `accounts` não tem `organization_id`, e `deskvoice_app` não tem nenhum direito sobre ela: só o
 * papel de sistema a lê, e só por este arquivo. A senha de todas as contas nunca fica ao alcance de
 * uma rota presa a uma organização.
 *
 * O login, a senha e o papel da instalação filtram `kind = 'member'`. O vínculo `support` (o "entrar
 * como", da fatia 5) não entra no login, não confere senha e não dá papel na instalação. A exceção é
 * `deleteAccountIfOrphan`: ali qualquer vínculo segura a conta.
 */

export interface LoginAccount {
  accountId: string;
  passwordHash: string;
  /** O vínculo ativo com que a conta entra, ou `null` se ela não tem nenhum (desativada). */
  member: { id: string; organizationId: string; name: string; role: TeamRole } | null;
}

/**
 * A conta do e-mail e o vínculo com que ela entra: o da última organização usada, se ainda ativo, ou
 * o mais antigo. Atravessa organizações porque é o e-mail que diz qual é a organização.
 */
export async function findLoginAccount(db: Db, email: string): Promise<LoginAccount | null> {
  const row = await withSystem(db, (q) =>
    q.one<{ accountId: string; passwordHash: string; userId: string | null; organizationId: string | null; name: string | null; role: TeamRole | null }>(
      `select a.id as "accountId", a.password_hash as "passwordHash", m.id as "userId", m.organization_id as "organizationId", m.name, m.role
         from accounts a
         left join lateral (
           select u.id, u.organization_id, u.name, u.role
             from users u
            where u.account_id = a.id and u.kind = 'member' and u.disabled_at is null
            order by (u.organization_id = a.last_organization_id) desc nulls last, u.created_at, u.id
            limit 1
         ) m on true
        where a.email = $1`,
      [email],
    ),
  );
  if (!row) return null;
  const member = row.userId && row.organizationId && row.name !== null && row.role ? { id: row.userId, organizationId: row.organizationId, name: row.name, role: row.role } : null;
  return { accountId: row.accountId, passwordHash: row.passwordHash, member };
}

/** Se o e-mail já tem conta. Para quem quer recusar antes de gastar o hash, que é caro de propósito. */
export async function accountExists(db: Db, email: string): Promise<boolean> {
  return withSystem(db, async (q) => (await q.one("select 1 from accounts where email = $1", [email])) !== null);
}

/** Cria a conta. Devolve `null` se o e-mail já tem conta. `q` tem de ser de `withSystem`. */
export async function createAccount(q: OrgQuery, account: { email: string; passwordHash: string }): Promise<string | null> {
  const row = await q.one<{ id: string }>("insert into accounts (email, password_hash) values ($1, $2) on conflict (email) do nothing returning id", [
    account.email,
    account.passwordHash,
  ]);
  return row?.id ?? null;
}

/**
 * Cria a conta e o vínculo `member` dela com a organização, na transação de quem chama. É a única
 * função que grava `users.email`, sempre junto com `accounts.email`. Devolve `null` se o e-mail já
 * tem conta: nada é gravado. `q` tem de ser de `withSystem`.
 */
export async function createMember(
  q: OrgQuery,
  member: { organizationId: string; email: string; name: string; passwordHash: string; role: TeamRole },
): Promise<{ accountId: string; userId: string } | null> {
  const accountId = await createAccount(q, member);
  if (!accountId) return null;
  const user = await q.one<{ id: string }>(
    "insert into users (organization_id, account_id, kind, email, name, role) values ($1, $2, 'member', $3, $4, $5) returning id",
    [member.organizationId, accountId, member.email, member.name, member.role],
  );
  if (!user) throw new Error("Insert into users returned no row");
  return { accountId, userId: user.id };
}

/** A conta de um vínculo `member`, ou `null`. */
export function accountOfMember(db: Db, userId: string): Promise<string | null> {
  return withSystem(db, async (q) => (await q.one<{ id: string }>("select account_id as id from users where id = $1 and kind = 'member'", [userId]))?.id ?? null);
}

/**
 * Confere a senha da conta de um vínculo `member`, sem que o hash saia daqui. `null` = o vínculo não
 * existe. `verify` vem de quem chama (o painel injeta a sua, para o teste contar as conferências).
 */
export async function checkMemberPassword(db: Db, userId: string, password: string, verify: (password: string, stored: string) => Promise<boolean>): Promise<boolean | null> {
  const row = await withSystem(db, (q) =>
    q.one<{ passwordHash: string }>(
      `select a.password_hash as "passwordHash" from users u join accounts a on a.id = u.account_id where u.id = $1 and u.kind = 'member'`,
      [userId],
    ),
  );
  if (!row) return null;
  return verify(password, row.passwordHash);
}

/**
 * Troca a senha da conta de um vínculo `member` e encerra as outras sessões da conta. Quem trocou
 * continua com `keepSessionId`. Devolve quantas sessões foram encerradas, ou `null` se o vínculo
 * não existe.
 */
export function changeMemberPassword(db: Db, userId: string, passwordHash: string, keepSessionId: string): Promise<number | null> {
  return withSystem(db, async (q) => {
    const account = await q.one<{ id: string }>("update accounts a set password_hash = $2 from users u where u.id = $1 and u.kind = 'member' and a.id = u.account_id returning a.id", [
      userId,
      passwordHash,
    ]);
    if (!account) return null;
    return closeSessions(q, account.id, keepSessionId);
  });
}

/**
 * Troca a senha da conta do e-mail e encerra todas as sessões dela. Só para `reset-password`, que
 * roda de dentro da VPS. Devolve quantas sessões foram encerradas, ou `null` se o e-mail não tem
 * conta.
 */
export function resetAccountPassword(db: Db, email: string, passwordHash: string): Promise<number | null> {
  return withSystem(db, async (q) => {
    const account = await q.one<{ id: string }>("update accounts set password_hash = $2 where email = $1 returning id", [email, passwordHash]);
    if (!account) return null;
    return closeSessions(q, account.id, null);
  });
}

function closeSessions(q: OrgQuery, accountId: string, keepSessionId: string | null): Promise<number> {
  // Pelo vínculo, e não por `sessions.account_id`: a sessão de qualquer vínculo da conta cai.
  return q.exec("delete from sessions s using users u where u.id = s.user_id and u.account_id = $1 and s.id is distinct from $2", [accountId, keepSessionId]);
}

/**
 * Apaga a conta que ficou sem nenhum vínculo (de qualquer `kind`). É o passo seguinte à remoção de
 * um membro: sem ele, o e-mail e o hash ficariam numa conta que não entra em lugar nenhum, e um
 * convite novo para o mesmo e-mail cairia em `email_taken`. A conta que ainda tem outro vínculo
 * continua. Se a conta tinha a marca de quem administra a instalação, a perda fica na auditoria.
 * Devolve se apagou.
 */
export function deleteAccountIfOrphan(db: Db, accountId: string, now: Date, detail: { actorAccountId?: string | null; organizationId?: string | null } = {}): Promise<boolean> {
  return withSystem(db, async (q) => {
    const gone = await q.one<{ admin: boolean }>(
      `delete from accounts a where a.id = $1 and not exists (select from users u where u.account_id = a.id)
       returning a.installation_admin_at is not null as admin`,
      [accountId],
    );
    if (!gone) return false;
    if (gone.admin) {
      await recordInstallationEvent(q, now, "installation_admin_revoked", { ...detail, payload: { account_id: accountId, source: "member_removed" } });
    }
    return true;
  });
}

/**
 * A única função que responde quem administra a instalação (seção 3.2). Lê ESTADO GRAVADO, nunca a
 * contagem de organizações, que sobe e desce sem que o papel possa mudar de dono:
 *
 * 1. a conta com a marca (`installation_admin_at`) administra;
 * 2. enquanto `installation.admins_explicit_at` não existe, o vínculo `member` ativo com papel
 *    `owner` ou `admin` na organização fundadora também administra. São as mesmas pessoas que hoje
 *    podem atualizar, então quem tem um cliente só não percebe nada.
 *
 * Uma organização inserida por SQL direto não é a fundadora e não dá papel a ninguém.
 */
export function isInstallationAdmin(db: Db, accountId: string): Promise<boolean> {
  return withSystem(db, async (q) => {
    const row = await q.one<{ administers: boolean }>(
      `select exists (select from accounts a where a.id = $1 and a.installation_admin_at is not null)
           or (not exists (select from installation_settings where key = $3)
               and exists (select from users u
                             join installation_settings s on s.key = $2 and u.organization_id = (s.value #>> '{}')::uuid
                            where u.account_id = $1 and u.kind = 'member' and u.disabled_at is null and u.role in ('owner', 'admin')))
           as administers`,
      [accountId, FOUNDING_ORGANIZATION_KEY, ADMINS_EXPLICIT_KEY],
    );
    return row?.administers === true;
  });
}

export type GrantInstallationAdminResult = { granted: true; accountId: string } | { granted: false; reason: "email_not_found" | "already_granted" };

/**
 * Dá a marca de quem administra a instalação à conta do e-mail. É a saída de emergência
 * (`install/grant-installation-admin.sh`), que roda de dentro da VPS: quem tem acesso ao servidor já
 * é dono da instalação. Grava `installation_admin_granted` na auditoria da instalação.
 */
export function grantInstallationAdmin(db: Db, email: string, now: Date): Promise<GrantInstallationAdminResult> {
  return withSystem(db, async (q) => {
    const account = await q.one<{ id: string; already: boolean }>("select id, installation_admin_at is not null as already from accounts where email = $1 for update", [email]);
    if (!account) return { granted: false, reason: "email_not_found" };
    if (account.already) return { granted: false, reason: "already_granted" };
    await q.exec("update accounts set installation_admin_at = $2 where id = $1", [account.id, now]);
    await recordInstallationEvent(q, now, "installation_admin_granted", { payload: { account_id: account.id, source: "command" } });
    return { granted: true, accountId: account.id };
  });
}
