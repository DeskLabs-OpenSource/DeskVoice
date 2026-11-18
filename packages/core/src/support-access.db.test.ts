// O acesso de suporte da instalação (R8 seção 3.6), pelo núcleo: o vínculo `support` que
// `startSupportAccess` cria ou reativa, o fim pelos três caminhos sem rastro duplicado e a lista que a
// organização vê. A conta que dá suporte é `member` de uma organização de casa (A) e entra em B.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { createAccount } from "./accounts";
import { END_SUPPORT_ACCESS_TASK, endSupportAccess, listSupportAccesses, startSupportAccess } from "./support-access";
import { withOrg, withSystem } from "./with-org";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const at = new Date("2026-05-04T10:00:00Z");
const minutesAfter = (minutes: number): Date => new Date(at.getTime() + minutes * 60_000);
const REASON = "A linha da operadora não registra";

/** Um vínculo `member` com sessão; com `admin`, a conta administra a instalação. */
async function person(organizationId: string, options: { admin?: boolean; role?: "owner" | "admin" | "operator"; name?: string } = {}) {
  const email = `support-${randomUUID()}@example.com`;
  return withSystem(app, async (q) => {
    const accountId = await createAccount(q, { email, passwordHash: "x" });
    if (!accountId) throw new Error("account not created");
    if (options.admin) await q.exec("update accounts set installation_admin_at = $2 where id = $1", [accountId, at]);
    const user = await q.one<{ id: string }>(
      `insert into users (organization_id, account_id, email, name, role, phone_e164, whatsapp_e164)
       values ($1, $2, $3, $4, $5, '+5531999990001', '+5531999990001') returning id`,
      [organizationId, accountId, email, options.name ?? "Rafa da Agência", options.role ?? "owner"],
    );
    const session = await q.one<{ id: string }>(
      "insert into sessions (organization_id, user_id, account_id, token_hash, expires_at) values ($1, $2, $3, $4, $5) returning id",
      [organizationId, user?.id, accountId, `token-${randomUUID()}`, minutesAfter(60 * 24)],
    );
    return { accountId, userId: user?.id ?? "", sessionId: session?.id ?? "" };
  });
}

async function scene(label: string) {
  const home = await createOrganization(app, `Casa ${label}`);
  const client = await createOrganization(app, `Cliente ${label}`);
  const actor = await person(home, { admin: true });
  return { home, client, actor };
}

const start = (s: Awaited<ReturnType<typeof scene>>, extra: Partial<{ reason: string; minutes: number; organizationId: string }> = {}, now = at) =>
  startSupportAccess(app, { actorAccountId: s.actor.accountId, sessionId: s.actor.sessionId, organizationId: s.client, reason: REASON, minutes: 30, ...extra }, now);

const sessionRow = (sessionId: string) =>
  withSystem(app, (q) => q.one<{ organizationId: string; userId: string; supportAccessId: string | null }>(
    `select organization_id as "organizationId", user_id as "userId", support_access_id as "supportAccessId" from sessions where id = $1`,
    [sessionId],
  ));
const linkRow = (userId: string) =>
  withSystem(app, (q) => q.one<{ kind: string; role: string; name: string; phone: string | null; whatsapp: string | null; disabledAt: Date | null }>(
    `select kind, role, name, phone_e164 as phone, whatsapp_e164 as whatsapp, disabled_at as "disabledAt" from users where id = $1`,
    [userId],
  ));
const orgEvents = (organizationId: string, kind: string) =>
  withOrg(app, organizationId, (q) => q.many<{ actor: string | null; payload: Record<string, unknown> }>("select actor_user_id as actor, payload from organization_events where kind = $1 order by id", [kind]));
const installationEvents = (organizationId: string, kind: string) =>
  withSystem(app, (q) => q.many<{ actor: string | null; payload: Record<string, unknown> }>("select actor_account_id as actor, payload from installation_events where organization_id = $1 and kind = $2 order by id", [organizationId, kind]));
const lastOrganization = (accountId: string) =>
  withSystem(app, async (q) => (await q.one<{ id: string | null }>("select last_organization_id as id from accounts where id = $1", [accountId]))?.id ?? null);

describe("startSupportAccess", () => {
  it("creates an admin support link without phone or WhatsApp, moves the session there and leaves the trail on both sides", async () => {
    const s = await scene("start");
    const started = await start(s);
    if (!started.ok) throw new Error(started.reason);
    expect(started.expiresAt).toEqual(minutesAfter(30));

    expect(await linkRow(started.userId)).toEqual({ kind: "support", role: "admin", name: "Rafa da Agência", phone: null, whatsapp: null, disabledAt: null });
    expect(await sessionRow(s.actor.sessionId)).toEqual({ organizationId: s.client, userId: started.userId, supportAccessId: started.supportAccessId });
    // O próximo login nunca cai na organização do suporte.
    expect(await lastOrganization(s.actor.accountId)).toBeNull();

    const detail = { support_access_id: started.supportAccessId, reason: REASON, minutes: 30, expires_at: minutesAfter(30).toISOString() };
    expect(await orgEvents(s.client, "support_access_started")).toEqual([{ actor: started.userId, payload: detail }]);
    expect(await installationEvents(s.client, "support_access_started")).toEqual([{ actor: s.actor.accountId, payload: detail }]);
    // Nada na organização de casa.
    expect(await orgEvents(s.home, "support_access_started")).toEqual([]);

    const tasks = await withOrg(app, s.client, (q) => q.many<{ kind: string; payload: unknown; runAt: Date }>('select kind, payload, run_at as "runAt" from tasks where kind = $1', [END_SUPPORT_ACCESS_TASK]));
    expect(tasks).toEqual([{ kind: END_SUPPORT_ACCESS_TASK, payload: { supportAccessId: started.supportAccessId }, runAt: minutesAfter(30) }]);
  });

  it("accepts a suspended organization", async () => {
    const s = await scene("suspended");
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = $2, suspended_reason = 'Inadimplência do cliente' where id = $1", [s.client, at]));
    expect((await start(s)).ok).toBe(true);
  });

  it("refuses the organization where the account is already a member, without a second link and without touching the member", async () => {
    const s = await scene("already member");
    const member = await withSystem(app, (q) =>
      q.one<{ id: string }>("insert into users (organization_id, account_id, email, name, role, disabled_at) select $1, id, email, 'Membro', 'operator', $3 from accounts where id = $2 returning id", [
        s.client,
        s.actor.accountId,
        at,
      ]),
    );
    expect(await start(s)).toEqual({ ok: false, reason: "already_member" });
    const links = await withSystem(app, (q) => q.many<{ id: string; kind: string; role: string; disabled: boolean }>("select id, kind, role, disabled_at is not null as disabled from users where organization_id = $1 and account_id = $2", [s.client, s.actor.accountId]));
    expect(links).toEqual([{ id: member?.id, kind: "member", role: "operator", disabled: true }]);
    expect((await sessionRow(s.actor.sessionId))?.organizationId).toBe(s.home);
  });

  it.each([
    ["a length outside 15, 30 and 60", { minutes: 45 }, "invalid_minutes"],
    ["zero minutes", { minutes: 0 }, "invalid_minutes"],
    ["a reason under 10 characters", { reason: "  curto   " }, "invalid_reason"],
    ["a reason over 500 characters", { reason: "x".repeat(501) }, "invalid_reason"],
    ["an organization that does not exist", { organizationId: randomUUID() }, "not_found"],
  ] as const)("refuses %s, and writes nothing", async (_label, extra, reason) => {
    const s = await scene(`refusal ${reason}`);
    expect(await start(s, extra)).toEqual({ ok: false, reason });
    expect(await sessionRow(s.actor.sessionId)).toMatchObject({ organizationId: s.home, supportAccessId: null });
    expect(await withSystem(app, (q) => q.many("select 1 from users where account_id = $1 and kind = 'support'", [s.actor.accountId]))).toEqual([]);
  });

  it("refuses an account that does not administer the installation", async () => {
    const s = await scene("not admin");
    const plain = await person(s.home, { role: "admin" });
    const refused = await startSupportAccess(app, { actorAccountId: plain.accountId, sessionId: plain.sessionId, organizationId: s.client, reason: REASON, minutes: 15 }, at);
    expect(refused).toEqual({ ok: false, reason: "not_installation_admin" });
  });

  it("refuses to open a support access from a support session", async () => {
    const s = await scene("nested");
    expect((await start(s)).ok).toBe(true);
    const third = await createOrganization(app, "Terceira nested");
    expect(await start(s, { organizationId: third })).toEqual({ ok: false, reason: "session_not_found" });
  });

  it("reactivates the same link as admin, with phone and WhatsApp cleared again, never as owner", async () => {
    const s = await scene("reactivate");
    const first = await start(s);
    if (!first.ok) throw new Error(first.reason);
    await endSupportAccess(app, first.supportAccessId, minutesAfter(5), "ended");
    // O pior caso, por SQL: alguém pôs telefone, WhatsApp e papel de dono no vínculo desativado.
    await withSystem(app, (q) => q.exec("update users set phone_e164 = '+5531988887777', whatsapp_e164 = '+5531988887777', role = 'owner' where id = $1", [first.userId]));
    // A sessão voltou para casa e entra de novo.
    const second = await start(s, {}, minutesAfter(10));
    if (!second.ok) throw new Error(second.reason);
    expect(second.userId).toBe(first.userId);
    expect(await linkRow(second.userId)).toMatchObject({ role: "admin", phone: null, whatsapp: null, disabledAt: null });
    const links = await withSystem(app, (q) => q.many("select 1 from users where organization_id = $1 and account_id = $2", [s.client, s.actor.accountId]));
    expect(links).toHaveLength(1);
  });

  it("refuses a second live access of the same link, and closes the one already past its time", async () => {
    const s = await scene("second session");
    const first = await start(s);
    if (!first.ok) throw new Error(first.reason);
    // A mesma conta, noutro aparelho, na organização de casa.
    const other = await withSystem(app, (q) =>
      q.one<{ id: string }>("insert into sessions (organization_id, user_id, account_id, token_hash, expires_at) values ($1, $2, $3, $4, $5) returning id", [
        s.home,
        s.actor.userId,
        s.actor.accountId,
        `token-${randomUUID()}`,
        minutesAfter(60 * 24),
      ]),
    );
    const again = { ...s, actor: { ...s.actor, sessionId: other?.id ?? "" } };
    expect(await start(again, {}, minutesAfter(5))).toEqual({ ok: false, reason: "support_access_active" });
    // Passado o prazo do primeiro, sem ninguém ter encerrado: o segundo encerra o primeiro e começa.
    const later = await start(again, {}, minutesAfter(31));
    expect(later.ok).toBe(true);
    expect(await orgEvents(s.client, "support_access_ended")).toEqual([
      { actor: null, payload: { support_access_id: first.supportAccessId, cause: "expired", ended_at: minutesAfter(30).toISOString() } },
    ]);
  });
});

describe("endSupportAccess", () => {
  it("ends once: a second call, from any path, writes nothing", async () => {
    const s = await scene("idempotent");
    const started = await start(s);
    if (!started.ok) throw new Error(started.reason);

    expect(await endSupportAccess(app, started.supportAccessId, minutesAfter(5), "ended")).toBe(true);
    expect(await endSupportAccess(app, started.supportAccessId, minutesAfter(6), "ended")).toBe(false);
    expect(await endSupportAccess(app, started.supportAccessId, minutesAfter(31), "expired")).toBe(false);

    const ended = { support_access_id: started.supportAccessId, cause: "ended", ended_at: minutesAfter(5).toISOString() };
    expect(await orgEvents(s.client, "support_access_ended")).toEqual([{ actor: started.userId, payload: ended }]);
    expect(await installationEvents(s.client, "support_access_ended")).toEqual([{ actor: s.actor.accountId, payload: ended }]);
    expect((await linkRow(started.userId))?.disabledAt).toEqual(minutesAfter(5));
    expect(await sessionRow(s.actor.sessionId)).toEqual({ organizationId: s.home, userId: s.actor.userId, supportAccessId: null });
  });

  it("does not expire an access before its time, and records `expires_at` as the end when it does", async () => {
    const s = await scene("expire");
    const started = await start(s, { minutes: 15 });
    if (!started.ok) throw new Error(started.reason);
    expect(await endSupportAccess(app, started.supportAccessId, minutesAfter(14), "expired")).toBe(false);
    expect((await sessionRow(s.actor.sessionId))?.organizationId).toBe(s.client);

    expect(await endSupportAccess(app, started.supportAccessId, minutesAfter(40), "expired")).toBe(true);
    const row = await withOrg(app, s.client, (q) => q.one<{ endedAt: Date }>('select ended_at as "endedAt" from support_accesses where id = $1', [started.supportAccessId]));
    expect(row?.endedAt).toEqual(minutesAfter(15));
    expect(await installationEvents(s.client, "support_access_ended")).toEqual([
      { actor: null, payload: { support_access_id: started.supportAccessId, cause: "expired", ended_at: minutesAfter(15).toISOString() } },
    ]);
  });

  it("brings the session back to the account's last organization when it still has an active member link there", async () => {
    const s = await scene("last organization");
    const other = await createOrganization(app, "Segunda casa");
    const second = await withSystem(app, (q) =>
      q.one<{ id: string }>("insert into users (organization_id, account_id, email, name, role) select $1, id, email, 'Rafa', 'admin' from accounts where id = $2 returning id", [other, s.actor.accountId]),
    );
    await withSystem(app, (q) => q.exec("update accounts set last_organization_id = $2 where id = $1", [s.actor.accountId, other]));
    const started = await start(s);
    if (!started.ok) throw new Error(started.reason);
    await endSupportAccess(app, started.supportAccessId, minutesAfter(1), "ended");
    expect(await sessionRow(s.actor.sessionId)).toEqual({ organizationId: other, userId: second?.id, supportAccessId: null });
  });

  it("deletes the session when the account has no active member link left", async () => {
    const s = await scene("no home");
    const started = await start(s);
    if (!started.ok) throw new Error(started.reason);
    await withSystem(app, (q) => q.exec("update users set disabled_at = $2 where id = $1", [s.actor.userId, at]));
    await endSupportAccess(app, started.supportAccessId, minutesAfter(1), "ended");
    expect(await sessionRow(s.actor.sessionId)).toBeNull();
    expect((await linkRow(started.userId))?.disabledAt).not.toBeNull();
  });
});

describe("listSupportAccesses", () => {
  it("lists the accesses the organization received, newest first, and nothing of another organization", async () => {
    const s = await scene("list");
    const first = await start(s);
    if (!first.ok) throw new Error(first.reason);
    await endSupportAccess(app, first.supportAccessId, minutesAfter(2), "ended");
    const second = await start(s, { reason: "Conferir o agente de vendas", minutes: 60 }, minutesAfter(3));
    if (!second.ok) throw new Error(second.reason);

    expect(await listSupportAccesses(app, s.client)).toEqual([
      { id: second.supportAccessId, userId: second.userId, reason: "Conferir o agente de vendas", startedAt: minutesAfter(3), expiresAt: minutesAfter(63), endedAt: null },
      { id: first.supportAccessId, userId: first.userId, reason: REASON, startedAt: at, expiresAt: minutesAfter(30), endedAt: minutesAfter(2) },
    ]);
    expect(await listSupportAccesses(app, s.home)).toEqual([]);
  });
});
