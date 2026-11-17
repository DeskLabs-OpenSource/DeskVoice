import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { callerHistory } from "./caller-history";
import { MAX_CALLER_NOTES_PER_CALL, PURGE_CALLER_NOTES_TASK, deleteCallerNote, forgetCaller, purgeCallerNotes, saveCallerNote } from "./caller-memory";
import { withOrg, withSystem } from "./with-org";

/**
 * O único ponto de escrita de `caller_notes` (fatia 3 do desenho de 13/11): o telefone vem da linha
 * da chamada, nunca de quem chama; ligação sem número não grava; 10 por ligação; e nada roda fora de
 * `withOrg`.
 */
const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const PHONE = "+5531933332222";
const LINE = "+553133330000";
const t = (minutes: number): Date => new Date(Date.UTC(2026, 3, 1, 12, minutes));

async function callOf(
  organizationId: string,
  input: { at: Date; direction?: "inbound" | "outbound"; from?: string | null; to?: string | null; channel?: "phone" | "simulated"; ended?: boolean },
): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec(
      "insert into calls (id, organization_id, direction, channel, status, from_e164, to_e164, started_at, ended_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        id,
        organizationId,
        input.direction ?? "inbound",
        input.channel ?? "phone",
        input.ended === false ? "in_progress" : "completed",
        input.from ?? null,
        input.to ?? null,
        input.at,
        input.ended === false ? null : input.at,
      ],
    ),
  );
  return id;
}
const save = (organizationId: string, callId: string, text: string, at = t(0)) => withOrg(app, organizationId, (q) => saveCallerNote(q, { callId, text }, at));
const notesOf = (organizationId: string) => withOrg(app, organizationId, (q) => q.many<{ call_id: string; caller_e164: string; text: string }>("select call_id, caller_e164, text from caller_notes order by created_at, id"));

describe("saveCallerNote", () => {
  it("o telefone é o do outro lado: from_e164 na recebida, to_e164 na feita; nunca a linha da empresa", async () => {
    const org = await createOrganization(app, "notes side");
    const inbound = await callOf(org, { at: t(0), from: PHONE, to: LINE });
    const outbound = await callOf(org, { at: t(1), direction: "outbound", from: LINE, to: PHONE });
    expect(await save(org, inbound, "  Prefere de manhã.  ")).toMatchObject({ status: "saved" });
    expect(await save(org, outbound, "O pedido é o 4471.", t(1))).toMatchObject({ status: "saved" });
    expect(await notesOf(org)).toEqual([
      { call_id: inbound, caller_e164: PHONE, text: "Prefere de manhã." },
      { call_id: outbound, caller_e164: PHONE, text: "O pedido é o 4471." },
    ]);
  });

  it("ligação sem número não grava nada", async () => {
    const org = await createOrganization(app, "notes no number");
    const anonymous = await callOf(org, { at: t(0), from: null, to: LINE });
    const outboundWithout = await callOf(org, { at: t(1), direction: "outbound", from: LINE, to: null });
    expect(await save(org, anonymous, "Nota sem número.")).toEqual({ status: "no_number" });
    expect(await save(org, outboundWithout, "Nota sem número.")).toEqual({ status: "no_number" });
    expect(await notesOf(org)).toEqual([]);
    expect(await withOrg(app, org, (q) => q.many("select 1 from tasks"))).toEqual([]);
  });

  it(`recusa a ${MAX_CALLER_NOTES_PER_CALL + 1}ª nota da mesma ligação`, async () => {
    const org = await createOrganization(app, "notes limit");
    const callId = await callOf(org, { at: t(0), from: PHONE });
    for (let index = 0; index < MAX_CALLER_NOTES_PER_CALL; index += 1) expect(await save(org, callId, `Nota ${index}`)).toMatchObject({ status: "saved" });
    expect(await save(org, callId, "A décima primeira.")).toEqual({ status: "limit" });
    expect(await notesOf(org)).toHaveLength(MAX_CALLER_NOTES_PER_CALL);
    // A outra ligação do mesmo número tem as próprias vagas.
    const next = await callOf(org, { at: t(5), from: PHONE });
    expect(await save(org, next, "Outra ligação.")).toMatchObject({ status: "saved" });
  });

  it("ligação apagada a pedido do titular, ou de outra organização, não recebe nota", async () => {
    const org = await createOrganization(app, "notes erased");
    const other = await createOrganization(app, "notes erased other");
    const erased = await callOf(org, { at: t(0), from: PHONE });
    await withSystem(app, (q) => q.exec("update calls set erased_at = $2 where id = $1", [erased, t(1)]));
    expect(await save(org, erased, "Depois do apagamento.")).toEqual({ status: "not_found" });
    const theirs = await callOf(other, { at: t(0), from: PHONE });
    expect(await save(org, theirs, "Na chamada da outra.")).toEqual({ status: "not_found" });
    expect(await notesOf(org)).toEqual([]);
    expect(await notesOf(other)).toEqual([]);
  });

  it("começa a corrente do prazo da memória uma vez só", async () => {
    const org = await createOrganization(app, "notes chain");
    const callId = await callOf(org, { at: t(0), from: PHONE });
    await save(org, callId, "Primeira.", t(0));
    await save(org, callId, "Segunda.", t(1));
    const tasks = await withOrg(app, org, (q) => q.many<{ kind: string; run_at: Date }>("select kind, run_at from tasks"));
    expect(tasks).toEqual([{ kind: PURGE_CALLER_NOTES_TASK, run_at: new Date(t(0).getTime() + 86_400_000) }]);
  });

  it("saveCallerNote e purgeCallerNotes falham em withSystem", async () => {
    const org = await createOrganization(app, "notes system");
    const callId = await callOf(org, { at: t(0), from: PHONE });
    await expect(withSystem(app, (q) => saveCallerNote(q, { callId, text: "Nota." }, t(0)))).rejects.toThrow(/inside withOrg/);
    await expect(withSystem(app, (q) => purgeCallerNotes(q, t(0)))).rejects.toThrow(/inside withOrg/);
  });

  it("purgeCallerNotes apaga só as anteriores ao limite e só da organização", async () => {
    const org = await createOrganization(app, "notes purge core");
    const other = await createOrganization(app, "notes purge core other");
    await save(org, await callOf(org, { at: t(0), from: PHONE }), "Velha.", t(0));
    await save(org, await callOf(org, { at: t(10), from: PHONE }), "Nova.", t(10));
    await save(other, await callOf(other, { at: t(0), from: PHONE }), "Da outra.", t(0));
    expect(await withOrg(app, org, (q) => purgeCallerNotes(q, t(5)))).toBe(1);
    expect((await notesOf(org)).map((note) => note.text)).toEqual(["Nova."]);
    expect((await notesOf(other)).map((note) => note.text)).toEqual(["Da outra."]);
  });
});

describe("callerHistory com notas e simuladas (#291)", () => {
  it("a mesma nota e o mesmo número em duas organizações nunca aparecem na outra", async () => {
    const a = await createOrganization(app, "notes iso a");
    const b = await createOrganization(app, "notes iso b");
    const firstA = await callOf(a, { at: t(0), from: PHONE });
    const firstB = await callOf(b, { at: t(0), from: PHONE });
    await save(a, firstA, "A mesma nota.");
    await save(b, firstB, "A mesma nota.");
    const currentA = await callOf(a, { at: t(10), from: PHONE, ended: false });
    const history = await withOrg(app, a, (q) => callerHistory(q, currentA));
    expect(history).toMatchObject({ noteCount: 1, notes: [{ callId: firstA, text: "A mesma nota." }] });
  });

  it("pendência e nota de simulada vêm marcadas e contadas à parte; a pendência sem chamada conta como real", async () => {
    const org = await createOrganization(app, "notes simulated");
    const real = await callOf(org, { at: t(0), from: PHONE });
    const simulated = await callOf(org, { at: t(1), from: PHONE, channel: "simulated" });
    await save(org, simulated, "Anotado na simulada.", t(1));
    await save(org, real, "Anotado na real.", t(0));
    await withSystem(app, async (q) => {
      // A da simulada vence antes: mesmo assim, a lista traz as reais primeiro.
      await q.exec("insert into follow_ups (organization_id, call_id, caller_e164, title, due_at, created_at) values ($1, $2, $3, 'Da simulada', $4, $4)", [org, simulated, PHONE, t(2)]);
      await q.exec("insert into follow_ups (organization_id, call_id, caller_e164, title, due_at, created_at) values ($1, $2, $3, 'Da real', $4, $4)", [org, real, PHONE, t(3)]);
      await q.exec("insert into follow_ups (organization_id, caller_e164, title, due_at, created_at) values ($1, $2, 'Da tela', $3, $3)", [org, PHONE, t(4)]);
    });
    const current = await callOf(org, { at: t(10), from: PHONE, ended: false });

    const history = await withOrg(app, org, (q) => callerHistory(q, current));
    expect(history).toMatchObject({ callCount: 2, simulatedCallCount: 1, openFollowUpCount: 3, simulatedOpenFollowUpCount: 1, noteCount: 2, simulatedNoteCount: 1 });
    expect(history?.openFollowUps.map((followUp) => [followUp.title, followUp.simulated])).toEqual([
      ["Da real", false],
      ["Da tela", false],
      ["Da simulada", true],
    ]);
    expect(history?.notes.map((note) => [note.text, note.callId, note.simulated])).toEqual([
      ["Anotado na simulada.", simulated, true],
      ["Anotado na real.", real, false],
    ]);
  });
});

describe("apagar uma nota e esquecer um número (fatia 3b)", () => {
  /** Uma pendência do número, aberta ou fechada, com notificação ligada a ela. */
  async function followUpOf(organizationId: string, callId: string | null, status: "open" | "done" | "canceled", title: string, phone: string | null = PHONE): Promise<string> {
    return withSystem(app, async (q) => {
      const row = await q.one<{ id: string }>(
        `insert into follow_ups (organization_id, call_id, caller_e164, title, due_at, created_at, status, closed_at)
         values ($1, $2, $3, $4, $5, $5, $6, $7) returning id`,
        [organizationId, callId, phone, title, t(0), status, status === "open" ? null : t(1)],
      );
      await q.exec("insert into notifications (organization_id, channel, body, follow_up_id, created_at) values ($1, 'panel', 'Pendência', $2, $3)", [organizationId, row?.id, t(0)]);
      return row?.id ?? "";
    });
  }
  const followUpsOf = (organizationId: string) =>
    withOrg(app, organizationId, (q) => q.many<{ title: string; status: string }>("select title, status from follow_ups order by title"));

  it("deleteCallerNote e forgetCaller falham em withSystem", async () => {
    const org = await createOrganization(app, "forget system");
    const callId = await callOf(org, { at: t(0), from: PHONE });
    const saved = await save(org, callId, "Nota.");
    const id = saved.status === "saved" ? saved.id : "";
    await expect(withSystem(app, (q) => deleteCallerNote(q, id))).rejects.toThrow(/inside withOrg/);
    await expect(withSystem(app, (q) => forgetCaller(q, PHONE))).rejects.toThrow(/inside withOrg/);
    expect(await notesOf(org)).toHaveLength(1);
  });

  it("deleteCallerNote apaga só a nota pedida, e o id de outra organização não é achado", async () => {
    const org = await createOrganization(app, "delete note");
    const other = await createOrganization(app, "delete note other");
    const callId = await callOf(org, { at: t(0), from: PHONE });
    const first = await save(org, callId, "Primeira.");
    await save(org, callId, "Segunda.", t(1));
    const foreign = await save(other, await callOf(other, { at: t(0), from: PHONE }), "Da outra.");
    if (first.status !== "saved" || foreign.status !== "saved") throw new Error("fixture");

    expect(await withOrg(app, org, (q) => deleteCallerNote(q, foreign.id))).toBe(false);
    expect((await notesOf(other)).map((note) => note.text)).toEqual(["Da outra."]);
    expect(await withOrg(app, org, (q) => deleteCallerNote(q, first.id))).toBe(true);
    expect(await withOrg(app, org, (q) => deleteCallerNote(q, first.id))).toBe(false);
    expect((await notesOf(org)).map((note) => note.text)).toEqual(["Segunda."]);
  });

  it("forgetCaller apaga as notas e as pendências fechadas do número, deixa as abertas, os outros números e as ligações", async () => {
    const org = await createOrganization(app, "forget");
    const other = await createOrganization(app, "forget other");
    const OTHER_PHONE = "+5531911110000";
    const inbound = await callOf(org, { at: t(0), from: PHONE, to: LINE });
    const outbound = await callOf(org, { at: t(1), direction: "outbound", from: LINE, to: PHONE });
    const stranger = await callOf(org, { at: t(2), from: OTHER_PHONE, to: LINE });
    await save(org, inbound, "Prefere de manhã.");
    await save(org, outbound, "O pedido é o 4471.", t(1));
    await save(org, stranger, "De outro número.", t(2));
    const done = await followUpOf(org, inbound, "done", "b feita");
    await followUpOf(org, outbound, "canceled", "c cancelada");
    const open = await followUpOf(org, inbound, "open", "a aberta");
    await followUpOf(org, stranger, "done", "d de outro número", OTHER_PHONE);
    const otherCall = await callOf(other, { at: t(0), from: PHONE });
    await save(other, otherCall, "Na outra organização.");
    await followUpOf(other, otherCall, "done", "e fechada da outra");

    expect(await withOrg(app, org, (q) => forgetCaller(q, PHONE))).toEqual({ notes: 2, followUps: 2 });

    expect((await notesOf(org)).map((note) => note.text)).toEqual(["De outro número."]);
    expect(await followUpsOf(org)).toEqual([
      { title: "a aberta", status: "open" },
      { title: "d de outro número", status: "done" },
    ]);
    // Os avisos da pendência fechada saem em cascata; os da aberta ficam.
    const notifications = await withOrg(app, org, (q) => q.many<{ follow_up_id: string }>("select follow_up_id from notifications where follow_up_id = any($1::uuid[])", [[done, open]]));
    expect(notifications.map((row) => row.follow_up_id)).toEqual([open]);
    // As ligações ficam: seguem o prazo de guarda.
    expect(await withOrg(app, org, (q) => q.many("select id from calls where id = any($1::uuid[])", [[inbound, outbound]]))).toHaveLength(2);
    // A outra organização não é tocada.
    expect((await notesOf(other)).map((note) => note.text)).toEqual(["Na outra organização."]);
    expect(await followUpsOf(other)).toEqual([{ title: "e fechada da outra", status: "done" }]);

    // Repetir não acha mais nada.
    expect(await withOrg(app, org, (q) => forgetCaller(q, PHONE))).toEqual({ notes: 0, followUps: 0 });
  });

  it("a linha da empresa não esquece as notas de quem ligou para ela", async () => {
    const org = await createOrganization(app, "forget line");
    await save(org, await callOf(org, { at: t(0), from: PHONE, to: LINE }), "Nota.");
    expect(await withOrg(app, org, (q) => forgetCaller(q, LINE))).toEqual({ notes: 0, followUps: 0 });
    expect(await notesOf(org)).toHaveLength(1);
  });
});
