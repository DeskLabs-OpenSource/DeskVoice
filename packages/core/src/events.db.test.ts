import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, openTestDbs, waitFor } from "../test/helpers";
import { listen } from "./db";
import { recordEvent } from "./events";
import type { CallEventKind } from "./types";
import { withOrg, withSystem } from "./with-org";

const { app, owner } = openTestDbs();
const at = new Date("2026-03-01T15:00:00.123Z");
let org: string;
let otherOrg: string;
let callId: string;

beforeAll(async () => {
  org = await createOrganization(app, "events");
  otherOrg = await createOrganization(app, "events other");
  callId = await createCall(app, org, at);
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

const eventsOf = async (call: string): Promise<Record<string, unknown>[]> =>
  (await owner.pool.query("select id, organization_id, call_id, at, kind, payload from call_events where call_id = $1 order by id", [call])).rows;

describe("recordEvent", () => {
  it("stores the event and notifies organization:call:event", async () => {
    const payloads: string[] = [];
    const stop = await listen(app, "call_events", (payload) => payloads.push(payload));
    const mine = (): string[] => payloads.filter((payload) => payload.startsWith(`${org}:${callId}:`));

    await withOrg(app, org, (q) => recordEvent(q, callId, "tool_called", { name: "end_call", args: { reason: "done" } }, at));
    await waitFor(() => mine().length === 1, "the call_events notification");
    await stop();

    const rows = await eventsOf(callId);
    expect(rows).toEqual([
      { id: expect.any(String), organization_id: org, call_id: callId, at, kind: "tool_called", payload: { name: "end_call", args: { reason: "done" } } },
    ]);
    expect(mine()).toEqual([`${org}:${callId}:${String(rows[0]?.id)}`]);
  });

  it("keeps events of a call in the order they were recorded", async () => {
    const call = await createCall(app, org, at);
    await withOrg(app, org, async (q) => {
      await recordEvent(q, call, "call_started", {}, at);
      await recordEvent(q, call, "call_answered", {}, at);
      await recordEvent(q, call, "call_ended", { reason: "hangup" }, at);
    });
    expect((await eventsOf(call)).map((row) => row.kind)).toEqual(["call_started", "call_answered", "call_ended"]);
  });

  it("works from a system transaction, taking the organization from the call", async () => {
    const call = await createCall(app, org, at);
    await withSystem(app, (q) => recordEvent(q, call, "call_started", {}, at));
    expect(await eventsOf(call)).toMatchObject([{ organization_id: org, kind: "call_started" }]);
  });

  it("refuses a kind outside the vocabulary", async () => {
    await expect(withOrg(app, org, (q) => recordEvent(q, callId, "made_up" as CallEventKind, {}, at))).rejects.toThrow(/made_up/);
  });

  it("refuses a call of another organization or one that does not exist", async () => {
    const before = (await eventsOf(callId)).length;
    await expect(withOrg(app, otherOrg, (q) => recordEvent(q, callId, "call_ended", {}, at))).rejects.toThrow(/not found/);
    await expect(withOrg(app, org, (q) => recordEvent(q, "00000000-0000-4000-8000-000000000000", "call_ended", {}, at))).rejects.toThrow(/not found/);
    expect((await eventsOf(callId)).length).toBe(before);
  });
});

describe("listen", () => {
  it("notifies the approvals channel when the status changes, and only then", async () => {
    const approvalId = await withOrg(app, org, async (q) => {
      const row = await q.one<{ id: string }>(
        "insert into approvals (organization_id, call_id, question, default_on_timeout, expires_at) values ($1, $2, 'Pode?', 'denied', $3) returning id",
        [org, callId, at],
      );
      return row?.id ?? "";
    });
    const payloads: string[] = [];
    const stop = await listen(app, "approvals", (payload) => payloads.push(payload));

    await withOrg(app, org, (q) => q.exec("update approvals set question = 'Pode mesmo?' where id = $1", [approvalId]));
    await withOrg(app, org, (q) => q.exec("update approvals set status = 'pending' where id = $1", [approvalId]));
    await withOrg(app, org, (q) => q.exec("update approvals set status = 'approved', decided_at = $2 where id = $1", [approvalId, at]));
    await waitFor(() => payloads.includes(approvalId), "the approvals notification");
    await stop();

    expect(payloads.filter((payload) => payload === approvalId)).toEqual([approvalId]);
  });

  it("refuses a channel name that is not a plain identifier", async () => {
    await expect(listen(app, "tasks; drop table tasks", () => undefined)).rejects.toThrow(/channel/);
  });

  it("stops delivering after the returned function runs, and that function is safe to call twice", async () => {
    const payloads: string[] = [];
    const stop = await listen(app, "isolated_channel", (payload) => payloads.push(payload));
    await owner.pool.query("select pg_notify('isolated_channel', 'one')");
    await waitFor(() => payloads.length === 1, "the first notification");
    await stop();
    await stop();

    const witness: string[] = [];
    const stopWitness = await listen(app, "isolated_channel", (payload) => witness.push(payload));
    await owner.pool.query("select pg_notify('isolated_channel', 'two')");
    await waitFor(() => witness.length === 1, "the witness notification");
    await stopWitness();
    expect(payloads).toEqual(["one"]);
  });
});
