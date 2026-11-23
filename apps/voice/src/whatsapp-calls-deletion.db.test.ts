// A ligação pelo WhatsApp na exclusão de organização (R8, fatia 9b2), do lado do processo de voz:
// banco real e o WaCalls falso. A organização viva é comparada pelo retrato da linha (`to_jsonb`).
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { withSystem } from "@deskvoice/core";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { silentLogger } from "./log";
import { createOrganization } from "./testing/db";
import { startFakeWacalls } from "./testing/fake-wacalls";
import { wacallsSessionName, type WacallsOptions } from "./wacalls-client";
import { unpairDeletingOrganizations } from "./whatsapp-calls-deletion";

const { app, owner } = openTestDbs();
/** Pelo papel de sistema: o teste atravessa organizações para preparar e conferir. */
const sql = <T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> => withSystem(app, (q) => q.many<T>(text, params));
const wacalls = await startFakeWacalls();
const now = new Date("2026-11-19T12:00:00Z");

// Uma porta onde ninguém escuta: o WaCalls fora do ar.
const closedPort = await new Promise<number>((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as AddressInfo;
    server.close(() => resolve(port));
  });
});
const unreachable: WacallsOptions = { ...wacalls.options, baseUrl: `http://127.0.0.1:${closedPort}` };

const created: string[] = [];
// As linhas que outro arquivo deixou com `service_wanted`: desligadas aqui, e de volta no fim.
let wantedElsewhere: string[] = [];

beforeEach(async () => {
  wacalls.requests.length = 0;
  wacalls.state.down = false;
  wacalls.state.hangMs = 0;
  wacalls.sessions.clear();
  wantedElsewhere = (await sql<{ organization_id: string }>("update whatsapp_call_sessions set service_wanted = false where service_wanted returning organization_id")).map(
    (row) => row.organization_id,
  );
});
afterEach(async () => {
  // Nenhuma lápide fica para trás: o processo de outro arquivo a desfaria.
  await sql("delete from organizations where id = any($1::uuid[])", [created.splice(0)]);
  await sql("update whatsapp_call_sessions set service_wanted = true where organization_id = any($1::uuid[])", [wantedElsewhere]);
});
afterAll(async () => {
  await wacalls.stop();
  await app.close();
  await owner.close();
});

const run = (options: WacallsOptions = wacalls.options): Promise<void> => unpairDeletingOrganizations({ db: app, options, log: silentLogger, now: () => now });

/**
 * Uma organização com a linha da ligação pelo WhatsApp e, no falso, a sessão dela: `paired`, em
 * pareamento (`pairing`) ou nenhuma (`none`, desconectada antes por fora). `tombstone`: suspensa e
 * com lápide, como a deixa `requestOrganizationDeletion`.
 */
async function organization(label: string, options: { tombstone: boolean; session: "paired" | "pairing" | "none"; wanted?: boolean }) {
  const id = await createOrganization(app, label);
  created.push(id);
  if (options.tombstone) {
    await sql("update organizations set suspended_at = $2, suspended_reason = 'teste da 9b2', deleting_at = $2, deleting_reason = 'teste da 9b2' where id = $1", [id, now]);
  }
  const name = wacallsSessionName(id);
  let sessionId = "s-gone";
  if (options.session === "paired") sessionId = wacalls.paired(name).id;
  if (options.session === "pairing") {
    const session = wacalls.paired(name);
    session.paired = false;
    session.jid = "";
    session.state = "qr";
    sessionId = session.id;
  }
  await withSystem(app, (q) =>
    q.exec(
      `insert into whatsapp_call_sessions (organization_id, session_name, service_wanted, status, phone_e164, wacalls_session_id, connected_at)
       values ($1, $2, $3, 'connected', '+553133330000', $4, $5)`,
      [id, name, options.wanted ?? false, sessionId, now],
    ),
  );
  return { id, sessionId };
}

const rowOf = async (organizationId: string) =>
  (
    await sql<{ wacalls_session_id: string | null; status: string; phone_e164: string | null; connected_at: Date | null; failure: string | null; service_wanted: boolean }>(
      "select wacalls_session_id, status, phone_e164, connected_at, failure, service_wanted from whatsapp_call_sessions where organization_id = $1",
      [organizationId],
    )
  )[0];
const snapshotOf = async (organizationId: string): Promise<string | undefined> =>
  (await sql<{ row: string }>("select to_jsonb(s)::text as row from whatsapp_call_sessions s where organization_id = $1", [organizationId]))[0]?.row;
/** Os pedidos ao falso sobre a sessão, em ordem: `POST logout`, `DELETE`. */
const sessionCalls = (sessionId: string): string[] =>
  wacalls.requests.filter((request) => request.path.startsWith(`/api/sessions/${sessionId}`)).map((request) => `${request.method} ${request.path.split("/")[4] ?? "session"}`);
const cleared = { wacalls_session_id: null, status: "disconnected", phone_e164: null, connected_at: null, failure: null };

describe("unpairDeletingOrganizations", { timeout: 30_000 }, () => {
  it("D1: a tombstoned organization with a paired session gets logout, then delete, and the row is cleared", async () => {
    const a = await organization("9b2 D1", { tombstone: true, session: "paired", wanted: true });
    await run();
    expect(sessionCalls(a.sessionId)).toEqual(["POST logout", "DELETE session"]);
    expect(wacalls.sessions.has(a.sessionId)).toBe(false);
    // `service_wanted` fica: a cascata o leva junto.
    expect(await rowOf(a.id)).toEqual({ ...cleared, service_wanted: true });
  });

  it("D2: a live, paired organization gets no call at all, and its row stays exactly as it was", async () => {
    const a = await organization("9b2 D2 A", { tombstone: true, session: "paired" });
    const b = await organization("9b2 D2 B", { tombstone: false, session: "paired", wanted: true });
    const before = await snapshotOf(b.id);
    await run();
    expect(sessionCalls(b.sessionId)).toEqual([]);
    expect(wacalls.sessions.has(b.sessionId)).toBe(true);
    expect(await snapshotOf(b.id)).toEqual(before);
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it("D3: a session still pairing gets only delete, and the row is cleared", async () => {
    const a = await organization("9b2 D3", { tombstone: true, session: "pairing" });
    await run();
    expect(sessionCalls(a.sessionId)).toEqual(["DELETE session"]);
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it("D4: with no session in WaCalls (disconnected before), the row is cleared without a logout", async () => {
    const a = await organization("9b2 D4", { tombstone: true, session: "none" });
    await run();
    expect(wacalls.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /api/sessions"]);
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it("D5: WaCalls down and someone wanting the service: the row is not cleared; when it is back, the next round clears it", async () => {
    const a = await organization("9b2 D5", { tombstone: true, session: "paired" });
    await organization("9b2 D5 B", { tombstone: false, session: "paired", wanted: true });
    const before = await snapshotOf(a.id);
    await run(unreachable);
    expect(await snapshotOf(a.id)).toEqual(before);

    await run();
    expect(sessionCalls(a.sessionId)).toEqual(["POST logout", "DELETE session"]);
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it("D5b: WaCalls down and only the tombstoned organization itself wanting the service: the row is not cleared", async () => {
    const a = await organization("9b2 D5b", { tombstone: true, session: "paired", wanted: true });
    const before = await snapshotOf(a.id);
    await run(unreachable);
    expect(await snapshotOf(a.id)).toEqual(before);
  });

  it("D6: WaCalls down and nobody wanting the service: the row is cleared", async () => {
    const a = await organization("9b2 D6", { tombstone: true, session: "paired" });
    await organization("9b2 D6 B", { tombstone: false, session: "none" });
    await run(unreachable);
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it("D7: WaCalls not answering in time and someone wanting the service: the row is not cleared; when it answers, the next round clears it", async () => {
    const a = await organization("9b2 D7", { tombstone: true, session: "paired" });
    await organization("9b2 D7 B", { tombstone: false, session: "paired", wanted: true });
    const before = await snapshotOf(a.id);
    wacalls.state.hangMs = 500;
    await run({ ...wacalls.options, timeoutMs: 100 });
    expect(wacalls.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /api/sessions"]);
    expect(await snapshotOf(a.id)).toEqual(before);

    wacalls.state.hangMs = 0;
    await run();
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it("D7b: WaCalls not answering in time and nobody wanting the service: the row is cleared", async () => {
    const a = await organization("9b2 D7b", { tombstone: true, session: "paired" });
    wacalls.state.hangMs = 500;
    await run({ ...wacalls.options, timeoutMs: 100 });
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it("D8: without a token, the row is cleared and WaCalls hears nothing", async () => {
    const a = await organization("9b2 D8", { tombstone: true, session: "paired", wanted: true });
    await run({ ...wacalls.options, token: "" });
    expect(wacalls.requests).toEqual([]);
    expect(await rowOf(a.id)).toMatchObject(cleared);
  });

  it.each([
    ["401", { ...wacalls.options, token: "wrong-token" }],
    ["503", null],
  ] as const)("D9: WaCalls refusing (%s) leaves the row as it was", async (_code, options) => {
    const a = await organization("9b2 D9", { tombstone: true, session: "paired" });
    const before = await snapshotOf(a.id);
    if (!options) wacalls.state.down = true;
    await run(options ?? wacalls.options);
    expect(await snapshotOf(a.id)).toEqual(before);
  });

  it("D9b: a refusal on the logout of one organization does not stop the others", async () => {
    const a = await organization("9b2 D9b A", { tombstone: true, session: "paired" });
    const b = await organization("9b2 D9b B", { tombstone: true, session: "paired" });
    const before = await snapshotOf(a.id);
    // O logout da A recebe 500 do WaCalls; o da B passa.
    const failing: typeof fetch = (input, init) =>
      String(input).endsWith(`/api/sessions/${a.sessionId}/logout`) ? Promise.resolve(new Response("boom", { status: 500 })) : fetch(input, init);
    await run({ ...wacalls.options, fetch: failing });
    expect(await snapshotOf(a.id)).toEqual(before);
    expect(await rowOf(b.id)).toMatchObject(cleared);
  });

  it("D10: with no tombstone at all, WaCalls is not called", async () => {
    await organization("9b2 D10", { tombstone: false, session: "paired", wanted: true });
    expect(await sql("select 1 as tombstone from organizations where deleting_at is not null")).toEqual([]);
    await run();
    expect(wacalls.requests).toEqual([]);
  });
});
