// Os limites com que uma organização nova nasce (R8, seção 3.5, fatia 7d): `defaults.limits` em
// `installation_settings`, COPIADO para a linha de `organization_limits` da nova na criação. Sem padrão
// gravado, a nova nasce sem limite e com a saída travada. A fundadora e as que já existem não mudam.
import { randomUUID } from "node:crypto";
import { withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as readDefaults, PUT as writeDefaults } from "./installation/defaults/limits/route";
import { GET as listOrganizations, POST as addOrganization } from "./installation/organizations/route";
import { PUT as writePolicy } from "./outbound-policy/route";

const panel = startPanel();
const { owner } = openTestDbs();

const clearInstallationState = (): Promise<void> => clear(owner);
beforeEach(clearInstallationState);
afterAll(async () => {
  await clearInstallationState();
  await owner.close();
  await panel.close();
});

const FOUNDING_KEY = "installation.founding_organization_id";
const turnOn = { enabled: true, purpose: "Confirmar consultas marcadas pelos pacientes", legalBasis: "Consentimento no cadastro" };
type Limits = { maxTrunks: number | null; maxAgents: number | null; monthlySpendCapCents: number | null; outboundAllowed: boolean };

const accountOf = async (userId: string): Promise<string> =>
  (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [userId])))?.id ?? "";
const system = <T>(sql: string, params: unknown[] = []): Promise<T[]> => withSystem(panel.app, (q) => q.many<T & Record<string, unknown>>(sql, params));
const limitsRow = async (org: string): Promise<Limits | null> =>
  (
    await system<Limits>(
      `select max_trunks as "maxTrunks", max_agents as "maxAgents", monthly_spend_cap_cents as "monthlySpendCapCents", outbound_allowed as "outboundAllowed"
         from organization_limits where organization_id = $1`,
      [org],
    )
  )[0] ?? null;
const storedDefault = async (): Promise<number> => (await system("select 1 as one from installation_settings where key = 'defaults.limits'")).length;

/** A fundadora, com uma pessoa dona que administra a instalação, e outra organização que já existe. */
async function scene() {
  const founding = await createOrganization(panel.app, `Fundadora ${randomUUID().slice(0, 8)}`);
  await system("insert into installation_settings (key, value) values ($1, to_jsonb($2::text)) returning key", [FOUNDING_KEY, founding]);
  const admin = await createUser(panel.app, founding, "owner");
  await withSystem(panel.app, async (q) => q.exec("update accounts set installation_admin_at = now() where id = $1", [await accountOf(admin.id)]));
  const existing = await createOrganization(panel.app, `Já existe ${randomUUID().slice(0, 8)}`);
  /** Cria pela área da instalação, confirmando a lista que a tela mostraria. */
  const create = async (name = `Nova ${randomUUID().slice(0, 8)}`): Promise<string> => {
    const { creation } = (await call(listOrganizations, { cookie: admin.cookie })).data as { creation: { granted: { accountId: string }[]; losing: { accountId: string }[] } };
    const shown = { granted: creation.granted.map((p) => p.accountId), losing: creation.losing.map((p) => p.accountId) };
    const created = await call(addOrganization, { method: "POST", cookie: admin.cookie, body: { name, shown, keep: [] } });
    expect(created.status).toBe(200);
    return (created.data as { organizationId: string }).organizationId;
  };
  const setDefaults = (body: Record<string, unknown>) => call(writeDefaults, { method: "PUT", cookie: admin.cookie, body });
  return { founding, admin, existing, create, setDefaults };
}

describe("the limits a new organization starts with", () => {
  it("T1: without a stored default, the new one starts with outbound locked and no other limit, and its policy PUT gets 409", async () => {
    const s = await scene();
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ maxTrunks: null, maxAgents: null, monthlySpendCapCents: null, outboundAllowed: false });
    const org = await s.create();
    expect(await limitsRow(org)).toEqual({ maxTrunks: null, maxAgents: null, monthlySpendCapCents: null, outboundAllowed: false });
    const person = await createUser(panel.app, org, "owner");
    expect(await call(writePolicy, { method: "PUT", cookie: person.cookie, body: turnOn })).toMatchObject({ status: 409, code: "outbound_not_allowed" });
    // Nada foi gravado no padrão só por ler ou criar.
    expect(await storedDefault()).toBe(0);
  });

  it("T2: with a stored default, the new one starts with the four values; changing the default later does not change its row", async () => {
    const s = await scene();
    const chosen = { maxTrunks: 2, maxAgents: 5, monthlySpendCapCents: 5000, outboundAllowed: true };
    const saved = await s.setDefaults(chosen);
    expect(saved).toMatchObject({ status: 200, data: chosen });
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual(chosen);
    const org = await s.create();
    expect(await limitsRow(org)).toEqual(chosen);

    expect((await s.setDefaults({ maxTrunks: 9, maxAgents: null, monthlySpendCapCents: null, outboundAllowed: false })).status).toBe(200);
    expect(await limitsRow(org)).toEqual(chosen);
    const later = await s.create();
    expect(await limitsRow(later)).toEqual({ maxTrunks: 9, maxAgents: null, monthlySpendCapCents: null, outboundAllowed: false });
  });

  it("T3: the founding organization and one that already existed keep no row, before and after a default is stored and an organization is created", async () => {
    const s = await scene();
    await s.setDefaults({ maxTrunks: 1, maxAgents: 1, monthlySpendCapCents: 0, outboundAllowed: false });
    await s.create();
    expect(await limitsRow(s.founding)).toBeNull();
    expect(await limitsRow(s.existing)).toBeNull();
  });

  it("T4: the application role neither reads nor writes defaults.limits", async () => {
    const s = await scene();
    await s.setDefaults({ maxTrunks: 3, maxAgents: null });
    for (const sql of [
      "select value from installation_settings where key = 'defaults.limits'",
      `insert into installation_settings (key, value) values ('defaults.limits', '{"outboundAllowed": true}') on conflict (key) do update set value = excluded.value`,
      `update installation_settings set value = '{"outboundAllowed": true}' where key = 'defaults.limits'`,
      "delete from installation_settings where key = 'defaults.limits'",
    ]) {
      await expect(withOrg(panel.app, s.existing, (q) => q.exec(sql))).rejects.toMatchObject({ code: "42501" });
    }
    const privileges = await system<Record<string, boolean>>(
      `select ${["select", "insert", "update", "delete"].map((p) => `has_table_privilege('deskvoice_app', 'public.installation_settings', '${p}') as "${p}"`).join(", ")}`,
    );
    expect(privileges).toEqual([{ select: false, insert: false, update: false, delete: false }]);
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toMatchObject({ maxTrunks: 3, outboundAllowed: false });
  });

  it("records installation_setting_changed with the key, before and after only of what changed, and records nothing when nothing changed", async () => {
    const s = await scene();
    await s.setDefaults({ maxTrunks: 2, maxAgents: null, outboundAllowed: false });
    await s.setDefaults({ maxTrunks: 2, maxAgents: null, outboundAllowed: true, monthlySpendCapCents: 100 });
    await s.setDefaults({ maxTrunks: 2, maxAgents: null });
    const events = await system<{ actor: string; organization: string | null; payload: unknown }>(
      "select actor_account_id as actor, organization_id as organization, payload, at from installation_events where kind = 'installation_setting_changed' and payload->>'key' = 'defaults.limits' and at = $1 order by id",
      [NOW],
    );
    const actor = await accountOf(s.admin.id);
    expect(events.slice(-2).map(({ actor, organization, payload }) => ({ actor, organization, payload }))).toEqual([
      { actor, organization: null, payload: { key: "defaults.limits", before: { max_trunks: null }, after: { max_trunks: 2 } } },
      { actor, organization: null, payload: { key: "defaults.limits", before: { outbound_allowed: false, monthly_spend_cap_cents: null }, after: { outbound_allowed: true, monthly_spend_cap_cents: 100 } } },
    ]);
  });

  it("refuses what the organization limits PUT refuses, and an unknown field, without storing anything", async () => {
    const s = await scene();
    for (const body of [
      { maxTrunks: 1, maxAgents: 1, outboundAllowed: null },
      { maxTrunks: 1, maxAgents: 1, monthlySpendCapCents: -1 },
      { maxTrunks: 1, maxAgents: 1, monthlySpendCapCents: 1.5 },
      { maxTrunks: -1, maxAgents: 1 },
      { maxTrunks: 1.5, maxAgents: 1 },
      { maxTrunks: 1, maxAgents: 1, nope: 1 },
      { maxAgents: 1 },
    ]) {
      expect(await s.setDefaults(body)).toMatchObject({ status: 400, code: "validation_error" });
    }
    expect(await storedDefault()).toBe(0);
  });

  it("a key written by hand with a strange field falls back to the factory value for that field, never to outbound allowed", async () => {
    const s = await scene();
    await system("insert into installation_settings (key, value) values ('defaults.limits', $1) returning key", [{ maxTrunks: 4, maxAgents: -1, monthlySpendCapCents: "100", outboundAllowed: "yes" }]);
    const factoryForStrange = { maxTrunks: 4, maxAgents: null, monthlySpendCapCents: null, outboundAllowed: false };
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual(factoryForStrange);
    expect(await limitsRow(await s.create())).toEqual(factoryForStrange);
  });

  it("a key written by hand above the ceiling falls back to the factory value for that field, and the organization is still created", async () => {
    const s = await scene();
    // 2^53 - 1 de propósito: acima disso o JSON.parse do node já perde a precisão.
    await system("insert into installation_settings (key, value) values ('defaults.limits', $1) returning key", [
      { maxTrunks: 2_147_483_648, maxAgents: 3, monthlySpendCapCents: Number.MAX_SAFE_INTEGER, outboundAllowed: true },
    ]);
    const bornWith = { maxTrunks: null, maxAgents: 3, monthlySpendCapCents: null, outboundAllowed: true };
    // A criação primeiro: sem o teto na leitura, é ela que cai (o insert estoura o integer).
    expect(await limitsRow(await s.create())).toEqual(bornWith);
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual(bornWith);
  });

  it("the ceiling itself is a limit, one above it is not", async () => {
    const s = await scene();
    await system("insert into installation_settings (key, value) values ('defaults.limits', $1) returning key", [
      { maxTrunks: 1_000_000, maxAgents: 1_000_001, monthlySpendCapCents: 2_147_483_647, outboundAllowed: false },
    ]);
    const bornWith = { maxTrunks: 1_000_000, maxAgents: null, monthlySpendCapCents: 2_147_483_647, outboundAllowed: false };
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual(bornWith);
    expect(await limitsRow(await s.create())).toEqual(bornWith);
  });

  it("only who administers the installation reads or changes the default", async () => {
    const s = await scene();
    const other = await createUser(panel.app, s.existing, "owner");
    expect(await call(readDefaults, { cookie: other.cookie })).toMatchObject({ status: 403, code: "forbidden" });
    expect(await call(writeDefaults, { method: "PUT", cookie: other.cookie, body: { maxTrunks: 1, maxAgents: 1, outboundAllowed: true } })).toMatchObject({ status: 403, code: "forbidden" });
    expect(await storedDefault()).toBe(0);
  });
});
