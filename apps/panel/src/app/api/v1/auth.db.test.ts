import { randomUUID } from "node:crypto";
import { addMembership, grantInstallationAdmin, hashPassword, hashToken, withSystem } from "@deskvoice/core";
import type * as Core from "@deskvoice/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, PASSWORD, call, createCall, createOrganization, createUser, openSession, startPanel } from "../../../../test/kit";
import { loginLimiter } from "../../../server/rate-limit";
import { GET as listAgents } from "./agents/route";
import { POST as login } from "./auth/login/route";
import { POST as logout } from "./auth/logout/route";
import { GET as me } from "./auth/me/route";
import { GET as listOrganizations } from "./auth/organizations/route";
import { POST as changePassword } from "./auth/password/route";
import { POST as switchOrganization } from "./auth/switch/route";
import { GET as getCall } from "./calls/[id]/route";
import { GET as listCalls } from "./calls/route";
import { GET as stream } from "./events/stream/route";
import { POST as acceptInvite } from "./invites/[token]/accept/route";
import { GET as openInvite } from "./invites/[token]/route";
import { POST as createInvite } from "./team/invites/route";
import { GET as listTeam } from "./team/route";
import { DELETE as removeMember, PATCH as changeMember } from "./team/users/[id]/route";

// A limpeza da conta órfã roda depois da remoção, fora da transação, e pode falhar. O teste da conta
// órfã liga a falha; nos outros, a função de verdade roda. O teste da corrida do convite liga
// `staleInvite`: a leitura do convite diz o contrário do que a conta é, como se ela tivesse ganhado
// ou perdido a conta entre a leitura e o aceite.
const orphanCleanup = vi.hoisted(() => ({ fail: false, staleInvite: false }));
vi.mock("@deskvoice/core", async (importOriginal) => {
  const real = await importOriginal<typeof Core>();
  return {
    ...real,
    deleteAccountIfOrphan: (...args: Parameters<typeof real.deleteAccountIfOrphan>) =>
      orphanCleanup.fail ? Promise.reject(new Error("the account cleanup failed (test)")) : real.deleteAccountIfOrphan(...args),
    findInviteByToken: async (...args: Parameters<typeof real.findInviteByToken>) => {
      const found = await real.findInviteByToken(...args);
      return found && orphanCleanup.staleInvite ? { ...found, existingAccount: !found.existingAccount } : found;
    },
  };
});

const panel = startPanel();
let user: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  user = await createUser(panel.app, await createOrganization(panel.app, "auth"), "owner");
});
beforeEach(() => loginLimiter.clear());
afterEach(() => void (panel.clock.at = NOW));
afterAll(() => panel.close());

const signIn = (email: string, password: string, ip = "203.0.113.9") =>
  call(login, { method: "POST", body: { email, password }, headers: { "x-forwarded-for": ip } });

describe("login", () => {
  it("opens a session with an HttpOnly cookie and stores only the hash of the token", async () => {
    const result = await signIn(user.email.toUpperCase(), PASSWORD);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ email: user.email, role: "owner" });

    const cookie = result.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^dv_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    const token = cookie.slice("dv_session=".length, cookie.indexOf(";"));
    expect(result.text).not.toContain(token);

    const sessions = await call(me, { cookie: `dv_session=${token}` });
    expect(sessions.data).toEqual({ name: "Test owner", email: user.email, role: "owner", phone: null, whatsapp: null, organizationName: "auth" });
    expect(hashToken(token)).not.toBe(token);
  });

  it("answers the same way for a wrong password and for an e-mail that does not exist", async () => {
    const wrongPassword = await signIn(user.email, "not the password");
    const unknownEmail = await signIn("nobody@example.test", PASSWORD);
    expect(wrongPassword.status).toBe(401);
    expect([unknownEmail.status, unknownEmail.code, unknownEmail.message]).toEqual([wrongPassword.status, wrongPassword.code, wrongPassword.message]);
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
  });
});

// Verificador falso: conta quantas tentativas chegaram a conferir a senha, sem o custo do scrypt.
const countingVerifier = () => {
  const real = panel.deps.verifyPassword;
  const state = { calls: 0, restore: () => void (panel.deps.verifyPassword = real) };
  panel.deps.verifyPassword = async () => {
    state.calls += 1;
    return false;
  };
  return state;
};

/** Falhas reais pela rota, com o verificador falso: cada uma passa pelo limitador como um erro de senha. */
const fail = async (email: string, ips: string[]): Promise<number[]> => {
  const verifier = countingVerifier();
  const statuses: number[] = [];
  for (const ip of ips) statuses.push((await signIn(email, "wrong", ip)).status);
  verifier.restore();
  return statuses;
};
const minutesLater = (minutes: number): void => {
  panel.clock.at = new Date(panel.clock.at.getTime() + minutes * 60 * 1000);
};
const fiveTimes = (ip: string): string[] => Array<string>(5).fill(ip);

describe("login limit", () => {
  it("five wrong passwords from one address lock only that address for that e-mail: the owner signs in from another", async () => {
    expect(await fail(user.email, fiveTimes("198.51.100.1"))).toEqual(Array<number>(5).fill(401));

    const sameAddress = await signIn(user.email, PASSWORD, "198.51.100.1");
    expect([sameAddress.status, sameAddress.code]).toEqual([429, "too_many_attempts"]);
    expect((await signIn(user.email, PASSWORD, "203.0.113.20")).status).toBe(200);
    // Entrar de outro lugar não solta o endereço de quem errou.
    expect((await signIn(user.email, PASSWORD, "198.51.100.1")).status).toBe(429);

    minutesLater(16);
    expect((await signIn(user.email, PASSWORD, "198.51.100.1")).status).toBe(200);
  });

  it("IPv6 counts by its /64: five failures from five addresses of one block lock the block, not the owner elsewhere", async () => {
    const block = Array.from({ length: 5 }, (_, index) => `2001:db8:aa:bb:${index + 1}::9`);
    expect(await fail(user.email, block)).toEqual(Array<number>(5).fill(401));

    expect((await signIn(user.email, PASSWORD, "2001:db8:aa:bb:ffff::1")).status).toBe(429);
    expect((await signIn(user.email, PASSWORD, "2001:db8:aa:bc::1")).status).toBe(200);
  });

  it("the refusal does not say whether the account exists", async () => {
    await fail(user.email, fiveTimes("198.51.100.2"));
    await fail("nobody@example.test", fiveTimes("198.51.100.2"));
    const known = await signIn(user.email, PASSWORD, "198.51.100.2");
    const unknown = await signIn("nobody@example.test", PASSWORD, "198.51.100.2");
    expect([unknown.status, unknown.code, unknown.message]).toEqual([known.status, known.code, known.message]);
  });

  it("one address gets twenty failures across e-mails, then is refused for any e-mail", async () => {
    const verifier = countingVerifier();
    const guesses = await Promise.all(Array.from({ length: 20 }, (_, index) => signIn(`guess-${index}@example.test`, "wrong", "192.0.2.50")));
    verifier.restore();
    expect(guesses.map((result) => result.status)).toEqual(Array<number>(20).fill(401));
    expect((await signIn(user.email, PASSWORD, "192.0.2.50")).status).toBe(429);
    expect((await signIn(user.email, PASSWORD, "192.0.2.51")).status).toBe(200);
  });

  it("fifty failures on one e-mail from many addresses refuse that e-mail everywhere, for up to an hour", async () => {
    const addresses = Array.from({ length: 10 }, (_, index) => fiveTimes(`198.51.100.${20 + index}`)).flat();
    expect(await fail(user.email, addresses)).toEqual(Array<number>(50).fill(401));
    expect((await signIn(user.email, PASSWORD, "203.0.113.21")).status).toBe(429);

    minutesLater(30);
    expect((await signIn(user.email, PASSWORD, "203.0.113.21")).status).toBe(429);
    minutesLater(31);
    expect((await signIn(user.email, PASSWORD, "203.0.113.21")).status).toBe(200);
  });

  it("behind a tunnel everyone arrives from one address, and the pair works as the e-mail limit", async () => {
    // Por túnel o Caddy só vê a própria máquina: o mesmo endereço para todo visitante.
    await fail(user.email, fiveTimes("127.0.0.1"));
    expect((await signIn(user.email, PASSWORD, "127.0.0.1")).status).toBe(429);
  });
});

describe("login limit under concurrency", () => {
  it("of twelve simultaneous wrong attempts on one e-mail from one address, only five reach the password check", async () => {
    const verifier = countingVerifier();
    const results = await Promise.all(Array.from({ length: 12 }, () => signIn(user.email, "wrong", "198.51.100.100")));
    verifier.restore();
    expect(verifier.calls).toBe(5);
    expect(results.map((result) => result.status).sort()).toEqual([...Array<number>(5).fill(401), ...Array<number>(7).fill(429)]);
  });

  it("a forged first item in x-forwarded-for does not buy a new address", async () => {
    const verifier = countingVerifier();
    const results = await Promise.all(Array.from({ length: 9 }, (_, index) => signIn(user.email, "wrong", `9.9.9.${index}, 192.0.2.77`)));
    verifier.restore();
    expect(verifier.calls).toBe(5);
    expect(results.filter((result) => result.status === 429)).toHaveLength(4);
  });

  it("without a trusted address there is no shared IP key: strangers cannot lock everyone out", async () => {
    const verifier = countingVerifier();
    const request = (index: number) => call(login, { method: "POST", body: { email: `nobody-${index}@example.test`, password: "wrong" } });
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => request(index)));
    verifier.restore();
    expect(results.map((result) => result.status)).toEqual(Array<number>(8).fill(401));
  });
});

describe("session", () => {
  it("refuses a route without a session, with a made-up token and after the session expires", async () => {
    expect((await call(listAgents)).status).toBe(401);
    expect((await call(listAgents, { cookie: "dv_session=made-up" })).code).toBe("unauthenticated");
    const sse = await stream(new Request("https://panel.test/api/v1/events/stream"));
    expect(sse.status).toBe(401);

    const fresh = await createUser(panel.app, await createOrganization(panel.app, "auth expiry"), "admin");
    expect((await call(listAgents, { cookie: fresh.cookie })).status).toBe(200);
    const before = panel.clock.at;
    panel.clock.at = new Date(before.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect((await call(listAgents, { cookie: fresh.cookie })).status).toBe(401);
    panel.clock.at = before;
  });

  it("logout deletes the session, so the same cookie stops working", async () => {
    const fresh = await createUser(panel.app, await createOrganization(panel.app, "auth logout"), "operator");
    const out = await call(logout, { method: "POST", cookie: fresh.cookie });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call(me, { cookie: fresh.cookie })).status).toBe(401);
  });
});

// Fatia 3 do R8: a mesma pessoa em várias organizações.
const inviteBy = async (cookie: string, email: string, role = "operator"): Promise<string> => {
  const created = await call(createInvite, { method: "POST", cookie, body: { email, name: "Convidada", role } });
  expect(created.status).toBe(200);
  return (created.data as { link: string }).link.split("/invite/")[1] ?? "";
};
const accept = (token: string, password: string, ip = "203.0.113.50", name = "Nome no vínculo") =>
  call(acceptInvite, { method: "POST", params: { token }, body: { name, password }, headers: { "x-forwarded-for": ip } });
const cookieOf = (result: { headers: Headers }): string => (result.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
const linkTo = async (organizationId: string, email: string, role: "owner" | "admin" | "operator" = "operator"): Promise<string> =>
  withSystem(panel.app, async (q) => {
    const account = await q.one<{ id: string }>("select id from accounts where email = $1", [email]);
    return addMembership(q, { organizationId, accountId: account?.id ?? "", name: `Vínculo ${role}`, role });
  });

// A resposta do convite é a mesma para todo e-mail: só estes campos.
const INVITE_KEYS = ["organizationName", "email", "name", "role"];
const headersOf = (result: { headers: Headers }): [string, string][] => [...result.headers.entries()];

describe("the invite page does not change with the e-mail", () => {
  it("the same token answers the same status, text and headers before and after the e-mail gets an account in another organization", async () => {
    const ownerA = await createUser(panel.app, await createOrganization(panel.app, "auth convite igual A"), "owner");
    const ownerB = await createUser(panel.app, await createOrganization(panel.app, "auth convite igual B"), "owner");
    const email = `igual-${randomUUID()}@example.test`;
    const token = await inviteBy(ownerA.cookie, email, "admin");

    const before = await call(openInvite, { params: { token } });
    expect(before.status).toBe(200);
    expect(Object.keys(before.data as object)).toEqual(INVITE_KEYS);

    // O e-mail ganha conta pela outra organização, com uma senha nova.
    const password = "a senha da conta em B";
    expect((await accept(await inviteBy(ownerB.cookie, email), password)).status).toBe(200);

    const after = await call(openInvite, { params: { token } });
    expect(after.status).toBe(before.status);
    expect(after.text).toBe(before.text);
    expect(headersOf(after)).toEqual(headersOf(before));
    for (const shown of [before.text, after.text]) {
      expect(shown).not.toContain("existingAccount");
      expect(shown).not.toContain("existing");
    }

    // A diferença só aparece no envio da senha: a da conta entra na organização do convite.
    const accepted = await accept(token, password);
    expect(accepted.status).toBe(200);
    expect((await call(me, { cookie: cookieOf(accepted) })).data).toMatchObject({ email, role: "admin", organizationName: "auth convite igual A" });
  });
});

describe("an invite for an e-mail that already has an account", () => {
  it("does not say the account exists, takes the password the account has, and the session lands in the new organization", async () => {
    const a = await createOrganization(panel.app, "auth convite A");
    const b = await createOrganization(panel.app, "auth convite B");
    const ownerA = await createUser(panel.app, a, "owner");
    const person = await createUser(panel.app, b, "operator");
    const token = await inviteBy(ownerA.cookie, person.email, "admin");

    const shown = await call(openInvite, { params: { token } });
    expect(shown.data).toMatchObject({ email: person.email });
    expect(Object.keys(shown.data as object)).toEqual(INVITE_KEYS);
    // Token inválido: a mesma resposta de antes, sem nada sobre o e-mail.
    const invalid = await call(openInvite, { params: { token: `${token}x` } });
    expect([invalid.status, invalid.code, invalid.data]).toEqual([404, "invite_invalid", undefined]);
    expect(invalid.text).not.toContain("existingAccount");

    // A senha que a conta já tem pode ser de antes da regra de senha nova: não passa por ela.
    const oldShort = "curta";
    const shortHash = await hashPassword(oldShort);
    await withSystem(panel.app, (q) => q.exec("update accounts set password_hash = $2 where email = $1", [person.email, shortHash]));
    const accepted = await accept(token, oldShort);
    expect(accepted.status).toBe(200);
    const session = cookieOf(accepted);
    expect((await call(me, { cookie: session })).data).toMatchObject({ email: person.email, role: "admin", name: "Nome no vínculo", organizationName: "auth convite A" });
    // O convite foi gasto, e a pessoa continua na organização de antes com a mesma senha.
    expect((await call(openInvite, { params: { token } })).status).toBe(404);
    expect((await call(me, { cookie: person.cookie })).data).toMatchObject({ organizationName: "auth convite B" });
    // O próximo login volta para a organização do convite.
    const again = await signIn(person.email, oldShort);
    expect((await call(me, { cookie: cookieOf(again) })).data).toMatchObject({ organizationName: "auth convite A" });
  });

  it("a wrong password is the one refusal and does not spend the invite; an account already in the organization is 409", async () => {
    const a = await createOrganization(panel.app, "auth convite errado");
    const ownerA = await createUser(panel.app, a, "owner");
    const person = await createUser(panel.app, await createOrganization(panel.app, "auth convite errado B"), "operator");
    const token = await inviteBy(ownerA.cookie, person.email);
    const wrong = await accept(token, "not the password");
    expect([wrong.status, wrong.code]).toEqual([401, "invite_password_refused"]);
    expect((await call(openInvite, { params: { token } })).status).toBe(200);

    const member = await createUser(panel.app, a, "operator");
    // Desativada também conta: o caminho dela é a reativação na tela Equipe.
    await call(changeMember, { method: "PATCH", cookie: ownerA.cookie, params: { id: member.id }, body: { disabled: true } });
    const dup = await withSystem(panel.app, async (q) => {
      const tokenText = `dup-${member.id}`;
      await q.exec("insert into invites (organization_id, email, name, role, token_hash, expires_at, created_by) values ($1, $2, 'X', 'operator', $3, $4, $5)", [
        a,
        member.email,
        hashToken(tokenText),
        new Date(NOW.getTime() + 86_400_000),
        ownerA.id,
      ]);
      return tokenText;
    });
    const already = await accept(dup, PASSWORD);
    expect([already.status, already.code]).toEqual([409, "already_member"]);
    expect((await call(openInvite, { params: { token: dup } })).status).toBe(200);
  });

  it("a new account still needs a password that follows the rule", async () => {
    const ownerA = await createUser(panel.app, await createOrganization(panel.app, "auth convite novo"), "owner");
    const token = await inviteBy(ownerA.cookie, `nova-${randomUUID()}@example.test`);
    expect(Object.keys((await call(openInvite, { params: { token } })).data as object)).toEqual(INVITE_KEYS);
    const short = await accept(token, "curta");
    expect([short.status, short.code]).toEqual([401, "invite_password_refused"]);
    expect((await accept(token, "uma senha nova e longa")).status).toBe(200);
  });
});

describe("while the invite is not accepted, the password refusal is the same for every e-mail", () => {
  // O limite das rotas de convite por IP (`server/invite-guard.ts`) também para no sexto erro: ele
  // é desfeito a cada envio para que o 429 medido aqui seja o do limite do login.
  const acceptPastTheGuard = async (token: string, password: string, ip: string) => {
    const sent = await accept(token, password, ip);
    loginLimiter.clear(`invite:${ip}`);
    return sent;
  };

  it("an e-mail with an account and one without answer the same status and body, spend the same limit and check the same number of hashes", async () => {
    const a = await createOrganization(panel.app, "auth recusa igual");
    const ownerA = await createUser(panel.app, a, "owner");
    const withAccount = await createUser(panel.app, await createOrganization(panel.app, "auth recusa igual B"), "operator");
    const withoutAccount = `sem-conta-${randomUUID()}@example.test`;
    const tokens = { with: await inviteBy(ownerA.cookie, withAccount.email), without: await inviteBy(ownerA.cookie, withoutAccount) };
    const ip = "198.51.100.90";
    // Só senhas fora da regra de senha nova: no e-mail sem conta, uma de 10+ cria a conta e gasta o convite.
    const passwords = ["x", "123456789", "curta", "a", "nove-ch9", "123456789"];
    const real = panel.deps.verifyPassword;
    const answers = { with: [] as unknown[], without: [] as unknown[] };
    const hashes = { with: 0, without: 0 };
    for (const side of ["with", "without"] as const) {
      panel.deps.verifyPassword = async (...args) => {
        hashes[side] += 1;
        return real(...args);
      };
      for (const password of passwords) {
        const sent = await acceptPastTheGuard(tokens[side], password, ip);
        answers[side].push([sent.status, sent.text.replaceAll(tokens[side], "<token>").replaceAll(side === "with" ? withAccount.email : withoutAccount, "<email>")]);
      }
    }
    panel.deps.verifyPassword = real;

    expect(answers.without).toEqual(answers.with);
    expect(answers.with.map((answer) => (answer as [number])[0])).toEqual([401, 401, 401, 401, 401, 429]);
    expect(hashes.without).toBe(hashes.with);
    expect(hashes.with).toBe(5);
    // Os dois convites seguem pendentes, e o e-mail sem conta continua sem conta.
    expect((await call(openInvite, { params: { token: tokens.with } })).status).toBe(200);
    expect((await call(openInvite, { params: { token: tokens.without } })).status).toBe(200);
    expect(await withSystem(panel.app, (q) => q.one("select id from accounts where email = $1", [withoutAccount]))).toBeNull();

    // E segue valendo: a senha da conta entra; a senha nova de 10+ cria a conta.
    loginLimiter.clear();
    expect((await accept(tokens.with, PASSWORD, ip)).status).toBe(200);
    expect((await accept(tokens.without, "uma senha nova e longa", ip)).status).toBe(200);
    expect((await signIn(withoutAccount, "uma senha nova e longa")).status).toBe(200);
  });

  it("the account that appears or goes away between reading the invite and accepting it gets the same refusal, counted", async () => {
    const ownerA = await createUser(panel.app, await createOrganization(panel.app, "auth recusa corrida"), "owner");
    const person = await createUser(panel.app, await createOrganization(panel.app, "auth recusa corrida B"), "operator");
    const nobody = `corrida-${randomUUID()}@example.test`;
    const gained = await inviteBy(ownerA.cookie, person.email);
    const lost = await inviteBy(ownerA.cookie, nobody);
    const plain = await accept(await inviteBy(ownerA.cookie, `outra-${randomUUID()}@example.test`), "x");
    expect([plain.status, plain.code]).toEqual([401, "invite_password_refused"]);

    orphanCleanup.staleInvite = true;
    let raced: Awaited<ReturnType<typeof accept>>[];
    try {
      // Lido sem conta, aceito com a conta já criada (`existing_account`); lido com conta, aceito sem ela (`no_account`).
      raced = [await acceptPastTheGuard(gained, "uma senha nova e longa", "198.51.100.91"), await acceptPastTheGuard(lost, "qualquer senha", "198.51.100.92")];
    } finally {
      orphanCleanup.staleInvite = false;
    }
    for (const refused of raced) expect([refused.status, refused.text]).toEqual([plain.status, plain.text]);
    expect((await call(openInvite, { params: { token: gained } })).status).toBe(200);
    expect((await call(openInvite, { params: { token: lost } })).status).toBe(200);
    // A recusa da corrida ficou contada no limite do e-mail, como as outras.
    const verifier = countingVerifier();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) statuses.push((await acceptPastTheGuard(gained, "wrong", "198.51.100.91")).status);
    verifier.restore();
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
  });
});

describe("the invite password and the login limit are one limit", () => {
  it("the sixth wrong password of the same pair is refused, and the login of the same e-mail is held too", async () => {
    const ownerA = await createUser(panel.app, await createOrganization(panel.app, "auth limite convite"), "owner");
    const person = await createUser(panel.app, await createOrganization(panel.app, "auth limite convite B"), "operator");
    const token = await inviteBy(ownerA.cookie, person.email);
    const ip = "198.51.100.77";

    const verifier = countingVerifier();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await accept(token, "wrong", ip)).status);
    verifier.restore();
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(verifier.calls).toBe(5);

    const login = await signIn(person.email, PASSWORD, ip);
    expect([login.status, login.code]).toEqual([429, "too_many_attempts"]);
    // O convite não foi gasto por nenhuma das tentativas.
    expect((await call(openInvite, { params: { token } })).status).toBe(200);
  });

  it("five wrong sign-ins hold the invite of the same e-mail from the same address, even with the right password", async () => {
    const ownerA = await createUser(panel.app, await createOrganization(panel.app, "auth limite login"), "owner");
    const person = await createUser(panel.app, await createOrganization(panel.app, "auth limite login B"), "operator");
    const token = await inviteBy(ownerA.cookie, person.email);
    const ip = "198.51.100.78";
    expect(await fail(person.email, fiveTimes(ip))).toEqual(Array<number>(5).fill(401));

    const held = await accept(token, PASSWORD, ip);
    expect([held.status, held.code]).toEqual([429, "too_many_attempts"]);
    expect((await accept(token, PASSWORD, "203.0.113.79")).status).toBe(200);
  });
});

describe("the orphan account left by a failed cleanup (nota da revisora)", () => {
  afterEach(() => void (orphanCleanup.fail = false));

  it("invited again, the person sets a new password and signs in with it; the old one does not work and the installation mark does not come back", async () => {
    const a = await createOrganization(panel.app, "auth órfã");
    const ownerA = await createUser(panel.app, a, "owner");
    const person = await createUser(panel.app, a, "operator");
    expect(await grantInstallationAdmin(panel.app, person.email, NOW)).toMatchObject({ granted: true });

    orphanCleanup.fail = true;
    const removed = await call(removeMember, { method: "DELETE", cookie: ownerA.cookie, params: { id: person.id } });
    orphanCleanup.fail = false;
    expect(removed.status).toBe(500);
    // A remoção do vínculo valeu; a conta ficou, sem vínculo, com o hash antigo e a marca.
    const left = await withSystem(panel.app, (q) => q.one<{ admin: boolean }>("select installation_admin_at is not null as admin from accounts where email = $1", [person.email]));
    expect(left).toEqual({ admin: true });

    const token = await inviteBy(ownerA.cookie, person.email);
    expect(Object.keys((await call(openInvite, { params: { token } })).data as object)).toEqual(INVITE_KEYS);
    expect((await accept(token, "a brand new password")).status).toBe(200);

    expect((await signIn(person.email, "a brand new password")).status).toBe(200);
    expect((await signIn(person.email, PASSWORD)).status).toBe(401);
    const account = await withSystem(panel.app, (q) => q.one<{ admin: boolean }>("select installation_admin_at is not null as admin from accounts where email = $1", [person.email]));
    expect(account).toEqual({ admin: false });
  });
});

describe("switching organization", () => {
  it("lists the active member links, moves the same cookie to another organization, and answers 404 for any organization without an active link", async () => {
    const a = await createOrganization(panel.app, "auth troca A");
    const b = await createOrganization(panel.app, "auth troca B");
    const stranger = await createOrganization(panel.app, "auth troca alheia");
    const disabledOrg = await createOrganization(panel.app, "auth troca desativada");
    const person = await createUser(panel.app, a, "owner");
    await linkTo(b, person.email, "admin");
    const disabled = await linkTo(disabledOrg, person.email);
    await withSystem(panel.app, (q) => q.exec("update users set disabled_at = $2 where id = $1", [disabled, NOW]));

    expect((await call(listOrganizations, { cookie: person.cookie })).data).toEqual([
      { organizationId: a, organizationName: "auth troca A", current: true },
      { organizationId: b, organizationName: "auth troca B", current: false },
    ]);
    for (const organizationId of [stranger, disabledOrg, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const refused = await call(switchOrganization, { method: "POST", cookie: person.cookie, body: { organizationId } });
      expect([refused.status, refused.code]).toEqual([404, "not_found"]);
    }
    expect((await call(switchOrganization, { method: "POST", body: { organizationId: b } })).status).toBe(401);

    const switched = await call(switchOrganization, { method: "POST", cookie: person.cookie, body: { organizationId: b } });
    expect(switched.status).toBe(200);
    expect(switched.headers.get("set-cookie")).toBeNull();
    expect((await call(me, { cookie: person.cookie })).data).toMatchObject({ role: "admin", organizationName: "auth troca B" });
    expect((await call(listOrganizations, { cookie: person.cookie })).data).toEqual([
      { organizationId: a, organizationName: "auth troca A", current: false },
      { organizationId: b, organizationName: "auth troca B", current: true },
    ]);
  });

  it("one organization only: the list has one item, so the screen shows no selector", async () => {
    const alone = await createUser(panel.app, await createOrganization(panel.app, "auth troca uma"), "operator");
    expect((await call(listOrganizations, { cookie: alone.cookie })).data).toEqual([expect.objectContaining({ current: true })]);
  });

  // Isolamento depois da troca: uma rota de leitura de cada tabela principal da equipe e das
  // chamadas. `team` lê `users` e `invites`; `calls` lê `calls`; `calls/[id]` é o detalhe.
  it("after switching to B, the team and the calls of A are not visible on any of these reads", async () => {
    const a = await createOrganization(panel.app, "auth isolamento A");
    const b = await createOrganization(panel.app, "auth isolamento B");
    const ownerA = await createUser(panel.app, a, "owner");
    const person = await createUser(panel.app, a, "admin");
    const inB = await linkTo(b, person.email, "admin");
    const callA = await createCall(panel.app, a, NOW);
    const callB = await createCall(panel.app, b, NOW);
    await inviteBy(ownerA.cookie, `pendente-a-${randomUUID()}@example.test`);

    expect((await call(switchOrganization, { method: "POST", cookie: person.cookie, body: { organizationId: b } })).status).toBe(200);
    const team = (await call(listTeam, { cookie: person.cookie })).data as { people: Array<{ id: string }>; invites: unknown[] };
    expect(team.people.map((row) => row.id)).toEqual([inB]);
    expect(team.invites).toEqual([]);
    const calls = (await call(listCalls, { cookie: person.cookie })).data as Array<{ id: string }>;
    expect(calls.map((row) => row.id)).toEqual([callB]);
    expect((await call(getCall, { cookie: person.cookie, params: { id: callA } })).status).toBe(404);
    expect((await call(getCall, { cookie: person.cookie, params: { id: callB } })).status).toBe(200);
  });
});

describe("links are independent across organizations", () => {
  it("disabling the link in A closes only the sessions of that link: the session of the same account in B goes on", async () => {
    const a = await createOrganization(panel.app, "auth independente A");
    const b = await createOrganization(panel.app, "auth independente B");
    const ownerA = await createUser(panel.app, a, "owner");
    const person = await createUser(panel.app, a, "operator");
    const inB = await linkTo(b, person.email);
    const inBSession = await openSession(panel.app, b, inB);

    expect((await call(changeMember, { method: "PATCH", cookie: ownerA.cookie, params: { id: person.id }, body: { disabled: true } })).status).toBe(200);
    expect((await call(me, { cookie: person.cookie })).status).toBe(401);
    expect((await call(me, { cookie: inBSession })).data).toMatchObject({ organizationName: "auth independente B" });
    expect(((await call(listOrganizations, { cookie: inBSession })).data as unknown[]).length).toBe(1);
  });

  it("removing the link in A keeps the account, which still signs in to B", async () => {
    const a = await createOrganization(panel.app, "auth remove A");
    const b = await createOrganization(panel.app, "auth remove B");
    const ownerA = await createUser(panel.app, a, "owner");
    const person = await createUser(panel.app, a, "operator");
    await linkTo(b, person.email);
    expect((await call(removeMember, { method: "DELETE", cookie: ownerA.cookie, params: { id: person.id } })).status).toBe(200);
    const again = await signIn(person.email, PASSWORD);
    expect(again.status).toBe(200);
    expect((await call(me, { cookie: cookieOf(again) })).data).toMatchObject({ organizationName: "auth remove B" });
  });

  it("changing the password ends the sessions of the account in every organization but the one that changed it", async () => {
    const a = await createOrganization(panel.app, "auth senha A");
    const b = await createOrganization(panel.app, "auth senha B");
    const person = await createUser(panel.app, a, "operator");
    const inB = await linkTo(b, person.email);
    const inBSession = await openSession(panel.app, b, inB);
    const otherInA = await openSession(panel.app, a, person.id);

    expect((await call(changePassword, { method: "POST", cookie: inBSession, body: { current: PASSWORD, new: "another long password" } })).status).toBe(200);
    expect((await call(me, { cookie: inBSession })).status).toBe(200);
    expect((await call(me, { cookie: person.cookie })).status).toBe(401);
    expect((await call(me, { cookie: otherInA })).status).toBe(401);
  });
});
