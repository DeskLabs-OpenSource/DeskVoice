import { PURGE_CALLER_NOTES_TASK, saveCallerNote, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, putSetting, t0, task, tasksOf } from "../../test/helpers";
import purgeCallerNotes from "./purge_caller_notes";
import purgeTranscripts from "./purge_transcripts";

/**
 * O prazo da memória (decisão 2A, registro 0020), com relógio injetado: ausente vale 90 dias, e não
 * "para sempre"; o prazo em vigor é o menor entre o da memória e o da transcrição; a corrente é uma só
 * por organização e não existe sem nota.
 */
const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(t0.getTime() - days * DAY_MS);
const PHONE = "+5531955550000";

/** Uma nota de `days` dias atrás, numa chamada recebida de `PHONE`. */
async function noteAged(org: string, days: number, text = `Nota de ${days} dias.`): Promise<string> {
  const callId = await createCall(app, org, daysAgo(days));
  await withSystem(app, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [callId, PHONE]));
  const saved = await withOrg(app, org, (q) => saveCallerNote(q, { callId, text }, daysAgo(days)));
  if (saved.status !== "saved") throw new Error(`note not saved: ${saved.status}`);
  return saved.id;
}
const notesOf = (org: string) => withOrg(app, org, (q) => q.many<{ text: string }>("select text from caller_notes order by created_at"));
const orgEventsOf = (org: string, kind: string) =>
  withSystem(app, (q) => q.many<{ payload: Record<string, unknown> }>("select payload from organization_events where organization_id = $1 and kind = $2 order by id", [org, kind]));
const queuedPurges = async (org: string) => (await tasksOf(app, org)).filter((row) => row.kind === PURGE_CALLER_NOTES_TASK && row.status === "queued");
const clearQueue = (org: string) => withSystem(app, (q) => q.exec("delete from tasks where organization_id = $1", [org]));
const runNotes = (org: string): Promise<void> => purgeCallerNotes.run(task(org, PURGE_CALLER_NOTES_TASK), depsFor(app));
const runTranscripts = (org: string): Promise<void> => purgeTranscripts.run(task(org, "purge_transcripts"), depsFor(app));

describe("purge_caller_notes", () => {
  it("sem chave, uma nota de 91 dias sai e uma de 89 fica; grava a contagem e marca a passagem de amanhã", async () => {
    const org = await createOrganization(app, "notes purge default");
    const other = await createOrganization(app, "notes purge other");
    await noteAged(org, 91);
    await noteAged(org, 89);
    await noteAged(other, 200, "Nota da outra organização.");
    await clearQueue(org);

    await runNotes(org);

    expect(await notesOf(org)).toEqual([{ text: "Nota de 89 dias." }]);
    expect(await notesOf(other)).toEqual([{ text: "Nota da outra organização." }]);
    const events = await orgEventsOf(org, "caller_notes_purged");
    expect(events).toEqual([{ payload: { count: 1, retentionDays: 90, before: daysAgo(90).toISOString() } }]);
    expect(JSON.stringify(events)).not.toContain("Nota de");
    expect((await queuedPurges(org)).map((row) => row.run_at)).toEqual([new Date(t0.getTime() + DAY_MS)]);
  });

  it("o prazo gravado vale, e o da transcrição, quando menor, vence", async () => {
    const org = await createOrganization(app, "notes purge configured");
    await putSetting(app, org, "caller_notes.retention_days", 60, false);
    await noteAged(org, 61);
    await noteAged(org, 59);
    await noteAged(org, 31);
    await runNotes(org);
    expect(await notesOf(org)).toEqual([{ text: "Nota de 59 dias." }, { text: "Nota de 31 dias." }]);

    await putSetting(app, org, "transcripts.retention_days", 30, false);
    await runNotes(org);
    expect(await notesOf(org)).toEqual([]);
    expect((await orgEventsOf(org, "caller_notes_purged")).map((event) => event.payload.retentionDays)).toEqual([60, 30]);
  });

  it("prazo gravado inválido não vira \"para sempre\": vale o de fábrica", async () => {
    const org = await createOrganization(app, "notes purge invalid");
    await putSetting(app, org, "caller_notes.retention_days", 5000, false);
    await noteAged(org, 91);
    await runNotes(org);
    expect(await notesOf(org)).toEqual([]);
  });

  it("organização sem nota não tem tarefa na fila; a corrente para quando não sobra nota", async () => {
    const empty = await createOrganization(app, "notes purge empty");
    await runNotes(empty);
    expect(await tasksOf(app, empty)).toEqual([]);
    expect(await orgEventsOf(empty, "caller_notes_purged")).toEqual([]);

    const org = await createOrganization(app, "notes purge last");
    await noteAged(org, 100);
    await clearQueue(org);
    await runNotes(org);
    expect(await notesOf(org)).toEqual([]);
    expect(await queuedPurges(org)).toEqual([]);
  });

  it("a primeira nota começa a corrente, e as seguintes não abrem outra", async () => {
    const org = await createOrganization(app, "notes purge chain");
    expect(await tasksOf(app, org)).toEqual([]);
    await noteAged(org, 2);
    await noteAged(org, 1);
    expect((await queuedPurges(org)).map((row) => row.run_at)).toEqual([new Date(daysAgo(2).getTime() + DAY_MS)]);
  });
});

describe("purge_transcripts e as notas", () => {
  it("com a transcrição em 30 dias, uma nota de 31 dias sai e transcripts_purged conta notes", async () => {
    const org = await createOrganization(app, "notes transcripts 30");
    await putSetting(app, org, "transcripts.retention_days", 30, false);
    await noteAged(org, 31);
    await noteAged(org, 29);

    await runTranscripts(org);

    expect(await notesOf(org)).toEqual([{ text: "Nota de 29 dias." }]);
    const [purged] = await orgEventsOf(org, "transcripts_purged");
    expect(purged?.payload).toMatchObject({ notes: 1, retentionDays: 30 });
    expect(JSON.stringify(purged)).not.toContain("Nota de");
  });

  it("sem prazo de transcrição, purge_transcripts não apaga nota: só a rotina nova, pelos 90", async () => {
    const org = await createOrganization(app, "notes transcripts forever");
    await noteAged(org, 120);
    await runTranscripts(org);
    expect(await notesOf(org)).toEqual([{ text: "Nota de 120 dias." }]);
    expect(await orgEventsOf(org, "transcripts_purged")).toEqual([]);

    await runNotes(org);
    expect(await notesOf(org)).toEqual([]);
  });
});
