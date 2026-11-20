// O fuso com que uma organização nova nasce (R8, seção 3.5, fatia 8a): `defaults.timezone` em
// `installation_settings`, COPIADO para `outbound_policy.timezone` da nova na criação. É por esse fuso
// que se conta o mês de custo (`costTotal`). Sem padrão, a nova nasce como sempre (America/Sao_Paulo).
// A fundadora e as que já existem não mudam, nem quando o padrão muda.
import { randomUUID } from "node:crypto";
import { costTotal, organizationDays, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as readDefaults, PUT as writeDefaults } from "./installation/defaults/organization/route";
import { GET as listOrganizations, POST as addOrganization } from "./installation/organizations/route";

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

const accountOf = async (userId: string): Promise<string> =>
  (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [userId])))?.id ?? "";
const system = <T>(sql: string, params: unknown[] = []): Promise<T[]> => withSystem(panel.app, (q) => q.many<T & Record<string, unknown>>(sql, params));
/** O fuso gravado na política de saída da organização, ou `null` sem linha. */
const zoneOf = async (org: string): Promise<string | null> => (await system<{ timezone: string }>("select timezone from outbound_policy where organization_id = $1", [org]))[0]?.timezone ?? null;
const storedDefault = async (): Promise<unknown[]> => (await system<{ value: unknown }>("select value from installation_settings where key = 'defaults.timezone'")).map((row) => row.value);

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
  const setDefault = (body: Record<string, unknown>) => call(writeDefaults, { method: "PUT", cookie: admin.cookie, body });
  return { founding, admin, existing, create, setDefault };
}

describe("the time zone a new organization starts with", () => {
  it("Z1: without a stored default, the new one starts in America/Sao_Paulo, as before, and nothing is stored", async () => {
    const s = await scene();
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ timezone: null });
    expect(await zoneOf(await s.create())).toBe("America/Sao_Paulo");
    expect(await storedDefault()).toEqual([]);
  });

  it("Z2: with a stored default, the new one starts in it; changing the default later does not change it, nor the founding or existing ones", async () => {
    const s = await scene();
    const foundingBefore = await zoneOf(s.founding);
    const existingBefore = await zoneOf(s.existing);
    expect(await s.setDefault({ timezone: "Asia/Tokyo" })).toMatchObject({ status: 200, data: { timezone: "Asia/Tokyo" } });
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ timezone: "Asia/Tokyo" });
    const org = await s.create();
    expect(await zoneOf(org)).toBe("Asia/Tokyo");

    expect((await s.setDefault({ timezone: "Europe/Lisbon" })).status).toBe(200);
    expect(await zoneOf(org)).toBe("Asia/Tokyo");
    expect(await zoneOf(await s.create())).toBe("Europe/Lisbon");

    // Tirar o padrão: a próxima volta a nascer como sempre, e a que já nasceu continua no dela.
    expect(await s.setDefault({ timezone: null })).toMatchObject({ status: 200, data: { timezone: null } });
    expect(await zoneOf(await s.create())).toBe("America/Sao_Paulo");
    expect(await zoneOf(org)).toBe("Asia/Tokyo");
    expect(await zoneOf(s.founding)).toBe(foundingBefore);
    expect(await zoneOf(s.existing)).toBe(existingBefore);
  });

  it("Z3: an unknown time zone is refused with 400, as the outbound policy refuses it, and nothing is stored", async () => {
    const s = await scene();
    for (const body of [{ timezone: "Mars/Olympus_Mons" }, { timezone: "" }, { timezone: "america/sao paulo" }, { timezone: 3 }, {}, { timezone: "Asia/Tokyo", language: "en" }]) {
      expect(await s.setDefault(body)).toMatchObject({ status: 400, code: "validation_error" });
    }
    expect(await storedDefault()).toEqual([]);
  });

  it("Z4: the cost month of the new one (costTotal) is counted in the copied time zone, and changing the default does not move it", async () => {
    const s = await scene();
    await s.setDefault({ timezone: "Asia/Tokyo" });
    const tokyo = await s.create();
    await s.setDefault({ timezone: null });
    const saoPaulo = await s.create();
    // 30/11 20:00 UTC: já é 1/12 em Tóquio e ainda é 30/11 em São Paulo.
    const at = new Date("2026-11-30T20:00:00.000Z");
    for (const org of [tokyo, saoPaulo]) {
      await withOrg(panel.app, org, async (q) => {
        const created = await q.one<{ id: string }>("insert into calls (organization_id, direction, channel, status, started_at) values ($1, 'inbound', 'simulated', 'completed', $2) returning id", [org, at]);
        await q.exec(
          "insert into usage_ledger (organization_id, call_id, engine, cost_cents, cost_microcents, cost_estimated, cost_measured, at) values ($1, $2, 'simulated', 1, 1000000, false, true, $3)",
          [org, created?.id, at],
        );
      });
    }
    const december = { from: "2026-12-01", to: "2026-12-31" };
    const monthOf = (org: string) =>
      withOrg(panel.app, org, async (q) => ({ month: (await organizationDays(q, at)).monthStart, december: (await costTotal(q, december)).microcents }));
    expect(await monthOf(tokyo)).toEqual({ month: "2026-12-01", december: 1_000_000 });
    expect(await monthOf(saoPaulo)).toEqual({ month: "2026-11-01", december: 0 });

    // O padrão lido ao vivo moveria o mês de quem já existe. Não move.
    await s.setDefault({ timezone: "America/Sao_Paulo" });
    expect(await monthOf(tokyo)).toEqual({ month: "2026-12-01", december: 1_000_000 });
    await s.setDefault({ timezone: "Asia/Tokyo" });
    expect(await monthOf(saoPaulo)).toEqual({ month: "2026-11-01", december: 0 });
  });

  it("records installation_setting_changed with the key, before and after, and records nothing when nothing changed", async () => {
    const s = await scene();
    await s.setDefault({ timezone: "Asia/Tokyo" });
    await s.setDefault({ timezone: "Asia/Tokyo" });
    await s.setDefault({ timezone: null });
    await s.setDefault({ timezone: null });
    const events = await system<{ actor: string; organization: string | null; payload: unknown }>(
      "select actor_account_id as actor, organization_id as organization, payload from installation_events where kind = 'installation_setting_changed' and payload->>'key' = 'defaults.timezone' and at = $1 order by id",
      [NOW],
    );
    const actor = await accountOf(s.admin.id);
    expect(events.slice(-2)).toEqual([
      { actor, organization: null, payload: { key: "defaults.timezone", before: null, after: "Asia/Tokyo" } },
      { actor, organization: null, payload: { key: "defaults.timezone", before: "Asia/Tokyo", after: null } },
    ]);
  });

  it("a key written by hand with something that is not a known time zone counts as no default", async () => {
    const s = await scene();
    await system("insert into installation_settings (key, value) values ('defaults.timezone', to_jsonb('Mars/Olympus_Mons'::text)) returning key");
    expect((await call(readDefaults, { cookie: s.admin.cookie })).data).toEqual({ timezone: null });
    expect(await zoneOf(await s.create())).toBe("America/Sao_Paulo");
  });

  it("only who administers the installation reads or changes the default", async () => {
    const s = await scene();
    const other = await createUser(panel.app, s.existing, "owner");
    expect(await call(readDefaults, { cookie: other.cookie })).toMatchObject({ status: 403, code: "forbidden" });
    expect(await call(writeDefaults, { method: "PUT", cookie: other.cookie, body: { timezone: "Asia/Tokyo" } })).toMatchObject({ status: 403, code: "forbidden" });
    expect(await storedDefault()).toEqual([]);
  });
});
