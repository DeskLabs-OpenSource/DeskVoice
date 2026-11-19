import { ADMINS_EXPLICIT_KEY, FOUNDING_ORGANIZATION_KEY, recordInstallationEvent } from "./installation";
import type { TeamRole } from "./invites";
import type { Db, OrgQuery } from "./types";
import { endSupportAccessesIfNotAllowedIn } from "./support-access";
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
 * Cria a conta e o vínculo `member` dela com a organização, na transação de quem chama. Devolve
 * `null` se o e-mail já tem conta: nada é gravado. `q` tem de ser de `withSystem`.
 */
export async function createMember(
  q: OrgQuery,
  member: { organizationId: string; email: string; name: string; passwordHash: string; role: TeamRole },
): Promise<{ accountId: string; userId: string } | null> {
  const accountId = await createAccount(q, member);
  if (!accountId) return null;
  const userId = await addMembership(q, { organizationId: member.organizationId, accountId, name: member.name, role: member.role });
  return { accountId, userId };
}

/**
 * Cria o vínculo `member` de uma conta que já existe com uma organização, na transação de quem
 * chama. É a única função que grava `users.email`, e copia o e-mail da própria conta: as duas
 * nunca divergem. A conta que já tem vínculo nesta organização faz o banco recusar
 * (`users_one_membership_idx`); quem chama confere antes. `q` tem de ser de `withSystem`.
 */
export async function addMembership(q: OrgQuery, member: { organizationId: string; accountId: string; name: string; role: TeamRole }): Promise<string> {
  const user = await q.one<{ id: string }>(
    "insert into users (organization_id, account_id, kind, email, name, role) select $1, a.id, 'member', a.email, $3, $4 from accounts a where a.id = $2 returning id",
    [member.organizationId, member.accountId, member.name, member.role],
  );
  if (!user) throw new Error("addMembership: the account does not exist");
  return user.id;
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
 * um membro: sem ele, o e-mail e o hash ficariam numa conta que não entra em lugar nenhum. A conta
 * que ainda tem outro vínculo continua. Se a conta tinha a marca de quem administra a instalação, a
 * perda fica na auditoria. Devolve se apagou.
 */
export function deleteAccountIfOrphan(db: Db, accountId: string, now: Date, detail: { actorAccountId?: string | null; organizationId?: string | null } = {}): Promise<boolean> {
  return withSystem(db, (q) => deleteOrphanAccount(q, accountId, now, { ...detail, source: "member_removed" }));
}

/** De onde veio a remoção da conta órfã, gravado em `installation_admin_revoked` quando ela tinha a marca. */
export type OrphanSource = "member_removed" | "orphan_on_invite";

/**
 * A regra de `deleteAccountIfOrphan`, na transação de quem chama. São as duas pontas da conta
 * órfã: a remoção do membro (que apaga depois de confirmar, fora da transação, e pode falhar) e o
 * aceite de um convite novo para o mesmo e-mail, que apaga a conta que sobrou antes de criar a
 * nova. A marca de quem administra a instalação some com a conta e nunca passa para a nova.
 * `q` tem de ser de `withSystem`.
 */
export async function deleteOrphanAccount(
  q: OrgQuery,
  accountId: string,
  now: Date,
  detail: { actorAccountId?: string | null; organizationId?: string | null; source: OrphanSource },
): Promise<boolean> {
  const gone = await q.one<{ admin: boolean }>(
    `delete from accounts a where a.id = $1 and not exists (select from users u where u.account_id = a.id)
     returning a.installation_admin_at is not null as admin`,
    [accountId],
  );
  if (!gone) return false;
  if (gone.admin) {
    await recordInstallationEvent(q, now, "installation_admin_revoked", {
      actorAccountId: detail.actorAccountId,
      organizationId: detail.organizationId,
      payload: { account_id: accountId, source: detail.source },
    });
  }
  return true;
}

/** Uma organização em que a conta tem vínculo `member` ativo: o que o seletor do topo lista. */
export interface Membership {
  organizationId: string;
  organizationName: string;
}

/**
 * As organizações em que a conta tem vínculo `member` ativo, por nome. O vínculo `support` (o
 * "entrar como", da fatia 5) nunca aparece aqui, nem o desativado. Atravessa organizações porque a
 * conta não tem organização.
 */
export function listMemberships(db: Db, accountId: string): Promise<Membership[]> {
  return withSystem(db, (q) =>
    q.many<Membership>(
      `select o.id as "organizationId", o.name as "organizationName"
         from users u join organizations o on o.id = u.organization_id
        where u.account_id = $1 and u.kind = 'member' and u.disabled_at is null
        order by o.name, o.id`,
      [accountId],
    ),
  );
}

/**
 * Leva a sessão para outra organização da mesma conta (seção 3.1): confere que a conta tem vínculo
 * `member` ativo no destino e muda `organization_id` e `user_id` na mesma linha de `sessions`. O
 * cookie não muda. Grava `last_organization_id`, para o próximo login voltar para lá.
 *
 * Devolve `false`, sem mudar nada, quando a organização não existe, quando a conta não tem vínculo
 * nela, quando o vínculo está desativado ou não é `member`, e quando a sessão não é desta conta:
 * para quem chama, as quatro são o mesmo "não encontrado".
 */
export function switchOrganization(db: Db, sessionId: string, accountId: string, organizationId: string): Promise<boolean> {
  return withSystem(db, async (q) => {
    const target = await q.one<{ id: string }>(
      "select id from users where account_id = $1 and organization_id = $2 and kind = 'member' and disabled_at is null",
      [accountId, organizationId],
    );
    if (!target) return false;
    // A sessão tem de ser da conta: pelo vínculo em que ela está agora, que é o que `findSession` confere.
    const moved = await q.exec(
      `update sessions s set organization_id = $3, user_id = $4, account_id = $2
        where s.id = $1 and exists (select from users cur where cur.id = s.user_id and cur.organization_id = s.organization_id and cur.account_id = $2)`,
      [sessionId, accountId, organizationId, target.id],
    );
    if (moved !== 1) return false;
    await q.exec("update accounts set last_organization_id = $2 where id = $1", [accountId, organizationId]);
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
    const row = await q.one<{ administers: boolean }>(`select ${administersInstallationSql("$1")} as administers`, [accountId]);
    return row?.administers === true;
  });
}

/**
 * A regra de `isInstallationAdmin` escrita em SQL, para quem precisa dela dentro de outra consulta
 * (o convite do primeiro dono, em `invites.ts`). Uma fonte só: as duas nunca divergem. `account` é
 * uma expressão SQL do código (um parâmetro ou uma coluna), nunca texto de fora. Pelo papel de sistema.
 */
/**
 * Os acessos de suporte ainda abertos dos vínculos `support` da conta, travados para encerrar
 * (`endSupportAccessesIfNotAllowedIn`, em `support-access.ts`). Na transação de quem chama, pelo
 * papel de sistema.
 */
export async function openSupportAccessesOf(q: OrgQuery, accountId: string): Promise<string[]> {
  const rows = await q.many<{ id: string }>(
    `select sa.id from support_accesses sa join users u on u.id = sa.user_id and u.organization_id = sa.organization_id
      where u.account_id = $1 and u.kind = 'support' and sa.ended_at is null
      order by sa.id
      for update of sa`,
    [accountId],
  );
  return rows.map((row) => row.id);
}

export function administersInstallationSql(account: string): string {
  return `(exists (select from accounts a where a.id = ${account} and a.installation_admin_at is not null)
     or (not exists (select from installation_settings where key = ${sqlLiteral(ADMINS_EXPLICIT_KEY)})
         and exists (select from users u
                       join installation_settings s on s.key = ${sqlLiteral(FOUNDING_ORGANIZATION_KEY)} and u.organization_id = (s.value #>> '{}')::uuid
                      where u.account_id = ${account} and u.kind = 'member' and u.disabled_at is null and u.role in ('owner', 'admin'))))`;
}

function sqlLiteral(value: string): string {
  if (!/^[a-z_.]+$/.test(value)) throw new Error(`sqlLiteral: unexpected key ${JSON.stringify(value)}`);
  return `'${value}'`;
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

/**
 * Trava da lista de quem administra a instalação. Pôr, tirar e a criação da segunda organização
 * passam por ela, na transação de quem chama: duas pessoas tirando uma à outra ao mesmo tempo não
 * deixam a lista vazia. `q` tem de ser de `withSystem`.
 */
export async function lockInstallationAdmins(q: OrgQuery): Promise<void> {
  await q.exec("select pg_advisory_xact_lock(hashtext('deskvoice.installation_admins'))");
}

/** Uma pessoa, como a área da instalação a mostra: a conta e o nome do vínculo mais antigo. */
export interface InstallationPerson {
  accountId: string;
  email: string;
  name: string;
}

/**
 * Para onde vai a lista quando ela ficar explícita (seção 3.2, item 3), lido da fundadora:
 * - `granted`: os donos ativos que ainda não têm a marca, e que vão recebê-la;
 * - `losing`: os administradores ativos sem a marca, que deixam de administrar a instalação.
 *
 * Com a lista já explícita, as duas listas vêm vazias: criar outra organização não muda ninguém.
 * `q` tem de ser de `withSystem`.
 */
export async function explicitAdminsTransition(q: OrgQuery): Promise<{ explicit: boolean; granted: InstallationPerson[]; losing: InstallationPerson[] }> {
  const explicit = (await q.one("select 1 from installation_settings where key = $1", [ADMINS_EXPLICIT_KEY])) !== null;
  if (explicit) return { explicit, granted: [], losing: [] };
  const rows = await q.many<InstallationPerson & { role: TeamRole }>(
    `select a.id as "accountId", a.email::text as email, u.name, u.role
       from users u
       join installation_settings s on s.key = $1 and u.organization_id = (s.value #>> '{}')::uuid
       join accounts a on a.id = u.account_id
      where u.kind = 'member' and u.disabled_at is null and u.role in ('owner', 'admin') and a.installation_admin_at is null
      order by u.name, a.email`,
    [FOUNDING_ORGANIZATION_KEY],
  );
  const person = ({ accountId, email, name }: InstallationPerson): InstallationPerson => ({ accountId, email, name });
  return { explicit, granted: rows.filter((row) => row.role === "owner").map(person), losing: rows.filter((row) => row.role === "admin").map(person) };
}

/**
 * Dá a marca a uma conta e grava `installation_admin_granted`. Devolve se deu (a conta que já tinha
 * a marca fica como estava). `q` tem de ser de `withSystem`, com a trava da lista.
 */
export async function markInstallationAdmin(q: OrgQuery, accountId: string, now: Date, detail: { actorAccountId: string | null; source: string }): Promise<boolean> {
  const marked = await q.exec("update accounts set installation_admin_at = $2 where id = $1 and installation_admin_at is null", [accountId, now]);
  if (marked === 0) return false;
  await recordInstallationEvent(q, now, "installation_admin_granted", { actorAccountId: detail.actorAccountId, payload: { account_id: accountId, source: detail.source } });
  return true;
}

export interface InstallationAdmin extends InstallationPerson {
  /** Quando recebeu a marca, ou `null` se administra só pela regra da fundadora (lista ainda não explícita). */
  since: string | null;
}

/**
 * Quem administra a instalação, com a mesma regra de `isInstallationAdmin`: as contas com a marca e,
 * enquanto a lista não é explícita, o dono e o administrador ativos da fundadora.
 */
export function listInstallationAdmins(db: Db): Promise<{ explicit: boolean; admins: InstallationAdmin[] }> {
  return withSystem(db, async (q) => {
    const explicit = (await q.one("select 1 from installation_settings where key = $1", [ADMINS_EXPLICIT_KEY])) !== null;
    const admins = await q.many<InstallationAdmin>(
      `select a.id as "accountId", a.email::text as email,
              coalesce((select u.name from users u where u.account_id = a.id and u.kind = 'member' order by u.created_at, u.id limit 1), '') as name,
              a.installation_admin_at as since
         from accounts a
        where a.installation_admin_at is not null
           or (not $2::boolean and exists (select from users u
                                    join installation_settings s on s.key = $1 and u.organization_id = (s.value #>> '{}')::uuid
                                   where u.account_id = a.id and u.kind = 'member' and u.disabled_at is null and u.role in ('owner', 'admin')))
        order by name, a.email`,
      [FOUNDING_ORGANIZATION_KEY, explicit],
    );
    return { explicit, admins: admins.map((admin) => ({ ...admin, since: admin.since === null ? null : new Date(admin.since).toISOString() })) };
  });
}

export type GrantByAdminResult = { ok: true; accountId: string } | { ok: false; reason: "email_not_found" | "already_granted" };

/** Quem administra põe outra conta na lista, pelo e-mail dela (seção 3.2, regras da lista). */
export function grantInstallationAdminBy(db: Db, actorAccountId: string, email: string, now: Date): Promise<GrantByAdminResult> {
  return withSystem(db, async (q) => {
    await lockInstallationAdmins(q);
    const account = await q.one<{ id: string }>("select id from accounts where email = $1", [email]);
    if (!account) return { ok: false, reason: "email_not_found" };
    if (!(await markInstallationAdmin(q, account.id, now, { actorAccountId, source: "panel" }))) return { ok: false, reason: "already_granted" };
    return { ok: true, accountId: account.id };
  });
}

export type RevokeResult = { ok: true } | { ok: false; reason: "not_found" | "last_admin" };

/**
 * Tira a marca de uma conta. Recusa (`last_admin`) quando, sem ela, ninguém mais administraria a
 * instalação: depois de explícita, a lista nunca fica vazia. Enquanto a lista não é explícita, a
 * conta que também é dona ou administradora da fundadora continua administrando pela regra dela.
 * Só conta quem consegue entrar no painel: a marca sem vínculo `member` ativo (a condição de
 * `findLoginAccount`) não administra pela tela, e não impede a recusa.
 */
export function revokeInstallationAdmin(db: Db, actorAccountId: string, accountId: string, now: Date): Promise<RevokeResult> {
  return withSystem(db, async (q) => {
    await lockInstallationAdmins(q);
    const target = await q.one("select 1 from accounts where id = $1 and installation_admin_at is not null", [accountId]);
    if (!target) return { ok: false, reason: "not_found" };
    const others = await q.one<{ n: number }>(
      `select count(*)::int as n from accounts a
        where a.id <> $1
          and ((a.installation_admin_at is not null
                and exists (select from users u where u.account_id = a.id and u.kind = 'member' and u.disabled_at is null))
               or (not exists (select from installation_settings where key = $2)
                   and exists (select from users u
                                 join installation_settings s on s.key = $3 and u.organization_id = (s.value #>> '{}')::uuid
                                where u.account_id = a.id and u.kind = 'member' and u.disabled_at is null and u.role in ('owner', 'admin'))))`,
      [accountId, ADMINS_EXPLICIT_KEY, FOUNDING_ORGANIZATION_KEY],
    );
    // Enquanto não é explícita, a própria conta pode continuar pela regra da fundadora: não é a última.
    const keepsByRole = await q.one(
      `select 1 from users u join installation_settings s on s.key = $2 and u.organization_id = (s.value #>> '{}')::uuid
        where u.account_id = $1 and u.kind = 'member' and u.disabled_at is null and u.role in ('owner', 'admin')
          and not exists (select from installation_settings where key = $3)`,
      [accountId, FOUNDING_ORGANIZATION_KEY, ADMINS_EXPLICIT_KEY],
    );
    if ((others?.n ?? 0) === 0 && !keepsByRole) return { ok: false, reason: "last_admin" };
    await q.exec("update accounts set installation_admin_at = null where id = $1", [accountId]);
    await recordInstallationEvent(q, now, "installation_admin_revoked", { actorAccountId, payload: { account_id: accountId, source: "panel" } });
    // Quem deixa de administrar sai do suporte na hora (`revoked`), se não continua pela regra da fundadora.
    await endSupportAccessesIfNotAllowedIn(q, accountId, now, actorAccountId);
    return { ok: true };
  });
}
