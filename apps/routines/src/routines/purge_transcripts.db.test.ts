import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeFollowUp, createFollowUp, recordingPath, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, createUser, depsFor, openTestDbs, putSetting, t0, task, tasksOf } from "../../test/helpers";
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
    const recentCall = await createCall(app, org, daysAgo(29));
    // A fala que sustenta o desfecho é cópia da transcrição: sai com o mesmo prazo, e o desfecho fica.
    await withSystem(app, (q) =>
      q.exec("update calls set outcome = 'booked', outcome_evidence = 'Pode marcar.' where id = any($1::uuid[])", [[call, recentCall]]),
    );
    const foreignCall = await createCall(app, other, daysAgo(40));
    const foreign = await addEvent(other, foreignCall, "transcript_user", { text: "Outra empresa." }, daysAgo(60));
    await withSystem(app, (q) => q.exec("update calls set outcome = 'booked', outcome_evidence = 'Outra empresa.' where id = $1", [foreignCall]));

    await run(org);

    expect(await payloadOf(oldUser)).toEqual({ purged: true });
    expect(await payloadOf(oldAgent)).toEqual({ purged: true });
    // Fora do vocabulário de fala, fora do prazo ou de outra organização: nada muda.
    expect(await payloadOf(oldTool)).toEqual({ name: "end_call", args: {} });
    expect(await payloadOf(recent)).toEqual({ text: "Ainda dentro do prazo." });
    expect(await payloadOf(foreign)).toEqual({ text: "Outra empresa." });
    const outcomes = await withSystem(app, (q) =>
      q.many<{ id: string; outcome: string; outcome_evidence: string | null }>("select id, outcome, outcome_evidence from calls where id = any($1::uuid[])", [[call, recentCall, foreignCall]]),
    );
    expect(outcomes.find((row) => row.id === call)).toMatchObject({ outcome: "booked", outcome_evidence: null });
    expect(outcomes.find((row) => row.id === recentCall)).toMatchObject({ outcome: "booked", outcome_evidence: "Pode marcar." });
    expect(outcomes.find((row) => row.id === foreignCall)).toMatchObject({ outcome: "booked", outcome_evidence: "Outra empresa." });

    expect(await orgEventsOf(org)).toEqual([
      { kind: "transcripts_purged", actor_user_id: null, payload: { count: 2, retentionDays: 30, before: daysAgo(30).toISOString() } },
    ]);
    expect(await orgEventsOf(other)).toEqual([]);
    expect((await tasksOf(app, org)).map(({ kind, status, run_at }) => ({ kind, status, run_at }))).toEqual([
      { kind: "purge_transcripts", status: "queued", run_at: new Date(t0.getTime() + DAY_MS) },
    ]);
  });

  // A organização não tem a gravação ligada: desligar não apaga o que já foi gravado, e o que ficou
  // segue o prazo (registro 0016).
  it("apaga as gravações de áudio que passaram do prazo, mesmo com a gravação desligada, só da organização, e conta no mesmo evento", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-recordings-"));
    try {
      const org = await createOrganization(app, "purge recordings");
      const other = await createOrganization(app, "purge recordings other");
      await putSetting(app, org, "transcripts.retention_days", 30, false);
      const wav = async (organizationId: string, callId: string, age: number): Promise<string> => {
        const file = recordingPath(dir, organizationId, callId);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, "RIFF");
        await utimes(file, daysAgo(age), daysAgo(age));
        return file;
      };
      await wav(org, "11111111-1111-4111-8111-111111111111", 31);
      await wav(org, "22222222-2222-4222-8222-222222222222", 29);
      await wav(other, "33333333-3333-4333-8333-333333333333", 60);

      await purgeTranscripts.run(task(org, "purge_transcripts"), { ...depsFor(app), recordingsDir: dir });

      // Saiu só a gravação velha desta organização; a recente e a de outra empresa ficam.
      expect(await readdir(path.join(dir, org))).toEqual(["22222222-2222-4222-8222-222222222222.wav"]);
      expect(await readdir(path.join(dir, other))).toEqual(["33333333-3333-4333-8333-333333333333.wav"]);
      expect(await orgEventsOf(org)).toEqual([
        { kind: "transcripts_purged", actor_user_id: null, payload: { count: 0, recordings: 1, retentionDays: 30, before: daysAgo(30).toISOString() } },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("apaga a pendência fechada antes do limite (pelo fecho) com o aviso dela, deixa a aberta mesmo velha, e conta followUps", async () => {
    const org = await createOrganization(app, "purge follow-ups");
    await putSetting(app, org, "transcripts.retention_days", 30, false);
    const call = await createCall(app, org, daysAgo(200));
    const person = await createUser(app, org, null);
    const agent = await withSystem(app, (q) => q.one<{ id: string }>("insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]));
    const open = (title: string) => withOrg(app, org, (q) => createFollowUp(q, { callId: call, agentId: agent?.id ?? "", title, details: "", dueAt: daysAgo(199) }, daysAgo(200)));
    const old = await open("Fechada há 40 dias");
    const recent = await open("Fechada há 10 dias");
    const stillOpen = await open("Aberta há 200 dias");
    const close = (id: string, at: Date) => withOrg(app, org, (q) => closeFollowUp(q, id, { status: "done", note: "Feito.", closedBy: person }, at));
    await close(old.id, daysAgo(40));
    await close(recent.id, daysAgo(10));
    // O aviso do sino aponta para a pendência: sai junto com ela.
    for (const id of [old.id, stillOpen.id]) {
      await withSystem(app, (q) => q.exec("insert into notifications (organization_id, follow_up_id, channel, body, status, created_at) values ($1, $2, 'panel', 'Pendência para agora', 'sent', $3)", [org, id, daysAgo(199)]));
    }

    await run(org);

    const left = await withSystem(app, (q) => q.many<{ id: string }>("select id from follow_ups where organization_id = $1 order by created_at, id", [org]));
    expect(left.map((row) => row.id).sort()).toEqual([recent.id, stillOpen.id].sort());
    const notices = await withSystem(app, (q) => q.many<{ follow_up_id: string }>("select follow_up_id from notifications where organization_id = $1", [org]));
    expect(notices).toEqual([{ follow_up_id: stillOpen.id }]);
    expect(await orgEventsOf(org)).toEqual([
      { kind: "transcripts_purged", actor_user_id: null, payload: { count: 0, followUps: 1, retentionDays: 30, before: daysAgo(30).toISOString() } },
    ]);
  });

  it("sem prazo gravado, a pendência fechada também fica para sempre", async () => {
    const org = await createOrganization(app, "purge follow-ups forever");
    const call = await createCall(app, org, daysAgo(4000));
    const person = await createUser(app, org, null);
    const agent = await withSystem(app, (q) => q.one<{ id: string }>("insert into agents (organization_id, name, engine) values ($1, 'Recepção', 'simulated') returning id", [org]));
    const { id } = await withOrg(app, org, (q) => createFollowUp(q, { callId: call, agentId: agent?.id ?? "", title: "Antiga", details: "", dueAt: daysAgo(4000) }, daysAgo(4000)));
    await withOrg(app, org, (q) => closeFollowUp(q, id, { status: "canceled", note: "Desistiu.", closedBy: person }, daysAgo(3999)));

    await run(org);

    expect(await withSystem(app, (q) => q.one("select 1 as kept from follow_ups where id = $1", [id]))).toEqual({ kept: 1 });
    expect(await orgEventsOf(org)).toEqual([]);
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
