// Os limites por organização (R8, seção 3.4, fatia 7a): quantas linhas telefônicas e quantos agentes
// cada organização cria. Quem administra a instalação define; a organização só lê. A conferência é
// na rota de criação, na mesma transação do `insert`, com a trava da organização.
import { randomUUID } from "node:crypto";
import { withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { PATCH as editAgent } from "./agents/[id]/route";
import { POST as createAgent } from "./agents/route";
import { GET as readLimits, PUT as writeLimits } from "./installation/organizations/[id]/limits/route";
import { GET as ownLimits } from "./organization-limits/route";
import { POST as createTrunk } from "./trunks/route";

const panel = startPanel();
const { owner } = openTestDbs();

const clearInstallationState = (): Promise<void> => clear(owner);
beforeEach(async () => {
  await clearInstallationState();
  panel.voice.respond = () => Response.json({ applied: true, detail: "1 line(s) written, reloaded and listed by the telephony server.", skipped: [] });
});
afterAll(async () => {
  await clearInstallationState();
  await owner.close();
  await panel.close();
});

const accountOf = async (userId: string): Promise<string> =>
  (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [userId])))?.id ?? "";

/** Uma organização com uma pessoa dona, e outra organização de onde alguém administra a instalação. */
async function scene() {
  const org = await createOrganization(panel.app, `Limites ${randomUUID().slice(0, 8)}`);
  const person = await createUser(panel.app, org, "owner");
  const home = await createOrganization(panel.app, `Instalação ${randomUUID().slice(0, 8)}`);
  const admin = await createUser(panel.app, home, "owner");
  await withSystem(panel.app, async (q) => q.exec("update accounts set installation_admin_at = now() where id = $1", [await accountOf(admin.id)]));
  const setLimits = (body: { maxTrunks: number | null; maxAgents: number | null }) => call(writeLimits, { method: "PUT", cookie: admin.cookie, params: { id: org }, body });
  const trunk = () => call(createTrunk, { method: "POST", cookie: person.cookie, body: { name: "Linha", host: "203.0.113.70", authMode: "ip" } });
  const agent = () => call(createAgent, { method: "POST", cookie: person.cookie, body: { name: "Recepção", engine: "simulated" } });
  const count = async (table: "trunks" | "agents"): Promise<number> =>
    (await withSystem(panel.app, (q) => q.one<{ n: number }>(`select count(*)::int as n from ${table} where organization_id = $1`, [org])))?.n ?? -1;
  return { org, person, home, admin, setLimits, trunk, agent, count };
}

describe("organization limits", () => {
  it("refuses the trunk and the agent beyond the limit, with the count and the limit, and creates nothing", async () => {
    const s = await scene();
    expect((await s.setLimits({ maxTrunks: 2, maxAgents: 2 })).status).toBe(200);
    for (let i = 0; i < 2; i++) {
      expect((await s.trunk()).status).toBe(200);
      expect((await s.agent()).status).toBe(200);
    }
    const trunk = await s.trunk();
    expect(trunk).toMatchObject({ status: 409, code: "organization_limit_reached" });
    expect(trunk.message).toBe("This organization already has 2 phone lines; the limit set by the installation administration is 2.");
    expect(JSON.parse(trunk.text).error.detail).toEqual({ kind: "trunks", count: 2, limit: 2 });
    const agent = await s.agent();
    expect(agent).toMatchObject({ status: 409, code: "organization_limit_reached" });
    expect(JSON.parse(agent.text).error.detail).toEqual({ kind: "agents", count: 2, limit: 2 });
    expect(await s.count("trunks")).toBe(2);
    expect(await s.count("agents")).toBe(2);
  });

  it("lets only one of two simultaneous creations take the last place", async () => {
    const s = await scene();
    await s.setLimits({ maxTrunks: null, maxAgents: 1 });
    const results = await Promise.all([s.agent(), s.agent()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.code).toBe("organization_limit_reached");
    expect(await s.count("agents")).toBe(1);
  });

  it("keeps what exists when the limit goes below it: editing works, creating is refused", async () => {
    const s = await scene();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(((await s.agent()).data as { id: string }).id);
    await s.setLimits({ maxTrunks: null, maxAgents: 1 });
    expect(await s.count("agents")).toBe(3);
    const edited = await call(editAgent, { method: "PATCH", cookie: s.person.cookie, params: { id: ids[0] ?? "" }, body: { name: "Recepção nova", enabled: false } });
    expect(edited.status).toBe(200);
    expect((await s.agent()).code).toBe("organization_limit_reached");
    expect(await s.count("agents")).toBe(3);
  });

  it("removes the limit with null: creating works again", async () => {
    const s = await scene();
    await s.setLimits({ maxTrunks: 0, maxAgents: 0 });
    expect((await s.trunk()).code).toBe("organization_limit_reached");
    expect((await s.agent()).code).toBe("organization_limit_reached");
    await s.setLimits({ maxTrunks: null, maxAgents: null });
    expect((await s.trunk()).status).toBe(200);
    expect((await s.agent()).status).toBe(200);
  });

  it("does not limit another organization", async () => {
    const s = await scene();
    await s.setLimits({ maxTrunks: 0, maxAgents: 0 });
    const other = await createUser(panel.app, s.home, "owner");
    expect((await call(createTrunk, { method: "POST", cookie: other.cookie, body: { name: "Linha", host: "203.0.113.71", authMode: "ip" } })).status).toBe(200);
    expect((await call(createAgent, { method: "POST", cookie: other.cookie, body: { name: "Recepção", engine: "simulated" } })).status).toBe(200);
  });

  it("records the change in the installation audit, only with what changed, and shows the usage", async () => {
    const s = await scene();
    await s.trunk();
    expect((await s.setLimits({ maxTrunks: 2, maxAgents: 5 })).data).toEqual({ maxTrunks: 2, maxAgents: 5 });
    expect((await s.setLimits({ maxTrunks: 2, maxAgents: null })).status).toBe(200);
    // Nada mudou: nada se grava.
    expect((await s.setLimits({ maxTrunks: 2, maxAgents: null })).status).toBe(200);
    const events = await withSystem(panel.app, (q) =>
      q.many<{ actor: string; payload: unknown }>(
        "select actor_account_id as actor, payload from installation_events where kind = 'organization_limits_changed' and organization_id = $1 order by id",
        [s.org],
      ),
    );
    const actor = await accountOf(s.admin.id);
    expect(events).toEqual([
      { actor, payload: { before: { max_trunks: null, max_agents: null }, after: { max_trunks: 2, max_agents: 5 } } },
      { actor, payload: { before: { max_agents: 5 }, after: { max_agents: null } } },
    ]);
    const read = await call(readLimits, { cookie: s.admin.cookie, params: { id: s.org } });
    expect(read.data).toEqual({ maxTrunks: 2, maxAgents: null, usage: { trunks: 1, agents: 0 } });
    // A organização lê os próprios, só para leitura.
    expect((await call(ownLimits, { cookie: s.person.cookie })).data).toEqual({ maxTrunks: 2, maxAgents: null, usage: { trunks: 1, agents: 0 } });
  });

  it("refuses the limits routes to a session without the installation role, an unknown organization and an unknown field", async () => {
    const s = await scene();
    for (const cookie of [s.person.cookie, (await createUser(panel.app, s.home, "admin")).cookie]) {
      expect((await call(readLimits, { cookie, params: { id: s.org } })).status).toBe(403);
      expect((await call(writeLimits, { method: "PUT", cookie, params: { id: s.org }, body: { maxTrunks: 9, maxAgents: 9 } })).status).toBe(403);
    }
    expect((await call(readLimits, { cookie: s.admin.cookie, params: { id: randomUUID() } })).status).toBe(404);
    expect((await call(writeLimits, { method: "PUT", cookie: s.admin.cookie, params: { id: randomUUID() }, body: { maxTrunks: 1, maxAgents: 1 } })).status).toBe(404);
    for (const body of [{ maxTrunks: 1, maxAgents: 1, outboundAllowed: false }, { maxTrunks: 1, maxAgents: 1, monthlySpendCapCents: 100 }, { maxTrunks: -1, maxAgents: 1 }, { maxTrunks: 1.5, maxAgents: 1 }]) {
      expect((await call(writeLimits, { method: "PUT", cookie: s.admin.cookie, params: { id: s.org }, body })).code).toBe("validation_error");
    }
    expect(await withSystem(panel.app, (q) => q.one("select 1 from organization_limits where organization_id = $1", [s.org]))).toBeNull();
  });

  it("cannot be written by the organization itself, not even by SQL of the application role", async () => {
    const s = await scene();
    await s.setLimits({ maxTrunks: 1, maxAgents: 1 });
    for (const sql of [
      "update organization_limits set max_agents = null",
      "delete from organization_limits",
      `insert into organization_limits (organization_id, max_agents) values ('${s.org}', 100) on conflict (organization_id) do update set max_agents = 100`,
    ]) {
      await expect(withOrg(panel.app, s.org, (q) => q.exec(sql))).rejects.toMatchObject({ code: "42501" });
    }
    await expect(insert(panel.app, s.org, "insert into organization_limits (organization_id) values ($1) returning organization_id", [s.org])).rejects.toMatchObject({ code: "42501" });
    expect((await call(ownLimits, { cookie: s.person.cookie })).data).toMatchObject({ maxTrunks: 1, maxAgents: 1 });
  });

  it("changes nothing for an organization without limits: no row, and creating works", async () => {
    const s = await scene();
    expect((await call(ownLimits, { cookie: s.person.cookie })).data).toEqual({ maxTrunks: null, maxAgents: null, usage: { trunks: 0, agents: 0 } });
    for (let i = 0; i < 3; i++) expect((await s.agent()).status).toBe(200);
    expect(await withSystem(panel.app, (q) => q.one("select 1 from organization_limits where organization_id = $1", [s.org]))).toBeNull();
  });
});
