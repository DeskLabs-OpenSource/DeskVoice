import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { QR_PNG, WAHA_KEY, startFakeWaha } from "../../test/fake-waha";
import {
  WahaError,
  sendViaWaha,
  wahaCheckExists,
  wahaEnsureSession,
  wahaGetQr,
  wahaGetSession,
  wahaLogoutSession,
  wahaSendText,
  wahaSessionName,
  wahaStartSession,
  wahaStopSession,
} from "./waha";

const waha = await startFakeWaha();
afterAll(() => waha.stop());
beforeEach(() => {
  waha.sessions.clear();
  waha.contacts.clear();
  waha.sent.length = 0;
  waha.requests.length = 0;
  for (const route of ["GET /api/sessions/s1", "GET /api/s1/auth/qr", "GET /api/contacts/check-exists", "POST /api/sendText", "POST /api/sessions/s1/start"]) waha.override(route, undefined);
});

const code = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => "no error",
    (error: unknown) => (error instanceof WahaError ? error.code : error),
  );

describe("waha client", () => {
  it("derives the session name from the organization id alone", () => {
    expect(wahaSessionName("0b9f4f0e-3a51-4c0f-9d53-6f1f8a1c2d3e")).toBe("dv_0b9f4f0e3a514c0f9d536f1f8a1c2d3e");
  });

  it("creates the session stopped, ignoring statuses, groups, channels and broadcast, and sends the key on every call", async () => {
    await wahaEnsureSession(waha.options, "s1");
    expect(waha.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /api/sessions/s1", "POST /api/sessions"]);
    expect(waha.requests[1]?.body).toEqual({ name: "s1", start: false, config: { ignore: { status: true, groups: true, channels: true, broadcast: true } } });
    expect(waha.requests.every((request) => request.key === WAHA_KEY)).toBe(true);
    expect(await wahaGetSession(waha.options, "s1")).toEqual({ status: "STOPPED", phone: null });
  });

  it("converges an existing session by reading first: the PUT replaces the whole configuration, so what was there is kept", async () => {
    waha.sessions.set("s1", { status: "STOPPED", me: null, config: { debug: true, ignore: { status: true, groups: false } } });
    await wahaEnsureSession(waha.options, "s1");
    expect(waha.sessions.get("s1")?.config).toEqual({ debug: true, ignore: { status: true, groups: true, channels: true, broadcast: true } });
    waha.requests.length = 0;
    await wahaEnsureSession(waha.options, "s1");
    expect(waha.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("starts, reads the QR code, stops and logs out; repeating a transition is not an error", async () => {
    await wahaEnsureSession(waha.options, "s1");
    await wahaStartSession(waha.options, "s1");
    expect(await wahaGetSession(waha.options, "s1")).toEqual({ status: "SCAN_QR_CODE", phone: null });
    expect(await wahaGetQr(waha.options, "s1")).toBe(QR_PNG);
    waha.override("POST /api/sessions/s1/start", { status: 422, body: { message: "already started" } });
    await wahaStartSession(waha.options, "s1");
    await wahaStopSession(waha.options, "s1");
    expect(await code(wahaGetQr(waha.options, "s1"))).toBe("rejected");
    await wahaLogoutSession(waha.options, "s1");
    await wahaStopSession(waha.options, "missing");
    await wahaLogoutSession(waha.options, "missing");
    expect(await code(wahaStartSession(waha.options, "missing"))).toBe("session_not_found");
    expect(await wahaGetSession(waha.options, "missing")).toBeNull();
  });

  it("reads the connected number as E.164, and an id that is not a phone as unknown", async () => {
    waha.connect("s1", "5531999998888");
    expect(await wahaGetSession(waha.options, "s1")).toEqual({ status: "WORKING", phone: "+5531999998888" });
    waha.sessions.set("s1", { status: "WORKING", me: { id: "5531999998888:12@s.whatsapp.net" }, config: {} });
    expect((await wahaGetSession(waha.options, "s1"))?.phone).toBe("+5531999998888");
    waha.sessions.set("s1", { status: "WORKING", me: { id: "23423462304912@lid" }, config: {} });
    expect((await wahaGetSession(waha.options, "s1"))?.phone).toBeNull();
  });

  it("asks for the canonical address with digits only, and answers null for a number that is not on WhatsApp", async () => {
    waha.contacts.set("5531999998888", "553199998888@c.us");
    expect(await wahaCheckExists(waha.options, "s1", "+55 (31) 99999-8888")).toBe("553199998888@c.us");
    expect(waha.requests.at(-1)?.path).toBe("/api/contacts/check-exists?phone=5531999998888&session=s1");
    expect(await wahaCheckExists(waha.options, "s1", "+5531911112222")).toBeNull();
  });

  it("sends a text", async () => {
    await wahaSendText(waha.options, "s1", "553199998888@c.us", "Olá");
    expect(waha.sent).toEqual([{ session: "s1", chatId: "553199998888@c.us", text: "Olá" }]);
  });

  it("translates every failure into a closed code", async () => {
    expect(await code(wahaGetSession({ apiKey: "" }, "s1"))).toBe("not_configured");
    expect(await code(wahaGetSession({ ...waha.options, apiKey: "wrong" }, "s1"))).toBe("unauthorized");
    expect(await code(wahaGetSession({ apiKey: WAHA_KEY, baseUrl: "http://127.0.0.1:1" }, "s1"))).toBe("unreachable");
    waha.override("GET /api/sessions/s1", "hang");
    expect(await code(wahaGetSession({ ...waha.options, timeoutMs: 50 }, "s1"))).toBe("timeout");
    waha.override("GET /api/sessions/s1", { status: 500, body: { message: "boom" } });
    expect(await code(wahaGetSession(waha.options, "s1"))).toBe("rejected");
  });

  it("refuses an answer outside the documented contract instead of using it", async () => {
    waha.override("GET /api/sessions/s1", { status: 200, body: { name: "s1", status: "DANCING", me: null } });
    expect(await code(wahaGetSession(waha.options, "s1"))).toBe("invalid_response");
    waha.override("GET /api/sessions/s1", { status: 200, body: "<html>not json</html>" });
    expect(await code(wahaGetSession(waha.options, "s1"))).toBe("invalid_response");
    waha.override("GET /api/s1/auth/qr", { status: 200, body: { mimetype: "image/svg+xml", data: "PHN2Zz4=" } });
    expect(await code(wahaGetQr(waha.options, "s1"))).toBe("invalid_response");
    waha.override("GET /api/s1/auth/qr", { status: 200, body: { mimetype: "image/png", data: '"><script>' } });
    expect(await code(wahaGetQr(waha.options, "s1"))).toBe("invalid_response");
    waha.override("GET /api/contacts/check-exists", { status: 200, body: { numberExists: "yes" } });
    expect(await code(wahaCheckExists(waha.options, "s1", "+5531999998888"))).toBe("invalid_response");
    waha.override("GET /api/contacts/check-exists", { status: 200, body: { numberExists: true } });
    expect(await code(wahaCheckExists(waha.options, "s1", "+5531999998888"))).toBe("invalid_response");
    waha.override("POST /api/sendText", { status: 201, body: "sent" });
    expect(await code(wahaSendText(waha.options, "s1", "x@c.us", "Olá"))).toBe("invalid_response");
  });
});

describe("sendViaWaha", () => {
  it("sends to the canonical address of the number", async () => {
    waha.connect("s1", "553133334444");
    waha.contacts.set("5531999998888", "553199998888@c.us");
    expect(await sendViaWaha(waha.options, "s1", { to: "+5531999998888", text: "Olá" })).toEqual({ addressVerified: true });
    expect(waha.sent).toEqual([{ session: "s1", chatId: "553199998888@c.us", text: "Olá" }]);
  });

  it.each([400, 404, 422, 500, 501])("when WAHA refuses the address lookup itself (HTTP %i), still sends, to the number as it is, and says the address was not confirmed", async (status) => {
    waha.connect("s1", "553133334444");
    waha.override("GET /api/contacts/check-exists", { status, body: { message: "Enable NOWEB store" } });
    expect(await sendViaWaha(waha.options, "s1", { to: "+55 31 99999-8888", text: "Olá" })).toEqual({ addressVerified: false });
    expect(waha.sent).toEqual([{ session: "s1", chatId: "5531999998888@c.us", text: "Olá" }]);
  });

  it("a lookup that answers outside the contract or does not answer is still a failure: nothing is sent blind", async () => {
    waha.connect("s1", "553133334444");
    waha.override("GET /api/contacts/check-exists", { status: 200, body: { numberExists: "yes" } });
    expect(await code(sendViaWaha(waha.options, "s1", { to: "+5531999998888", text: "Olá" }))).toBe("invalid_response");
    waha.override("GET /api/contacts/check-exists", "hang");
    expect(await code(sendViaWaha({ ...waha.options, timeoutMs: 50 }, "s1", { to: "+5531999998888", text: "Olá" }))).toBe("timeout");
    expect(waha.sent).toEqual([]);
  });

  it.each(["STOPPED", "STARTING", "SCAN_QR_CODE", "FAILED"])("fails with the reason, without sending or reconnecting, when the session is %s", async (status) => {
    waha.sessions.set("s1", { status, me: null, config: {} });
    waha.contacts.set("5531999998888", "553199998888@c.us");
    await expect(sendViaWaha(waha.options, "s1", { to: "+5531999998888", text: "Olá" })).rejects.toMatchObject({ code: "session_not_working", message: expect.stringContaining(status) as string });
    expect(waha.sent).toEqual([]);
    expect(waha.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("fails the same way when the session does not exist", async () => {
    expect(await code(sendViaWaha(waha.options, "s1", { to: "+5531999998888", text: "Olá" }))).toBe("session_not_working");
  });

  it("fails clearly, before sending, for a number that is not on WhatsApp", async () => {
    waha.connect("s1", "553133334444");
    await expect(sendViaWaha(waha.options, "s1", { to: "+5531911112222", text: "Olá" })).rejects.toMatchObject({ code: "number_not_on_whatsapp", message: "+5531911112222 is not on WhatsApp" });
    expect(waha.sent).toEqual([]);
  });
});
