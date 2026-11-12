import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, putSetting, t0, task, tasksOf } from "../../test/helpers";
import purgeTranscripts from "./purge_transcripts";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(t0.getTime() - days * DAY_MS);

async function addEvent(org: string, callId: string, kind: string, payload: object, at: Date): Promise<string> {
  const row = await withSystem(app, (q) =>
    q.one<{ id: string }>("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, $4, $5) returning id", [org, callId, at, kind, JSON.stringify(payload)]),
  );
  return row?.id ?? "";
}
const payloadOf = async (id: string): Promise<unknown> => (await withSystem(app, (q) => q.one<{ payload: unknown }>("select payload from call_events where id = $1", [id])))?.payload;
const orgEventsOf = (org: string) =>
  withSystem(app, (q) => q.many<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown> }>("select kind, actor_user_id, payload from organization_events where organization_id = $1 order by id", [org]));
const run = (org: string): Promise<void> => purgeTranscripts.run(task(org, "purge_transcripts"), depsFor(app));

describe("purge_transcripts", () => {
  it("troca pelo marcador só a fala que passou do prazo, grava o evento com a contagem e marca a passagem de amanhã", async () => {
    const org = await createOrganization(app, "purge org");
    const other = await createOrganization(app, "purge other");
    await putSetting(app, org, "transcripts.retention_days", 30, false);
    await putSetting(app, other, "transcripts.retention_days", 30, false);
    const call = await createCall(app, org, daysAgo(40));
    const oldUser = await addEvent(org, call, "transcript_user", { text: "Meu CPF é 000.000.000-00." }, daysAgo(31));
    const oldAgent = await addEvent(org, call, "transcript_agent", { text: "Anotado." }, daysAgo(30.5));
    const oldTool = await addEvent(org, call, "tool_called", { name: "end_call", args: {} }, daysAgo(31));
    const recent = await addEvent(org, call, "transcript_user", { text: "Ainda dentro do prazo." }, daysAgo(29));
    const foreign = await addEvent(other, await createCall(app, other, daysAgo(40)), "transcript_user", { text: "Outra empresa." }, daysAgo(60));

    await run(org);

    expect(await payloadOf(oldUser)).toEqual({ purged: true });
    expect(await payloadOf(oldAgent)).toEqual({ purged: true });
    // Fora do vocabulário de fala, fora do prazo ou de outra organização: nada muda.
    expect(await payloadOf(oldTool)).toEqual({ name: "end_call", args: {} });
    expect(await payloadOf(recent)).toEqual({ text: "Ainda dentro do prazo." });
    expect(await payloadOf(foreign)).toEqual({ text: "Outra empresa." });

    expect(await orgEventsOf(org)).toEqual([
      { kind: "transcripts_purged", actor_user_id: null, payload: { count: 2, retentionDays: 30, before: daysAgo(30).toISOString() } },
    ]);
    expect(await orgEventsOf(other)).toEqual([]);
    expect((await tasksOf(app, org)).map(({ kind, status, run_at }) => ({ kind, status, run_at }))).toEqual([
      { kind: "purge_transcripts", status: "queued", run_at: new Date(t0.getTime() + DAY_MS) },
    ]);
  });

  it("rodar de novo não reconta, não grava evento e não abre uma segunda corrente", async () => {
    const org = await createOrganization(app, "purge twice");
    await putSetting(app, org, "transcripts.retention_days", 30, false);
    const call = await createCall(app, org, daysAgo(90));
    const old = await addEvent(org, call, "transcript_user", { text: "Antiga." }, daysAgo(90));

    await run(org);
    await run(org);

    expect(await payloadOf(old)).toEqual({ purged: true });
    expect((await orgEventsOf(org)).map((event) => event.payload.count)).toEqual([1]);
    expect((await tasksOf(app, org)).filter((queued) => queued.status === "queued")).toHaveLength(1);
  });

  it("sem prazo gravado, guarda para sempre e a corrente para", async () => {
    const org = await createOrganization(app, "purge forever");
    const call = await createCall(app, org, daysAgo(4000));
    const ancient = await addEvent(org, call, "transcript_user", { text: "De muito tempo atrás." }, daysAgo(4000));

    await run(org);

    expect(await payloadOf(ancient)).toEqual({ text: "De muito tempo atrás." });
    expect(await orgEventsOf(org)).toEqual([]);
    expect(await tasksOf(app, org)).toEqual([]);
  });

  it("prazo gravado abaixo do piso não apaga nada", async () => {
    const org = await createOrganization(app, "purge below floor");
    await putSetting(app, org, "transcripts.retention_days", 1, false);
    const call = await createCall(app, org, daysAgo(10));
    const tenDays = await addEvent(org, call, "transcript_agent", { text: "Dez dias." }, daysAgo(10));

    await run(org);

    expect(await payloadOf(tenDays)).toEqual({ text: "Dez dias." });
    expect(await tasksOf(app, org)).toEqual([]);
  });
});
