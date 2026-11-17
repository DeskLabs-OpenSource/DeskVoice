import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import {
  accountOfMember,
  changeMemberPassword,
  checkMemberPassword,
  createAccount,
  createMember,
  deleteAccountIfOrphan,
  findLoginAccount,
  grantInstallationAdmin,
  isInstallationAdmin,
  resetAccountPassword,
} from "./accounts";
import { createDb } from "./db";
import { ADMINS_EXPLICIT_KEY, FOUNDING_ORGANIZATION_KEY, recordFoundingOrganization } from "./installation";
import { runMigrations } from "./migrate";
import { hashPassword, verifyPassword } from "./password";
import type { Db } from "./types";
import { withOrg, withSystem } from "./with-org";

const REAL_MIGRATIONS = path.resolve(import.meta.dirname, "../../../db/migrations");
const THIS_MIGRATION = "20261117T053804_contas_e_papel_da_instalacao.sql";
const now = new Date("2026-03-01T15:00:00.000Z");

const { app, owner } = openTestDbs();
afterAll(async () => {
  // Não deixa lista explícita para os arquivos seguintes: o produto nunca a apaga, e eles contam com
  // a regra da fundadora.
  await clearInstallationState();
  await app.close();
  await owner.close();
});

// Quem administra a instalação é estado GLOBAL. Os arquivos de banco rodam em série, e cada teste
// daqui começa sem fundadora e sem lista explícita. Só o dono do schema apaga: o produto nunca apaga.
const clearInstallationState = async (): Promise<void> => {
  await owner.pool.query("delete from installation_settings where key = any ($1)", [[FOUNDING_ORGANIZATION_KEY, ADMINS_EXPLICIT_KEY]]);
};

const textCompare = async (password: string, stored: string): Promise<boolean> => password === stored;

type TeamRole = "owner" | "admin" | "operator";
async function member(organizationId: string, role: TeamRole, passwordHash = "senha"): Promise<{ accountId: string; userId: string; email: string }> {
  const email = `${role}-${randomUUID()}@example.test`;
  const created = await withSystem(app, (q) => createMember(q, { organizationId, email, name: `Pessoa ${role}`, passwordHash, role }));
  if (!created) throw new Error("member not created");
  return { ...created, email };
}
const admin = (accountId: string): Promise<boolean> => isInstallationAdmin(app, accountId);

describe("isInstallationAdmin: estado gravado, nunca a contagem de organizações (seção 3.2)", () => {
  beforeEach(clearInstallationState);

  it("lets the owner and the admin of the founding organization administer, and never an operator or a disabled member", async () => {
    const founding = await createOrganization(app, "Fundadora");
    await withSystem(app, (q) => recordFoundingOrganization(q, founding));
    const [owner_, admin_, operator, disabled] = await Promise.all([member(founding, "owner"), member(founding, "admin"), member(founding, "operator"), member(founding, "admin")]);
    await withOrg(app, founding, (q) => q.exec("update users set disabled_at = $2 where id = $1", [disabled.userId, now]));

    expect(await admin(owner_.accountId)).toBe(true);
    expect(await admin(admin_.accountId)).toBe(true);
    expect(await admin(operator.accountId)).toBe(false);
    expect(await admin(disabled.accountId)).toBe(false);
    expect(await admin(randomUUID())).toBe(false);
  });

  it("gives nothing to anyone for an organization inserted by direct SQL", async () => {
    const founding = await createOrganization(app, "Fundadora");
    await withSystem(app, (q) => recordFoundingOrganization(q, founding));
    // Pela VPS, sem passar por packages/core: não é a fundadora e não muda o estado.
    const direct = await createOrganization(app, "Inserida por SQL");
    const [owner_, admin_] = await Promise.all([member(direct, "owner"), member(direct, "admin")]);
    expect(await admin(owner_.accountId)).toBe(false);
    expect(await admin(admin_.accountId)).toBe(false);
    // E a fundadora não se troca depois de gravada.
    expect(await withSystem(app, (q) => recordFoundingOrganization(q, direct))).toBe(false);
    expect(await admin(owner_.accountId)).toBe(false);
  });

  it("keeps the owner of the remaining organization without the role when the founding one is suspended or deleted", async () => {
    const founding = await createOrganization(app, "Fundadora que sai");
    await withSystem(app, (q) => recordFoundingOrganization(q, founding));
    const foundingOwner = await member(founding, "owner");
    const remaining = await createOrganization(app, "A que sobra");
    const remainingOwner = await member(remaining, "owner");
    expect(await admin(foundingOwner.accountId)).toBe(true);
    expect(await admin(remainingOwner.accountId)).toBe(false);

    // Suspensa: a contagem de organizações ativas caiu para uma, e nada muda de dono.
    await owner.pool.query("update organizations set suspended_at = $2, suspended_reason = 'teste de suspensão' where id = $1", [founding, now]);
    expect(await admin(remainingOwner.accountId)).toBe(false);

    // Excluída: sobrou uma organização só, e ela continua sem dar papel a ninguém.
    await owner.pool.query("delete from users where organization_id = $1", [founding]);
    await owner.pool.query("delete from organizations where id = $1", [founding]);
    expect(await admin(remainingOwner.accountId)).toBe(false);
  });

  it("once the list is explicit, only the mark counts, and the explicit state cannot be erased by the product", async () => {
    const founding = await createOrganization(app, "Fundadora explícita");
    await withSystem(app, (q) => recordFoundingOrganization(q, founding));
    const [owner_, admin_] = await Promise.all([member(founding, "owner"), member(founding, "admin")]);
    await withSystem(app, (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [owner_.accountId, now]));
    await withSystem(app, (q) => q.exec("insert into installation_settings (key, value) values ($1, to_jsonb($2::timestamptz))", [ADMINS_EXPLICIT_KEY, now]));

    expect(await admin(owner_.accountId)).toBe(true);
    expect(await admin(admin_.accountId)).toBe(false);
    // O papel de sistema não apaga a marca da lista explícita.
    await expect(withSystem(app, (q) => q.exec("delete from installation_settings where key = $1", [ADMINS_EXPLICIT_KEY]))).rejects.toMatchObject({ code: "42501" });
  });

  it("never gives the installation role through a support link", async () => {
    const founding = await createOrganization(app, "Fundadora com suporte");
    await withSystem(app, (q) => recordFoundingOrganization(q, founding));
    const outsider = await withSystem(app, (q) => createAccount(q, { email: `suporte-${randomUUID()}@example.test`, passwordHash: "senha" }));
    if (!outsider) throw new Error("account not created");
    // Nenhum código cria vínculo `support` nesta fatia; o dono do schema o grava para provar a regra.
    await owner.pool.query("insert into users (organization_id, account_id, kind, email, name, role) values ($1, $2, 'support', $3, 'Suporte', 'admin')", [
      founding,
      outsider,
      `suporte-link-${randomUUID()}@example.test`,
    ]);
    expect(await admin(outsider)).toBe(false);
    expect(await findLoginAccount(app, (await owner.pool.query<{ email: string }>("select email::text from accounts where id = $1", [outsider])).rows[0]?.email ?? "")).toMatchObject({ member: null });
  });
});

describe("grantInstallationAdmin (a saída de emergência)", () => {
  beforeEach(clearInstallationState);

  it("marks the account once, records it in the installation audit, and says when the e-mail has no account", async () => {
    const org = await createOrganization(app, "Emergência");
    const operator = await member(org, "operator");
    expect(await admin(operator.accountId)).toBe(false);

    expect(await grantInstallationAdmin(app, operator.email.toUpperCase(), now)).toEqual({ granted: true, accountId: operator.accountId });
    expect(await admin(operator.accountId)).toBe(true);
    expect(await grantInstallationAdmin(app, operator.email, now)).toEqual({ granted: false, reason: "already_granted" });
    expect(await grantInstallationAdmin(app, `ninguem-${randomUUID()}@example.test`, now)).toEqual({ granted: false, reason: "email_not_found" });

    const events = await owner.pool.query("select kind, actor_account_id, organization_id, payload from installation_events where payload->>'account_id' = $1", [operator.accountId]);
    expect(events.rows).toEqual([{ kind: "installation_admin_granted", actor_account_id: null, organization_id: null, payload: { account_id: operator.accountId, source: "command" } }]);
  });
});

describe("the account behind sign-in and password", () => {
  it("finds the account by e-mail with its active member link, and no link for a disabled member", async () => {
    const org = await createOrganization(app, "Login");
    const person = await member(org, "admin", "hash-da-conta");
    expect(await findLoginAccount(app, person.email.toUpperCase())).toEqual({
      accountId: person.accountId,
      passwordHash: "hash-da-conta",
      member: { id: person.userId, organizationId: org, name: "Pessoa admin", role: "admin" },
    });
    expect(await accountOfMember(app, person.userId)).toBe(person.accountId);

    await withOrg(app, org, (q) => q.exec("update users set disabled_at = $2 where id = $1", [person.userId, now]));
    expect(await findLoginAccount(app, person.email)).toMatchObject({ accountId: person.accountId, member: null });
    expect(await findLoginAccount(app, `ninguem-${randomUUID()}@example.test`)).toBeNull();
  });

  it("checks and changes the password of the account, closing the other sessions of the account only", async () => {
    const org = await createOrganization(app, "Senha");
    const person = await member(org, "operator", "antiga");
    const other = await member(org, "operator", "outra");
    const session = async (userId: string): Promise<string> => {
      const id = randomUUID();
      await withSystem(app, (q) =>
        q.exec("insert into sessions (id, organization_id, user_id, account_id, token_hash, expires_at) select $1, organization_id, id, account_id, $3, $4 from users where id = $2", [
          id,
          userId,
          randomUUID(),
          new Date(now.getTime() + 86_400_000),
        ]),
      );
      return id;
    };
    const kept = await session(person.userId);
    await session(person.userId);
    const others = await session(other.userId);

    expect(await checkMemberPassword(app, person.userId, "antiga", textCompare)).toBe(true);
    expect(await checkMemberPassword(app, person.userId, "errada", textCompare)).toBe(false);
    expect(await checkMemberPassword(app, randomUUID(), "antiga", textCompare)).toBeNull();

    expect(await changeMemberPassword(app, person.userId, "nova", kept)).toBe(1);
    expect(await checkMemberPassword(app, person.userId, "nova", textCompare)).toBe(true);
    expect(await checkMemberPassword(app, other.userId, "outra", textCompare)).toBe(true);
    const left = await owner.pool.query<{ id: string }>("select id from sessions where user_id = any ($1) order by id", [[person.userId, other.userId]]);
    expect(left.rows.map((row) => row.id).sort()).toEqual([kept, others].sort());

    expect(await resetAccountPassword(app, person.email, "de-dentro-da-vps")).toBe(1);
    expect(await checkMemberPassword(app, person.userId, "de-dentro-da-vps", textCompare)).toBe(true);
    expect(await resetAccountPassword(app, `ninguem-${randomUUID()}@example.test`, "x")).toBeNull();
  });

  it("refuses a second account for the same e-mail, in any case of letters", async () => {
    const org = await createOrganization(app, "E-mail único");
    const person = await member(org, "operator");
    expect(await withSystem(app, (q) => createMember(q, { organizationId: org, email: person.email.toUpperCase(), name: "Outra", passwordHash: "x", role: "owner" }))).toBeNull();
  });
});

// A atualização de uma instalação de antes desta fatia, com dados (critério 4 do desenho do R8).
// O banco é próprio: aplica as migrations anteriores a esta, grava o que uma instalação real tem e
// aplica o resto por cima, com o executor de verdade.
describe("deleteAccountIfOrphan (removing the last link)", () => {
  const accountRow = (accountId: string) => withSystem(app, (q) => q.one("select id from accounts where id = $1", [accountId]));
  const dropLink = (organizationId: string, userId: string) => withOrg(app, organizationId, (q) => q.exec("delete from users where id = $1", [userId]));

  it("deletes the account only when no link is left, of any kind", async () => {
    const org = await createOrganization(app, "Órfã");
    const other = await createOrganization(app, "Órfã, outra");
    const person = await member(org, "operator");
    // O segundo vínculo é `support`: ele também segura a conta.
    await withOrg(app, other, (q) =>
      q.exec("insert into users (organization_id, account_id, kind, email, name, role) values ($1, $2, 'support', $3, 'Suporte', 'operator')", [
        other,
        person.accountId,
        `support-${randomUUID()}@example.test`,
      ]),
    );

    expect(await deleteAccountIfOrphan(app, person.accountId, now)).toBe(false);
    await dropLink(org, person.userId);
    expect(await deleteAccountIfOrphan(app, person.accountId, now)).toBe(false);
    expect(await accountRow(person.accountId)).not.toBeNull();

    await withOrg(app, other, (q) => q.exec("delete from users where account_id = $1", [person.accountId]));
    expect(await deleteAccountIfOrphan(app, person.accountId, now)).toBe(true);
    expect(await accountRow(person.accountId)).toBeNull();
    expect(await deleteAccountIfOrphan(app, person.accountId, now)).toBe(false);
  });

  it("records the loss of the installation mark in the installation audit", async () => {
    const org = await createOrganization(app, "Órfã com marca");
    const person = await member(org, "owner");
    expect(await grantInstallationAdmin(app, person.email, now)).toMatchObject({ granted: true });
    await dropLink(org, person.userId);

    expect(await deleteAccountIfOrphan(app, person.accountId, now, { organizationId: org })).toBe(true);
    const events = await withSystem(app, (q) =>
      q.many<{ kind: string; source: string }>("select kind, payload->>'source' as source from installation_events where payload->>'account_id' = $1 order by at, id", [person.accountId]),
    );
    expect(events).toEqual([
      { kind: "installation_admin_granted", source: "command" },
      { kind: "installation_admin_revoked", source: "member_removed" },
    ]);
  });
});

describe("upgrade over a database with data", () => {
  const roleUrl = (variable: string, dbName: string): string => {
    const url = new URL(process.env[variable] ?? "");
    url.pathname = `/${dbName}`;
    return url.toString();
  };

  async function upgradedInstallation(organizations: number): Promise<{ db: Db; product: Db; dbName: string; dir: string; orgs: string[]; people: Record<string, string>; hash: string }> {
    const dbName = `accounts_upgrade_${randomUUID().replaceAll("-", "")}`;
    await owner.pool.query(`create database ${dbName}`);
    const db = createDb(roleUrl("TEST_MIGRATION_DATABASE_URL", dbName));
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-before-accounts-"));
    for (const name of (await readdir(REAL_MIGRATIONS)).filter((file) => file < THIS_MIGRATION)) await copyFile(path.join(REAL_MIGRATIONS, name), path.join(dir, name));
    await runMigrations(db, dir);

    const hash = await hashPassword("senha-de-antes");
    const orgs: string[] = [];
    const people: Record<string, string> = {};
    for (let i = 0; i < organizations; i++) {
      const org = (await db.pool.query<{ id: string }>("insert into organizations (name, created_at) values ($1, $2) returning id", [`Cliente ${i}`, new Date(now.getTime() + i * 60_000)])).rows[0]?.id ?? "";
      orgs.push(org);
      for (const role of ["owner", "admin", "operator"] as const) {
        const email = `${role}-${i}-${randomUUID()}@example.test`;
        const user = (await db.pool.query<{ id: string }>("insert into users (organization_id, email, name, password_hash, role) values ($1, $2, $3, $4, $5) returning id", [org, email, `${role} ${i}`, hash, role]))
          .rows[0]?.id;
        people[`${role}${i}`] = email;
        await db.pool.query("insert into sessions (organization_id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)", [org, user, randomUUID(), new Date(now.getTime() + 86_400_000)]);
      }
    }
    await runMigrations(db, REAL_MIGRATIONS);
    const product = createDb(roleUrl("TEST_DATABASE_URL", dbName), roleUrl("TEST_SYSTEM_DATABASE_URL", dbName));
    return { db, product, dbName, dir, orgs, people, hash };
  }

  async function drop(installation: { db: Db; product: Db; dbName: string; dir: string }): Promise<void> {
    await installation.product.close();
    await installation.db.close();
    await owner.pool.query(`drop database ${installation.dbName} with (force)`);
    await rm(installation.dir, { recursive: true });
  }

  it("lets the same person in, with the same role, in the same organization, and keeps owner and admin updating, without any manual step", async () => {
    const installation = await upgradedInstallation(1);
    try {
      const { product, orgs, people, db } = installation;
      for (const role of ["owner", "admin", "operator"] as const) {
        const account = await findLoginAccount(product, people[`${role}0`] ?? "");
        expect(account?.member, role).toMatchObject({ organizationId: orgs[0], role, name: `${role} 0` });
        expect(await verifyPassword("senha-de-antes", account?.passwordHash ?? ""), role).toBe(true);
        expect(await isInstallationAdmin(product, account?.accountId ?? ""), role).toBe(role !== "operator");
      }
      // A fundadora é a única organização; a lista não ficou explícita e ninguém recebeu marca.
      const settings = await db.pool.query<{ key: string; value: unknown }>("select key, value from installation_settings order by key");
      expect(settings.rows).toEqual([{ key: FOUNDING_ORGANIZATION_KEY, value: orgs[0] }]);
      expect((await db.pool.query("select 1 from accounts where installation_admin_at is not null")).rows).toEqual([]);
      // As sessões abertas continuam valendo, agora com a conta.
      const sessions = await db.pool.query<{ ok: boolean }>("select s.account_id = u.account_id as ok from sessions s join users u on u.id = s.user_id");
      expect(sessions.rows).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
      // A senha saiu do vínculo, que a organização lê.
      await expect(withOrg(product, orgs[0] ?? "", (q) => q.many("select password_hash from users"))).rejects.toMatchObject({ code: "42703" });
      await expect(withOrg(product, orgs[0] ?? "", (q) => q.many("select password_hash from accounts"))).rejects.toMatchObject({ code: "42501" });
    } finally {
      await drop(installation);
    }
  });

  it("with more than one organization already, makes the list explicit and marks the active owners of the oldest one", async () => {
    const installation = await upgradedInstallation(2);
    try {
      const { product, people, db, orgs } = installation;
      const accountOf = async (key: string): Promise<string> => (await findLoginAccount(product, people[key] ?? ""))?.accountId ?? "";
      expect(await isInstallationAdmin(product, await accountOf("owner0"))).toBe(true);
      expect(await isInstallationAdmin(product, await accountOf("admin0"))).toBe(false);
      expect(await isInstallationAdmin(product, await accountOf("owner1"))).toBe(false);
      expect(await isInstallationAdmin(product, await accountOf("admin1"))).toBe(false);
      const explicit = await db.pool.query("select 1 from installation_settings where key = $1", [ADMINS_EXPLICIT_KEY]);
      expect(explicit.rows).toHaveLength(1);
      const events = await db.pool.query("select kind, organization_id, payload->>'source' as source from installation_events");
      expect(events.rows).toEqual([{ kind: "installation_admin_granted", organization_id: orgs[0], source: "migration" }]);
    } finally {
      await drop(installation);
    }
  });
});
