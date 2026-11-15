import { eraseCaller, withOrg, withSystem } from "@deskvoice/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

    it("a simulada com o número de um cliente não entra no \"já ligou\", no painel nem no WhatsApp", async () => {
      const ctx = await createFixture(app, "notify memoria simulada");
      await putWhatsAppConnector(app, ctx.organizationId);
      await createUser(app, ctx.organizationId, "+5531988887776");
      await seedCallerHistory(app, ctx, "+5531966665551", { calls: 1, openFollowUps: [TITLE], simulatedCalls: 2 });
      await runTool(notifyHuman, { message: "Recado." }, ctx);
      const [panelNotice, whatsapp] = await notificationsOf(app, ctx.organizationId);
      expect(panelNotice?.body).toBe(`Aviso: Recado.\n\nEste número já ligou 1 vez; 1 pendência aberta: ${TITLE}.`);
      expect(whatsapp?.body).toBe("Aviso: Recado.\n\nEste número já ligou 1 vez; 1 pendência aberta.");

      // Só simuladas antes, e nada aberto: o aviso é o de sempre.
      const onlySimulated = await createFixture(app, "notify memoria so simulada");
      await seedCallerHistory(app, onlySimulated, "+5531966665550", { calls: 0, openFollowUps: [], simulatedCalls: 1 });
      await runTool(notifyHuman, { message: "Recado." }, onlySimulated);
      expect((await notificationsOf(app, onlySimulated.organizationId))[0]?.body).toBe("Aviso: Recado.");
    });

    it("o apagamento a pedido do titular alcança o título copiado no aviso", async () => {
      const ctx = await createFixture(app, "notify memoria apagamento");
      await seedCallerHistory(app, ctx, "+5531966665551", { calls: 1, openFollowUps: [TITLE] });
      await runTool(notifyHuman, { message: "Recado." }, ctx);
      expect((await notificationsOf(app, ctx.organizationId))[0]?.body).toContain(TITLE);

      await withSystem(app, (q) => q.exec("update calls set ended_at = $2, status = 'completed' where id = $1", [ctx.callId, ctx.clock.now()]));
      const dir = await mkdtemp(path.join(tmpdir(), "deskvoice-notify-"));
      try {
        const erased = await withOrg(app, ctx.organizationId, (q) => eraseCaller(q, { dir, phoneE164: "+5531966665551", now: ctx.clock.now() }));
        expect(erased).toMatchObject({ calls: 2 });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      expect((await notificationsOf(app, ctx.organizationId))[0]?.body).not.toContain(TITLE);
    });

    it("nada do bloco chega ao modelo: o resultado inteiro é o mesmo com e sem ligações anteriores ou pendências", async () => {
      // O modelo recebe o resultado inteiro (`JSON.stringify(result)` no OpenAI, `{ result }` no
      // Gemini), e não só `message`: a guarda compara o resultado serializado.
      const SUMMARY = "Resumo"; // o texto que `seedCallerHistory` grava em cada ligação anterior
      const scenarios = [
        { label: "nada", calls: 0, openFollowUps: [] },
        { label: "ligacoes", calls: 2, openFollowUps: [] },
        { label: "pendencias", calls: 0, openFollowUps: [TITLE] },
        { label: "as duas", calls: 12, openFollowUps: [TITLE, "Ligar de volta sobre o exame"] },
      ];
      const serialized: string[] = [];
      for (const [index, scenario] of scenarios.entries()) {
        const ctx = await createFixture(app, `notify guarda ${scenario.label}`);
        await putWhatsAppConnector(app, ctx.organizationId);
        await createUser(app, ctx.organizationId, "+5531988887777");
        await seedCallerHistory(app, ctx, `+553196666${String(index).padStart(4, "0")}`, scenario);
        const result = await runTool(notifyHuman, { message: "Pediu retorno.", urgency: "high" }, ctx);
        // O aviso do painel de fato levou a linha: a guarda não passa por falta do que vazar.
        if (scenario.calls + scenario.openFollowUps.length > 0) expect((await notificationsOf(app, ctx.organizationId))[0]?.body).toContain("Este número");
        serialized.push(JSON.stringify(result));
      }
      for (const text of serialized) {
        expect(text).toBe(serialized[0]);
        expect(text).not.toMatch(new RegExp(`ligou|pendência|Este número|${TITLE}|exame|${SUMMARY}`));
      }
    });

    it("acima de 10: o painel e o WhatsApp contam tudo; o painel cita três títulos e conta o resto", async () => {
      const ctx = await createFixture(app, "notify memoria acima de 10");
      await putWhatsAppConnector(app, ctx.organizationId);
      await createUser(app, ctx.organizationId, "+5531988887777");
      const titles = Array.from({ length: 12 }, (_, index) => `Pendência ${index + 1}`);
      await seedCallerHistory(app, ctx, "+5531966665550", { calls: 12, openFollowUps: titles });
      await runTool(notifyHuman, { message: "Recado." }, ctx);
      const [panelNotice, whatsapp] = await notificationsOf(app, ctx.organizationId);
      expect(panelNotice?.body).toBe("Aviso: Recado.\n\nEste número já ligou 12 vezes; 12 pendências abertas: Pendência 1; Pendência 2; Pendência 3; e mais 9.");
      expect(whatsapp).toMatchObject({ channel: "whatsapp", body: "Aviso: Recado.\n\nEste número já ligou 12 vezes; 12 pendências abertas." });
    });

    it("só pendência, sem ligação anterior", async () => {
      const ctx = await createFixture(app, "notify memoria so pendencia");
      await seedCallerHistory(app, ctx, "+5531966665552", { calls: 0, openFollowUps: [TITLE] });
      await runTool(notifyHuman, { message: "Recado." }, ctx);
      expect((await notificationsOf(app, ctx.organizationId))[0]?.body).toBe(`Aviso: Recado.\n\nEste número tem 1 pendência aberta: ${TITLE}.`);
    });
  });
});
