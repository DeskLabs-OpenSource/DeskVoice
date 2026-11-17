import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { createAccount, createMember, deleteAccountIfOrphan, findLoginAccount, grantInstallationAdmin } from "./accounts";
import { TEAM_ROLES, acceptInvite, canManageRole, findInviteByToken } from "./invites";
import { hashToken } from "./password";
import { withOrg, withSystem } from "./with-org";

const { app, owner } = openTestDbs();
const now = new Date("2026-03-01T15:00:00.000Z");
const later = new Date(now.getTime() + 7 * 86_400_000);
let orgA: string;
let orgB: string;
const creators = new Map<string, string>();

async function member(organizationId: string, role = "owner", kind: "member" | "support" = "member"): Promise<string> {
  const email = `${randomUUID()}@example.test`;
  const account = await withSystem(app, (q) => createAccount(q, { email, passwordHash: "x" }));
  const row = await withOrg(app, organizationId, (q) =>
    q.one<{ id: string }>("insert into users (organization_id, account_id, email, name, role, kind) values ($1, $2, $3, 'Quem convida', $4, $5) returning id", [organizationId, account, email, role, kind]),
  );
  return row?.id ?? "";
}

beforeAll(async () => {
  orgA = await createOrganization(app, "Invites A");
  orgB = await createOrganization(app, "Invites B");
  for (const org of [orgA, orgB]) creators.set(org, await member(org));
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

async function invite(organizationId: string, overrides: Record<string, unknown> = {}): Promise<{ token: string; email: string; id: string }> {
  const token = `token-${randomUUID()}`;
  const row = { email: `${randomUUID()}@example.test`, name: "Convidada", role: "operator", expires_at: later, accepted_at: null, revoked_at: null, created_by: creators.get(organizationId), ...overrides };
  const id = await withOrg(app, organizationId, async (q) => {
    const inserted = await q.one<{ id: string }>(
      `insert into invites (organization_id, email, name, role, token_hash, expires_at, accepted_at, revoked_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [organizationId, row.email, row.name, row.role, hashToken(token), row.expires_at, row.accepted_at, row.revoked_at, row.created_by],
    );
    return inserted?.id ?? "";
  });
  return { token, email: String(row.email), id };
}

const usersWith = async (email: string): Promise<Array<Record<string, unknown>>> =>
  (await owner.pool.query("select u.organization_id, u.name, u.role, u.kind, a.password_hash from users u join accounts a on a.id = u.account_id and a.email = u.email where u.email = $1", [email])).rows;
const lastOrganization = async (email: string): Promise<string | null | undefined> =>
  (await owner.pool.query("select last_organization_id from accounts where email = $1", [email])).rows[0]?.last_organization_id;
const inviteRow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await owner.pool.query("select accepted_at, accepted_user_id, revoked_at from invites where id = $1", [id])).rows[0];

describe("findInviteByToken", () => {
  it("finds a pending invite by its token, with the organization it belongs to", async () => {
    const { token, email } = await invite(orgA, { role: "admin", name: "Bia" });
    expect(await findInviteByToken(app, token, now)).toEqual({ organizationId: orgA, organizationName: "Invites A", email, name: "Bia", role: "admin", existingAccount: false });
  });

  it("answers null, the same way, for a token that does not exist, expired, accepted or revoked", async () => {
    const expired = await invite(orgA, { expires_at: new Date(now.getTime() - 1) });
    const accepted = await invite(orgA, { accepted_at: now });
    const revoked = await invite(orgA, { revoked_at: now });
    for (const token of ["made-up", "", expired.token, accepted.token, revoked.token]) expect(await findInviteByToken(app, token, now)).toBeNull();
    // O banco guarda o resumo: o próprio resumo não serve de token.
    const pending = await invite(orgA);
    expect(await findInviteByToken(app, hashToken(pending.token), now)).toBeNull();
  });
});

describe("acceptInvite", () => {
  it("creates the user in the organization and role of the invite and spends the invite", async () => {
    const { token, email, id } = await invite(orgA, { role: "admin" });
    const result = await acceptInvite(app, token, { account: "new", name: "Bia Lima", passwordHash: "hash-1" }, now);
    expect(result).toEqual({ ok: true, userId: expect.any(String), organizationId: orgA, accountId: expect.any(String) });
    expect(await usersWith(email)).toEqual([{ organization_id: orgA, name: "Bia Lima", role: "admin", kind: "member", password_hash: "hash-1" }]);
    expect(await lastOrganization(email)).toBe(orgA);
    expect(await inviteRow(id)).toEqual({ accepted_at: now, accepted_user_id: result.ok ? result.userId : "", revoked_at: null });

    expect(await findInviteByToken(app, token, now)).toBeNull();
    expect(await acceptInvite(app, token, { account: "new", name: "Outra", passwordHash: "hash-2" }, now)).toEqual({ ok: false, reason: "invalid" });
    expect(await usersWith(email)).toHaveLength(1);
  });

  it("of two simultaneous accepts of the same token, exactly one wins", async () => {
    const { token, email } = await invite(orgA);
    const results = await Promise.all(["one", "two", "three"].map((name) => acceptInvite(app, token, { account: "new", name, passwordHash: `hash-${name}` }, now)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "invalid" }, { ok: false, reason: "invalid" }]);
    expect(await usersWith(email)).toHaveLength(1);
  });

  it("refuses an expired, revoked or unknown token and creates nobody", async () => {
    const expired = await invite(orgA, { expires_at: new Date(now.getTime() - 1) });
    const revoked = await invite(orgA, { revoked_at: now });
    for (const token of [expired.token, revoked.token, "made-up"]) {
      expect(await acceptInvite(app, token, { account: "new", name: "X", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "invalid" });
    }
    expect([...(await usersWith(expired.email)), ...(await usersWith(revoked.email))]).toEqual([]);
  });

  it("with a new password, refuses an e-mail that has an account with a link, in any organization, and leaves the invite pending", async () => {
    const taken = `${randomUUID()}@example.test`;
    const account = await withSystem(app, (q) => createAccount(q, { email: taken, passwordHash: "x" }));
    await withOrg(app, orgB, (q) => q.exec("insert into users (organization_id, account_id, email, name, role) values ($1, $2, $3, 'Já existe', 'operator')", [orgB, account, taken]));
    const { token, id } = await invite(orgA, { email: taken });
    expect(await acceptInvite(app, token, { account: "new", name: "X", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "existing_account" });
    expect(await inviteRow(id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });
    expect(await usersWith(taken)).toEqual([expect.objectContaining({ organization_id: orgB, password_hash: "x" })]);
  });

  it("an invite of organization A is invisible inside B, and accepting it never creates anyone in B", async () => {
    const { token, email, id } = await invite(orgA);
    const seenFromB = await withOrg(app, orgB, (q) => q.many("select id from invites where id = $1 or token_hash = $2", [id, hashToken(token)]));
    expect(seenFromB).toEqual([]);
    expect(await withOrg(app, orgB, (q) => q.exec("update invites set revoked_at = $2 where id = $1", [id, now]))).toBe(0);

    await acceptInvite(app, token, { account: "new", name: "De A", passwordHash: "h" }, now);
    expect(await usersWith(email)).toEqual([expect.objectContaining({ organization_id: orgA })]);
    expect(await withOrg(app, orgB, (q) => q.many("select id from users where email = $1", [email]))).toEqual([]);
  });
});

describe("an invite is only as good as whoever created it", () => {
  // O estado é montado direto no banco, SEM revogar o convite: é a prova de que a recusa vem do
  // core, e não só da revogação que o painel faz ao desativar ou remover a pessoa.
  it("refuses the invite of a disabled creator, and of a creator who no longer exists", async () => {
    const disabledCreator = await member(orgA);
    const removedCreator = await member(orgA);
    const fromDisabled = await invite(orgA, { created_by: disabledCreator, role: "owner" });
    const fromRemoved = await invite(orgA, { created_by: removedCreator });
    const untouched = await invite(orgA);
    expect(await findInviteByToken(app, fromDisabled.token, now)).not.toBeNull();

    await withOrg(app, orgA, (q) => q.exec("update users set disabled_at = $2 where id = $1", [disabledCreator, now]));
    // A chave estrangeira zera `created_by` em vez de apagar o convite ou barrar a remoção.
    await withOrg(app, orgA, (q) => q.exec("delete from users where id = $1", [removedCreator]));
    expect(await inviteRow(fromRemoved.id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });

    for (const dead of [fromDisabled, fromRemoved]) {
      expect(await findInviteByToken(app, dead.token, now)).toBeNull();
      expect(await acceptInvite(app, dead.token, { account: "new", name: "Volta", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "invalid" });
      expect(await usersWith(dead.email)).toEqual([]);
      expect(await inviteRow(dead.id)).toMatchObject({ accepted_at: null });
    }
    // Convite de outra pessoa, na mesma organização, não é afetado.
    expect(await findInviteByToken(app, untouched.token, now)).not.toBeNull();
    expect((await acceptInvite(app, untouched.token, { account: "new", name: "Entra", passwordHash: "h" }, now)).ok).toBe(true);
  });

  // O pior caso: o vínculo que criou o convite está ativo, é dono e só não é da equipe. O mesmo
  // convite de um vínculo da equipe igual vale: sem o par, o teste passaria sem convite nenhum.
  it("only a team link backs an invite: the same active owner outside the team leaves it invalid", async () => {
    for (const kind of ["member", "support"] as const) {
      const creator = await member(orgA, "owner", kind);
      const made = await invite(orgA, { created_by: creator, role: "owner" });
      const valid = kind === "member";
      expect(await findInviteByToken(app, made.token, now)).toEqual(valid ? expect.objectContaining({ organizationId: orgA, role: "owner" }) : null);
      const result = await acceptInvite(app, made.token, { account: "new", name: "Entra", passwordHash: "h" }, now);
      expect(result.ok).toBe(valid);
      if (!valid) {
        expect(result).toEqual({ ok: false, reason: "invalid" });
        expect(await usersWith(made.email)).toEqual([]);
        expect(await inviteRow(made.id)).toMatchObject({ accepted_at: null });
      }
    }
  });
});

describe("an invite is only as good as the role of whoever created it", () => {
  it("the query agrees with canManageRole on all nine pairs of creator role and invite role", async () => {
    const pairs = TEAM_ROLES.flatMap((creatorRole) => TEAM_ROLES.map((inviteRole) => ({ creatorRole, inviteRole })));
    expect(pairs).toHaveLength(9);
    for (const { creatorRole, inviteRole } of pairs) {
      const created = await invite(orgA, { created_by: await member(orgA, creatorRole), role: inviteRole });
      const expected = canManageRole(creatorRole, inviteRole);
      const found = (await findInviteByToken(app, created.token, now)) !== null;
      const accepted = (await acceptInvite(app, created.token, { account: "new", name: "Par", passwordHash: "h" }, now)).ok;
      expect({ creatorRole, inviteRole, found, accepted }).toEqual({ creatorRole, inviteRole, found: expected, accepted: expected });
    }
    // A regra em si: dono gere todos, administrador não gere dono, operador não gere ninguém.
    expect(TEAM_ROLES.map((actor) => TEAM_ROLES.filter((target) => canManageRole(actor, target)))).toEqual([["owner", "admin", "operator"], ["admin", "operator"], []]);
  });

  // Estado montado direto no banco, SEM revogar: a recusa vem do core, não da revogação do painel.
  it("refuses an owner invite whose creator has since been demoted, and keeps the ones the creator still manages", async () => {
    const creator = await member(orgA, "owner");
    const forOwner = await invite(orgA, { created_by: creator, role: "owner" });
    const forOperator = await invite(orgA, { created_by: creator, role: "operator" });
    expect(await findInviteByToken(app, forOwner.token, now)).not.toBeNull();

    await withOrg(app, orgA, (q) => q.exec("update users set role = 'admin' where id = $1", [creator]));
    expect(await inviteRow(forOwner.id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });
    expect(await findInviteByToken(app, forOwner.token, now)).toBeNull();
    expect(await acceptInvite(app, forOwner.token, { account: "new", name: "Dono pela porta dos fundos", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "invalid" });
    expect(await usersWith(forOwner.email)).toEqual([]);
    expect(await findInviteByToken(app, forOperator.token, now)).not.toBeNull();

    await withOrg(app, orgA, (q) => q.exec("update users set role = 'operator' where id = $1", [creator]));
    expect(await findInviteByToken(app, forOperator.token, now)).toBeNull();
    expect(await acceptInvite(app, forOperator.token, { account: "new", name: "X", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "invalid" });
  });
});

// Fatia 3 do R8: a mesma pessoa em várias organizações. A senha "certa" de cada conta é o próprio
// texto guardado: `verify` aqui compara texto, sem o custo do scrypt.
const textVerify = async (password: string, stored: string): Promise<boolean> => password === stored;
const existing = (password: string, verify = textVerify) => ({ account: "existing" as const, name: "Nome aqui", password, verify });

async function personIn(organizationId: string, passwordHash: string, role: "owner" | "admin" | "operator" = "operator") {
  const email = `pessoa-${randomUUID()}@example.test`;
  const created = await withSystem(app, (q) => createMember(q, { organizationId, email, name: "Pessoa", passwordHash, role }));
  if (!created) throw new Error("member not created");
  return { ...created, email };
}

describe("an invite for an e-mail that already has an account (fatia 3)", () => {
  it("says so only once the token is valid, and an account without any link counts as no account", async () => {
    const person = await personIn(orgB, "senha-b");
    const forPerson = await invite(orgA, { email: person.email });
    expect((await findInviteByToken(app, forPerson.token, now))?.existingAccount).toBe(true);
    // Mesmo e-mail, token que não vale: a mesma resposta nula de qualquer token.
    const revoked = await invite(orgA, { email: person.email, revoked_at: now });
    expect(await findInviteByToken(app, revoked.token, now)).toBeNull();

    await withOrg(app, orgB, (q) => q.exec("delete from users where id = $1", [person.userId]));
    expect((await findInviteByToken(app, forPerson.token, now))?.existingAccount).toBe(false);
  });

  it("accepts with the password the account already has: a new member link, the same password, and the next sign-in lands here", async () => {
    const person = await personIn(orgB, "senha-antiga-curta");
    const { token, id } = await invite(orgA, { email: person.email, role: "admin" });
    const result = await acceptInvite(app, token, existing("senha-antiga-curta"), now);
    expect(result).toEqual({ ok: true, userId: expect.any(String), organizationId: orgA, accountId: person.accountId });

    const links = await usersWith(person.email);
    expect(links).toHaveLength(2);
    expect(links).toEqual(
      expect.arrayContaining([
        { organization_id: orgB, name: "Pessoa", role: "operator", kind: "member", password_hash: "senha-antiga-curta" },
        { organization_id: orgA, name: "Nome aqui", role: "admin", kind: "member", password_hash: "senha-antiga-curta" },
      ]),
    );
    expect(await inviteRow(id)).toEqual({ accepted_at: now, accepted_user_id: result.ok ? result.userId : "", revoked_at: null });
    expect(await lastOrganization(person.email)).toBe(orgA);
    expect((await findLoginAccount(app, person.email))?.member).toMatchObject({ organizationId: orgA, role: "admin" });
    // Ainda uma conta só.
    expect((await owner.pool.query("select count(*)::int as n from accounts where email = $1", [person.email])).rows[0]?.n).toBe(1);
  });

  it("a wrong password does not spend the invite and creates nothing", async () => {
    const person = await personIn(orgB, "certa");
    const { token, id } = await invite(orgA, { email: person.email });
    expect(await acceptInvite(app, token, existing("errada"), now)).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await inviteRow(id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });
    expect(await usersWith(person.email)).toEqual([expect.objectContaining({ organization_id: orgB })]);
    expect(await acceptInvite(app, token, existing("certa"), now)).toMatchObject({ ok: true });
  });

  it("refuses an account that is already in this organization, active or disabled, without spending the invite", async () => {
    const active = await personIn(orgA, "a");
    const disabled = await personIn(orgA, "d");
    await withOrg(app, orgA, (q) => q.exec("update users set disabled_at = $2 where id = $1", [disabled.userId, now]));
    for (const [person, password] of [
      [active, "a"],
      [disabled, "d"],
    ] as const) {
      const { token, id } = await invite(orgA, { email: person.email });
      expect(await acceptInvite(app, token, existing(password), now)).toEqual({ ok: false, reason: "already_member" });
      expect(await inviteRow(id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });
    }
    expect(await usersWith(disabled.email)).toEqual([expect.objectContaining({ organization_id: orgA })]);
  });

  it("checks again inside the transaction: a password changed, the account gone or a link in this organization since the check", async () => {
    // O `verify` muda o banco no meio, entre a conferência e a transação do aceite.
    const changed = await personIn(orgB, "antes");
    const one = await invite(orgA, { email: changed.email });
    const changePassword = async (password: string, stored: string) => {
      await owner.pool.query("update accounts set password_hash = 'depois' where id = $1", [changed.accountId]);
      return password === stored;
    };
    expect(await acceptInvite(app, one.token, existing("antes", changePassword), now)).toEqual({ ok: false, reason: "invalid_credentials" });

    const orphaned = await personIn(orgB, "x");
    const two = await invite(orgA, { email: orphaned.email });
    const dropLink = async (password: string, stored: string) => {
      await owner.pool.query("delete from users where id = $1", [orphaned.userId]);
      return password === stored;
    };
    expect(await acceptInvite(app, two.token, existing("x", dropLink), now)).toEqual({ ok: false, reason: "no_account" });

    const joined = await personIn(orgB, "y");
    const three = await invite(orgA, { email: joined.email });
    const joinHere = async (password: string, stored: string) => {
      await owner.pool.query("insert into users (organization_id, account_id, email, name, role) values ($1, $2, $3, 'Já', 'operator')", [orgA, joined.accountId, joined.email]);
      return password === stored;
    };
    expect(await acceptInvite(app, three.token, existing("y", joinHere), now)).toEqual({ ok: false, reason: "already_member" });

    for (const { id } of [one, two, three]) expect(await inviteRow(id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });
  });

  it("an e-mail without an account asked for its old password answers no_account, and nothing is spent", async () => {
    const { token, id } = await invite(orgA);
    expect(await acceptInvite(app, token, existing("qualquer"), now)).toEqual({ ok: false, reason: "no_account" });
    expect(await inviteRow(id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });
  });

  it("of two invites of the same new e-mail accepted at once, one creates the account and the other is told to use it", async () => {
    const email = `dupla-${randomUUID()}@example.test`;
    const first = await invite(orgA, { email });
    const second = await invite(orgB, { email });
    const results = await Promise.all([
      acceptInvite(app, first.token, { account: "new", name: "A", passwordHash: "ha" }, now),
      acceptInvite(app, second.token, { account: "new", name: "B", passwordHash: "hb" }, now),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "existing_account" }]);
    expect(await usersWith(email)).toHaveLength(1);
  });
});

describe("the orphan account: removing a member whose account cleanup failed (fatia 3, nota da revisora)", () => {
  const installationEvents = async (accountId: string) =>
    (await owner.pool.query("select kind, payload->>'source' as source, organization_id from installation_events where payload->>'account_id' = $1 order by at, id", [accountId])).rows;

  it("treats the leftover account as no account: a new password, the old one gone, and the installation mark never comes back", async () => {
    const person = await personIn(orgB, "senha-velha");
    expect(await grantInstallationAdmin(app, person.email, now)).toMatchObject({ granted: true });
    // A remoção apaga o vínculo; o passo seguinte, que apagaria a conta, "falhou" (não roda).
    await withOrg(app, orgB, (q) => q.exec("delete from users where id = $1", [person.userId]));

    const { token, id } = await invite(orgA, { email: person.email, role: "admin" });
    expect((await findInviteByToken(app, token, now))?.existingAccount).toBe(false);
    // Pedir a senha velha não serve: a conta órfã não conta.
    expect(await acceptInvite(app, token, existing("senha-velha"), now)).toEqual({ ok: false, reason: "no_account" });

    const result = await acceptInvite(app, token, { account: "new", name: "Recomeço", passwordHash: "senha-nova" }, now);
    expect(result).toMatchObject({ ok: true, organizationId: orgA });
    if (!result.ok) return;
    expect(result.accountId).not.toBe(person.accountId);
    expect(await inviteRow(id)).toMatchObject({ accepted_user_id: result.userId });

    const account = (await owner.pool.query("select id, password_hash, installation_admin_at from accounts where email = $1", [person.email])).rows;
    expect(account).toEqual([{ id: result.accountId, password_hash: "senha-nova", installation_admin_at: null }]);
    const login = await findLoginAccount(app, person.email);
    expect(login?.passwordHash).toBe("senha-nova");
    expect(login?.member).toMatchObject({ organizationId: orgA, role: "admin" });
    expect(await installationEvents(person.accountId)).toEqual([
      { kind: "installation_admin_granted", source: "command", organization_id: null },
      { kind: "installation_admin_revoked", source: "orphan_on_invite", organization_id: orgA },
    ]);
    expect(await installationEvents(result.accountId)).toEqual([]);
  });

  it("an orphan without the mark goes quietly, and the cleanup that runs later finds nothing to do", async () => {
    const person = await personIn(orgB, "velha");
    await withOrg(app, orgB, (q) => q.exec("delete from users where id = $1", [person.userId]));
    const { token } = await invite(orgA, { email: person.email });
    expect(await acceptInvite(app, token, { account: "new", name: "N", passwordHash: "nova" }, now)).toMatchObject({ ok: true });
    expect(await installationEvents(person.accountId)).toEqual([]);
    expect(await deleteAccountIfOrphan(app, person.accountId, now)).toBe(false);
  });
});
