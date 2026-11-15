import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { callerHistory } from "./caller-history";
import { MAX_CALLER_NOTES_PER_CALL, PURGE_CALLER_NOTES_TASK, purgeCallerNotes, saveCallerNote } from "./caller-memory";
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
