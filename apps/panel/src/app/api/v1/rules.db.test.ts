import { decryptSecret, withOrg } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOW, SECRET_KEY, call, createCall, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { DELETE as deleteAgent, PATCH as patchAgent } from "./agents/[id]/route";
import { POST as createAgent } from "./agents/route";
import { POST as decide } from "./approvals/[id]/decide/route";
import { POST as simulate } from "./calls/simulate/route";
import { DELETE as removeDoNotCall, GET as listDoNotCall, POST as addDoNotCall } from "./do-not-call/route";
import { GET as listEngines } from "./engines/route";
import { GET as getPolicy, PUT as putPolicy } from "./outbound-policy/route";
import { POST as createNumber } from "./phone-numbers/route";
import { GET as getSetting, PUT as putSetting } from "./settings/[key]/route";
import { GET as costs } from "./system/costs/route";
import { GET as health } from "./system/health/route";
import { POST as checkTrunk } from "./trunks/[id]/check/route";
import { PATCH as patchTrunk } from "./trunks/[id]/route";
import { GET as listTrunks, POST as createTrunk } from "./trunks/route";

const panel = startPanel();
let org: string;
let owner: string;
let operator: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  org = await createOrganization(panel.app, "rules");
  owner = (await createUser(panel.app, org, "owner")).cookie;
  operator = await createUser(panel.app, org, "operator");
});
afterAll(() => panel.close());

const stored = <T>(sql: string, params: unknown[] = []) => withOrg(panel.app, org, (q) => q.one<Record<string, T>>(sql, params));
const newAgent = async (name: string): Promise<string> =>
  ((await call(createAgent, { method: "POST", cookie: owner, body: { name, engine: "simulated" } })).data as { id: string }).id;

describe("roles", () => {
  it("an operator reads but cannot change configuration, on every configuration route", async () => {
    const agent = await newAgent("Guarded");
    const as = { cookie: operator.cookie };
    const attempts = [
      call(createAgent, { ...as, method: "POST", body: { name: "Nope", engine: "simulated" } }),
      call(patchAgent, { ...as, method: "PATCH", params: { id: agent }, body: { enabled: false } }),
      call(deleteAgent, { ...as, method: "DELETE", params: { id: agent } }),
      call(createTrunk, { ...as, method: "POST", body: { name: "T", host: "sip.example.test", authMode: "ip" } }),
      call(putSetting, { ...as, method: "PUT", params: { key: "recording_notice.text" }, body: { value: "x" } }),
      call(putPolicy, { ...as, method: "PUT", body: { dailyCapPerLine: 2000 } }),
      call(addDoNotCall, { ...as, method: "POST", body: { numbers: ["31999998888"] } }),
    ];
    for (const result of await Promise.all(attempts)) expect([result.status, result.code]).toEqual([403, "forbidden"]);
    expect((await call(getPolicy, as)).status).toBe(200);
    expect(await stored("select enabled from agents where id = $1", [agent])).toEqual({ enabled: true });
  });
});

describe("agents", () => {
  it("normalizes the transfer number typed freely and refuses one that is not a phone", async () => {
    const created = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Recepção", engine: "simulated", transferTo: "(31) 99999-8888" } });
    expect(created.data).toMatchObject({ transferTo: "+5531999998888", maxCallSeconds: 600, costCeilingCents: 500, enabled: true, tools: [] });

    const id = (created.data as { id: string }).id;
    const patched = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { transferTo: "031988887777", greeting: "" } });
    expect(patched.data).toMatchObject({ name: "Recepção", transferTo: "+5531988887777", greeting: null });

    const invalid = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { transferTo: "abc" } });
    expect([invalid.status, invalid.code]).toEqual([400, "validation_error"]);
    const unknownEngine = await call(createAgent, { method: "POST", cookie: owner, body: { name: "X", engine: "made-up" } });
    expect(unknownEngine.message).toMatch(/engine/);
  });
});

describe("secrets", () => {
  it("stores an engine key encrypted and never sends it back", async () => {
    const key = "sk-test-do-not-leak-1234567890";
    const params = { key: "engine.openai-realtime.api_key" };
    const saved = await call(putSetting, { method: "PUT", cookie: owner, params, body: { value: key } });
    const read = await call(getSetting, { cookie: owner, params });
    const engines = await call(listEngines, { cookie: owner });
    expect(saved.data).toEqual({ key: params.key, value: { configured: true } });
    expect(read.data).toEqual(saved.data);
    for (const response of [saved, read, engines]) expect(response.text).not.toContain(key);
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "openai-realtime", requiresKey: true, keyConfigured: true }));
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "simulated", requiresKey: false }));

    const row = await stored<unknown>("select value, secret from settings where key = $1", [params.key]);
    expect(row?.secret).toBe(true);
    expect(JSON.stringify(row?.value)).not.toContain(key);
    expect(decryptSecret(String(row?.value), SECRET_KEY)).toBe(key);

    await call(putSetting, { method: "PUT", cookie: owner, params, body: { value: null } });
    expect((await call(getSetting, { cookie: owner, params })).data).toEqual({ key: params.key, value: null });
  });

  it("keeps the WhatsApp connector token out of the answer and keeps it when the form sends none", async () => {
    const params = { key: "whatsapp.connector" };
    const token = "connector-token-do-not-leak";
    const saved = await call(putSetting, { method: "PUT", cookie: owner, params, body: { value: { type: "webhook", url: "https://hooks.example.test/wa", token } } });
    expect(saved.data).toEqual({ key: params.key, value: { type: "webhook", url: "https://hooks.example.test/wa", token: { configured: true } } });
    expect(saved.text).not.toContain(token);

    await call(putSetting, { method: "PUT", cookie: owner, params, body: { value: { type: "deskcomm", url: "https://crm.example.test" } } });
    const row = await stored<{ type: string; token: string }>("select value from settings where key = $1", [params.key]);
    expect(row?.value?.type).toBe("deskcomm");
    expect(decryptSecret(row?.value?.token ?? "", SECRET_KEY)).toBe(token);
  });

  it("stores the line password encrypted and answers only that it is configured", async () => {
    const password = "trunk-password-do-not-leak";
    const created = await call(createTrunk, { method: "POST", cookie: owner, body: { name: "Operadora", host: "sip.example.test:5060", username: "5531", password, authMode: "register", callerId: "31 3333-4444" } });
    expect(created.data).toMatchObject({ secret: { configured: true }, callerId: "+553133334444", status: "unverified", applied: false });
    const id = (created.data as { id: string }).id;
    const patched = await call(patchTrunk, { method: "PATCH", cookie: owner, params: { id }, body: { name: "Operadora X" } });
    const listed = await call(listTrunks, { cookie: owner });
    for (const response of [created, patched, listed]) {
      expect(response.text).not.toContain(password);
      expect(response.text).not.toContain("secret_enc");
    }
    const row = await stored<string>("select secret_enc from trunks where id = $1", [id]);
    expect(row?.secret_enc).not.toContain(password);
    expect(decryptSecret(row?.secret_enc ?? "", SECRET_KEY)).toBe(password);

    const injected = await call(patchTrunk, { method: "PATCH", cookie: owner, params: { id }, body: { host: "sip.example.test\n[evil]" } });
    expect(injected.code).toBe("validation_error");
  });
});

describe("settings", () => {
  it("refuses a key outside the known list, on read and on write", async () => {
    const params = { key: "feature.flags" };
    const write = await call(putSetting, { method: "PUT", cookie: owner, params, body: { value: true } });
    const read = await call(getSetting, { cookie: owner, params });
    expect([write.status, write.code, read.status, read.code]).toEqual([400, "unknown_setting", 400, "unknown_setting"]);
    expect(await stored("select key from settings where key = $1", [params.key])).toBeNull();
  });

  it("validates each known key with its own schema", async () => {
    const put = (key: string, value: unknown) => call(putSetting, { method: "PUT", cookie: owner, params: { key }, body: { value } });
    expect((await put("network.public_ip", "not an ip")).code).toBe("validation_error");
    expect((await put("engine.default", "made-up")).code).toBe("validation_error");
    expect((await put("webhooks.allowed", [{ name: "crm", url: "ftp://example.test" }])).code).toBe("validation_error");
    expect((await put("network.public_ip", "203.0.113.10")).data).toEqual({ key: "network.public_ip", value: "203.0.113.10" });
    expect((await put("engine.default", "gemini-live")).status).toBe(200);
    const hooks = await put("webhooks.allowed", [{ name: "crm", url: "https://crm.example.test/hook", token: "hook-token" }]);
    expect(hooks.data).toEqual({ key: "webhooks.allowed", value: [{ name: "crm", url: "https://crm.example.test/hook", token: { configured: true } }] });
  });
});

describe("approvals", () => {
  const pendingApproval = async (expiresAt: Date): Promise<string> => {
    const callId = await createCall(panel.app, org, NOW);
    return insert(panel.app, org, "insert into approvals (organization_id, call_id, question, default_on_timeout, expires_at) values ($1, $2, 'Pode remarcar?', 'denied', $3) returning id", [
      org,
      callId,
      expiresAt,
    ]);
  };

  it("an operator decides a pending request once; the second decision is refused and changes nothing", async () => {
    const id = await pendingApproval(new Date(NOW.getTime() + 60_000));
    const first = await call(decide, { method: "POST", cookie: operator.cookie, params: { id }, body: { decision: "approved" } });
    expect(first.data).toMatchObject({ id, status: "approved" });

    const second = await call(decide, { method: "POST", cookie: owner, params: { id }, body: { decision: "denied" } });
    expect([second.status, second.code]).toEqual([409, "already_decided"]);
    expect(await stored("select status, decided_by from approvals where id = $1", [id])).toEqual({ status: "approved", decided_by: operator.id });
  });

  it("of two simultaneous decisions, exactly one wins", async () => {
    const id = await pendingApproval(new Date(NOW.getTime() + 60_000));
    const results = await Promise.all(["approved", "denied"].map((decision) => call(decide, { method: "POST", cookie: owner, params: { id }, body: { decision } })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it("refuses a decision after the deadline, even if the request is still marked pending", async () => {
    const id = await pendingApproval(new Date(NOW.getTime() - 1000));
    const late = await call(decide, { method: "POST", cookie: owner, params: { id }, body: { decision: "approved" } });
    expect([late.status, late.code]).toEqual([409, "approval_expired"]);
    expect(await stored("select status from approvals where id = $1", [id])).toEqual({ status: "pending" });
  });
});

describe("outbound policy", () => {
  it("starts off, and does not turn on without purpose and legal basis", async () => {
    expect((await call(getPolicy, { cookie: owner })).data).toMatchObject({ enabled: false, dailyCapPerLine: 200, windowStart: "09:00", windowEnd: "20:00" });

    for (const body of [{ enabled: true }, { enabled: true, purpose: "Confirmar consultas" }, { enabled: true, purpose: "  ", legalBasis: "Consentimento" }]) {
      const refused = await call(putPolicy, { method: "PUT", cookie: owner, body });
      expect([refused.status, refused.code]).toEqual([400, "purpose_required"]);
    }
    expect(await stored("select enabled from outbound_policy")).toBeNull();

    const on = await call(putPolicy, { method: "PUT", cookie: owner, body: { enabled: true, purpose: "Confirmar consultas", legalBasis: "Consentimento do paciente", windowEnd: "18:30" } });
    expect(on.data).toMatchObject({ enabled: true, windowEnd: "18:30", maxAttemptsPerContact: 3 });
    // Apagar a finalidade com a política ligada também é recusado.
    expect((await call(putPolicy, { method: "PUT", cookie: owner, body: { purpose: null } })).code).toBe("purpose_required");
  });

  it("normalizes pasted numbers for the do-not-call list and refuses the whole batch if one is invalid", async () => {
    const bad = await call(addDoNotCall, { method: "POST", cookie: owner, body: { numbers: ["(31) 99999-8888", "abc"] } });
    expect([bad.status, bad.code, bad.message]).toEqual([400, "invalid_numbers", "abc"]);
    expect((await call(listDoNotCall, { cookie: owner })).data).toEqual([]);

    const added = await call(addDoNotCall, { method: "POST", cookie: owner, body: { numbers: ["(31) 99999-8888", "031999998888", "+55 31 98888 7777"], reason: "Pediu" } });
    expect(added.data).toEqual({ added: 2 });
    const list = (await call(listDoNotCall, { cookie: owner })).data as Array<{ e164: string }>;
    expect(list.map((entry) => entry.e164).sort()).toEqual(["+5531988887777", "+5531999998888"]);

    await call(removeDoNotCall, { method: "DELETE", cookie: owner, body: { number: "31 99999-8888" } });
    expect(((await call(listDoNotCall, { cookie: owner })).data as unknown[]).length).toBe(1);
  });
});

describe("phone numbers", () => {
  it("normalizes the number and refuses one already registered as a validation error", async () => {
    const trunk = ((await call(createTrunk, { method: "POST", cookie: owner, body: { name: "Linha", host: "sip.example.test", authMode: "ip" } })).data as { id: string }).id;
    const created = await call(createNumber, { method: "POST", cookie: owner, body: { trunkId: trunk, number: "(31) 3222-1100" } });
    expect(created.data).toMatchObject({ e164: "+553132221100", trunkId: trunk, agentId: null });

    const repeated = await call(createNumber, { method: "POST", cookie: owner, body: { trunkId: trunk, number: "+55 31 3222 1100" } });
    expect([repeated.status, repeated.code]).toEqual([400, "number_already_registered"]);
    const noTrunk = await call(createNumber, { method: "POST", cookie: owner, body: { number: "(31) 3222-1101" } });
    expect(noTrunk.code).toBe("validation_error");
  });
});

describe("voice process", () => {
  it("simulate passes the organization of the session and returns the call id", async () => {
    const agent = await newAgent("Demo");
    panel.voice.requests.length = 0;
    panel.voice.respond = () => Response.json({ callId: "11111111-1111-4111-8111-111111111111" });
    const started = await call(simulate, { method: "POST", cookie: operator.cookie, body: { agentId: agent } });
    expect(started.data).toEqual({ callId: "11111111-1111-4111-8111-111111111111" });
    expect(panel.voice.requests).toEqual([{ url: "http://voice.test/calls/simulate", body: { organizationId: org, agentId: agent } }]);
  });

  it("says the voice process is unavailable instead of failing with a server error, and passes its refusals on", async () => {
    const agent = await newAgent("Demo 2");
    panel.voice.respond = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const down = await call(simulate, { method: "POST", cookie: owner, body: { agentId: agent } });
    expect([down.status, down.code]).toEqual([502, "voice_unavailable"]);

    panel.voice.respond = () => Response.json({ code: "engine_not_configured", message: "No key." }, { status: 409 });
    const refused = await call(simulate, { method: "POST", cookie: owner, body: { agentId: agent } });
    expect([refused.status, refused.code]).toEqual([422, "engine_not_configured"]);
  });

  it("tests a line step by step and records the outcome", async () => {
    const trunk = ((await call(createTrunk, { method: "POST", cookie: owner, body: { name: "Teste", host: "sip.example.test", authMode: "register" } })).data as { id: string }).id;
    panel.voice.respond = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const down = await call(checkTrunk, { method: "POST", cookie: owner, params: { id: trunk } });
    expect(down.data).toMatchObject({ status: "fail", steps: [{ step: "apply", status: "fail" }, { step: "asterisk", status: "skipped" }, { step: "trunk", status: "skipped" }] });

    panel.voice.respond = (url) =>
      url.endsWith("/health")
        ? Response.json({ asterisk: { status: "ok", detail: "up" }, trunks: [{ id: trunk, status: "fail", detail: "401 Unauthorized" }] })
        : Response.json({ applied: true });
    const rejected = await call(checkTrunk, { method: "POST", cookie: owner, params: { id: trunk } });
    expect(rejected.data).toMatchObject({ status: "fail", steps: [{ status: "ok" }, { status: "ok" }, { step: "trunk", status: "fail", detail: "401 Unauthorized" }] });
    expect(await stored("select status, last_error, last_check_at from trunks where id = $1", [trunk])).toEqual({ status: "fail", last_error: "401 Unauthorized", last_check_at: NOW });
  });

  it("health is public, names each part separately and leaks no configuration", async () => {
    panel.voice.respond = () => Response.json({ asterisk: { status: "ok", detail: "PJSIP 20.1 at 10.0.0.5" }, trunks: [] });
    const result = await call(health);
    expect(result.data).toMatchObject({
      panel: { status: "ok" },
      database: { status: "ok" },
      asterisk: { status: "ok" },
      trunk: { status: "warn", detail: "nenhuma linha cadastrada" },
    });
    expect(result.text).not.toContain("10.0.0.5");

    panel.voice.respond = () => {
      throw new Error("connect ECONNREFUSED");
    };
    expect((await call(health)).data).toMatchObject({ database: { status: "ok" }, asterisk: { status: "fail" }, trunk: { status: "fail" } });
  });
});

describe("costs", () => {
  it("adds usage by day, agent and engine inside the period, with the date the price was checked", async () => {
    const agent = await newAgent("Custos");
    const callId = await insert(panel.app, org, "insert into calls (organization_id, agent_id, direction, status, started_at, engine) values ($1, $2, 'inbound', 'completed', $3, 'simulated') returning id", [org, agent, NOW]);
    for (const [cents, at] of [[12, NOW], [30, new Date(NOW.getTime() - 86_400_000)], [99, new Date(NOW.getTime() - 90 * 86_400_000)]] as const) {
      await insert(panel.app, org, "insert into usage_ledger (organization_id, call_id, engine, seconds, cost_cents, at) values ($1, $2, 'simulated', 60, $3, $4) returning id", [org, callId, cents, at]);
    }
    const result = await call(costs, { cookie: owner });
    expect(result.data).toMatchObject({
      from: "2026-01-31",
      to: "2026-03-01",
      totalCents: 42,
      byDay: [{ day: "2026-02-28", costCents: 30 }, { day: "2026-03-01", costCents: 12 }],
      byAgent: [{ agentId: agent, name: "Custos", costCents: 42, calls: 1 }],
      byEngine: [{ engine: "simulated", costCents: 42, seconds: 120, priceCheckedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }],
    });
    expect((await call(costs, { cookie: owner, query: "?from=2026-03-02&to=2026-03-01" })).code).toBe("validation_error");
  });
});
