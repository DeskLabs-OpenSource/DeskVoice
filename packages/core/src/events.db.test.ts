import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, openTestDbs, waitFor } from "../test/helpers";
import { purgedCallAnalysisSchema, type CallAnalysis } from "./analysis";
import { listen } from "./db";
import { purgeTranscripts, recordEvent, recordOrgEvent } from "./events";
import type { CallEventKind, OrgEventKind } from "./types";
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

describe("recordOrgEvent", () => {
  it("stores the event in the organization of the transaction, with who did it", async () => {
    await withOrg(app, org, (q) => recordOrgEvent(q, "transcript_retention_changed", { from: null, to: 30 }, at));
    const rows = (await owner.pool.query("select organization_id, at, kind, actor_user_id, payload from organization_events where organization_id = $1", [org])).rows;
    expect(rows).toEqual([{ organization_id: org, at, kind: "transcript_retention_changed", actor_user_id: null, payload: { from: null, to: 30 } }]);
  });

  it("refuses a kind outside the vocabulary", async () => {
    await expect(withOrg(app, org, (q) => recordOrgEvent(q, "made_up" as OrgEventKind, {}, at))).rejects.toThrow(/made_up/);
  });

  it("is append-only: neither the application nor the system role changes or deletes a record, but removing the author still clears it", async () => {
    const audited = await createOrganization(app, "events append-only");
    const author = await withOrg(app, audited, async (q) => {
      const row = await q.one<{ id: string }>("insert into users (organization_id, email, name, password_hash, role) values ($1, $2, 'Autora', 'x', 'admin') returning id", [
        audited,
        `author-${audited}@example.test`,
      ]);
      const id = row?.id ?? "";
      await recordOrgEvent(q, "caller_data_exported", { phone: "+5531999998888", calls: 1, events: 2, doNotCall: false }, at, id);
      return id;
    });
    const recorded = async () =>
      (await owner.pool.query("select actor_user_id, payload from organization_events where organization_id = $1", [audited])).rows;
    const denied = { code: "42501", message: expect.stringMatching(/permission denied/) };

    for (const attempt of [
      "update organization_events set payload = '{}'",
      "update organization_events set actor_user_id = null",
      "delete from organization_events",
    ]) {
      await expect(withOrg(app, audited, (q) => q.exec(attempt)), attempt).rejects.toMatchObject(denied);
      await expect(withSystem(app, (q) => q.exec(`${attempt} where organization_id = $1`, [audited])), `${attempt} (system)`).rejects.toMatchObject(denied);
    }
    expect(await recorded()).toEqual([{ actor_user_id: author, payload: { phone: "+5531999998888", calls: 1, events: 2, doNotCall: false } }]);

    // A ação da chave estrangeira roda como dona da tabela: apagar a pessoa limpa o autor e mantém o registro.
    expect(await withOrg(app, audited, (q) => q.exec("delete from users where id = $1", [author]))).toBe(1);
    expect(await recorded()).toEqual([{ actor_user_id: null, payload: { phone: "+5531999998888", calls: 1, events: 2, doNotCall: false } }]);
  });
});

describe("purgeTranscripts", () => {
  it("only runs inside withOrg: a system transaction would reach every organization", async () => {
    await expect(withSystem(app, (q) => purgeTranscripts(q, at))).rejects.toThrow(/withOrg/);
  });

  it("swaps the text of older speech for the marker, in this organization only, and does not count it twice", async () => {
    const mine = await createCall(app, org, at);
    const theirs = await createCall(app, otherOrg, at);
    const older = new Date(at.getTime() - 1);
    await withSystem(app, async (q) => {
      for (const [organization, call, kind, when] of [
        [org, mine, "transcript_user", older],
        [org, mine, "transcript_agent", at],
        [org, mine, "recording_notice", older],
        [otherOrg, theirs, "transcript_user", older],
      ] as const) {
        await q.exec("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, $4, $5)", [organization, call, when, kind, JSON.stringify({ text: "Olá." })]);
      }
    });

    expect(await withOrg(app, org, (q) => purgeTranscripts(q, at))).toBe(1);
    expect(await withOrg(app, org, (q) => purgeTranscripts(q, at))).toBe(0);
    expect((await eventsOf(mine)).map((row) => [row.kind, row.payload])).toEqual([
      ["transcript_user", { purged: true }],
      ["transcript_agent", { text: "Olá." }],
      ["recording_notice", { text: "Olá." }],
    ]);
    expect((await eventsOf(theirs)).map((row) => row.payload)).toEqual([{ text: "Olá." }]);
  });
});

describe("purgeTranscripts and the call analysis", () => {
  const analysis: CallAnalysis = {
    rubricVersion: 1,
    model: "gemini-test",
    criteria: [
      { id: "opening", status: "met", evidence: "Boa tarde, aqui é a recepção." },
      { id: "discovery", status: "partial", evidence: "O que a senhora precisa?" },
      { id: "objections", status: "met", evidence: "Achei caro." },
      { id: "accuracy", status: "missed", evidence: "" },
      { id: "closing", status: "met", evidence: "Fica marcado para terça." },
    ],
    temperature: { start: "cold", middle: "warm", end: "hot" },
    objections: [
      { objection: "Preço", quote: "Achei caro.", response: "Ofereceu parcelamento.", handled: "addressed" },
      { objection: "Horário", quote: "Só posso de manhã.", response: "Marcou de manhã.", handled: "partial" },
    ],
    strengths: ["Confirmou o horário."],
    weaknesses: ["Não disse o preço total."],
    nextStep: "Lembrar a consulta na segunda.",
    droppedObjections: 1,
  };
  const texts = [
    ...analysis.criteria.map((criterion) => criterion.evidence).filter((text) => text !== ""),
    ...analysis.objections.flatMap((objection) => [objection.objection, objection.quote, objection.response]),
    ...analysis.strengths,
    ...analysis.weaknesses,
    analysis.nextStep,
  ];
  const analysisOf = async (call: string) =>
    (await owner.pool.query<{ analysis: unknown; analysis_score: number | null }>("select analysis, analysis_score from calls where id = $1", [call])).rows[0];

  it("keeps rubric, temperature and objection count before the deadline, drops every text, and leaves later calls and other organizations alone", async () => {
    const older = new Date(at.getTime() - 1);
    const purgedCall = await createCall(app, org, older);
    const keptCall = await createCall(app, org, at);
    const foreignCall = await createCall(app, otherOrg, older);
    for (const call of [purgedCall, keptCall, foreignCall]) {
      await owner.pool.query("update calls set analysis = $2, analysis_score = 7 where id = $1", [call, JSON.stringify(analysis)]);
    }

    await withOrg(app, org, (q) => purgeTranscripts(q, at));

    const purged = await analysisOf(purgedCall);
    expect(purged?.analysis).toEqual({
      rubricVersion: 1,
      model: "gemini-test",
      criteria: analysis.criteria.map(({ id, status }) => ({ id, status })),
      temperature: { start: "cold", middle: "warm", end: "hot" },
      objectionCount: 2,
      purged: true,
    });
    expect(purgedCallAnalysisSchema.safeParse(purged?.analysis).success).toBe(true);
    const stored = JSON.stringify(purged?.analysis);
    for (const text of texts) expect(stored).not.toContain(text);
    // A nota é a soma dos status que ficaram, não é fala de ninguém.
    expect(purged?.analysis_score).toBe(7);

    expect(await analysisOf(keptCall)).toEqual({ analysis, analysis_score: 7 });
    expect(await analysisOf(foreignCall)).toEqual({ analysis, analysis_score: 7 });
  });

  it("does not rewrite an analysis that was already purged, and leaves calls without analysis as null", async () => {
    const older = new Date(at.getTime() - 1);
    const call = await createCall(app, org, older);
    const never = await createCall(app, org, older);
    await owner.pool.query("update calls set analysis = $2, analysis_score = 7 where id = $1", [call, JSON.stringify(analysis)]);

    await withOrg(app, org, (q) => purgeTranscripts(q, at));
    const first = await analysisOf(call);
    // Uma expurgada com um campo a mais mostra se o segundo passo a reescreveria.
    await owner.pool.query("update calls set analysis = analysis || '{\"marker\": 1}'::jsonb where id = $1", [call]);
    await withOrg(app, org, (q) => purgeTranscripts(q, at));

    expect((await analysisOf(call))?.analysis).toEqual({ ...(first?.analysis as object), marker: 1 });
    expect(await analysisOf(never)).toEqual({ analysis: null, analysis_score: null });
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
