import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, createUser, eventsOf, notificationsOf, putWhatsAppConnector, tasksOf } from "../../test/helpers";
import { runTool } from "../run-tool";
import notifyHuman from "./notify_human";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("notify_human", () => {
  it("avisa só o painel quando não há conector de WhatsApp, e não espera resposta", async () => {
    const ctx = await createFixture(app, "notify painel");
    await createUser(app, ctx.organizationId, "+5531988887777");
    const result = await runTool(notifyHuman, { message: "João pediu retorno sobre o orçamento." }, ctx);

    expect(result).toMatchObject({ ok: true, data: { channels: ["panel"] } });
    expect(ctx.waits).toEqual([]);
    expect(await notificationsOf(app, ctx.organizationId)).toEqual([expect.objectContaining({ channel: "panel", target: null, body: "Aviso: João pediu retorno sobre o orçamento.", status: "pending" })]);
    const events = await eventsOf(app, ctx.callId);
    expect(events.map((event) => event.kind)).toEqual(["tool_called", "human_notified", "tool_result"]);
    expect(events[1]?.payload).toEqual({ message: "João pediu retorno sobre o orçamento.", urgency: "normal", channels: ["panel"] });
  });

  it("avisa também por WhatsApp cada número cadastrado quando há conector, com uma tarefa de entrega por aviso", async () => {
    const ctx = await createFixture(app, "notify whatsapp");
    await putWhatsAppConnector(app, ctx.organizationId);
    await createUser(app, ctx.organizationId, "+5531988887777");
    await createUser(app, ctx.organizationId, "+5531977776666");
    await createUser(app, ctx.organizationId, null);

    const result = await runTool(notifyHuman, { message: "Cliente relatou cobrança em dobro.", urgency: "high" }, ctx);
    expect(result).toMatchObject({ ok: true, data: { channels: ["panel", "whatsapp"] } });

    const notifications = await notificationsOf(app, ctx.organizationId);
    expect(notifications.map(({ channel, target, body }) => ({ channel, target, body }))).toEqual([
      { channel: "panel", target: null, body: "URGENTE: Cliente relatou cobrança em dobro." },
      { channel: "whatsapp", target: "+5531977776666", body: "URGENTE: Cliente relatou cobrança em dobro." },
      { channel: "whatsapp", target: "+5531988887777", body: "URGENTE: Cliente relatou cobrança em dobro." },
    ]);
    const tasks = await tasksOf(app, ctx.organizationId);
    expect(tasks.map((task) => task.kind)).toEqual(["deliver_notification", "deliver_notification", "deliver_notification"]);
    expect(tasks.map((task) => task.payload.notificationId).sort()).toEqual(notifications.map((notification) => notification.id).sort());
  });

  it("com conector mas ninguém com WhatsApp cadastrado, fica só no painel", async () => {
    const ctx = await createFixture(app, "notify sem numero");
    await putWhatsAppConnector(app, ctx.organizationId);
    await createUser(app, ctx.organizationId, null);
    expect(await runTool(notifyHuman, { message: "Recado." }, ctx)).toMatchObject({ ok: true, data: { channels: ["panel"] } });
  });
});
