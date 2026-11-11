import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { createDb } from "./db";
import { resolveInboundRoute } from "./routing";
import { withOrg } from "./with-org";

const { app, owner } = openTestDbs();
const SHARED = "+5531999998888";
const ONLY_IN_B = "+5531999997777";

interface Fixture {
  org: string;
  trunk: string;
  agent: string;
}
let a: Fixture;
let b: Fixture;

async function createTrunk(org: string): Promise<string> {
  const id = randomUUID();
  await withOrg(app, org, (q) =>
    q.exec("insert into trunks (id, organization_id, name, host, auth_mode) values ($1, $2, 'Trunk', 'sip.example.com', 'register')", [id, org]),
  );
  return id;
}

async function createNumber(org: string, trunk: string, e164: string, agent: string | null): Promise<string> {
  const id = randomUUID();
  await withOrg(app, org, (q) =>
    q.exec("insert into phone_numbers (id, organization_id, trunk_id, e164, agent_id) values ($1, $2, $3, $4, $5)", [id, org, trunk, e164, agent]),
  );
  return id;
}

async function createFixture(label: string): Promise<Fixture> {
  const org = await createOrganization(app, label);
  const agent = randomUUID();
  await withOrg(app, org, (q) => q.exec("insert into agents (id, organization_id, name, engine) values ($1, $2, 'Agent', 'simulated')", [agent, org]));
  return { org, trunk: await createTrunk(org), agent };
}

beforeAll(async () => {
  a = await createFixture("routing A");
  b = await createFixture("routing B");
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("resolveInboundRoute", () => {
  it("routes the same number to the organization that owns the trunk it arrived on", async () => {
    const numberA = await createNumber(a.org, a.trunk, SHARED, a.agent);
    const numberB = await createNumber(b.org, b.trunk, SHARED, b.agent);

    expect(await resolveInboundRoute(app, a.trunk, SHARED)).toEqual({ organizationId: a.org, trunkId: a.trunk, phoneNumberId: numberA, agentId: a.agent });
    expect(await resolveInboundRoute(app, b.trunk, SHARED)).toEqual({ organizationId: b.org, trunkId: b.trunk, phoneNumberId: numberB, agentId: b.agent });
  });

  it("returns null for a trunk that does not exist or an id that is not a uuid", async () => {
    expect(await resolveInboundRoute(app, randomUUID(), SHARED)).toBeNull();
    expect(await resolveInboundRoute(app, "trunk-1", SHARED)).toBeNull();
    expect(await resolveInboundRoute(app, "", null)).toBeNull();
  });

  it("never finds a number that only exists in another organization", async () => {
    await createNumber(b.org, b.trunk, ONLY_IN_B, b.agent);
    expect(await resolveInboundRoute(app, a.trunk, ONLY_IN_B)).toEqual({ organizationId: a.org, trunkId: a.trunk, phoneNumberId: null, agentId: null });
  });

  it("returns the route without agent for a number nobody registered", async () => {
    expect(await resolveInboundRoute(app, a.trunk, "+5531900000000")).toEqual({ organizationId: a.org, trunkId: a.trunk, phoneNumberId: null, agentId: null });
  });

  it("returns the number with a null agent when the number has no agent", async () => {
    const number = await createNumber(a.org, a.trunk, "+5531988880000", null);
    expect(await resolveInboundRoute(app, a.trunk, "+5531988880000")).toEqual({ organizationId: a.org, trunkId: a.trunk, phoneNumberId: number, agentId: null });
  });

  it("finds a number of the same organization registered on another trunk", async () => {
    const otherTrunk = await createTrunk(a.org);
    const number = await createNumber(a.org, otherTrunk, "+5531977770000", a.agent);
    expect(await resolveInboundRoute(app, a.trunk, "+5531977770000")).toEqual({ organizationId: a.org, trunkId: a.trunk, phoneNumberId: number, agentId: a.agent });
  });

  describe("without a dialed number", () => {
    it("uses the only number of a single-number trunk", async () => {
      const trunk = await createTrunk(a.org);
      const number = await createNumber(a.org, trunk, "+5531966660001", a.agent);
      expect(await resolveInboundRoute(app, trunk, null)).toEqual({ organizationId: a.org, trunkId: trunk, phoneNumberId: number, agentId: a.agent });
    });

    it("fails closed when the trunk has no number", async () => {
      const trunk = await createTrunk(a.org);
      expect(await resolveInboundRoute(app, trunk, null)).toEqual({ organizationId: a.org, trunkId: trunk, phoneNumberId: null, agentId: null });
    });

    it("fails closed when the trunk has more than one number", async () => {
      const trunk = await createTrunk(a.org);
      await createNumber(a.org, trunk, "+5531966660002", a.agent);
      await createNumber(a.org, trunk, "+5531966660003", a.agent);
      expect(await resolveInboundRoute(app, trunk, null)).toEqual({ organizationId: a.org, trunkId: trunk, phoneNumberId: null, agentId: null });
    });

    it("does not count numbers of other trunks", async () => {
      const single = await createTrunk(b.org);
      const number = await createNumber(b.org, single, "+5531966660004", b.agent);
      // b.trunk já tem outros números; eles não tornam este tronco ambíguo.
      expect(await resolveInboundRoute(app, single, null)).toEqual({ organizationId: b.org, trunkId: single, phoneNumberId: number, agentId: b.agent });
    });
  });

  it("needs the system connection", async () => {
    const appOnly = createDb(process.env.TEST_DATABASE_URL ?? "");
    try {
      await expect(resolveInboundRoute(appOnly, a.trunk, SHARED)).rejects.toThrow(/no system pool/);
    } finally {
      await appOnly.close();
    }
  });
});
