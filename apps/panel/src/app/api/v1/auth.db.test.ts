import { hashToken } from "@deskvoice/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
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
    expect(sessions.data).toEqual({ name: "Test owner", email: user.email, role: "owner" });
    expect(hashToken(token)).not.toBe(token);
  });

  it("answers the same way for a wrong password and for an e-mail that does not exist", async () => {
    const wrongPassword = await signIn(user.email, "not the password");
    const unknownEmail = await signIn("nobody@example.test", PASSWORD);
    expect(wrongPassword.status).toBe(401);
    expect([unknownEmail.status, unknownEmail.code, unknownEmail.message]).toEqual([wrongPassword.status, wrongPassword.code, wrongPassword.message]);
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
  });

  // Quatro das cinco falhas entram direto no limitador: cada tentativa real custa um scrypt.
  const failFourTimes = (key: string): void => {
    for (let attempt = 0; attempt < 4; attempt += 1) loginLimiter.take(key, panel.clock.at);
  };

  it("blocks the e-mail after five failures, even with the right password, until the window passes", async () => {
    failFourTimes(`email:${user.email}`);
    expect((await signIn(user.email, PASSWORD, "198.51.100.1")).status).toBe(200);
    failFourTimes(`email:${user.email}`);
    expect((await signIn(user.email, "wrong", "198.51.100.2")).status).toBe(401);
    const blocked = await signIn(user.email, PASSWORD, "198.51.100.99");
    expect([blocked.status, blocked.code]).toEqual([429, "too_many_attempts"]);

    panel.clock.at = new Date(panel.clock.at.getTime() + 16 * 60 * 1000);
    expect((await signIn(user.email, PASSWORD, "198.51.100.99")).status).toBe(200);
  });

  it("blocks the IP after five failures across different e-mails", async () => {
    failFourTimes("ip:192.0.2.50");
    expect((await signIn("guess@example.test", "wrong", "192.0.2.50")).status).toBe(401);
    expect((await signIn(user.email, PASSWORD, "192.0.2.50")).status).toBe(429);
    expect((await signIn(user.email, PASSWORD, "192.0.2.51")).status).toBe(200);
  });
});

describe("login limit under concurrency", () => {
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

  it("of twelve simultaneous wrong attempts on one e-mail, only five reach the password check", async () => {
    const verifier = countingVerifier();
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => signIn(user.email, "wrong", `198.51.100.${100 + index}`)));
    verifier.restore();
    expect(verifier.calls).toBe(5);
    expect(results.map((result) => result.status).sort()).toEqual([...Array<number>(5).fill(401), ...Array<number>(7).fill(429)]);
  });

  it("a forged first item in x-forwarded-for does not buy a new IP", async () => {
    const verifier = countingVerifier();
    const results = await Promise.all(Array.from({ length: 9 }, (_, index) => signIn(`guess-${index}@example.test`, "wrong", `9.9.9.${index}, 192.0.2.77`)));
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
