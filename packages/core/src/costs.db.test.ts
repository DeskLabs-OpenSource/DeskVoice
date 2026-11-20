import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { costTotal } from "./costs";
import { withOrg, withSystem } from "./with-org";

// A soma do período (`costTotal`) lê pelo índice `(organization_id, at)` com um dia de folga de cada
// lado, fixado em UTC. O dia continua sendo o do fuso da organização, nas bordas dos fusos extremos,
// qualquer que seja o fuso da sessão do Postgres.
const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const DAY = { from: "2026-03-10", to: "2026-03-10" };

/** Uma organização no fuso dado, com uma linha do extrato em cada instante (texto, com microssegundo). */
async function organizationWith(timezone: string, rows: Record<string, number>): Promise<string> {
  const id = await createOrganization(app, `costs-${randomUUID()}`);
  await withSystem(app, (q) => q.exec("insert into outbound_policy (organization_id, timezone) values ($1, $2)", [id, timezone]));
  await withOrg(app, id, async (q) => {
    const call = await q.one<{ id: string }>("insert into calls (organization_id, direction, channel, status, started_at) values ($1, 'inbound', 'simulated', 'completed', now()) returning id", [id]);
    for (const [at, microcents] of Object.entries(rows)) {
      await q.exec(
        "insert into usage_ledger (organization_id, call_id, engine, cost_cents, cost_microcents, at) values ($1, $2, 'simulated', 0, $3, $4::timestamptz)",
        [id, call?.id, microcents, at],
      );
    }
  });
  return id;
}

/** A soma do dia 10/03 local, com a sessão do Postgres no fuso dado (ou no que ela já tem). */
const total = (organizationId: string, sessionZone?: string) =>
  withOrg(app, organizationId, async (q) => {
    if (sessionZone) await q.exec(`set local time zone '${sessionZone}'`);
    return (await costTotal(q, DAY)).microcents;
  });

const SESSION_ZONES = [undefined, "UTC", "Pacific/Kiritimati", "Etc/GMT+12", "America/Sao_Paulo"];

describe("costTotal nas bordas do fuso da organização", () => {
  it("C1: em Pacific/Kiritimati (+14), entra o primeiro instante do dia local e não o último microssegundo do anterior", async () => {
    const org = await organizationWith("Pacific/Kiritimati", {
      // 10/03 00:00 em Kiritimati é 09/03 10:00 UTC.
      "2026-03-09T09:59:59.999999Z": 1, // 09/03 23:59:59.999999 local: fora
      "2026-03-09T10:00:00.000000Z": 10, // 10/03 00:00 local: dentro
      "2026-03-10T09:59:59.999999Z": 100, // 10/03 23:59:59.999999 local: dentro
      "2026-03-10T10:00:00.000000Z": 1000, // 11/03 00:00 local: fora
    });
    for (const zone of SESSION_ZONES) expect([zone, await total(org, zone)]).toEqual([zone, 110]);
  });

  it("C2: em Etc/GMT+12 (−12), entra o último microssegundo do dia local e não o primeiro instante do seguinte", async () => {
    const org = await organizationWith("Etc/GMT+12", {
      // 10/03 00:00 em Etc/GMT+12 é 10/03 12:00 UTC.
      "2026-03-10T11:59:59.999999Z": 1, // 09/03 23:59:59.999999 local: fora
      "2026-03-10T12:00:00.000000Z": 10, // 10/03 00:00 local: dentro
      "2026-03-11T11:59:59.999999Z": 100, // 10/03 23:59:59.999999 local: dentro
      "2026-03-11T12:00:00.000000Z": 1000, // 11/03 00:00 local: fora
    });
    for (const zone of SESSION_ZONES) expect([zone, await total(org, zone)]).toEqual([zone, 110]);
  });

  it("C3: um período de vários dias soma o mesmo que o filtro só pela data local", async () => {
    const rows: Record<string, number> = {};
    // Uma linha a cada 7 h, de 25/02 a 15/04: atravessa as bordas do período em todo fuso.
    for (let t = Date.parse("2026-02-25T00:00:00Z"), n = 1; t < Date.parse("2026-04-15T00:00:00Z"); t += 7 * 3_600_000, n++) rows[new Date(t).toISOString()] = n;
    for (const zone of ["Pacific/Kiritimati", "Etc/GMT+12", "Asia/Kolkata", "America/Sao_Paulo"]) {
      const org = await organizationWith(zone, rows);
      const range = { from: "2026-03-01", to: "2026-03-31" };
      const [expected, got] = await withOrg(app, org, async (q) => {
        const only = await q.one<{ s: string }>(
          `select coalesce(sum(cost_microcents), 0)::text as s from usage_ledger where (at at time zone $3)::date between $1::date and $2::date`,
          [range.from, range.to, zone],
        );
        return [Number(only?.s), (await costTotal(q, range)).microcents];
      });
      expect([zone, got]).toEqual([zone, expected]);
      expect(expected).toBeGreaterThan(0);
    }
  });
});
