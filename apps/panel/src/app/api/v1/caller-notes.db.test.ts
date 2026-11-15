import { PURGE_CALLER_NOTES_TASK, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { DELETE as deleteNote } from "./caller-notes/[id]/route";
import { GET as callerHistory } from "./calls/[id]/caller-history/route";
import { POST as forget } from "./privacy/forget/route";
import { PUT as putNotesRetention } from "./privacy/caller-notes-retention/route";
import { POST as exportRecord } from "./privacy/export/route";
import { PUT as putRetention } from "./privacy/retention/route";
import { GET as privacy } from "./privacy/route";

/**
 * As notas do agente pela tela (fatia 3 do desenho de 13/11, registro 0020, 2A): o prazo da memória
 * em Configurações, a linha `note` na exportação e as notas no bloco "Este número", sempre só da
 * organização de quem pede.
 */
const panel = startPanel();
afterAll(() => panel.close());

const PHONE = "+5531977776666";
const NOTE = "Prefere ser atendida de manhã; o pedido é o 4471.";
const read = <T>(org: string, sql: string, params: unknown[] = []) => withOrg(panel.app, org, (q) => q.many<T & Record<string, unknown>>(sql, params));
const setNotesDays = (cookie: string, days: unknown) => call(putNotesRetention, { method: "PUT", cookie, body: { days } });
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];

interface NotesRetentionView {
  configured: number | null;
  days: number;
  effective: number;
  defaultDays: number;
  minDays: number;
  maxDays: number;
}

/** Uma chamada recebida de `phone` com uma nota do agente. */
async function noteOf(org: string, text: string, phone = PHONE, at = NOW): Promise<string> {
  const callId = await createCall(panel.app, org, at);
  await withOrg(panel.app, org, async (q) => {
    await q.exec("update calls set from_e164 = $2, status = 'completed', ended_at = $3 where id = $1", [callId, phone, at]);
    await q.exec("insert into caller_notes (organization_id, call_id, caller_e164, text, created_at) values ($1, $2, $3, $4, $5)", [org, callId, phone, text, at]);
  });
  return callId;
}

const purgeTasks = (org: string) => read<{ run_at: Date }>(org, "select run_at from tasks where kind = $1 and status = 'queued'", [PURGE_CALLER_NOTES_TASK]);

describe("o prazo da memória em Configurações", () => {
  it("sem escolha vale 90 dias, e o prazo em vigor é o menor entre o da memória e o da transcrição", async () => {
    const org = await createOrganization(panel.app, "notes retention default");
    const owner = await createUser(panel.app, org, "owner");
    const view = async () => ((await call(privacy, { cookie: owner.cookie })).data as { notesRetention: NotesRetentionView }).notesRetention;
    expect(await view()).toEqual({ configured: null, days: 90, effective: 90, defaultDays: 90, minDays: 30, maxDays: 365 });

    expect((await call(putRetention, { method: "PUT", cookie: owner.cookie, body: { days: 30 } })).status).toBe(200);
    expect(await view()).toMatchObject({ configured: null, days: 90, effective: 30 });
  });

  it("recusa 29, 366 e um valor acima do prazo da transcrição; aceita o próprio prazo da transcrição", async () => {
    const org = await createOrganization(panel.app, "notes retention bounds");
    const owner = await createUser(panel.app, org, "owner");
    expect(refusal(await setNotesDays(owner.cookie, 29))).toEqual([400, "validation_error"]);
    expect(refusal(await setNotesDays(owner.cookie, 366))).toEqual([400, "validation_error"]);
    expect(refusal(await setNotesDays(owner.cookie, 45.5))).toEqual([400, "validation_error"]);
    expect(refusal(await setNotesDays(owner.cookie, null))).toEqual([400, "validation_error"]);

    await call(putRetention, { method: "PUT", cookie: owner.cookie, body: { days: 60 } });
    expect(refusal(await setNotesDays(owner.cookie, 61))).toEqual([400, "caller_notes_retention_above_transcripts"]);
    expect(await read(org, "select 1 from settings where key = 'caller_notes.retention_days'")).toEqual([]);

    const saved = await setNotesDays(owner.cookie, 60);
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ configured: 60, days: 60, effective: 60 });
  });

  it("só dono ou administrador muda o prazo", async () => {
    const org = await createOrganization(panel.app, "notes retention operator");
    const operator = await createUser(panel.app, org, "operator");
    expect(refusal(await setNotesDays(operator.cookie, 60))).toEqual([403, "forbidden"]);
  });

  it("mudar grava o evento com o valor antigo e o novo, sem texto livre; sem nota, nada entra na fila", async () => {
    const org = await createOrganization(panel.app, "notes retention event");
    const admin = await createUser(panel.app, org, "admin");
    expect((await setNotesDays(admin.cookie, 120)).status).toBe(200);
    expect((await setNotesDays(admin.cookie, 120)).status).toBe(200); // o mesmo valor não grava de novo
    expect((await setNotesDays(admin.cookie, 45)).status).toBe(200);

    const events = await read<{ kind: string; actor_user_id: string; payload: unknown }>(
      org,
      "select kind, actor_user_id, payload from organization_events where kind = 'caller_notes_retention_changed' order by id",
    );
    expect(events).toEqual([
      { kind: "caller_notes_retention_changed", actor_user_id: admin.id, payload: { from: null, to: 120 } },
      { kind: "caller_notes_retention_changed", actor_user_id: admin.id, payload: { from: 120, to: 45 } },
    ]);
    // A organização sem nota não ganha tarefa na fila.
    expect(await purgeTasks(org)).toEqual([]);
  });

  it("com nota, mudar o prazo põe a rotina na fila para já", async () => {
    const org = await createOrganization(panel.app, "notes retention queue");
    const owner = await createUser(panel.app, org, "owner");
    await noteOf(org, NOTE);
    expect((await setNotesDays(owner.cookie, 30)).status).toBe(200);
    expect(await purgeTasks(org)).toEqual([{ run_at: panel.clock.at }]);
  });
});

describe("as notas na exportação e no bloco \"Este número\"", () => {
  it("a exportação traz as notas do número, e só da organização de quem pede", async () => {
    const mine = await createOrganization(panel.app, "notes export mine");
    const theirs = await createOrganization(panel.app, "notes export theirs");
    const owner = await createUser(panel.app, mine, "owner");
    const callId = await noteOf(mine, NOTE);
    await noteOf(theirs, "Nota da outra empresa.");
    await noteOf(mine, "Nota de outro número.", "+5531900001111");

    const result = await call(exportRecord, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(result.status).toBe(200);
    const data = result.data as { counts: Record<string, unknown>; content: string };
    expect(data.counts).toMatchObject({ calls: 1, notes: 1 });
    const notes = data.content
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.type === "note");
    expect(notes).toEqual([expect.objectContaining({ type: "note", call: callId, phone: PHONE, text: NOTE })]);
    expect(data.content).not.toContain("outra empresa");
    expect(data.content).not.toContain("outro número");
    // O registro da exportação leva a contagem, nunca o texto.
    const exported = await read<{ payload: unknown }>(mine, "select payload from organization_events where kind = 'caller_data_exported'");
    expect(JSON.stringify(exported)).not.toContain(NOTE);
  });

  it("o bloco lista as notas do número com o link da ligação e a marca da simulada; a de outra organização nunca", async () => {
    const mine = await createOrganization(panel.app, "notes block mine");
    const theirs = await createOrganization(panel.app, "notes block theirs");
    const owner = await createUser(panel.app, mine, "owner");
    const real = await noteOf(mine, NOTE, PHONE, new Date(NOW.getTime() - 120_000));
    const simulated = await noteOf(mine, "Anotado na simulada.", PHONE, new Date(NOW.getTime() - 60_000));
    await withOrg(panel.app, mine, (q) => q.exec("update calls set channel = 'simulated' where id = $1", [simulated]));
    await noteOf(theirs, "Nota da outra empresa.");
    const current = await createCall(panel.app, mine, NOW);
    await withOrg(panel.app, mine, (q) => q.exec("update calls set from_e164 = $2 where id = $1", [current, PHONE]));

    const result = await call(callerHistory, { cookie: owner.cookie, params: { id: current } });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      noteCount: 2,
      simulatedNoteCount: 1,
      notes: [
        { callId: simulated, text: "Anotado na simulada.", simulated: true },
        { callId: real, text: NOTE, simulated: false },
      ],
    });
    expect(JSON.stringify(result.data)).not.toContain("outra empresa");
  });
});

describe("apagar uma nota e esquecer um número (fatia 3b)", () => {
  const notesOf = (org: string) => read<{ id: string; text: string }>(org, "select id, text from caller_notes order by created_at, id");
  const deletedEvents = (org: string) =>
    read<{ actor_user_id: string; payload: unknown }>(org, "select actor_user_id, payload from organization_events where kind = 'caller_notes_deleted' order by id");
  /** Todo evento da organização, de chamada e da organização, como texto: nenhum pode conter a nota. */
  const allEvents = async (org: string) =>
    JSON.stringify([...(await read(org, "select kind, payload from call_events")), ...(await read(org, "select kind, payload from organization_events"))]);
  async function followUpOf(org: string, callId: string, status: "open" | "done" | "canceled", title: string): Promise<void> {
    await withOrg(panel.app, org, (q) =>
      q.exec("insert into follow_ups (organization_id, call_id, caller_e164, title, due_at, created_at, status, closed_at) values ($1, $2, $3, $4, $5, $5, $6, $7)", [
        org,
        callId,
        PHONE,
        title,
        NOW,
        status,
        status === "open" ? null : NOW,
      ]),
    );
  }

  it("o operador apaga uma nota; o evento leva quem apagou e a contagem, nunca o texto", async () => {
    const org = await createOrganization(panel.app, "delete note route");
    const operator = await createUser(panel.app, org, "operator");
    await noteOf(org, NOTE);
    await noteOf(org, "Outra nota que fica.");
    const target = (await notesOf(org)).find((note) => note.text === NOTE);

    const result = await call(deleteNote, { method: "DELETE", cookie: operator.cookie, params: { id: target?.id ?? "" } });
    expect(result.status).toBe(200);
    expect((await notesOf(org)).map((note) => note.text)).toEqual(["Outra nota que fica."]);
    expect(await deletedEvents(org)).toEqual([{ actor_user_id: operator.id, payload: { notes: 1 } }]);
    expect(await allEvents(org)).not.toContain(NOTE);

    // A segunda vez não acha a nota e não grava de novo.
    expect(refusal(await call(deleteNote, { method: "DELETE", cookie: operator.cookie, params: { id: target?.id ?? "" } }))).toEqual([404, "not_found"]);
    expect(await deletedEvents(org)).toHaveLength(1);
  });

  it("a nota de outra organização não é achada nem apagada", async () => {
    const mine = await createOrganization(panel.app, "delete note mine");
    const theirs = await createOrganization(panel.app, "delete note theirs");
    const owner = await createUser(panel.app, mine, "owner");
    await noteOf(theirs, NOTE);
    const [foreign] = await notesOf(theirs);
    expect(refusal(await call(deleteNote, { method: "DELETE", cookie: owner.cookie, params: { id: foreign?.id ?? "" } }))).toEqual([404, "not_found"]);
    expect(await notesOf(theirs)).toHaveLength(1);
    expect(await deletedEvents(mine)).toEqual([]);
  });

  it("o operador não esquece um número", async () => {
    const org = await createOrganization(panel.app, "forget operator");
    const operator = await createUser(panel.app, org, "operator");
    await noteOf(org, NOTE);
    expect(refusal(await call(forget, { method: "POST", cookie: operator.cookie, body: { phone: PHONE } }))).toEqual([403, "forbidden"]);
    expect(await notesOf(org)).toHaveLength(1);
    expect(await deletedEvents(org)).toEqual([]);
  });

  it("esquecer apaga as notas e as pendências fechadas, deixa as abertas, grava o telefone e as contagens, e não toca a outra organização", async () => {
    const mine = await createOrganization(panel.app, "forget mine");
    const theirs = await createOrganization(panel.app, "forget theirs");
    const admin = await createUser(panel.app, mine, "admin");
    const first = await noteOf(mine, NOTE);
    await noteOf(mine, "Segunda nota do número.");
    await noteOf(mine, "Nota de outro número.", "+5531900001111");
    await followUpOf(mine, first, "done", "Retornar sobre o orçamento");
    await followUpOf(mine, first, "canceled", "Mandar o boleto");
    await followUpOf(mine, first, "open", "Confirmar a consulta");
    const foreign = await noteOf(theirs, NOTE);
    await followUpOf(theirs, foreign, "done", "Fechada da outra");

    const result = await call(forget, { method: "POST", cookie: admin.cookie, body: { phone: PHONE } });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ phone: PHONE, notes: 2, followUps: 2 });

    expect((await notesOf(mine)).map((note) => note.text)).toEqual(["Nota de outro número."]);
    expect(await read(mine, "select title, status from follow_ups")).toEqual([{ title: "Confirmar a consulta", status: "open" }]);
    expect(await deletedEvents(mine)).toEqual([{ actor_user_id: admin.id, payload: { phone: PHONE, notes: 2, followUps: 2 } }]);
    expect(await allEvents(mine)).not.toContain(NOTE);
    expect(await allEvents(mine)).not.toContain("Segunda nota");

    expect((await notesOf(theirs)).map((note) => note.text)).toEqual([NOTE]);
    expect(await read(theirs, "select title from follow_ups")).toEqual([{ title: "Fechada da outra" }]);
    expect(await deletedEvents(theirs)).toEqual([]);

    // O registro da tela mostra quem esqueceu o número.
    const shown = (await call(privacy, { cookie: admin.cookie })).data as { history: { kind: string; actorName: string | null; payload: unknown }[] };
    expect(shown.history).toContainEqual(expect.objectContaining({ kind: "caller_notes_deleted", payload: { phone: PHONE, notes: 2, followUps: 2 } }));
  });

  it("esquecer um número sem nada grava o pedido mesmo assim, com contagens zero", async () => {
    const org = await createOrganization(panel.app, "forget empty");
    const owner = await createUser(panel.app, org, "owner");
    const result = await call(forget, { method: "POST", cookie: owner.cookie, body: { phone: PHONE } });
    expect(result.data).toEqual({ phone: PHONE, notes: 0, followUps: 0 });
    expect(await deletedEvents(org)).toEqual([{ actor_user_id: owner.id, payload: { phone: PHONE, notes: 0, followUps: 0 } }]);
  });

  it("recusa telefone fora do formato", async () => {
    const org = await createOrganization(panel.app, "forget invalid");
    const owner = await createUser(panel.app, org, "owner");
    expect(refusal(await call(forget, { method: "POST", cookie: owner.cookie, body: { phone: "31 99999" } }))).toEqual([400, "validation_error"]);
  });
});
