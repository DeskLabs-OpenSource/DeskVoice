import { decryptSecret, withOrg } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOW, SECRET_KEY, call, createCall, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { DELETE as deleteAgent, PATCH as patchAgent } from "./agents/[id]/route";
import { POST as createAgent } from "./agents/route";
import { POST as decide } from "./approvals/[id]/decide/route";
import { POST as simulate } from "./calls/simulate/route";
import { POST as webCall } from "./calls/web/route";
import { DELETE as removeDoNotCall, GET as listDoNotCall, POST as addDoNotCall } from "./do-not-call/route";
import { GET as listEngines } from "./engines/route";
import { GET as getPolicy, PUT as putPolicy } from "./outbound-policy/route";
import { GET as getMe, PATCH as patchMe } from "./auth/me/route";
import { DELETE as deleteNumber, PATCH as patchNumber } from "./phone-numbers/[id]/route";
import { GET as listNumbers, POST as createNumber } from "./phone-numbers/route";
import { GET as getSetting, PUT as putSetting } from "./settings/[key]/route";
import { GET as costs } from "./system/costs/route";
import { GET as health } from "./system/health/route";
import { POST as checkTrunk } from "./trunks/[id]/check/route";
import { DELETE as deleteTrunk, PATCH as patchTrunk } from "./trunks/[id]/route";
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

  it("keeps the vocabulary: empty by default, trimmed on save, and refused with the reason when a term breaks the rule", async () => {
    const created = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Vocabulário", engine: "simulated" } });
    expect(created.data).toMatchObject({ vocabulary: [] });
    const id = (created.data as { id: string }).id;

    const saved = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { vocabulary: [" Melgaço ", "DeskVoice"] } });
    expect(saved.data).toMatchObject({ vocabulary: ["Melgaço", "DeskVoice"] });
    expect(await stored("select vocabulary from agents where id = $1", [id])).toEqual({ vocabulary: ["Melgaço", "DeskVoice"] });
    // Mudar outro campo não mexe nos termos.
    expect((await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { enabled: false } })).data).toMatchObject({ vocabulary: ["Melgaço", "DeskVoice"] });

    const refusals: [unknown, string][] = [
      [["Melgaço", "melgaço"], 'vocabulary: term 2 repeats "melgaço"'],
      [["dois\ntermos"], "vocabulary: term 1 cannot contain line breaks, control characters, '<' or '>'"],
      [["<script>"], "vocabulary: term 1 cannot contain line breaks, control characters, '<' or '>'"],
      [["  "], "vocabulary: term 1 is empty"],
      [["x".repeat(61)], "vocabulary: term 1 has 61 characters; the limit is 60"],
      [Array.from({ length: 51 }, (_, index) => `t${index}`), "vocabulary: at most 50 terms (got 51)"],
    ];
    for (const [vocabulary, message] of refusals) {
      const refused = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { vocabulary } });
      expect([refused.status, refused.code, refused.message]).toEqual([400, "validation_error", message]);
    }
    const refusedOnCreate = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Y", engine: "simulated", vocabulary: ["a>b"] } });
    expect([refusedOnCreate.status, refusedOnCreate.code]).toEqual([400, "validation_error"]);
    expect(await stored("select vocabulary from agents where id = $1", [id])).toEqual({ vocabulary: ["Melgaço", "DeskVoice"] });

    const emptied = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { vocabulary: [] } });
    expect([emptied.status, emptied.data]).toMatchObject([200, { vocabulary: [] }]);
  });

  it("keeps the listening environment: normal when absent, noisy when chosen, and refuses any other value", async () => {
    const created = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Ambiente", engine: "simulated" } });
    expect(created.data).toMatchObject({ listeningEnvironment: "normal" });
    const id = (created.data as { id: string }).id;
    expect(await stored("select listening_environment from agents where id = $1", [id])).toEqual({ listening_environment: "normal" });

    const noisy = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { listeningEnvironment: "noisy" } });
    expect([noisy.status, noisy.data]).toMatchObject([200, { listeningEnvironment: "noisy" }]);
    expect(await stored("select listening_environment from agents where id = $1", [id])).toEqual({ listening_environment: "noisy" });
    // Mudar outro campo não mexe no ambiente.
    expect((await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { enabled: false } })).data).toMatchObject({ listeningEnvironment: "noisy" });

    for (const listeningEnvironment of ["loud", "NOISY", "", null, 1]) {
      const refused = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { listeningEnvironment } });
      expect([refused.status, refused.code, refused.message]).toEqual([400, "validation_error", expect.stringMatching(/listeningEnvironment/)]);
    }
    const refusedOnCreate = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Z", engine: "simulated", listeningEnvironment: "loud" } });
    expect([refusedOnCreate.status, refusedOnCreate.code]).toEqual([400, "validation_error"]);
    expect(await stored("select listening_environment from agents where id = $1", [id])).toEqual({ listening_environment: "noisy" });

    const createdNoisy = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Obra", engine: "simulated", listeningEnvironment: "noisy" } });
    expect(createdNoisy.data).toMatchObject({ listeningEnvironment: "noisy" });
    const back = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id }, body: { listeningEnvironment: "normal" } });
    expect([back.status, back.data]).toMatchObject([200, { listeningEnvironment: "normal" }]);
  });
});

describe("secrets", () => {
  it("stores an engine key encrypted and never sends it back", async () => {
    const key = "sk-test-do-not-leak-1234567890";
    const params = { key: "engine.openai-realtime.api_key" };
    const saved = await call(putSetting, { method: "PUT", cookie: owner, params, body: { value: key } });
    const read = await call(getSetting, { cookie: owner, params });
    const engines = await call(listEngines, { cookie: owner });
    // Gravar testa a chave; aqui o provedor não responde (o `fetch` do teste recusa tudo).
    expect(saved.data).toEqual({ key: params.key, value: { configured: true }, check: expect.objectContaining({ result: "unreachable" }) });
    expect(read.data).toEqual({ key: params.key, value: { configured: true } });
    for (const response of [saved, read, engines]) expect(response.text).not.toContain(key);
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "openai-realtime", requiresKey: true, keyConfigured: true }));
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "simulated", requiresKey: false }));
    // A tela escolhe a voz pela lista do motor; o simulado não oferece escolha.
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "openai-realtime", defaultVoice: "marin", voices: expect.arrayContaining([{ id: "cedar", recommended: true }]) }));
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "simulated", voices: [], defaultVoice: null }));
    // Onde o áudio é processado chega à tela como o motor declara.
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "simulated", provider: "none", processingLocation: { kind: "this-server" } }));
    expect(engines.data).toContainEqual(expect.objectContaining({ id: "openai-realtime", provider: "openai", processingLocation: { kind: "undeclared" } }));

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

    // Mesmo endereço e mesmo tipo, sem token: o gravado continua.
    const same = await call(putSetting, { method: "PUT", cookie: owner, params, body: { value: { type: "webhook", url: "https://hooks.example.test/wa" } } });
    expect(same.status).toBe(200);
    const row = () => stored<{ type: string; url: string; token: string }>("select value from settings where key = $1", [params.key]);
    expect(decryptSecret((await row())?.value?.token ?? "", SECRET_KEY)).toBe(token);
  });

  it("never carries the WhatsApp token to another address or another connector type", async () => {
    const params = { key: "whatsapp.connector" };
    const token = "connector-token-stays-home";
    const put = (value: unknown) => call(putSetting, { method: "PUT", cookie: owner, params, body: { value } });
    await put({ type: "webhook", url: "https://hooks.example.test/wa", token });
    const before = await stored<unknown>("select value from settings where key = $1", [params.key]);

    for (const value of [{ type: "webhook", url: "https://attacker.example.test/collect" }, { type: "deskcomm", url: "https://hooks.example.test/wa" }]) {
      const moved = await put(value);
      expect([moved.status, moved.code]).toEqual([400, "token_required"]);
    }
    expect(await stored<unknown>("select value from settings where key = $1", [params.key])).toEqual(before);

    const replaced = await put({ type: "webhook", url: "https://new.example.test/wa", token: "brand-new-token" });
    expect(replaced.status).toBe(200);
    const row = await stored<{ url: string; token: string }>("select value from settings where key = $1", [params.key]);
    expect([row?.value?.url, decryptSecret(row?.value?.token ?? "", SECRET_KEY)]).toEqual(["https://new.example.test/wa", "brand-new-token"]);
  });

  it("keeps a webhook token only for the item whose name and address are both unchanged", async () => {
    const params = { key: "webhooks.allowed" };
    const put = (value: unknown) => call(putSetting, { method: "PUT", cookie: owner, params, body: { value } });
    const tokens = async (): Promise<Record<string, string | undefined>> => {
      const row = await stored<Array<{ name: string; token?: string }>>("select value from settings where key = $1", [params.key]);
      return Object.fromEntries((row?.value ?? []).map((hook) => [hook.name, hook.token === undefined ? undefined : decryptSecret(hook.token, SECRET_KEY)]));
    };
    const original = [
      { name: "crm", url: "https://crm.example.test/hook", token: "crm-token" },
      { name: "erp", url: "https://erp.example.test/hook", token: "erp-token" },
      { name: "agenda", url: "https://agenda.example.test/hook", token: "agenda-token" },
    ];
    await put(original);

    const changed = await put([
      { name: "crm", url: "https://crm.example.test/hook" }, // igual: mantém
      { name: "erp", url: "https://attacker.example.test/collect" }, // endereço trocado, mesmo nome: perde
      { name: "agenda-renamed", url: "https://agenda.example.test/hook" }, // renomeado, mesmo endereço: perde
    ]);
    expect(changed.data).toEqual({
      key: params.key,
      value: [
        { name: "crm", url: "https://crm.example.test/hook", token: { configured: true } },
        { name: "erp", url: "https://attacker.example.test/collect", token: { configured: false } },
        { name: "agenda-renamed", url: "https://agenda.example.test/hook", token: { configured: false } },
      ],
    });
    expect(await tokens()).toEqual({ crm: "crm-token", erp: undefined, "agenda-renamed": undefined });
    expect(changed.text).not.toMatch(/crm-token|erp-token|agenda-token/);
  });

  it("does not send the stored line password to a different provider address or user", async () => {
    const password = "trunk-password-stays-home";
    const created = await call(createTrunk, { method: "POST", cookie: owner, body: { name: "Segura", host: "sip.example.test", username: "5531", password, authMode: "register" } });
    const id = (created.data as { id: string }).id;
    const row = () => stored<string | null>("select name, host, username, auth_mode, secret_enc from trunks where id = $1", [id]);
    const patch = (body: unknown) => call(patchTrunk, { method: "PATCH", cookie: owner, params: { id }, body });
    const before = await row();

    for (const body of [{ host: "attacker.example.test" }, { username: "someone-else" }]) {
      const refused = await patch(body);
      expect([refused.status, refused.code]).toEqual([400, "password_required"]);
    }
    expect(await row()).toEqual(before);

    // Só o nome: o destino é o mesmo, a senha fica.
    expect((await patch({ name: "Segura 2", host: "sip.example.test" })).status).toBe(200);
    expect(decryptSecret((await row())?.secret_enc ?? "", SECRET_KEY)).toBe(password);

    expect((await patch({ host: "sip2.example.test", password: "new-password" })).status).toBe(200);
    const moved = await row();
    expect([moved?.host, decryptSecret(moved?.secret_enc ?? "", SECRET_KEY)]).toEqual(["sip2.example.test", "new-password"]);

    // Autenticação por IP não tem senha: a antiga é apagada, não reaproveitada.
    expect((await patch({ authMode: "ip", host: "sip3.example.test" })).data).toMatchObject({ secret: { configured: false } });
    expect((await row())?.secret_enc).toBeNull();
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

  it("keeps inbound.max_concurrent_calls as a whole number from 1 to 50 that shows the factory value until saved", async () => {
    const params = { key: "inbound.max_concurrent_calls" };
    const put = (value: unknown, cookie = owner) => call(putSetting, { method: "PUT", cookie, params, body: { value } });
    expect((await call(getSetting, { cookie: owner, params })).data).toEqual({ key: params.key, value: 5 });

    for (const bad of [0, 51, 2.5, -1, "5", true]) expect((await put(bad)).code, JSON.stringify(bad)).toBe("validation_error");
    expect((await put(10, operator.cookie)).status).toBe(403);
    expect(await stored("select value from settings where key = $1", [params.key])).toBeNull();

    for (const good of [1, 50, 12]) expect((await put(good)).data).toEqual({ key: params.key, value: good });
    expect(await stored("select value, secret from settings where key = $1", [params.key])).toEqual({ value: 12, secret: false });
    expect((await call(getSetting, { cookie: owner, params })).data).toEqual({ key: params.key, value: 12 });
  });

  it.each(["calls.outcome_enabled", "calls.analysis_enabled"])("keeps %s off until an owner or admin turns it on, and an operator cannot", async (key) => {
    const params = { key };
    const put = (value: unknown, cookie = owner) => call(putSetting, { method: "PUT", cookie, params, body: { value } });
    expect((await call(getSetting, { cookie: owner, params })).data).toEqual({ key: params.key, value: false });

    for (const bad of ["true", 1, { enabled: true }]) expect((await put(bad)).code, JSON.stringify(bad)).toBe("validation_error");
    expect((await put(true, operator.cookie)).status).toBe(403);
    expect(await stored("select value from settings where key = $1", [params.key])).toBeNull();

    expect((await put(true)).data).toEqual({ key: params.key, value: true });
    expect(await stored("select value, secret from settings where key = $1", [params.key])).toEqual({ value: true, secret: false });
    expect((await put(null)).data).toEqual({ key: params.key, value: null });
    expect((await call(getSetting, { cookie: owner, params })).data).toEqual({ key: params.key, value: false });
  });

  it.each(["whatsapp.trust_caller_id", "whatsapp.notify_owner_on_call_end"])("keeps %s as a plain boolean that starts unset, and an operator cannot change it", async (key) => {
    const params = { key };
    const put = (value: unknown, cookie = owner) => call(putSetting, { method: "PUT", cookie, params, body: { value } });
    // Sem linha gravada quem lê entende desligado: enviar para quem ligou pede confirmação, e o
    // aviso de fim de ligação pelo WhatsApp não sai.
    expect((await call(getSetting, { cookie: owner, params })).data).toEqual({ key: params.key, value: null });

    for (const bad of ["true", 1, { enabled: true }]) expect((await put(bad)).code, JSON.stringify(bad)).toBe("validation_error");
    expect((await put(true, operator.cookie)).status).toBe(403);
    expect(await stored("select value from settings where key = $1", [params.key])).toBeNull();

    expect((await put(true)).data).toEqual({ key: params.key, value: true });
    expect(await stored("select value, secret from settings where key = $1", [params.key])).toEqual({ value: true, secret: false });
    expect((await put(false)).data).toEqual({ key: params.key, value: false });
    expect(await stored("select value from settings where key = $1", [params.key])).toEqual({ value: false });
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

describe("removing and correcting lines and numbers", () => {
  const newTrunk = async (name: string): Promise<string> =>
    ((await call(createTrunk, { method: "POST", cookie: owner, body: { name, host: "sip.example.test", authMode: "ip" } })).data as { id: string }).id;
  const newNumber = async (trunkId: string, number: string): Promise<string> =>
    ((await call(createNumber, { method: "POST", cookie: owner, body: { trunkId, number } })).data as { id: string }).id;

  it("corrects a mistyped number, keeps the agent, and refuses a number that already exists", async () => {
    const trunk = await newTrunk("Correção");
    const agent = await newAgent("Atende");
    const id = await newNumber(trunk, "(31) 3555-0001");
    await newNumber(trunk, "(31) 3555-0002");
    await call(patchNumber, { method: "PATCH", cookie: owner, params: { id }, body: { agentId: agent } });

    const fixed = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id }, body: { number: "31 3555-0009" } });
    expect(fixed.data).toMatchObject({ id, e164: "+553135550009", agentId: agent });

    const repeated = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id }, body: { number: "(31) 3555-0002" } });
    expect([repeated.status, repeated.code]).toEqual([400, "number_already_registered"]);
    const invalid = await call(patchNumber, { method: "PATCH", cookie: owner, params: { id }, body: { number: "abc" } });
    expect(invalid.code).toBe("validation_error");
    expect(await stored("select e164, agent_id from phone_numbers where id = $1", [id])).toEqual({ e164: "+553135550009", agent_id: agent });
  });

  it("refuses to remove a line that still has numbers, saying how many, then removes it once they are gone", async () => {
    const trunk = await newTrunk("Com números");
    const numbers = [await newNumber(trunk, "(31) 3666-0001"), await newNumber(trunk, "(31) 3666-0002")];
    panel.voice.requests.length = 0;
    panel.voice.respond = () => Response.json({ applied: true, detail: "1 line(s) written, reloaded and listed by the telephony server.", skipped: [] });

    const refused = await call(deleteTrunk, { method: "DELETE", cookie: owner, params: { id: trunk } });
    expect([refused.status, refused.code]).toEqual([409, "trunk_has_numbers"]);
    expect(refused.message).toContain("2 number");
    expect(await stored("select id from trunks where id = $1", [trunk])).toEqual({ id: trunk });
    expect(panel.voice.requests).toEqual([]);

    for (const id of numbers) expect((await call(deleteNumber, { method: "DELETE", cookie: owner, params: { id } })).status).toBe(200);
    expect((await call(deleteNumber, { method: "DELETE", cookie: owner, params: { id: numbers[0] ?? "" } })).status).toBe(404);
    const listed = (await call(listNumbers, { cookie: owner })).text;
    for (const id of numbers) expect(listed).not.toContain(id);

    const removed = await call(deleteTrunk, { method: "DELETE", cookie: owner, params: { id: trunk } });
    expect(removed.data).toEqual({ applied: true, detail: "1 line(s) written, reloaded and listed by the telephony server." });
    expect(await stored("select id from trunks where id = $1", [trunk])).toBeNull();
    // A linha saiu do banco: o processo de voz é chamado para tirá-la também do servidor de telefonia.
    expect(panel.voice.requests).toEqual([{ url: "http://voice.test/trunks/apply", body: { organizationId: org } }]);
  });

  it("does not claim a line was applied when the voice process says the telephony server did not load it", async () => {
    // O processo de voz responde 200 nos dois casos; o que diz se carregou é o corpo.
    const detail = "The lines were written, but the telephony server did not reload them: connect ECONNREFUSED";
    panel.voice.respond = () => Response.json({ applied: false, detail, skipped: [] });

    const created = await call(createTrunk, { method: "POST", cookie: owner, body: { name: "Asterisk fora", host: "203.0.113.40", authMode: "ip" } });
    expect(created.status).toBe(200);
    expect(created.data).toMatchObject({ applied: false, detail });

    const id = (created.data as { id: string }).id;
    const checked = await call(checkTrunk, { method: "POST", cookie: owner, params: { id } });
    const steps = (checked.data as { steps: Array<{ step: string; status: string; detail: string }> }).steps;
    expect(steps[0]).toEqual({ step: "apply", status: "fail", detail });

    panel.voice.respond = () => Response.json({ applied: true, detail: "1 line(s) written, reloaded and listed by the telephony server.", skipped: [] });
    const renamed = await call(patchTrunk, { method: "PATCH", cookie: owner, params: { id }, body: { name: "Asterisk de volta" } });
    expect(renamed.data).toMatchObject({ applied: true });
  });

  it("treats an answer it cannot read as not applied", async () => {
    panel.voice.respond = () => Response.json({ unexpected: true });
    const created = await call(createTrunk, { method: "POST", cookie: owner, body: { name: "Resposta estranha", host: "203.0.113.41", authMode: "ip" } });
    expect(created.status).toBe(200);
    expect((created.data as { applied: boolean }).applied).toBe(false);
  });

  it("an operator cannot remove or correct anything", async () => {
    const trunk = await newTrunk("Guardada");
    const number = await newNumber(trunk, "(31) 3777-0001");
    const as = { cookie: operator.cookie };
    const attempts = await Promise.all([
      call(deleteNumber, { ...as, method: "DELETE", params: { id: number } }),
      call(patchNumber, { ...as, method: "PATCH", params: { id: number }, body: { number: "(31) 3777-0002" } }),
      call(deleteTrunk, { ...as, method: "DELETE", params: { id: trunk } }),
    ]);
    for (const result of attempts) expect([result.status, result.code]).toEqual([403, "forbidden"]);
    expect(await stored("select e164 from phone_numbers where id = $1", [number])).toEqual({ e164: "+553137770001" });
  });

  it("accepts the provider addresses the voice process supports and refuses anything that could break the configuration", async () => {
    const create = (host: string) => call(createTrunk, { method: "POST", cookie: owner, body: { name: "Host", host, authMode: "ip" } });
    for (const host of ["203.0.113.0/24", "[2001:db8::1]:5060", "2001:db8::1", "sip.example.test:5060"]) expect([host, (await create(host)).status]).toEqual([host, 200]);
    for (const host of ["sip.example.test;x", "[evil]", "sip.example.test\n[evil]", "203.0.113.0/99"]) expect([host, (await create(host)).code]).toEqual([host, "validation_error"]);
  });
});

describe("my contact", () => {
  it("stores phone and WhatsApp normalized, for any role, and only for the signed-in user", async () => {
    const before = await call(getMe, { cookie: operator.cookie });
    expect(before.data).toMatchObject({ role: "operator", phone: null, whatsapp: null });

    const saved = await call(patchMe, { method: "PATCH", cookie: operator.cookie, body: { name: "  Ana Operadora ", phone: "(31) 98888-1111", whatsapp: "031988882222" } });
    expect(saved.data).toEqual({ name: "Ana Operadora", email: operator.email, role: "operator", phone: "+5531988881111", whatsapp: "+5531988882222" });
    expect((await call(getMe, { cookie: operator.cookie })).data).toEqual(saved.data);
    expect(await stored("select phone_e164, whatsapp_e164 from users where id = $1", [operator.id])).toEqual({ phone_e164: "+5531988881111", whatsapp_e164: "+5531988882222" });
    // O dono, na mesma organização, não foi tocado.
    expect((await call(getMe, { cookie: owner })).data).toMatchObject({ phone: null, whatsapp: null, name: "Test owner" });

    const invalid = await call(patchMe, { method: "PATCH", cookie: operator.cookie, body: { whatsapp: "abc" } });
    expect([invalid.status, invalid.code]).toEqual([400, "validation_error"]);

    // Vazio apaga; campo ausente fica como está; papel e e-mail não entram.
    const cleared = await call(patchMe, { method: "PATCH", cookie: operator.cookie, body: { whatsapp: "", role: "owner", email: "x@example.test" } });
    expect(cleared.data).toMatchObject({ name: "Ana Operadora", email: operator.email, role: "operator", phone: "+5531988881111", whatsapp: null });
    expect((await call(patchMe, { method: "PATCH", body: { name: "X" } })).status).toBe(401);
  });
});

describe("approval default", () => {
  it("is the operator's choice, limited to denied or approved", async () => {
    const params = { key: "approvals.default_on_timeout" };
    expect((await call(getSetting, { cookie: owner, params })).data).toEqual({ key: params.key, value: null });
    const put = (value: unknown, cookie = owner) => call(putSetting, { method: "PUT", cookie, params, body: { value } });
    expect((await put("maybe")).code).toBe("validation_error");
    expect((await put("approved", operator.cookie)).status).toBe(403);
    expect((await put("approved")).data).toEqual({ key: params.key, value: "approved" });
    expect(await stored("select value, secret from settings where key = $1", [params.key])).toEqual({ value: "approved", secret: false });
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

  it("a browser call asks for an invitation in the name of the session and tells the browser where to connect", async () => {
    const agent = await newAgent("Navegador");
    panel.voice.requests.length = 0;
    panel.voice.respond = () => Response.json({ callId: "22222222-2222-4222-8222-222222222222", token: "invite-token", expiresInSeconds: 60 });

    const started = await call(webCall, { method: "POST", cookie: operator.cookie, body: { agentId: agent } });
    expect(started.data).toEqual({ callId: "22222222-2222-4222-8222-222222222222", token: "invite-token", ws: { path: "/voice-ws" } });
    expect(panel.voice.requests).toEqual([{ url: "http://voice.test/calls/web", body: { organizationId: org, agentId: agent, userId: operator.id } }]);
  });

  it("a browser call passes on each refusal of the voice process with its own code, and says when it is down", async () => {
    const agent = await newAgent("Recusado");
    for (const code of ["agent_not_found", "agent_disabled", "engine_not_configured", "engine_simulated"]) {
      panel.voice.respond = () => Response.json({ code, message: "refused" }, { status: 409 });
      const refused = await call(webCall, { method: "POST", cookie: owner, body: { agentId: agent } });
      expect([refused.status, refused.code]).toEqual([422, code]);
    }
    panel.voice.respond = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const down = await call(webCall, { method: "POST", cookie: owner, body: { agentId: agent } });
    expect([down.status, down.code]).toEqual([502, "voice_unavailable"]);
    // Resposta sem convite não chega ao navegador como se fosse uma chamada.
    panel.voice.respond = () => Response.json({ callId: "x" });
    expect((await call(webCall, { method: "POST", cookie: owner, body: { agentId: agent } })).code).toBe("voice_unavailable");

    expect((await call(webCall, { method: "POST", body: { agentId: agent } })).status).toBe(401);
    expect((await call(webCall, { method: "POST", cookie: owner, body: { agentId: "not-a-uuid" } })).code).toBe("validation_error");
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
        : Response.json({ applied: true, detail: "1 line(s) written, reloaded and listed by the telephony server.", skipped: [] });
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
      voice: { status: "ok" },
      telephony: { status: "ok" },
      trunk: { status: "warn", detail: "nenhuma linha cadastrada" },
    });
    expect(result.text).not.toContain("10.0.0.5");

    panel.voice.respond = () => {
      throw new Error("connect ECONNREFUSED");
    };
    // A voz caiu: falha é dela; o que se pergunta a ela diz que não deu para conferir, e por quê.
    expect((await call(health)).data).toMatchObject({ database: { status: "ok" }, voice: { status: "fail" }, telephony: { status: "warn", reason: "needs_voice" }, trunk: { status: "warn", reason: "needs_voice" } });
  });
});

describe("costs", () => {
  it("adds usage by day, agent and engine inside the period, with the date the price was checked", async () => {
    const agent = await newAgent("Custos");
    const callId = await insert(panel.app, org, "insert into calls (organization_id, agent_id, direction, channel, status, started_at, engine) values ($1, $2, 'inbound', 'simulated', 'completed', $3, 'simulated') returning id", [org, agent, NOW]);
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
