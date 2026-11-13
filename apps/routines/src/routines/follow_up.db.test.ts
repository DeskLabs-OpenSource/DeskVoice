import { closeFollowUp, createFollowUp, withOrg, withSystem, type ClaimedTask } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, createUser, depsFor, notificationsOf, openTestDbs, putWhatsAppConnector, t0, task, tasksOf } from "../../test/helpers";
import followUp, { PANEL_BODY, WHATSAPP_BODY } from "./follow_up";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE = "Retornar para Maria sobre o orçamento";
const DETAILS = "Quer o orçamento por e-mail.";
const at = (ms: number): Date => new Date(t0.getTime() + ms);

/** Organização, pessoa (com ou sem WhatsApp) dona das pendências do agente, e uma pendência para daqui a 1 h. */
async function scene(label: string, whatsapp: string | null = null) {
  const org = await createOrganization(app, label);
  const callId = await createCall(app, org, t0);
  const person = await createUser(app, org, whatsapp);
  const agent = await withSystem(app, (q) =>
    q.one<{ id: string }>("insert into agents (organization_id, name, engine, follow_up_owner_user_id) values ($1, 'Recepção', 'simulated', $2) returning id", [org, person]),
  );
  const created = await withOrg(app, org, (q) => createFollowUp(q, { callId, agentId: agent?.id ?? "", title: TITLE, details: DETAILS, dueAt: at(3600_000) }, t0));
  return { org, callId, person, ...created };
}

/** A tarefa `follow_up` enfileirada mais recente, como o consumidor a reivindicaria. */
async function queued(org: string): Promise<ClaimedTask & { runAt: Date }> {
  const row = (await tasksOf(app, org)).filter((candidate) => candidate.kind === "follow_up" && candidate.status === "queued").at(-1);
  if (!row) throw new Error("no follow_up task queued");
  return { ...task(org, "follow_up", row.payload, row.call_id), id: row.id, runAt: row.run_at };
}
const runAt = (when: Date, claimed: ClaimedTask) => followUp.run(claimed, depsFor(app, { clock: { now: () => when } }));
const markDone = (org: string, id: string) => withSystem(app, (q) => q.exec("update tasks set status = 'done' where id = $1 and organization_id = $2", [id, org]));

describe("follow_up", () => {
  it("na hora marcada avisa o dono pelo painel sem o título, e o aviso de vencida sai uma vez, um dia depois do prazo", async () => {
    const { org, callId, id } = await scene("follow up reminder");

    // O lembrete está na fila para o prazo, e não antes.
    const due = await queued(org);
    expect(due.runAt).toEqual(at(3600_000));
    expect(due.payload).toEqual({ followUpId: id, stage: "due" });
    await runAt(due.runAt, due);
    await markDone(org, due.id);
    expect(await notificationsOf(app, org)).toEqual([{ id: expect.any(String), channel: "panel", target: null, body: PANEL_BODY.due, status: "sent", call_id: callId }]);

    const overdue = await queued(org);
    expect(overdue.runAt).toEqual(at(3600_000 + DAY_MS));
    expect(overdue.payload).toEqual({ followUpId: id, stage: "overdue" });
    await runAt(overdue.runAt, overdue);
    await markDone(org, overdue.id);

    const bodies = (await notificationsOf(app, org)).map((notification) => notification.body);
    expect(bodies.sort()).toEqual([PANEL_BODY.due, PANEL_BODY.overdue].sort());
    expect(bodies.join("\n")).not.toContain("Maria");
    // Depois do aviso de vencida, nada mais na fila: ele sai uma vez só.
    expect((await tasksOf(app, org)).filter((candidate) => candidate.status === "queued")).toEqual([]);
    const linked = await withSystem(app, (q) => q.many<{ follow_up_id: string }>("select follow_up_id from notifications where organization_id = $1", [org]));
    expect(linked.map((row) => row.follow_up_id)).toEqual([id, id]);
  });

  it("pendência já fechada não avisa nem marca o aviso de vencida", async () => {
    const { org, person, id } = await scene("follow up closed");
    await withOrg(app, org, (q) => closeFollowUp(q, id, { status: "done", note: "Retornei.", closedBy: person }, t0));
    const due = await queued(org);
    await runAt(due.runAt, due);
    await markDone(org, due.id);
    expect(await notificationsOf(app, org)).toEqual([]);
    expect((await tasksOf(app, org)).filter((candidate) => candidate.status === "queued")).toEqual([]);
  });

  it("com WhatsApp do dono e conector, manda pelo WhatsApp só a contagem, nunca o título", async () => {
    const { org, id } = await scene("follow up whatsapp", "+5531988880042");
    await putWhatsAppConnector(app, org);
    const due = await queued(org);
    await runAt(due.runAt, due);

    const whatsapp = (await notificationsOf(app, org)).filter((notification) => notification.channel === "whatsapp");
    expect(whatsapp).toEqual([{ id: expect.any(String), channel: "whatsapp", target: "+5531988880042", body: WHATSAPP_BODY.due, status: "pending", call_id: expect.any(String) }]);
    expect(WHATSAPP_BODY.due).not.toContain(TITLE);
    expect(JSON.stringify(whatsapp)).not.toContain("Maria");
    const delivery = (await tasksOf(app, org)).filter((candidate) => candidate.kind === "deliver_notification");
    expect(delivery.map((candidate) => candidate.payload)).toEqual([{ notificationId: whatsapp[0]?.id }]);
    expect((await withSystem(app, (q) => q.one<{ follow_up_id: string }>("select follow_up_id from notifications where id = $1", [whatsapp[0]?.id])))?.follow_up_id).toBe(id);
  });

  it("tarefa enfileirada antes da atualização (só título e detalhes) ainda cria o aviso de antes", async () => {
    const org = await createOrganization(app, "follow up legacy");
    const callId = await createCall(app, org, t0);
    await followUp.run(task(org, "follow_up", { title: "Retornar para Maria", details: "Quer o orçamento por e-mail." }, callId), depsFor(app));
    expect(await notificationsOf(app, org)).toEqual([
      { id: expect.any(String), channel: "panel", target: null, body: "Pendência: Retornar para Maria\n\nQuer o orçamento por e-mail.", status: "sent", call_id: callId },
    ]);
  });

  it("recusa tarefa sem pendência nem título", async () => {
    const org = await createOrganization(app, "follow up invalid");
    await expect(followUp.run(task(org, "follow_up", { details: "x" }), depsFor(app))).rejects.toThrow();
    expect(await notificationsOf(app, org)).toEqual([]);
  });
});
