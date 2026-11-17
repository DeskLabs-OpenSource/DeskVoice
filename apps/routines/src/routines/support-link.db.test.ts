// O vínculo de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) nunca recebe o resumo
// da ligação nem o lembrete da pendência pelo WhatsApp. O mesmo caso com um `member` igual mostra
// que ele recebe: sem o par, o teste passaria com ninguém recebendo nada.
import { randomUUID } from "node:crypto";
import { createAccount, createFollowUp, withOrg, withSystem, type ClaimedTask } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, notificationsOf, openTestDbs, putSetting, putWhatsAppConnector, t0, task, tasksOf } from "../../test/helpers";
import followUp from "./follow_up";
import summarizeCall, { OWNER_NOTICE_SETTING } from "./summarize_call";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

type Kind = "member" | "support";
const WHATSAPP = "+5531988880077";

/** O vínculo no pior caso: com telefone, WhatsApp e ativo (`disabled_at` nulo). */
async function link(organizationId: string, kind: Kind, role: "owner" | "admin"): Promise<string> {
  const id = randomUUID();
  await withSystem(app, async (q) => {
    const accountId = await createAccount(q, { email: `${id}@example.com`, passwordHash: "x" });
    await q.exec(
      `insert into users (id, organization_id, account_id, email, name, role, kind, phone_e164, whatsapp_e164, disabled_at)
       values ($1, $2, $3, $4, 'Pessoa', $5, $6, $7, $7, null)`,
      [id, organizationId, accountId, `${id}@example.com`, role, kind, WHATSAPP],
    );
  });
  return id;
}

const whatsappTargets = async (org: string): Promise<Array<string | null>> =>
  (await notificationsOf(app, org)).filter((notification) => notification.channel === "whatsapp").map((notification) => notification.target);

describe.each<Kind>(["support", "member"])("a %s link with WhatsApp, for the routines", (kind) => {
  const reached = kind === "member";

  it(reached ? "receives the end-of-call notice as the owner" : "never receives the end-of-call notice, even as the only owner", async () => {
    const org = await createOrganization(app, `summarize ${kind}`);
    await putWhatsAppConnector(app, org);
    await putSetting(app, org, OWNER_NOTICE_SETTING, true, false);
    await link(org, kind, "owner");
    const callId = await createCall(app, org, t0);

    await summarizeCall.run(task(org, "summarize_call", {}, callId), depsFor(app));

    expect(await whatsappTargets(org)).toEqual(reached ? [WHATSAPP] : []);
  });

  it(reached ? "receives the follow-up reminder as its owner" : "never receives the follow-up reminder, even written as its owner", async () => {
    const org = await createOrganization(app, `follow up ${kind}`);
    await putWhatsAppConnector(app, org);
    const person = await link(org, kind, "admin");
    const callId = await createCall(app, org, t0);
    const created = await withOrg(app, org, (q) => createFollowUp(q, { callId, agentId: null, title: "Retornar", details: "Detalhe.", dueAt: t0 }, t0));
    // Gravado direto, sem passar pela escolha de responsável: a rotina confere de novo na hora de avisar.
    await withSystem(app, (q) => q.exec("update follow_ups set owner_user_id = $2 where id = $1", [created.id, person]));
    const row = (await tasksOf(app, org)).find((candidate) => candidate.kind === "follow_up");
    if (!row) throw new Error("no follow_up task queued");
    const claimed: ClaimedTask = { ...task(org, "follow_up", row.payload, row.call_id), id: row.id };

    await followUp.run(claimed, depsFor(app, { clock: { now: () => t0 } }));

    expect(await whatsappTargets(org)).toEqual(reached ? [WHATSAPP] : []);
    // O painel recebe nos dois casos: o lembrete existe, só não vai ao WhatsApp do vínculo de suporte.
    expect((await notificationsOf(app, org)).some((notification) => notification.channel === "panel")).toBe(true);
  });
});
