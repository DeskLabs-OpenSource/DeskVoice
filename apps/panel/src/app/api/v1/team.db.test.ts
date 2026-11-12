import { findInviteByToken, hashToken, withOrg } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NOW, PASSWORD, call, createCall, createOrganization, createUser, insert, openSession, startPanel } from "../../../../test/kit";
import { loginLimiter } from "../../../server/rate-limit";
import { POST as createAgent } from "./agents/route";
import { POST as login } from "./auth/login/route";
import { GET as me } from "./auth/me/route";
import { POST as changePassword } from "./auth/password/route";
import { POST as acceptInvite } from "./invites/[token]/accept/route";
import { GET as readInvite } from "./invites/[token]/route";
import { DELETE as revokeInvite } from "./team/invites/[id]/route";
import { POST as invite } from "./team/invites/route";
import { GET as team } from "./team/route";
import { DELETE as removeUser, PATCH as patchUser } from "./team/users/[id]/route";

const panel = startPanel();
beforeEach(() => {
  loginLimiter.clear();
  panel.clock.at = NOW;
});
afterAll(() => panel.close());

type Person = Awaited<ReturnType<typeof createUser>>;
const newOrg = async (label: string): Promise<{ org: string; owner: Person }> => {
  const org = await createOrganization(panel.app, label);
  return { org, owner: await createUser(panel.app, org, "owner") };
};
const patch = (cookie: string, id: string, body: unknown) => call(patchUser, { method: "PATCH", cookie, params: { id }, body });
const remove = (cookie: string, id: string) => call(removeUser, { method: "DELETE", cookie, params: { id } });
const signIn = (email: string, password: string) => call(login, { method: "POST", body: { email, password } });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];
const stored = (org: string, sql: string, params: unknown[]) => withOrg(panel.app, org, (q) => q.one(sql, params));

let counter = 0;
async function newInvite(cookie: string, role = "operator", email = `invited-${++counter}@example.test`) {
  const result = await call(invite, { method: "POST", cookie, body: { email, name: "Pessoa Convidada", role } });
  const data = result.data as { id: string; link: string } | undefined;
  return { result, email, id: data?.id ?? "", link: data?.link ?? "", token: data?.link.split("/invite/")[1] ?? "" };
}

describe("who can manage the team", () => {
  it("an operator does not see the team screen or any of its actions", async () => {
    const { org, owner } = await newOrg("team operator");
    const operator = await createUser(panel.app, org, "operator");
    const pending = await newInvite(owner.cookie);
    const attempts = await Promise.all([
      call(team, { cookie: operator.cookie }),
      call(invite, { method: "POST", cookie: operator.cookie, body: { email: "x@example.test", name: "X", role: "operator" } }),
      call(revokeInvite, { method: "DELETE", cookie: operator.cookie, params: { id: pending.id } }),
      patch(operator.cookie, owner.id, { disabled: true }),
      remove(operator.cookie, owner.id),
    ]);
    for (const result of attempts) expect(refusal(result)).toEqual([403, "forbidden"]);
    expect((await call(team, { cookie: owner.cookie })).status).toBe(200);
  });

  it("an admin manages admins and operators, and cannot create, change, disable, remove or uninvite an owner", async () => {
    const { org, owner } = await newOrg("team admin");
    const admin = await createUser(panel.app, org, "admin");
    const operator = await createUser(panel.app, org, "operator");
    const ownerInvite = await newInvite(owner.cookie, "owner");

    const forbidden = await Promise.all([
      newInvite(admin.cookie, "owner").then((created) => created.result),
      patch(admin.cookie, owner.id, { role: "admin" }),
      patch(admin.cookie, owner.id, { disabled: true }),
      patch(admin.cookie, operator.id, { role: "owner" }),
      remove(admin.cookie, owner.id),
      call(revokeInvite, { method: "DELETE", cookie: admin.cookie, params: { id: ownerInvite.id } }),
    ]);
    for (const result of forbidden) expect(refusal(result)).toEqual([403, "cannot_manage_owner"]);
    expect(await stored(org, "select role, disabled_at from users where id = $1", [owner.id])).toEqual({ role: "owner", disabled_at: null });
    expect((await call(readInvite, { params: { token: ownerInvite.token } })).status).toBe(200);

    expect((await newInvite(admin.cookie, "admin")).result.status).toBe(200);
    expect((await patch(admin.cookie, operator.id, { role: "admin" })).data).toMatchObject({ role: "admin", active: true });
    expect((await patch(admin.cookie, operator.id, { disabled: true })).data).toMatchObject({ active: false });
    expect((await remove(admin.cookie, operator.id)).status).toBe(200);
  });

  it("changing the role changes what the person can do, both ways, without a new sign-in", async () => {
    const { org, owner } = await newOrg("team role switch");
    const person = await createUser(panel.app, org, "operator");
    const tryToConfigure = () => call(createAgent, { method: "POST", cookie: person.cookie, body: { name: "A", engine: "simulated" } });

    expect((await tryToConfigure()).status).toBe(403);
    await patch(owner.cookie, person.id, { role: "admin" });
    expect((await tryToConfigure()).status).toBe(200);
    expect((await call(team, { cookie: person.cookie })).status).toBe(200);
    await patch(owner.cookie, person.id, { role: "operator" });
    expect((await tryToConfigure()).status).toBe(403);
    expect((await call(team, { cookie: person.cookie })).status).toBe(403);
  });
});

describe("there is always an active owner", () => {
  it("the only owner cannot be demoted, disabled or removed, not even by themselves", async () => {
    const { org, owner } = await newOrg("last owner");
    const admin = await createUser(panel.app, org, "admin");
    expect(refusal(await patch(owner.cookie, owner.id, { role: "admin" }))).toEqual([400, "cannot_change_self_role"]);
    expect(refusal(await patch(owner.cookie, owner.id, { disabled: true }))).toEqual([409, "last_owner"]);
    expect(refusal(await remove(owner.cookie, owner.id))).toEqual([409, "last_owner"]);
    expect(await stored(org, "select role, disabled_at from users where id = $1", [owner.id])).toEqual({ role: "owner", disabled_at: null });
    expect((await call(me, { cookie: owner.cookie })).status).toBe(200);
    expect(admin.id).not.toBe(owner.id);
  });

  it("a disabled owner does not count: the last ACTIVE owner is protected, and with two active either can go", async () => {
    const { org, owner } = await newOrg("two owners");
    const second = await createUser(panel.app, org, "owner");

    // Dois ativos: um rebaixa o outro.
    expect((await patch(owner.cookie, second.id, { role: "admin" })).data).toMatchObject({ role: "admin" });
    // Sobrou um: ele não sai de jeito nenhum.
    expect(refusal(await patch(owner.cookie, owner.id, { disabled: true }))).toEqual([409, "last_owner"]);

    await patch(owner.cookie, second.id, { role: "owner" });
    await patch(owner.cookie, second.id, { disabled: true });
    // O segundo é dono, mas está desativado: o primeiro continua sendo o último ativo.
    expect(refusal(await patch(owner.cookie, owner.id, { disabled: true }))).toEqual([409, "last_owner"]);
    expect(refusal(await remove(owner.cookie, owner.id))).toEqual([409, "last_owner"]);

    await patch(owner.cookie, second.id, { disabled: false });
    const secondAgain = await openSession(panel.app, org, second.id);
    expect((await patch(secondAgain, owner.id, { disabled: true })).data).toMatchObject({ active: false });
    expect(refusal(await patch(secondAgain, second.id, { disabled: true }))).toEqual([409, "last_owner"]);
  });

  it("of two owners demoting each other at the same time, one is refused", async () => {
    const { org, owner } = await newOrg("owner race");
    const second = await createUser(panel.app, org, "owner");
    const results = await Promise.all([patch(owner.cookie, second.id, { disabled: true }), patch(second.cookie, owner.id, { disabled: true })]);
    const active = await withOrg(panel.app, org, (q) => q.many("select id from users where role = 'owner' and disabled_at is null"));
    expect(active).toHaveLength(1);
    // O que perde recebe a recusa da regra, não um erro de servidor por espera cruzada no banco.
    expect(results.map((result) => [result.status, result.code ?? "ok"]).sort()).toEqual([[200, "ok"], [409, "last_owner"]]);
  });
});

describe("isolation", () => {
  it("organization A neither sees nor touches a person or an invite of organization B", async () => {
    const a = await newOrg("team iso A");
    const b = await newOrg("team iso B");
    const theirPerson = await createUser(panel.app, b.org, "operator");
    const theirInvite = await newInvite(b.owner.cookie);
    const before = await stored(b.org, "select role, disabled_at from users where id = $1", [theirPerson.id]);

    const attempts = await Promise.all([
      patch(a.owner.cookie, theirPerson.id, { role: "admin" }),
      patch(a.owner.cookie, theirPerson.id, { disabled: true }),
      remove(a.owner.cookie, theirPerson.id),
      remove(a.owner.cookie, b.owner.id),
      call(revokeInvite, { method: "DELETE", cookie: a.owner.cookie, params: { id: theirInvite.id } }),
    ]);
    for (const result of attempts) expect(refusal(result)).toEqual([404, "not_found"]);
    expect(await stored(b.org, "select role, disabled_at from users where id = $1", [theirPerson.id])).toEqual(before);
    expect((await call(me, { cookie: theirPerson.cookie })).status).toBe(200);
    expect((await call(readInvite, { params: { token: theirInvite.token } })).status).toBe(200);

    const mine = await call(team, { cookie: a.owner.cookie });
    for (const leak of [theirPerson.email, b.owner.email, theirInvite.email, theirInvite.id, theirPerson.id]) expect(mine.text).not.toContain(leak);
    expect((mine.data as { people: unknown[] }).people).toHaveLength(1);
  });
});

describe("invites", () => {
  it("shows the link once, keeps only its digest, and the accepted invite opens a session with the invited role", async () => {
    const { org, owner } = await newOrg("Clínica Convite");
    const created = await newInvite(owner.cookie, "admin");
    expect(created.link).toMatch(/^https:\/\/panel\.test\/invite\/[\w-]{40,}$/);

    const listed = await call(team, { cookie: owner.cookie });
    expect((listed.data as { invites: unknown[] }).invites).toEqual([
      { id: created.id, email: created.email, name: "Pessoa Convidada", role: "admin", expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(), createdByName: "Test owner" },
    ]);
    for (const secret of [created.token, hashToken(created.token), "password_hash", "token_hash"]) expect(listed.text).not.toContain(secret);
    expect(await stored(org, "select token_hash from invites where id = $1", [created.id])).toEqual({ token_hash: hashToken(created.token) });

    const shown = await call(readInvite, { params: { token: created.token } });
    expect(shown.data).toEqual({ organizationName: "Clínica Convite", email: created.email, name: "Pessoa Convidada", role: "admin" });

    const short = await call(acceptInvite, { method: "POST", params: { token: created.token }, body: { name: "Bia", password: "short" } });
    expect(short.code).toBe("validation_error");

    const accepted = await call(acceptInvite, { method: "POST", params: { token: created.token }, body: { name: "Bia Lima", password: "a-long-enough-password" } });
    expect(accepted.data).toEqual({ name: "Bia Lima", email: created.email, role: "admin" });
    const cookie = (accepted.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect((await call(me, { cookie })).data).toMatchObject({ name: "Bia Lima", role: "admin" });
    expect((await call(team, { cookie })).status).toBe(200);
    expect((await signIn(created.email, "a-long-enough-password")).status).toBe(200);
    expect((await call(team, { cookie: owner.cookie })).data).toMatchObject({ invites: [] });
  });

  it("works once: the second accept is refused, exactly like an expired, a revoked and a made-up invite", async () => {
    const { owner } = await newOrg("team single use");
    const used = await newInvite(owner.cookie);
    const accept = (token: string) => call(acceptInvite, { method: "POST", params: { token }, body: { name: "Alguém", password: "a-long-enough-password" } });
    expect((await accept(used.token)).status).toBe(200);

    const revoked = await newInvite(owner.cookie);
    expect((await call(revokeInvite, { method: "DELETE", cookie: owner.cookie, params: { id: revoked.id } })).status).toBe(200);
    expect(refusal(await call(revokeInvite, { method: "DELETE", cookie: owner.cookie, params: { id: revoked.id } }))).toEqual([404, "not_found"]);
    const expired = await newInvite(owner.cookie);
    panel.clock.at = new Date(NOW.getTime() + 7 * 86_400_000 + 1000);

    const answers: string[] = [];
    for (const token of [used.token, revoked.token, expired.token, "made-up-token"]) {
      const read = await call(readInvite, { params: { token } });
      const again = await accept(token);
      expect(refusal(read)).toEqual([404, "invite_invalid"]);
      answers.push(read.text, again.text);
    }
    expect(new Set(answers).size).toBe(1);
    for (const email of [revoked.email, expired.email]) expect((await signIn(email, "a-long-enough-password")).status).toBe(401);
  });

  it("revoking is what turns a working link into a dead one", async () => {
    const { owner } = await newOrg("team revoke");
    const created = await newInvite(owner.cookie);
    expect((await call(readInvite, { params: { token: created.token } })).status).toBe(200);
    await call(revokeInvite, { method: "DELETE", cookie: owner.cookie, params: { id: created.id } });
    expect((await call(readInvite, { params: { token: created.token } })).status).toBe(404);
  });

  it("inviting the same e-mail again kills the previous link, and an e-mail already on the team is refused", async () => {
    const { owner } = await newOrg("team reinvite");
    const first = await newInvite(owner.cookie, "operator", `again-${++counter}@example.test`);
    const second = await newInvite(owner.cookie, "admin", first.email.toUpperCase());
    expect(second.result.status).toBe(200);
    expect((await call(readInvite, { params: { token: first.token } })).status).toBe(404);
    expect((await call(readInvite, { params: { token: second.token } })).data).toMatchObject({ role: "admin", email: first.email });
    expect(((await call(team, { cookie: owner.cookie })).data as { invites: unknown[] }).invites).toHaveLength(1);

    const taken = await newInvite(owner.cookie, "operator", owner.email);
    expect(refusal(taken.result)).toEqual([400, "email_taken"]);
    expect((await call(invite, { method: "POST", cookie: owner.cookie, body: { email: "not-an-email", name: "X", role: "operator" } })).code).toBe("validation_error");
    expect((await call(invite, { method: "POST", cookie: owner.cookie, body: { email: "x@example.test", name: "X", role: "god" } })).code).toBe("validation_error");
  });

  it("builds the link on the public address, or on the address the person is using when it is another one", async () => {
    const { owner } = await newOrg("team link host");
    const direct = await call(invite, { method: "POST", cookie: owner.cookie, origin: "http://203.0.113.10:3000", body: { email: `host-${++counter}@example.test`, name: "X", role: "operator" } });
    expect((direct.data as { link: string }).link).toMatch(/^http:\/\/203\.0\.113\.10:3000\/invite\//);
  });

  it("limits attempts per address on the public routes, and valid invites do not use up the limit", async () => {
    const { owner } = await newOrg("team limit");
    const created = await newInvite(owner.cookie);
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    for (let attempt = 0; attempt < 8; attempt += 1) expect((await call(readInvite, { params: { token: created.token }, headers: from("192.0.2.200") })).status).toBe(200);

    for (let attempt = 0; attempt < 5; attempt += 1) expect((await call(readInvite, { params: { token: `guess-${attempt}` }, headers: from("192.0.2.201") })).status).toBe(404);
    expect(refusal(await call(readInvite, { params: { token: created.token }, headers: from("192.0.2.201") }))).toEqual([429, "too_many_attempts"]);
    const blockedAccept = await call(acceptInvite, { method: "POST", params: { token: created.token }, headers: from("192.0.2.201"), body: { name: "X", password: "a-long-enough-password" } });
    expect(refusal(blockedAccept)).toEqual([429, "too_many_attempts"]);
    expect((await call(readInvite, { params: { token: created.token }, headers: from("192.0.2.202") })).status).toBe(200);
  });
});

describe("an invite does not outlive whoever created it", () => {
  const accept = (token: string) => call(acceptInvite, { method: "POST", params: { token }, body: { name: "Volta", password: "a-long-enough-password" } });
  const isDead = async (org: string, created: { token: string; id: string; email: string }): Promise<void> => {
    expect(refusal(await call(readInvite, { params: { token: created.token } }))).toEqual([404, "invite_invalid"]);
    expect(refusal(await accept(created.token))).toEqual([404, "invite_invalid"]);
    expect(await findInviteByToken(panel.app, created.token, panel.clock.at)).toBeNull();
    expect(await stored(org, "select revoked_at is not null as revoked, accepted_at from invites where id = $1", [created.id])).toEqual({ revoked: true, accepted_at: null });
    expect(await stored(org, "select id from users where email = $1", [created.email])).toBeNull();
  };

  it("disabling a person revokes the invites they created, others stay, and reactivating does not bring them back", async () => {
    const { org, owner } = await newOrg("team invite creator disabled");
    const admin = await createUser(panel.app, org, "admin");
    const backdoor = await newInvite(admin.cookie, "admin");
    const fromOwner = await newInvite(owner.cookie);
    expect((await call(readInvite, { params: { token: backdoor.token } })).status).toBe(200);

    await patch(owner.cookie, admin.id, { disabled: true });
    await isDead(org, backdoor);
    expect((await call(readInvite, { params: { token: fromOwner.token } })).status).toBe(200);
    expect(((await call(team, { cookie: owner.cookie })).data as { invites: Array<{ id: string }> }).invites.map((entry) => entry.id)).toEqual([fromOwner.id]);

    await patch(owner.cookie, admin.id, { disabled: false });
    await isDead(org, backdoor);
  });

  it("removing a person revokes the invites they created, without failing", async () => {
    const { org, owner } = await newOrg("team invite creator removed");
    const admin = await createUser(panel.app, org, "admin");
    const backdoor = await newInvite(admin.cookie, "operator");
    const fromOwner = await newInvite(owner.cookie);

    expect((await remove(owner.cookie, admin.id)).status).toBe(200);
    await isDead(org, backdoor);
    expect(await stored(org, "select created_by from invites where id = $1", [backdoor.id])).toEqual({ created_by: null });
    expect((await accept(fromOwner.token)).status).toBe(200);
  });
});

describe("an invite does not outlive the role of whoever created it", () => {
  const alive = async (token: string): Promise<boolean> => (await call(readInvite, { params: { token } })).status === 200;
  const revoked = async (org: string, id: string) => (await stored(org, "select revoked_at is not null as revoked from invites where id = $1", [id]))?.revoked;

  it("demoted to admin loses the owner invites and keeps the rest; demoted to operator loses all; the links die on the public routes", async () => {
    const { org, owner } = await newOrg("team invite creator demoted");
    const second = await createUser(panel.app, org, "owner");
    const forOwner = await newInvite(second.cookie, "owner");
    const forAdmin = await newInvite(second.cookie, "admin");
    const forOperator = await newInvite(second.cookie, "operator");
    const fromOther = await newInvite(owner.cookie, "owner");

    await patch(owner.cookie, second.id, { role: "admin" });
    expect([await alive(forOwner.token), await alive(forAdmin.token), await alive(forOperator.token), await alive(fromOther.token)]).toEqual([false, true, true, true]);
    expect([await revoked(org, forOwner.id), await revoked(org, forAdmin.id), await revoked(org, forOperator.id)]).toEqual([true, false, false]);
    const backdoor = await call(acceptInvite, { method: "POST", params: { token: forOwner.token }, body: { name: "Dono", password: "a-long-enough-password" } });
    expect(refusal(backdoor)).toEqual([404, "invite_invalid"]);
    expect(await stored(org, "select id from users where email = $1", [forOwner.email])).toBeNull();

    await patch(owner.cookie, second.id, { role: "operator" });
    expect([await alive(forAdmin.token), await alive(forOperator.token), await alive(fromOther.token)]).toEqual([false, false, true]);
    expect([await revoked(org, forAdmin.id), await revoked(org, forOperator.id)]).toEqual([true, true]);

    // Promover de volta não ressuscita o que foi revogado.
    await patch(owner.cookie, second.id, { role: "owner" });
    expect([await alive(forOwner.token), await alive(forAdmin.token), await alive(forOperator.token)]).toEqual([false, false, false]);
  });

  it("a promotion revokes nothing", async () => {
    const { org, owner } = await newOrg("team invite creator promoted");
    const admin = await createUser(panel.app, org, "admin");
    const forAdmin = await newInvite(admin.cookie, "admin");
    const forOperator = await newInvite(admin.cookie, "operator");
    await patch(owner.cookie, admin.id, { role: "owner" });
    expect([await alive(forAdmin.token), await alive(forOperator.token)]).toEqual([true, true]);
    expect([await revoked(org, forAdmin.id), await revoked(org, forOperator.id)]).toEqual([false, false]);
  });
});

describe("re-inviting follows the same rule as every other change", () => {
  it("an admin cannot knock down a pending owner invite by re-inviting the e-mail; an owner can", async () => {
    const { org, owner } = await newOrg("team reinvite owner");
    const admin = await createUser(panel.app, org, "admin");
    const forOwner = await newInvite(owner.cookie, "owner");

    for (const role of ["operator", "admin"]) {
      const attempt = await newInvite(admin.cookie, role, forOwner.email);
      expect(refusal(attempt.result)).toEqual([403, "cannot_manage_owner"]);
    }
    expect(refusal(await call(revokeInvite, { method: "DELETE", cookie: admin.cookie, params: { id: forOwner.id } }))).toEqual([403, "cannot_manage_owner"]);
    expect((await call(readInvite, { params: { token: forOwner.token } })).data).toMatchObject({ role: "owner" });
    expect(await withOrg(panel.app, org, (q) => q.many("select id from invites where email = $1 and revoked_at is null", [forOwner.email]))).toEqual([{ id: forOwner.id }]);

    const again = await newInvite(owner.cookie, "operator", forOwner.email);
    expect(again.result.status).toBe(200);
    expect((await call(readInvite, { params: { token: forOwner.token } })).status).toBe(404);
    expect((await call(readInvite, { params: { token: again.token } })).data).toMatchObject({ role: "operator" });
    // Sobre um convite que ele pode gerir, o administrador reconvida normalmente.
    expect((await newInvite(admin.cookie, "admin", forOwner.email)).result.status).toBe(200);
  });
});

describe("disabling a person", () => {
  it("drops the open session at once, refuses sign-in exactly like a wrong password, and reactivating restores access", async () => {
    const { org, owner } = await newOrg("team disable");
    const person = await createUser(panel.app, org, "operator");
    expect((await call(me, { cookie: person.cookie })).status).toBe(200);

    expect((await patch(owner.cookie, person.id, { disabled: true })).data).toMatchObject({ active: false });
    expect((await call(me, { cookie: person.cookie })).status).toBe(401);
    // Mesmo uma sessão criada depois não vale: a conta é conferida a cada requisição.
    const sneaky = await openSession(panel.app, org, person.id);
    expect((await call(me, { cookie: sneaky })).status).toBe(401);

    const disabled = await signIn(person.email, PASSWORD);
    const wrong = await signIn(owner.email, "definitely not the password");
    expect([disabled.status, disabled.code, disabled.message]).toEqual([wrong.status, wrong.code, wrong.message]);
    expect(disabled.status).toBe(401);
    expect(disabled.headers.get("set-cookie")).toBeNull();
    expect((await call(team, { cookie: owner.cookie })).data).toMatchObject({ people: expect.arrayContaining([expect.objectContaining({ id: person.id, active: false })]) });

    expect((await patch(owner.cookie, person.id, { disabled: false })).data).toMatchObject({ active: true });
    expect((await signIn(person.email, PASSWORD)).status).toBe(200);
  });

  it("removes for good only someone who never decided an approval", async () => {
    const { org, owner } = await newOrg("team remove");
    const fresh = await createUser(panel.app, org, "operator");
    const decider = await createUser(panel.app, org, "operator");
    const callId = await createCall(panel.app, org, NOW);
    await insert(panel.app, org, "insert into approvals (organization_id, call_id, question, status, default_on_timeout, expires_at, decided_by, decided_at) values ($1, $2, 'Pode?', 'approved', 'denied', $3, $4, $3) returning id", [org, callId, NOW, decider.id]);

    expect(refusal(await remove(owner.cookie, decider.id))).toEqual([409, "has_history"]);
    expect(await stored(org, "select id from users where id = $1", [decider.id])).toEqual({ id: decider.id });

    expect((await remove(owner.cookie, fresh.id)).status).toBe(200);
    expect(await stored(org, "select id from users where id = $1", [fresh.id])).toBeNull();
    expect((await call(me, { cookie: fresh.cookie })).status).toBe(401);
    expect(refusal(await remove(owner.cookie, fresh.id))).toEqual([404, "not_found"]);
  });
});

describe("changing my password", () => {
  it("asks for the current one, refuses a short one, keeps this session and ends the others", async () => {
    const { org } = await newOrg("team password");
    const person = await createUser(panel.app, org, "operator");
    const otherDevice = await openSession(panel.app, org, person.id);
    const change = (body: unknown, cookie = person.cookie) => call(changePassword, { method: "POST", cookie, body });

    expect(refusal(await change({ current: "not my password", new: "a-brand-new-password" }))).toEqual([400, "wrong_password"]);
    expect(refusal(await change({ current: PASSWORD, new: "too-short" }))).toEqual([400, "validation_error"]);
    expect((await change({ current: PASSWORD, new: "a-brand-new-password" }, "")).status).toBe(401);
    expect((await call(me, { cookie: otherDevice })).status).toBe(200);

    expect((await change({ current: PASSWORD, new: "a-brand-new-password" })).status).toBe(200);
    expect((await call(me, { cookie: person.cookie })).status).toBe(200);
    expect((await call(me, { cookie: otherDevice })).status).toBe(401);
    expect((await signIn(person.email, "a-brand-new-password")).status).toBe(200);
    expect((await signIn(person.email, PASSWORD)).status).toBe(401);
  });
});
