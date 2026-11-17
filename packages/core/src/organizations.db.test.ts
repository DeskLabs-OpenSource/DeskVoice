import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, createOrganization, openTestDbs } from "../test/helpers";
import { createMember, grantInstallationAdminBy, isInstallationAdmin, listInstallationAdmins, revokeInstallationAdmin } from "./accounts";
import { acceptInvite, findInviteByToken } from "./invites";
import { hashToken } from "./password";
import { FOUNDING_ORGANIZATION_KEY, adminsExplicit, listInstallationEvents, requestInstallationUpdate } from "./installation";
import { addOrganization, createFirstOwnerInvite, listOrganizations, previewNewOrganization, renameOrganization } from "./organizations";
import { withOrg, withSystem } from "./with-org";

const now = new Date("2026-03-01T15:00:00.000Z");
const { app, owner } = openTestDbs();

// Quem administra a instalação é estado GLOBAL, e os arquivos de banco rodam em série no mesmo
// banco. Cada teste daqui começa sem fundadora, sem lista explícita e sem marca em conta nenhuma, e
// o arquivo devolve o banco assim. Só o dono do schema apaga: o produto nunca apaga.
const clearInstallationState = (): Promise<void> => clear(owner);
beforeEach(clearInstallationState);
afterAll(async () => {
  await clearInstallationState();
  await app.close();
  await owner.close();
});

type TeamRole = "owner" | "admin" | "operator";
async function member(organizationId: string, role: TeamRole, name = `Pessoa ${role}`): Promise<{ accountId: string; userId: string; email: string }> {
  const email = `${role}-${randomUUID()}@example.test`;
  const created = await withSystem(app, (q) => createMember(q, { organizationId, email, name, passwordHash: "senha", role }));
  if (!created) throw new Error("member not created");
  return { ...created, email };
}
const administers = (accountId: string): Promise<boolean> => isInstallationAdmin(app, accountId);

/** Uma instalação de um cliente só: a fundadora, com dono, administrador e operador. */
async function singleClient() {
  const founding = await createOrganization(app, `Fundadora ${randomUUID().slice(0, 6)}`);
  await withSystem(app, (q) => q.exec("insert into installation_settings (key, value) values ($1, to_jsonb($2::text))", [FOUNDING_ORGANIZATION_KEY, founding]));
  const ownerOne = await member(founding, "owner", "Ana Dona");
  const adminOne = await member(founding, "admin", "Beto Admin");
  const operator = await member(founding, "operator", "Caio Operador");
  return { founding, ownerOne, adminOne, operator };
}
const shownFor = async () => {
  const preview = await previewNewOrganization(app);
  return { granted: preview.granted.map((p) => p.accountId), losing: preview.losing.map((p) => p.accountId) };
};
const marked = async (accountId: string): Promise<boolean> =>
  (await owner.pool.query<{ marked: boolean }>("select installation_admin_at is not null as marked from accounts where id = $1", [accountId])).rows[0]?.marked === true;
const orgEvents = async (organizationId: string) =>
  (await owner.pool.query<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from organization_events where organization_id = $1 order by id", [organizationId])).rows;
const installationEvents = async (organizationId: string) =>
  (await owner.pool.query<{ kind: string; actor_account_id: string | null; payload: Record<string, unknown> }>("select kind, actor_account_id, payload from installation_events where organization_id = $1 order by id", [organizationId]))
    .rows;

describe("creating the second organization (seção 3.2, item 3)", () => {
  it("shows, before confirming, who gets the mark and who stops administering", async () => {
    const { ownerOne, adminOne } = await singleClient();
    const preview = await previewNewOrganization(app);
    expect(preview.explicit).toBe(false);
    expect(preview.granted).toEqual([{ accountId: ownerOne.accountId, email: ownerOne.email, name: "Ana Dona" }]);
    expect(preview.losing).toEqual([{ accountId: adminOne.accountId, email: adminOne.email, name: "Beto Admin" }]);
  });

  it("marks the founding owners, records the explicit list and organization_created in both audits, in one go", async () => {
    const { founding, ownerOne, adminOne, operator } = await singleClient();
    expect(await administers(adminOne.accountId)).toBe(true);

    const result = await addOrganization(app, { name: "  Cliente Novo  ", actorAccountId: ownerOne.accountId, shown: await shownFor(), keep: [] }, now);
    if (!result.ok) throw new Error(result.reason);
    expect(result.granted.map((p) => p.accountId)).toEqual([ownerOne.accountId]);
    expect(result.lost.map((p) => p.accountId)).toEqual([adminOne.accountId]);

    expect(await adminsExplicit(app)).toBe(true);
    expect(await marked(ownerOne.accountId)).toBe(true);
    expect(await administers(ownerOne.accountId)).toBe(true);
    // O administrador da fundadora deixa de administrar: a tela disse antes, com o nome.
    expect(await administers(adminOne.accountId)).toBe(false);
    expect(await administers(operator.accountId)).toBe(false);

    const created = (await listOrganizations(app)).find((org) => org.id === result.organizationId);
    expect(created).toMatchObject({ name: "Cliente Novo", founding: false, suspendedAt: null });
    expect((await listOrganizations(app)).find((org) => org.id === founding)?.founding).toBe(true);
    expect(await installationEvents(result.organizationId)).toEqual([{ kind: "organization_created", actor_account_id: ownerOne.accountId, payload: { name: "Cliente Novo" } }]);
    expect(await orgEvents(result.organizationId)).toEqual([{ kind: "organization_created", payload: { name: "Cliente Novo" } }]);
    const granted = await owner.pool.query("select actor_account_id, payload from installation_events where kind = 'installation_admin_granted' and payload->>'account_id' = $1", [ownerOne.accountId]);
    expect(granted.rows).toEqual([{ actor_account_id: ownerOne.accountId, payload: { account_id: ownerOne.accountId, source: "second_organization" } }]);
    // Nasce como toda organização: com a saída desligada.
    expect(await withOrg(app, result.organizationId, (q) => q.one("select enabled from outbound_policy"))).toEqual({ enabled: false });
  });

  it("keeps the founding admins whom the creator ticks on the same screen", async () => {
    const { ownerOne, adminOne } = await singleClient();
    const result = await addOrganization(app, { name: "Cliente", actorAccountId: ownerOne.accountId, shown: await shownFor(), keep: [adminOne.accountId] }, now);
    if (!result.ok) throw new Error(result.reason);
    expect(result.kept.map((p) => p.accountId)).toEqual([adminOne.accountId]);
    expect(result.lost).toEqual([]);
    expect(await administers(adminOne.accountId)).toBe(true);
  });

  it("refuses when the list changed since the screen was shown, and when keeping someone not on it", async () => {
    const { founding, ownerOne } = await singleClient();
    const shown = await shownFor();
    const before = (await listOrganizations(app)).length;
    // Outro administrador entrou na fundadora depois que a tela abriu: ele perderia o papel sem aparecer.
    const late = await member(founding, "admin");
    expect(await addOrganization(app, { name: "Cliente", actorAccountId: ownerOne.accountId, shown, keep: [] }, now)).toEqual({ ok: false, reason: "admins_changed" });
    expect(await addOrganization(app, { name: "Cliente", actorAccountId: ownerOne.accountId, shown: await shownFor(), keep: [randomUUID()] }, now)).toEqual({ ok: false, reason: "invalid_keep" });
    expect((await listOrganizations(app)).length).toBe(before);
    expect(await adminsExplicit(app)).toBe(false);
    expect(await administers(late.accountId)).toBe(true);
  });

  it("leaves nothing behind when the transaction breaks in the middle", async () => {
    const { ownerOne, adminOne } = await singleClient();
    const organizations = (await listOrganizations(app)).length;
    const events = (await owner.pool.query("select count(*)::int as n from installation_events")).rows[0];
    const orgEventCount = (await owner.pool.query("select count(*)::int as n from organization_events where kind = 'organization_created'")).rows[0];
    // A gravação do estado explícito é a última: derrubá-la prova que tudo antes dela volta junto.
    await owner.pool.query(`create function test_break_explicit() returns trigger language plpgsql as $$ begin raise exception 'broken on purpose'; end $$`);
    await owner.pool.query("create trigger test_break_explicit before insert on installation_settings for each row when (new.key = 'installation.admins_explicit_at') execute function test_break_explicit()");
    try {
      await expect(addOrganization(app, { name: "Cliente", actorAccountId: ownerOne.accountId, shown: await shownFor(), keep: [adminOne.accountId] }, now)).rejects.toThrow(/broken on purpose/);
    } finally {
      await owner.pool.query("drop trigger test_break_explicit on installation_settings");
      await owner.pool.query("drop function test_break_explicit()");
    }
    expect((await listOrganizations(app)).length).toBe(organizations);
    expect((await owner.pool.query("select count(*)::int as n from installation_events")).rows[0]).toEqual(events);
    expect((await owner.pool.query("select count(*)::int as n from organization_events where kind = 'organization_created'")).rows[0]).toEqual(orgEventCount);
    expect(await marked(ownerOne.accountId)).toBe(false);
    expect(await marked(adminOne.accountId)).toBe(false);
    expect(await adminsExplicit(app)).toBe(false);
  });

  it("gives nothing back when an organization is later deleted or suspended by SQL", async () => {
    const { founding, ownerOne, adminOne } = await singleClient();
    const result = await addOrganization(app, { name: "Cliente", actorAccountId: ownerOne.accountId, shown: await shownFor(), keep: [] }, now);
    if (!result.ok) throw new Error(result.reason);
    const clientOwner = await member(result.organizationId, "owner");
    expect(await administers(clientOwner.accountId)).toBe(false);

    // De volta a uma organização só, por SQL na VPS: a regra não volta a ser a da contagem.
    await owner.pool.query("delete from users where organization_id = $1", [result.organizationId]);
    await owner.pool.query("delete from accounts where id = $1", [clientOwner.accountId]);
    await owner.pool.query("delete from organization_events where organization_id = $1", [result.organizationId]);
    await owner.pool.query("delete from outbound_policy where organization_id = $1", [result.organizationId]);
    await owner.pool.query("delete from organizations where id = $1", [result.organizationId]);
    await owner.pool.query("update organizations set suspended_at = $2, suspended_reason = 'teste de suspensão' where id = $1", [founding, now]);
    expect(await adminsExplicit(app)).toBe(true);
    expect(await administers(adminOne.accountId)).toBe(false);
    expect(await administers(ownerOne.accountId)).toBe(true);
    // Criar outra depois disso não muda ninguém: a lista já é explícita.
    expect(await previewNewOrganization(app)).toEqual({ explicit: true, granted: [], losing: [] });
  });

  it("the system role changes a setting's value, never its key", async () => {
    await singleClient();
    await withSystem(app, (q) => q.exec("update installation_settings set value = value, updated_at = $2 where key = $1", [FOUNDING_ORGANIZATION_KEY, now]));
    await expect(withSystem(app, (q) => q.exec("update installation_settings set key = 'installation.renamed' where key = $1", [FOUNDING_ORGANIZATION_KEY]))).rejects.toMatchObject({ code: "42501" });
    await expect(withSystem(app, (q) => q.exec("update installation_settings set secret = true where key = $1", [FOUNDING_ORGANIZATION_KEY]))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("renaming and the first owner's invite", () => {
  it("renames, recording organization_renamed in both audits, and does nothing for the same name", async () => {
    const { ownerOne } = await singleClient();
    const org = await createOrganization(app, "Antigo");
    expect(await renameOrganization(app, ownerOne.accountId, org, " Novo ", now)).toBe(true);
    expect(await renameOrganization(app, ownerOne.accountId, org, "Novo", now)).toBe(true);
    expect(await renameOrganization(app, ownerOne.accountId, randomUUID(), "Outro", now)).toBe(false);
    expect((await listOrganizations(app)).find((o) => o.id === org)?.name).toBe("Novo");
    expect(await orgEvents(org)).toEqual([{ kind: "organization_renamed", payload: { from: "Antigo", to: "Novo" } }]);
    expect(await installationEvents(org)).toEqual([{ kind: "organization_renamed", actor_account_id: ownerOne.accountId, payload: { from: "Antigo", to: "Novo" } }]);
  });

  it("invites the first owner inside the new organization, who joins without administering the installation", async () => {
    const { ownerOne } = await singleClient();
    const result = await addOrganization(app, { name: "Cliente", actorAccountId: ownerOne.accountId, shown: await shownFor(), keep: [] }, now);
    if (!result.ok) throw new Error(result.reason);
    const email = `dono-${randomUUID()}@example.test`;
    const invite = await createFirstOwnerInvite(app, result.organizationId, { email, name: "Dona do Cliente" }, now);
    if (!invite.ok) throw new Error(invite.reason);
    const row = await withOrg(app, result.organizationId, (q) => q.one("select email::text as email, role, created_by from invites"));
    expect(row).toEqual({ email, role: "owner", created_by: null });
    expect(await findInviteByToken(app, invite.token, now)).toMatchObject({ email, role: "owner" });

    const accepted = await acceptInvite(app, invite.token, { name: "Dona do Cliente", passwordHash: "senha" }, now);
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(accepted.organizationId).toBe(result.organizationId);
    const account = (await owner.pool.query<{ id: string }>("select id from accounts where email = $1", [email])).rows[0]?.id ?? "";
    expect(await administers(account)).toBe(false);

    // Depois do primeiro dono, quem convida é ele.
    expect(await createFirstOwnerInvite(app, result.organizationId, { email: `outro-${randomUUID()}@example.test`, name: "Outro" }, now)).toEqual({ ok: false, reason: "has_members" });
  });

  it("keeps one first-owner invite at a time, valid only while the organization has nobody", async () => {
    await singleClient();
    const org = await createOrganization(app, "Vazia");
    const first = await createFirstOwnerInvite(app, org, { email: `a-${randomUUID()}@example.test`, name: "A" }, now);
    const second = await createFirstOwnerInvite(app, org, { email: `b-${randomUUID()}@example.test`, name: "B" }, now);
    if (!first.ok || !second.ok) throw new Error("invite not created");
    // O novo derruba o anterior, mesmo de outro e-mail: dois links vivos fariam dois "primeiros" donos.
    expect(await findInviteByToken(app, first.token, now)).toBeNull();
    expect(await findInviteByToken(app, second.token, now)).toMatchObject({ role: "owner" });
    // Alguém entrou por outro caminho (SQL na VPS, ou a fatia 3): o convite sem criador deixa de valer.
    await member(org, "operator");
    expect(await findInviteByToken(app, second.token, now)).toBeNull();
    expect(await acceptInvite(app, second.token, { name: "B", passwordHash: "senha" }, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not revive an ordinary invite whose creator left: the null creator alone is not the mark", async () => {
    const org = await createOrganization(app, "Vazia");
    const token = `t-${randomUUID()}`;
    await withOrg(app, org, (q) =>
      q.exec("insert into invites (organization_id, email, name, role, token_hash, expires_at, created_by) values ($1, $2, 'X', 'owner', $3, $4, null)", [
        org,
        `x-${randomUUID()}@example.test`,
        hashToken(token),
        new Date(now.getTime() + 86_400_000),
      ]),
    );
    expect(await findInviteByToken(app, token, now)).toBeNull();
    // E a marca não convive com um criador: o convite de alguém da equipe nunca vira convite da administração.
    const creator = await member(org, "owner");
    await expect(
      withOrg(app, org, (q) =>
        q.exec("insert into invites (organization_id, email, name, role, token_hash, expires_at, created_by, installation_invite) values ($1, $2, 'Y', 'owner', $3, $4, $5, true)", [
          org,
          `y-${randomUUID()}@example.test`,
          hashToken(`u-${randomUUID()}`),
          new Date(now.getTime() + 86_400_000),
          creator.userId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses an installation invite with any role other than owner, in the database itself", async () => {
    const org = await createOrganization(app, "Vazia");
    await expect(
      withOrg(app, org, (q) =>
        q.exec("insert into invites (organization_id, email, name, role, token_hash, expires_at, created_by, installation_invite) values ($1, $2, 'Z', 'operator', $3, $4, null, true)", [
          org,
          `z-${randomUUID()}@example.test`,
          hashToken(`v-${randomUUID()}`),
          new Date(now.getTime() + 86_400_000),
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "invites_installation_invite_is_owner" });
  });

  it("refuses an e-mail that already has an account and an organization that does not exist", async () => {
    const { ownerOne } = await singleClient();
    const org = await createOrganization(app, "Vazia");
    expect(await createFirstOwnerInvite(app, org, { email: ownerOne.email, name: "Ana" }, now)).toEqual({ ok: false, reason: "email_taken" });
    expect(await createFirstOwnerInvite(app, randomUUID(), { email: `x-${randomUUID()}@example.test`, name: "X" }, now)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the list of who administers (seção 3.2, regras da lista)", () => {
  it("adds by e-mail and removes, recording both, and never removes the last person", async () => {
    const { ownerOne, adminOne } = await singleClient();
    const result = await addOrganization(app, { name: "Cliente", actorAccountId: ownerOne.accountId, shown: await shownFor(), keep: [] }, now);
    if (!result.ok) throw new Error(result.reason);
    expect(await revokeInstallationAdmin(app, ownerOne.accountId, ownerOne.accountId, now)).toEqual({ ok: false, reason: "last_admin" });
    expect(await administers(ownerOne.accountId)).toBe(true);

    expect(await grantInstallationAdminBy(app, ownerOne.accountId, adminOne.email.toUpperCase(), now)).toEqual({ ok: true, accountId: adminOne.accountId });
    expect(await grantInstallationAdminBy(app, ownerOne.accountId, adminOne.email, now)).toEqual({ ok: false, reason: "already_granted" });
    expect(await grantInstallationAdminBy(app, ownerOne.accountId, "ninguem@example.test", now)).toEqual({ ok: false, reason: "email_not_found" });
    expect((await listInstallationAdmins(app)).admins.map((a) => a.accountId).sort()).toEqual([ownerOne.accountId, adminOne.accountId].sort());

    expect(await revokeInstallationAdmin(app, adminOne.accountId, ownerOne.accountId, now)).toEqual({ ok: true });
    expect(await administers(ownerOne.accountId)).toBe(false);
    expect(await revokeInstallationAdmin(app, adminOne.accountId, adminOne.accountId, now)).toEqual({ ok: false, reason: "last_admin" });
    expect(await revokeInstallationAdmin(app, adminOne.accountId, randomUUID(), now)).toEqual({ ok: false, reason: "not_found" });

    const audit = await listInstallationEvents(app);
    expect(audit[0]).toMatchObject({ kind: "installation_admin_revoked", actorEmail: adminOne.email, subjectEmail: ownerOne.email, payload: { source: "panel" } });
    expect(audit[1]).toMatchObject({ kind: "installation_admin_granted", actorEmail: ownerOne.email, subjectEmail: adminOne.email });
  });

  it("before the list is explicit, lists the founding owner and admin by role, and a removed mark keeps the role's right", async () => {
    const { ownerOne, adminOne } = await singleClient();
    const listed = await listInstallationAdmins(app);
    expect(listed.explicit).toBe(false);
    expect(listed.admins).toEqual(
      expect.arrayContaining([
        { accountId: ownerOne.accountId, email: ownerOne.email, name: "Ana Dona", since: null },
        { accountId: adminOne.accountId, email: adminOne.email, name: "Beto Admin", since: null },
      ]),
    );
    expect(await grantInstallationAdminBy(app, ownerOne.accountId, ownerOne.email, now)).toMatchObject({ ok: true });
    expect(await revokeInstallationAdmin(app, ownerOne.accountId, ownerOne.accountId, now)).toEqual({ ok: true });
    expect(await administers(ownerOne.accountId)).toBe(true);
  });
});

describe("the update request (seção 3.11)", () => {
  it("records update_requested in the installation audit, with the organization and the account", async () => {
    const { founding, ownerOne } = await singleClient();
    await owner.pool.query("delete from update_requests");
    const request = await requestInstallationUpdate(app, { organizationId: founding, userId: ownerOne.userId, fromVersion: "0.1.0", targetVersion: "0.2.0" }, now);
    expect(request).toMatchObject({ status: "requested", fromVersion: "0.1.0", targetVersion: "0.2.0" });
    expect(await installationEvents(founding)).toEqual([
      { kind: "update_requested", actor_account_id: ownerOne.accountId, payload: { request_id: request.id, from_version: "0.1.0", target_version: "0.2.0" } },
    ]);
    // Um aberto por vez, na instalação inteira: o segundo cai no índice único, e nada é gravado.
    await expect(requestInstallationUpdate(app, { organizationId: founding, userId: ownerOne.userId, fromVersion: "0.1.0", targetVersion: "0.2.0" }, now)).rejects.toMatchObject({ code: "23505" });
    expect((await installationEvents(founding)).length).toBe(1);
    await owner.pool.query("delete from update_requests");
  });
});
