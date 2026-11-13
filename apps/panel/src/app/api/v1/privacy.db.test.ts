import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordingPath, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { POST as exportRecord } from "./privacy/export/route";
import { PUT as putRecording } from "./privacy/recording/route";
import { PUT as putRetention } from "./privacy/retention/route";
import { GET as privacy } from "./privacy/route";
import { PUT as putSetting } from "./settings/[key]/route";

const panel = startPanel();
afterAll(() => panel.close());

const PHONE = "+5531999998888";
const setDays = (cookie: string, days: unknown) => call(putRetention, { method: "PUT", cookie, body: { days } });
const setRecording = (cookie: string, enabled: unknown) => call(putRecording, { method: "PUT", cookie, body: { enabled } });
const exportPhone = (cookie: string, phone: string) => call(exportRecord, { method: "POST", cookie, body: { phone } });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];
const read = <T>(org: string, sql: string, params: unknown[] = []) => withOrg(panel.app, org, (q) => q.many<T & Record<string, unknown>>(sql, params));
const orgEvents = (org: string) => read<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown> }>(org, "select kind, actor_user_id, payload from organization_events order by id");

interface Privacy {
  retentionDays: number | null;
  recording: boolean;
  history: Array<{ kind: string; actorName: string | null; payload: Record<string, unknown> }>;
}

async function seedCaller(org: string, followUpTitle = "Retornar sobre a remarcação"): Promise<string> {
  const callId = await createCall(panel.app, org, NOW);
  await withOrg(panel.app, org, async (q) => {
    await q.exec("update calls set from_e164 = $2, summary = 'Pediu retorno.' where id = $1", [callId, PHONE]);
    await q.exec("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, 'transcript_user', $4), ($1, $2, $3, 'transcript_agent', $5)", [
      org,
      callId,
      NOW,
      JSON.stringify({ text: "Quero remarcar." }),
      JSON.stringify({ purged: true }),
    ]);
    await q.exec("insert into do_not_call (organization_id, e164, reason) values ($1, $2, 'Pediu para não ligar.')", [org, PHONE]);
    await q.exec("insert into follow_ups (organization_id, call_id, caller_e164, title, details, due_at, created_at) values ($1, $2, $3, $4, 'Prefere de manhã.', $5, $5)", [
      org,
      callId,
      PHONE,
      followUpTitle,
      NOW,
    ]);
  });
  return callId;
}

describe("who exercises the rights of the caller", () => {
  it("an operator neither reads, changes the retention, turns recording on, nor exports", async () => {
    const org = await createOrganization(panel.app, "privacy operator");
    const operator = await createUser(panel.app, org, "operator");
    await seedCaller(org);
    for (const result of [await call(privacy, { cookie: operator.cookie }), await setDays(operator.cookie, 30), await setRecording(operator.cookie, true), await exportPhone(operator.cookie, PHONE)]) {
      expect(refusal(result)).toEqual([403, "forbidden"]);
    }
    expect(await read(org, "select key from settings where key in ('transcripts.retention_days', 'calls.recording_enabled')")).toEqual([]);
    expect(await orgEvents(org)).toEqual([]);
  });
});

/** Um WAV de mentira no lugar onde a voz grava a chamada. */
async function recordingFor(org: string, callId: string): Promise<string> {
  const file = recordingPath(panel.deps.recordingsDir, org, callId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "RIFF");
  return file;
}

describe("call recording", () => {
  it("is off by default, only takes a boolean, and every change is recorded with who made it", async () => {
    const org = await createOrganization(panel.app, "privacy recording");
    const owner = await createUser(panel.app, org, "owner");
    const admin = await createUser(panel.app, org, "admin");
    expect((await call(privacy, { cookie: owner.cookie })).data).toMatchObject({ recording: false });

    for (const enabled of ["true", 1, null, undefined]) expect(refusal(await setRecording(owner.cookie, enabled))).toEqual([400, "validation_error"]);
    // Desligar o que já está desligado não é mudança.
    expect((await setRecording(owner.cookie, false)).data).toEqual({ enabled: false });
    expect(await orgEvents(org)).toEqual([]);

    expect((await setRecording(admin.cookie, true)).data).toEqual({ enabled: true });
    expect(await read(org, "select value from settings where key = 'calls.recording_enabled'")).toEqual([{ value: true }]);
    expect((await call(privacy, { cookie: owner.cookie })).data).toMatchObject({ recording: true });
    await setRecording(owner.cookie, true);
    expect((await setRecording(owner.cookie, false)).data).toEqual({ enabled: false });
    expect(await read(org, "select value from settings where key = 'calls.recording_enabled'")).toEqual([]);

    expect(await orgEvents(org)).toEqual([
      { kind: "call_recording_changed", actor_user_id: admin.id, payload: { from: false, to: true } },
      { kind: "call_recording_changed", actor_user_id: owner.id, payload: { from: true, to: false } },
    ]);
    const shown = (await call(privacy, { cookie: owner.cookie })).data as Privacy;
    expect(shown.history.map((entry) => [entry.kind, entry.actorName])).toEqual([
      ["call_recording_changed", "Test owner"],
      ["call_recording_changed", "Test admin"],
    ]);
  });

  it("turning it off keeps the recordings already made: they leave only by the retention period", async () => {
    const org = await createOrganization(panel.app, "privacy recording off keeps");
    const owner = await createUser(panel.app, org, "owner");
    await setRecording(owner.cookie, true);
    const file = await recordingFor(org, await createCall(panel.app, org, NOW));
    await setRecording(owner.cookie, false);
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it("is not reachable through the generic settings route, which would skip the record", async () => {
    const org = await createOrganization(panel.app, "privacy recording settings route");
    const owner = await createUser(panel.app, org, "owner");
    const result = await call(putSetting, { method: "PUT", cookie: owner.cookie, params: { key: "calls.recording_enabled" }, body: { value: true } });
    expect(refusal(result)).toEqual([400, "unknown_setting"]);
  });
});

describe("transcript retention", () => {
  it("is forever when empty, has a floor of 30 days, and every change is recorded with who made it", async () => {
    const org = await createOrganization(panel.app, "privacy retention");
    const owner = await createUser(panel.app, org, "owner");
    const admin = await createUser(panel.app, org, "admin");
    expect((await call(privacy, { cookie: owner.cookie })).data).toMatchObject({ retentionDays: null, minDays: 30, maxDays: 3650, history: [] });

    for (const days of [29, 0, -1, 30.5, 3651, "90"]) expect(refusal(await setDays(owner.cookie, days))).toEqual([400, "validation_error"]);
    expect(await orgEvents(org)).toEqual([]);

    expect((await setDays(admin.cookie, 30)).data).toEqual({ days: 30 });
    // A rotina roda logo em seguida, e não só amanhã.
    expect(await read(org, "select kind, status, run_at from tasks")).toEqual([{ kind: "purge_transcripts", status: "queued", run_at: NOW }]);
    // Mesmo valor de novo não é mudança: nada a registrar.
    await setDays(owner.cookie, 30);
    expect((await setDays(owner.cookie, null)).data).toEqual({ days: null });
    expect(await read(org, "select value from settings where key = 'transcripts.retention_days'")).toEqual([]);

    expect(await orgEvents(org)).toEqual([
      { kind: "transcript_retention_changed", actor_user_id: admin.id, payload: { from: null, to: 30 } },
      { kind: "transcript_retention_changed", actor_user_id: owner.id, payload: { from: 30, to: null } },
    ]);
    const shown = (await call(privacy, { cookie: owner.cookie })).data as Privacy;
    expect(shown.retentionDays).toBeNull();
    expect(shown.history.map((entry) => [entry.actorName, entry.payload])).toEqual([
      ["Test owner", { from: 30, to: null }],
      ["Test admin", { from: null, to: 30 }],
    ]);
  });

  it("is not reachable through the generic settings route, which would skip the record", async () => {
    const org = await createOrganization(panel.app, "privacy settings route");
    const owner = await createUser(panel.app, org, "owner");
    const result = await call(putSetting, { method: "PUT", cookie: owner.cookie, params: { key: "transcripts.retention_days" }, body: { value: 1 } });
    expect(refusal(result)).toEqual([400, "unknown_setting"]);
  });
});

describe("exporting what the organization keeps about a phone", () => {
  it("normalizes the phone, stays inside the organization of the session and records who exported which phone", async () => {
    const mine = await createOrganization(panel.app, "privacy export mine");
    const theirs = await createOrganization(panel.app, "privacy export theirs");
    const admin = await createUser(panel.app, mine, "admin");
    const callId = await seedCaller(mine);
    const foreignCall = await seedCaller(theirs, "Pendência da outra empresa");

    const result = await exportPhone(admin.cookie, "(31) 99999-8888");
    expect(result.status).toBe(200);
    const data = result.data as { phone: string; counts: unknown; content: string; exportedAt: string };
    expect(data).toMatchObject({ phone: PHONE, counts: { calls: 1, events: 2, doNotCall: true, followUps: 1 }, exportedAt: NOW.toISOString() });

    const lines = data.content.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => [line.type, line.kind ?? null])).toEqual([
      ["call", null],
      ["event", "transcript_user"],
      ["event", "transcript_agent"],
      ["follow_up", null],
      ["do_not_call", null],
    ]);
    expect(lines[3]).toMatchObject({ call: callId, phone: PHONE, title: "Retornar sobre a remarcação", details: "Prefere de manhã.", status: "open", closingNote: null });
    expect(lines[0]).toMatchObject({ call: callId, from: PHONE, summary: "Pediu retorno.", recording: false });
    expect(lines[2]).toMatchObject({ payload: { purged: true } });
    expect(data.content).not.toContain(foreignCall);
    expect(data.content).not.toContain("outra empresa");

    expect(await orgEvents(mine)).toEqual([{ kind: "caller_data_exported", actor_user_id: admin.id, payload: { phone: PHONE, calls: 1, events: 2, doNotCall: true, followUps: 1 } }]);
    expect(await orgEvents(theirs)).toEqual([]);
    const shown = (await call(privacy, { cookie: admin.cookie })).data as Privacy;
    expect(shown.history).toMatchObject([{ kind: "caller_data_exported", actorName: "Test admin", payload: { phone: PHONE } }]);
  });

  it("says, per call, whether there is a recording, without the audio", async () => {
    const org = await createOrganization(panel.app, "privacy export recording");
    const owner = await createUser(panel.app, org, "owner");
    const recorded = await seedCaller(org);
    const silent = await createCall(panel.app, org, new Date(NOW.getTime() + 60_000));
    await withOrg(panel.app, org, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [silent, PHONE]));
    await recordingFor(org, recorded);

    const data = (await exportPhone(owner.cookie, PHONE)).data as { content: string };
    const calls = data.content.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.type === "call");
    expect(calls.map((line) => [line.call, line.recording])).toEqual([
      [recorded, true],
      [silent, false],
    ]);
    expect(data.content).not.toContain("RIFF");
  });

  it("records the lookup even when nothing is found, and refuses what is not a phone", async () => {
    const org = await createOrganization(panel.app, "privacy export empty");
    const owner = await createUser(panel.app, org, "owner");
    expect((await exportPhone(owner.cookie, "+5531988887777")).data).toMatchObject({ counts: { calls: 0, events: 0, doNotCall: false, followUps: 0 }, content: "" });
    expect(refusal(await exportPhone(owner.cookie, "não é telefone"))).toEqual([400, "validation_error"]);
    expect((await orgEvents(org)).map((event) => event.payload)).toEqual([{ phone: "+5531988887777", calls: 0, events: 0, doNotCall: false, followUps: 0 }]);
  });
});
