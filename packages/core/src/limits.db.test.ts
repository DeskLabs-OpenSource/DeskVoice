import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs, waitFor } from "../test/helpers";
import { createAccount } from "./accounts";
import { assertBelowLimit, organizationLimits, setOrganizationLimits, type BelowLimitResult } from "./limits";
import { withOrg, withSystem } from "./with-org";

// Seção 3.4 do desenho do R8, fatia 7a: o limite de linhas e de agentes por organização.
const { app, owner } = openTestDbs();
const NOW = new Date("2026-03-01T15:00:00.000Z");

// Quem muda os limites: uma conta, como a de quem administra a instalação.
let actor: string;
beforeAll(async () => {
  actor = (await withSystem(app, (q) => createAccount(q, { email: `limits-${randomUUID()}@example.test`, passwordHash: "x" }))) ?? "";
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

const addAgent = (q: { exec(sql: string, params?: unknown[]): Promise<number>; organizationId: string }) =>
  q.exec("insert into agents (organization_id, name, engine) values ($1, 'Agente', 'simulated')", [q.organizationId]);
const agents = async (organizationId: string): Promise<number> =>
  (await owner.pool.query<{ n: number }>("select count(*)::int as n from agents where organization_id = $1", [organizationId])).rows[0]?.n ?? -1;
const waitingOnLock = async (): Promise<boolean> =>
  ((await owner.pool.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")).rows[0]?.n ?? 0) > 0;

describe("assertBelowLimit", () => {
  it("passes without a row, and reads no limit from it", async () => {
    const org = await createOrganization(app, `limits-${randomUUID()}`);
    await withOrg(app, org, async (q) => {
      expect(await organizationLimits(q)).toEqual({ monthlySpendCapCents: null, maxTrunks: null, maxAgents: null, outboundAllowed: true });
      expect(await assertBelowLimit(q, "agents")).toEqual({ ok: true });
      expect(await assertBelowLimit(q, "trunks")).toEqual({ ok: true });
    });
  });

  it("refuses at the limit and passes below it", async () => {
    const org = await createOrganization(app, `limits-${randomUUID()}`);
    expect(await setOrganizationLimits(app, org, { maxAgents: 2 }, actor, NOW)).toMatchObject({ ok: true });
    await withOrg(app, org, async (q) => {
      expect(await assertBelowLimit(q, "agents")).toEqual({ ok: true });
      await addAgent(q);
      expect(await assertBelowLimit(q, "agents")).toEqual({ ok: true });
      await addAgent(q);
      expect(await assertBelowLimit(q, "agents")).toEqual({ ok: false, kind: "agents", count: 2, limit: 2 });
      // A outra coisa com limite não é afetada.
      expect(await assertBelowLimit(q, "trunks")).toEqual({ ok: true });
    });
  });

  it("makes the second of two simultaneous creations wait for the first and count it", async () => {
    const org = await createOrganization(app, `limits-${randomUUID()}`);
    await setOrganizationLimits(app, org, { maxAgents: 1 }, actor, NOW);
    let second: Promise<BelowLimitResult> | undefined;
    let settled = false;
    await withOrg(app, org, async (q) => {
      expect(await assertBelowLimit(q, "agents")).toEqual({ ok: true });
      // A segunda criação começa com a primeira ainda aberta, antes do `insert` dela.
      second = withOrg(app, org, async (other) => {
        const result = await assertBelowLimit(other, "agents");
        if (result.ok) await addAgent(other);
        return result;
      }).finally(() => {
        settled = true;
      });
      // Com a trava, a segunda espera na linha da organização; sem ela, termina sozinha e entra.
      await waitFor(() => settled, "the second creation", 300).catch(() => undefined);
      if (!settled) {
        const deadline = performance.now() + 5000;
        while (!(await waitingOnLock()) && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await addAgent(q);
    });
    expect(await second).toEqual({ ok: false, kind: "agents", count: 1, limit: 1 });
    expect(await agents(org)).toBe(1);
  });

  it("refuses a transaction that is not of one organization", async () => {
    await expect(withSystem(app, (q) => assertBelowLimit(q, "agents"))).rejects.toThrow(/withOrg/);
  });
});

describe("setOrganizationLimits", () => {
  it("records only what changed, and nothing when nothing changed", async () => {
    const org = await createOrganization(app, `limits-${randomUUID()}`);
    await setOrganizationLimits(app, org, { maxTrunks: 3 }, actor, NOW);
    await setOrganizationLimits(app, org, { maxTrunks: 3, maxAgents: null }, actor, NOW);
    await setOrganizationLimits(app, org, { maxTrunks: null }, actor, NOW);
    const events = await owner.pool.query("select payload from installation_events where kind = 'organization_limits_changed' and organization_id = $1 order by id", [org]);
    expect(events.rows.map((row) => row.payload)).toEqual([
      { before: { max_trunks: null }, after: { max_trunks: 3 } },
      { before: { max_trunks: 3 }, after: { max_trunks: null } },
    ]);
    // A coluna da saída, que esta fatia não grava, segue no padrão.
    expect((await owner.pool.query("select max_trunks, max_agents, outbound_allowed, monthly_spend_cap_cents from organization_limits where organization_id = $1", [org])).rows).toEqual([
      { max_trunks: null, max_agents: null, outbound_allowed: true, monthly_spend_cap_cents: null },
    ]);
  });

  it("refuses an unknown organization and a value that is not a limit", async () => {
    expect(await setOrganizationLimits(app, randomUUID(), { maxAgents: 1 }, actor, NOW)).toEqual({ ok: false, reason: "not_found" });
    const org = await createOrganization(app, `limits-${randomUUID()}`);
    for (const value of [-1, 1.5, Number.NaN]) {
      await expect(setOrganizationLimits(app, org, { maxAgents: value }, actor, NOW)).rejects.toThrow(/non-negative integer/);
    }
  });
});
