import { withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, createUser, eventsOf, notificationsOf, putWhatsAppConnector, seedCallerHistory, tasksOf } from "../../test/helpers";
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

  it("quem foi desativado não recebe mais os avisos da equipe", async () => {
    // Quem saiu da empresa não pode continuar recebendo, no próprio WhatsApp, avisos de chamada
    // com dados de quem ligou.
    const ctx = await createFixture(app, "notify desativado");
    await putWhatsAppConnector(app, ctx.organizationId);
    await createUser(app, ctx.organizationId, "+5531988887777");
    const gone = await createUser(app, ctx.organizationId, "+5531977776666");
    await withOrg(app, ctx.organizationId, (q) => q.exec("update users set disabled_at = now() where id = $1", [gone]));

    await runTool(notifyHuman, { message: "Cliente pediu retorno.", urgency: "normal" }, ctx);
    const targets = (await notificationsOf(app, ctx.organizationId)).filter((n) => n.channel === "whatsapp").map((n) => n.target);
    expect(targets).toEqual(["+5531988887777"]);
  });

  it("com conector mas ninguém com WhatsApp cadastrado, fica só no painel", async () => {
    const ctx = await createFixture(app, "notify sem numero");
    await putWhatsAppConnector(app, ctx.organizationId);
    await createUser(app, ctx.organizationId, null);
    expect(await runTool(notifyHuman, { message: "Recado." }, ctx)).toMatchObject({ ok: true, data: { channels: ["panel"] } });
  });

  describe("a linha do número (memória para a equipe)", () => {
    const TITLE = "Retornar sobre o orçamento";

    it("o aviso de painel traz a contagem e os títulos; o do WhatsApp só a contagem, sem título, nota nem resumo", async () => {
      const ctx = await createFixture(app, "notify memoria");
      await putWhatsAppConnector(app, ctx.organizationId);
      await createUser(app, ctx.organizationId, "+5531988887777");
      await seedCallerHistory(app, ctx, "+5531966665555", { calls: 3, openFollowUps: [TITLE] });

      const result = await runTool(notifyHuman, { message: "Pediu retorno." }, ctx);
      const [panelNotice, whatsapp] = await notificationsOf(app, ctx.organizationId);
      expect(panelNotice).toMatchObject({ channel: "panel", body: `Aviso: Pediu retorno.\n\nEste número já ligou 3 vezes; 1 pendência aberta: ${TITLE}.` });
      expect(whatsapp).toMatchObject({ channel: "whatsapp", body: "Aviso: Pediu retorno.\n\nEste número já ligou 3 vezes; 1 pendência aberta." });
      expect(whatsapp?.body).not.toContain("orçamento");
      expect(whatsapp?.body).not.toContain("Resumo");

      // Nada da linha chega ao modelo nem a um evento: a resposta e o `human_notified` são os de sempre.
      expect(result.message).not.toMatch(/ligou|pendência|orçamento/);
      const text = JSON.stringify(await eventsOf(app, ctx.callId));
      expect(text).not.toMatch(/ligou|orçamento|Resumo/);
    });

    it("muitas pendências: o painel cita três títulos e conta as demais", async () => {
      const ctx = await createFixture(app, "notify memoria muitas");
      await seedCallerHistory(app, ctx, "+5531966665554", { calls: 1, openFollowUps: ["A\nB", "C", "D", "E"] });
      await runTool(notifyHuman, { message: "Recado." }, ctx);
      const [panelNotice] = await notificationsOf(app, ctx.organizationId);
      // O título vai numa linha só: a quebra que o modelo escreveu não abre outra parte do aviso.
      expect(panelNotice?.body).toBe("Aviso: Recado.\n\nEste número já ligou 1 vez; 4 pendências abertas: A B; C; D; e mais 1.");
    });

    it("sem número, ou sem nada antes, o aviso é o de sempre", async () => {
      const noNumber = await createFixture(app, "notify memoria sem numero");
      await runTool(notifyHuman, { message: "Recado." }, noNumber);
      expect((await notificationsOf(app, noNumber.organizationId))[0]?.body).toBe("Aviso: Recado.");

      const first = await createFixture(app, "notify memoria primeira");
      await seedCallerHistory(app, first, "+5531966665553", { calls: 0, openFollowUps: [] });
      await runTool(notifyHuman, { message: "Recado." }, first);
      expect((await notificationsOf(app, first.organizationId))[0]?.body).toBe("Aviso: Recado.");
    });

    it("só pendência, sem ligação anterior", async () => {
      const ctx = await createFixture(app, "notify memoria so pendencia");
      await seedCallerHistory(app, ctx, "+5531966665552", { calls: 0, openFollowUps: [TITLE] });
      await runTool(notifyHuman, { message: "Recado." }, ctx);
      expect((await notificationsOf(app, ctx.organizationId))[0]?.body).toBe(`Aviso: Recado.\n\nEste número tem 1 pendência aberta: ${TITLE}.`);
    });
  });
});
