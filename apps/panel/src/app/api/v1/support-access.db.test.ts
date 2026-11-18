// O acesso de suporte da instalação pelas rotas (R8 seção 3.6, fatia 5c), sem tela: entrar com
// motivo e prazo, encerrar, e o que acontece depois do prazo. A conta que dá suporte é `member` em A
// e entra em B; C é uma terceira organização.
import { withOrg, withSystem, type ClaimedTask } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SECRET_KEY, NOW, call, createOrganization, createUser, startPanel, type Result } from "../../../../test/kit";
import endSupportAccessRoutine from "../../../../../routines/src/routines/end_support_access";
import { SUPPORT_SESSION_FORBIDDEN } from "../../../server/context";
import { POST as logout } from "./auth/logout/route";
import { GET as me } from "./auth/me/route";
import { GET as myOrganizations } from "./auth/organizations/route";
import { POST as endSupport } from "./auth/support/end/route";
import { POST as switchOrganization } from "./auth/switch/route";
import { GET as owners } from "./follow-ups/owners/route";
import { GET as installationAdmins } from "./installation/admins/route";
import { GET as installationEvents } from "./installation/events/route";
import { GET as organizations } from "./installation/organizations/route";
import { GET as suspensionPreview } from "./installation/organizations/[id]/suspension/route";
import { POST as support } from "./installation/organizations/[id]/support/route";
import { GET as team } from "./team/route";

const panel = startPanel();
afterAll(() => panel.close());
beforeEach(() => {
  panel.clock.at = NOW;
});

const REASON = "A linha da operadora não registra";
const after = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);
const refusal = (result: Result) => [result.status, result.code];

async function accountOf(userId: string): Promise<string> {
  return (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [userId])))?.id ?? "";
}

/** A, B e C; em A, quem administra a instalação (`owner`, com a marca) e um `admin` sem a marca. */
async function scene(label: string) {
  const a = await createOrganization(panel.app, `A ${label}`);
  const b = await createOrganization(panel.app, `B ${label}`);
  const c = await createOrganization(panel.app, `C ${label}`);
  const supporter = await createUser(panel.app, a, "owner");
  await withSystem(panel.app, async (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [await accountOf(supporter.id), NOW]));
  const plain = await createUser(panel.app, a, "admin");
  const clientOwner = await createUser(panel.app, b, "owner");
  return { a, b, c, supporter, plain, clientOwner };
}

const enter = (cookie: string, organizationId: string, body: unknown = { reason: REASON, minutes: 30 }) =>
  call(support, { method: "POST", cookie, params: { id: organizationId }, body });
const whereAmI = async (cookie: string) => {
  const result = await call(me, { cookie });
  return result.status === 200 ? (result.data as { organizationName: string }).organizationName : result.status;
};
/** A tarefa `end_support_access` da organização, como a fila a entregaria (a fila é de todos os testes). */
async function queuedEnd(organizationId: string): Promise<ClaimedTask> {
  const row = await withOrg(panel.app, organizationId, (q) =>
    q.one<{ id: string; payload: Record<string, unknown>; runAt: Date }>(`select id, payload, run_at as "runAt" from tasks where kind = 'end_support_access' and status = 'queued'`),
  );
  if (!row) throw new Error("no end_support_access task");
  return { id: row.id, organizationId, callId: null, kind: "end_support_access", payload: row.payload, attempts: 1 };
}
const orgEvents = (organizationId: string, kind: string) =>
  withOrg(panel.app, organizationId, (q) => q.many<{ payload: Record<string, unknown> }>("select payload from organization_events where kind = $1", [kind]));
const installationEventsOf = (organizationId: string, kind: string) =>
  withSystem(panel.app, (q) => q.many<{ payload: Record<string, unknown> }>("select payload from installation_events where organization_id = $1 and kind = $2", [organizationId, kind]));

describe("entering an organization as installation support", () => {
  it("moves the session into the organization as an admin, with the reason and the deadline", async () => {
    const s = await scene("enter");
    const entered = await enter(s.supporter.cookie, s.b);
    expect(refusal(entered)).toEqual([200, undefined]);
    expect(entered.data).toMatchObject({ organizationId: s.b, expiresAt: after(30).toISOString() });
    const who = await call(me, { cookie: s.supporter.cookie });
    expect(who.data).toMatchObject({ organizationName: "B enter", role: "admin", phone: null, whatsapp: null });
    expect(await orgEvents(s.b, "support_access_started")).toEqual([{ payload: expect.objectContaining({ reason: REASON, minutes: 30 }) }]);
    expect(await installationEventsOf(s.b, "support_access_started")).toEqual([{ payload: expect.objectContaining({ reason: REASON, minutes: 30 }) }]);
  });

  it.each([
    ["a length outside the list", { reason: REASON, minutes: 45 }, "invalid_support_minutes"],
    ["a short reason", { reason: "curto", minutes: 15 }, "invalid_support_reason"],
    ["a length that is not a number", { reason: REASON, minutes: "30" }, "validation_error"],
  ])("answers 400 to %s", async (_label, body, code) => {
    const s = await scene(`bad ${code}`);
    expect(refusal(await enter(s.supporter.cookie, s.b, body))).toEqual([400, code]);
    expect(await whereAmI(s.supporter.cookie)).toBe(`A bad ${code}`);
  });

  it("answers 403 to an account that does not administer the installation", async () => {
    const s = await scene("not admin");
    expect(refusal(await enter(s.plain.cookie, s.b))).toEqual([403, "forbidden"]);
    expect(await whereAmI(s.plain.cookie)).toBe("A not admin");
  });

  it("answers 409 `already_member` where the account is on the team, and the member link stays as it was", async () => {
    const s = await scene("member");
    expect(refusal(await enter(s.supporter.cookie, s.a))).toEqual([409, "already_member"]);
    const links = await withSystem(panel.app, async (q) => q.many("select kind, role from users where account_id = $1", [await accountOf(s.supporter.id)]));
    expect(links).toEqual([{ kind: "member", role: "owner" }]);
  });

  it("answers 404 to an organization that does not exist", async () => {
    const s = await scene("missing");
    expect(refusal(await enter(s.supporter.cookie, "00000000-0000-4000-8000-000000000000"))).toEqual([404, "not_found"]);
  });

  it("keeps the support session inside the client: no other support access, no installation area, no switch, an empty selector", async () => {
    const s = await scene("inside");
    await enter(s.supporter.cookie, s.b);
    expect(refusal(await enter(s.supporter.cookie, s.c))).toEqual([403, SUPPORT_SESSION_FORBIDDEN]);
    for (const read of [organizations, installationEvents, installationAdmins]) expect(refusal(await call(read, { cookie: s.supporter.cookie }))).toEqual([403, SUPPORT_SESSION_FORBIDDEN]);
    expect(refusal(await call(suspensionPreview, { cookie: s.supporter.cookie, params: { id: s.b } }))).toEqual([403, SUPPORT_SESSION_FORBIDDEN]);
    expect(refusal(await call(switchOrganization, { method: "POST", cookie: s.supporter.cookie, body: { organizationId: s.a } }))).toEqual([403, SUPPORT_SESSION_FORBIDDEN]);
    const selector = await call(myOrganizations, { cookie: s.supporter.cookie });
    expect([selector.status, selector.data]).toEqual([200, []]);
    expect(await whereAmI(s.supporter.cookie)).toBe("B inside");
  });
});

describe("ending the support access", () => {
  it("answers 404 outside a support session", async () => {
    const s = await scene("end outside");
    expect(refusal(await call(endSupport, { method: "POST", cookie: s.supporter.cookie }))).toEqual([404, "not_found"]);
  });

  it("brings the session back home, disables the link and leaves one trail on each side", async () => {
    const s = await scene("end");
    await enter(s.supporter.cookie, s.b);
    panel.clock.at = after(5);
    expect(refusal(await call(endSupport, { method: "POST", cookie: s.supporter.cookie }))).toEqual([200, undefined]);
    expect(await whereAmI(s.supporter.cookie)).toBe("A end");
    // A sessão é de `member` de novo: encerrar outra vez é 404, e nada se grava.
    expect(refusal(await call(endSupport, { method: "POST", cookie: s.supporter.cookie }))).toEqual([404, "not_found"]);
    expect(await orgEvents(s.b, "support_access_ended")).toEqual([{ payload: expect.objectContaining({ cause: "ended", ended_at: after(5).toISOString() }) }]);
    expect(await installationEventsOf(s.b, "support_access_ended")).toEqual([{ payload: expect.objectContaining({ cause: "ended" }) }]);
    const link = await withSystem(panel.app, (q) => q.one<{ disabled: boolean }>("select disabled_at is not null as disabled from users where organization_id = $1 and kind = 'support'", [s.b]));
    expect(link?.disabled).toBe(true);
  });

  it("signing out of a support session ends the access at once: ended, link disabled, one trail on each side", async () => {
    const s = await scene("logout");
    await enter(s.supporter.cookie, s.b);
    const access = await withSystem(panel.app, (q) => q.one<{ id: string }>("select id from support_accesses where organization_id = $1", [s.b]));
    panel.clock.at = after(5);
    expect(refusal(await call(logout, { method: "POST", cookie: s.supporter.cookie }))).toEqual([200, undefined]);
    expect(await whereAmI(s.supporter.cookie)).toBe(401);
    const state = await withSystem(panel.app, (q) =>
      q.one<{ endedAt: Date | null; disabled: boolean; sessions: number }>(
        `select sa.ended_at as "endedAt", u.disabled_at is not null as disabled, (select count(*)::int from sessions where support_access_id = sa.id or user_id = sa.user_id) as sessions
           from support_accesses sa join users u on u.id = sa.user_id where sa.id = $1`,
        [access?.id],
      ),
    );
    expect(state).toEqual({ endedAt: after(5), disabled: true, sessions: 0 });
    // A tarefa da fila, que roda depois, não acha nada para encerrar.
    await endSupportAccessRoutine.run(await queuedEnd(s.b), { db: panel.app, clock: { now: () => after(31) }, secretKey: SECRET_KEY });
    expect(await orgEvents(s.b, "support_access_ended")).toEqual([{ payload: expect.objectContaining({ cause: "ended", ended_at: after(5).toISOString() }) }]);
    expect(await installationEventsOf(s.b, "support_access_ended")).toEqual([{ payload: expect.objectContaining({ cause: "ended" }) }]);
  });

  it("signing out of a member session is as before", async () => {
    const s = await scene("logout member");
    expect(refusal(await call(logout, { method: "POST", cookie: s.supporter.cookie }))).toEqual([200, undefined]);
    expect(await whereAmI(s.supporter.cookie)).toBe(401);
  });

  it("works in a suspended organization", async () => {
    const s = await scene("end suspended");
    await withSystem(panel.app, (q) => q.exec("update organizations set suspended_at = $2, suspended_reason = 'Pagamento atrasado' where id = $1", [s.b, NOW]));
    expect(refusal(await enter(s.supporter.cookie, s.b))).toEqual([200, undefined]);
    expect(refusal(await call(endSupport, { method: "POST", cookie: s.supporter.cookie }))).toEqual([200, undefined]);
    expect(await whereAmI(s.supporter.cookie)).toBe("A end suspended");
  });
});

describe("a support session without a live access", () => {
  // Estados que o código não produz (o fim move a sessão na mesma transação), montados por SQL: a
  // conferência da sessão não depende de o fim ter dado certo.
  it.each([
    ["the access was ended but the session still points to it", "update support_accesses set ended_at = started_at where organization_id = $1"],
    ["the support link's session lost its access", "update sessions set support_access_id = null where organization_id = $1"],
  ])("is not a session when %s", async (_label, sql) => {
    const s = await scene(`no access ${sql.slice(7, 15)}`);
    await enter(s.supporter.cookie, s.b);
    await withSystem(panel.app, (q) => q.exec(sql, [s.b]));
    expect((await call(me, { cookie: s.supporter.cookie })).status).toBe(401);
  });
});

describe("after the deadline", () => {
  it("the next request ends the access and never lands in the client; the queue task that runs later writes nothing", async () => {
    const s = await scene("deadline");
    await enter(s.supporter.cookie, s.b, { reason: REASON, minutes: 15 });
    panel.clock.at = after(14);
    expect(await whereAmI(s.supporter.cookie)).toBe("B deadline");

    panel.clock.at = after(16);
    // A primeira requisição depois do prazo não é atendida em B: dá 401, e a sessão já voltou para A.
    const first = await call(me, { cookie: s.supporter.cookie });
    expect(first.status).toBe(401);
    expect(await whereAmI(s.supporter.cookie)).toBe("A deadline");
    expect((await call(team, { cookie: s.supporter.cookie })).text).not.toContain(s.clientOwner.id);

    // A tarefa da fila roda depois, como em produção.
    await endSupportAccessRoutine.run(await queuedEnd(s.b), { db: panel.app, clock: { now: () => after(17) }, secretKey: SECRET_KEY });

    expect(await orgEvents(s.b, "support_access_ended")).toEqual([{ payload: expect.objectContaining({ cause: "expired", ended_at: after(15).toISOString() }) }]);
    expect(await installationEventsOf(s.b, "support_access_ended")).toEqual([{ payload: expect.objectContaining({ cause: "expired" }) }]);
    const link = await withSystem(panel.app, (q) => q.one<{ id: string; disabled: boolean }>("select id, disabled_at is not null as disabled from users where organization_id = $1 and kind = 'support'", [s.b]));
    expect(link?.disabled).toBe(true);
    // Nem a escolha de responsável de B alcança o vínculo.
    const offered = (await call(owners, { cookie: s.clientOwner.cookie })).data as Array<{ id: string }>;
    expect(offered.map((row) => row.id)).not.toContain(link?.id);
    // Nunca `last_organization_id` em B.
    const last = await withSystem(panel.app, async (q) => q.one<{ id: string | null }>("select last_organization_id as id from accounts where id = $1", [await accountOf(s.supporter.id)]));
    expect(last?.id).not.toBe(s.b);
  });

  it("the queue task alone ends an access nobody used again, and the session is home on the next request", async () => {
    const s = await scene("queue only");
    await enter(s.supporter.cookie, s.b, { reason: REASON, minutes: 15 });
    const queued = await queuedEnd(s.b);
    // Antes do prazo, a tarefa não encerra nada (a fila só a entrega no `run_at`, mas a rotina confere).
    await endSupportAccessRoutine.run(queued, { db: panel.app, clock: { now: () => after(14) }, secretKey: SECRET_KEY });
    expect(await orgEvents(s.b, "support_access_ended")).toEqual([]);
    await endSupportAccessRoutine.run(queued, { db: panel.app, clock: { now: () => after(15) }, secretKey: SECRET_KEY });
    expect(await orgEvents(s.b, "support_access_ended")).toHaveLength(1);
    panel.clock.at = after(20);
    expect(await whereAmI(s.supporter.cookie)).toBe("A queue only");
    expect(await orgEvents(s.b, "support_access_ended")).toHaveLength(1);
  });
});
