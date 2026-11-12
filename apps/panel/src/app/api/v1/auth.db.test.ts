import { hashToken } from "@deskvoice/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NOW, PASSWORD, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { loginLimiter } from "../../../server/rate-limit";
import { GET as listAgents } from "./agents/route";
import { POST as login } from "./auth/login/route";
import { POST as logout } from "./auth/logout/route";
import { GET as me } from "./auth/me/route";
import { GET as stream } from "./events/stream/route";

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
    expect(sessions.data).toEqual({ name: "Test owner", email: user.email, role: "owner", phone: null, whatsapp: null });
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
