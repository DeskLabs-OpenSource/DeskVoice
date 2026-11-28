import { withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../core/test/helpers";
import { createFixture, createUser, eventsOf, notificationsOf, putWhatsAppConnector, tasksOf, type FakeContext } from "../test/helpers";
import { runTool } from "./run-tool";
import notifyHuman from "./tools/notify_human";
import requestApproval from "./tools/request_approval";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

/** Uma chamada simulada (o teste da equipe) numa central com WhatsApp e alguém da equipe com número. */
async function simulated(label: string): Promise<FakeContext> {
  const ctx = await createFixture(app, label, { onWait: async () => "denied" });
  await withOrg(app, ctx.organizationId, (q) => q.exec("update calls set channel = 'simulated' where id = $1", [ctx.callId]));
  await putWhatsAppConnector(app, ctx.organizationId);
  await createUser(app, ctx.organizationId, "+5531988887777");
  return ctx;
}

const outbound = async (ctx: FakeContext) => (await notificationsOf(app, ctx.organizationId)).filter((notification) => notification.channel !== "panel");

describe("na chamada simulada, os avisos à equipe não saem pelo WhatsApp", () => {
  it("notify_human avisa só o painel e a linha do tempo grava que o WhatsApp teria saído", async () => {
    const ctx = await simulated("simulada notify");
    const result = await runTool(notifyHuman, { message: "João pediu retorno." }, ctx);

    expect(result).toMatchObject({ ok: true, data: { channels: ["panel"] } });
    expect(await outbound(ctx)).toEqual([]);
    expect((await notificationsOf(app, ctx.organizationId)).map((notification) => notification.channel)).toEqual(["panel"]);
    expect((await tasksOf(app, ctx.organizationId)).filter((task) => task.kind === "deliver_notification")).toHaveLength(1);
    const notified = (await eventsOf(app, ctx.callId)).find((event) => event.kind === "human_notified");
    expect(notified?.payload).toEqual({ message: "João pediu retorno.", urgency: "normal", channels: ["panel"], withheld: ["whatsapp"] });
  });

  it("request_approval pede a aprovação no painel, sem WhatsApp, e o approval_requested grava o que teria saído", async () => {
    const ctx = await simulated("simulada approval");
    const result = await runTool(requestApproval, { question: "Posso dar desconto?", context: "Cliente antiga." }, ctx);

    expect(result.ok).toBe(true);
    expect(await outbound(ctx)).toEqual([]);
    const requested = (await eventsOf(app, ctx.callId)).find((event) => event.kind === "approval_requested");
    expect(requested?.payload.withheld).toEqual(["whatsapp"]);
  });

  it("a ligação de verdade, na mesma configuração, sai pelo WhatsApp e não grava withheld", async () => {
    const ctx = await createFixture(app, "real notify");
    await putWhatsAppConnector(app, ctx.organizationId);
    await createUser(app, ctx.organizationId, "+5531988887777");
    await runTool(notifyHuman, { message: "João pediu retorno." }, ctx);

    expect((await outbound(ctx)).map((notification) => notification.target)).toEqual(["+5531988887777"]);
    expect((await eventsOf(app, ctx.callId)).find((event) => event.kind === "human_notified")?.payload).not.toHaveProperty("withheld");
  });

  it("simulada sem ninguém com WhatsApp não grava withheld: nada teria saído", async () => {
    const ctx = await createFixture(app, "simulada sem numero");
    await withOrg(app, ctx.organizationId, (q) => q.exec("update calls set channel = 'simulated' where id = $1", [ctx.callId]));
    await putWhatsAppConnector(app, ctx.organizationId);
    await runTool(notifyHuman, { message: "Recado." }, ctx);
    expect((await eventsOf(app, ctx.callId)).find((event) => event.kind === "human_notified")?.payload).not.toHaveProperty("withheld");
  });
});
