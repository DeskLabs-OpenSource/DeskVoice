import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { acceptInvite, findInviteByToken } from "./invites";
import { hashToken } from "./password";
import { withOrg } from "./with-org";

const { app, owner } = openTestDbs();
const now = new Date("2026-03-01T15:00:00.000Z");
const later = new Date(now.getTime() + 7 * 86_400_000);
let orgA: string;
let orgB: string;
const creators = new Map<string, string>();

async function member(organizationId: string): Promise<string> {
  const row = await withOrg(app, organizationId, (q) =>
    q.one<{ id: string }>("insert into users (organization_id, email, name, password_hash, role) values ($1, $2, 'Quem convida', 'x', 'admin') returning id", [organizationId, `${randomUUID()}@example.test`]),
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
  (await owner.pool.query("select organization_id, name, role, password_hash from users where email = $1", [email])).rows;
const inviteRow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await owner.pool.query("select accepted_at, accepted_user_id, revoked_at from invites where id = $1", [id])).rows[0];

describe("findInviteByToken", () => {
  it("finds a pending invite by its token, with the organization it belongs to", async () => {
    const { token, email } = await invite(orgA, { role: "admin", name: "Bia" });
    expect(await findInviteByToken(app, token, now)).toEqual({ organizationId: orgA, organizationName: "Invites A", email, name: "Bia", role: "admin" });
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
    const result = await acceptInvite(app, token, { name: "Bia Lima", passwordHash: "hash-1" }, now);
    expect(result).toEqual({ ok: true, userId: expect.any(String), organizationId: orgA });
    expect(await usersWith(email)).toEqual([{ organization_id: orgA, name: "Bia Lima", role: "admin", password_hash: "hash-1" }]);
    expect(await inviteRow(id)).toEqual({ accepted_at: now, accepted_user_id: result.ok ? result.userId : "", revoked_at: null });

    expect(await findInviteByToken(app, token, now)).toBeNull();
    expect(await acceptInvite(app, token, { name: "Outra", passwordHash: "hash-2" }, now)).toEqual({ ok: false, reason: "invalid" });
    expect(await usersWith(email)).toHaveLength(1);
  });

  it("of two simultaneous accepts of the same token, exactly one wins", async () => {
    const { token, email } = await invite(orgA);
    const results = await Promise.all(["one", "two", "three"].map((name) => acceptInvite(app, token, { name, passwordHash: `hash-${name}` }, now)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "invalid" }, { ok: false, reason: "invalid" }]);
    expect(await usersWith(email)).toHaveLength(1);
  });

  it("refuses an expired, revoked or unknown token and creates nobody", async () => {
    const expired = await invite(orgA, { expires_at: new Date(now.getTime() - 1) });
    const revoked = await invite(orgA, { revoked_at: now });
    for (const token of [expired.token, revoked.token, "made-up"]) {
      expect(await acceptInvite(app, token, { name: "X", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "invalid" });
    }
    expect([...(await usersWith(expired.email)), ...(await usersWith(revoked.email))]).toEqual([]);
  });

  it("says the e-mail is taken, in any organization, and leaves the invite pending", async () => {
    const taken = `${randomUUID()}@example.test`;
    await withOrg(app, orgB, (q) => q.exec("insert into users (organization_id, email, name, password_hash, role) values ($1, $2, 'Já existe', 'x', 'operator')", [orgB, taken]));
    const { token, id } = await invite(orgA, { email: taken });
    expect(await acceptInvite(app, token, { name: "X", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "email_taken" });
    expect(await inviteRow(id)).toEqual({ accepted_at: null, accepted_user_id: null, revoked_at: null });
    expect(await usersWith(taken)).toEqual([expect.objectContaining({ organization_id: orgB })]);
  });

  it("an invite of organization A is invisible inside B, and accepting it never creates anyone in B", async () => {
    const { token, email, id } = await invite(orgA);
    const seenFromB = await withOrg(app, orgB, (q) => q.many("select id from invites where id = $1 or token_hash = $2", [id, hashToken(token)]));
    expect(seenFromB).toEqual([]);
    expect(await withOrg(app, orgB, (q) => q.exec("update invites set revoked_at = $2 where id = $1", [id, now]))).toBe(0);

    await acceptInvite(app, token, { name: "De A", passwordHash: "h" }, now);
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
      expect(await acceptInvite(app, dead.token, { name: "Volta", passwordHash: "h" }, now)).toEqual({ ok: false, reason: "invalid" });
      expect(await usersWith(dead.email)).toEqual([]);
      expect(await inviteRow(dead.id)).toMatchObject({ accepted_at: null });
    }
    // Convite de outra pessoa, na mesma organização, não é afetado.
    expect(await findInviteByToken(app, untouched.token, now)).not.toBeNull();
    expect((await acceptInvite(app, untouched.token, { name: "Entra", passwordHash: "h" }, now)).ok).toBe(true);
  });
});
