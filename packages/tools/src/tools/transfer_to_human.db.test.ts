import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, notificationsOf, putWhatsAppConnector, seedCallerHistory, tasksOf, t0 } from "../../test/helpers";
import { runTool } from "../run-tool";
import transferToHuman from "./transfer_to_human";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const args = { reason: "pediu para falar com o financeiro", summary: "Maria, cliente desde 2024, quer renegociar a fatura de maio." };

describe("transfer_to_human", () => {
  it("transfere para o número do agente e entrega o resumo ao humano", async () => {
    const ctx = await createFixture(app, "transfer", { transferTo: "+5531999998888" });
    const result = await runTool(transferToHuman, args, ctx);

    expect(result.ok).toBe(true);
    expect(ctx.transfers).toEqual(["+5531999998888"]);
    expect((await eventsOf(app, ctx.callId)).map((event) => event.kind)).toEqual(["tool_called", "transfer_started", "tool_result"]);
    const started = (await eventsOf(app, ctx.callId)).find((event) => event.kind === "transfer_started");
    expect(started).toEqual({ kind: "transfer_started", at: t0, payload: { to: "+5531999998888", ...args } });

    const notifications = await notificationsOf(app, ctx.organizationId);
    expect(notifications).toEqual([expect.objectContaining({ channel: "panel", target: null, status: "pending", call_id: ctx.callId })]);
    expect(notifications[0]?.body).toContain(args.summary);
    expect(await tasksOf(app, ctx.organizationId)).toEqual([
      expect.objectContaining({ kind: "deliver_notification", payload: { notificationId: notifications[0]?.id }, status: "queued", run_at: t0, call_id: ctx.callId }),
    ]);
  });

  it("sem destino configurado devolve ok: false dizendo isso, e não transfere nem avisa", async () => {
    const ctx = await createFixture(app, "transfer sem destino");
    const result = await runTool(transferToHuman, args, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Não há número de transferência configurado/);
    expect(ctx.transfers).toEqual([]);
    expect(await notificationsOf(app, ctx.organizationId)).toEqual([]);
    expect((await eventsOf(app, ctx.callId)).map((event) => event.kind)).toEqual(["tool_called", "tool_result"]);
  });

  it("no canal que não transfere (WhatsApp) responde ao modelo para oferecer recado, sem evento de transferência", async () => {
    const ctx = await createFixture(app, "transfer no whatsapp", { transferTo: "+5531999998888", canTransfer: false });
    const result = await runTool(transferToHuman, args, ctx);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não há como transferir/);
    expect(result.message).toContain("notify_human");
    expect(ctx.transfers).toEqual([]);
    expect(await notificationsOf(app, ctx.organizationId)).toEqual([]);
    expect((await eventsOf(app, ctx.callId)).map((event) => event.kind)).toEqual(["tool_called", "tool_result"]);
  });

  it("quem recebe a transferência lê no aviso que o número já ligou e o que ficou aberto; o modelo e o evento não", async () => {
    const ctx = await createFixture(app, "transfer memoria", { transferTo: "+5531999998888" });
    await putWhatsAppConnector(app, ctx.organizationId);
    await seedCallerHistory(app, ctx, "+5531955554444", { calls: 2, openFollowUps: ["Enviar a segunda via do boleto"] });

    const result = await runTool(transferToHuman, args, ctx);
    const notifications = await notificationsOf(app, ctx.organizationId);
    // O aviso da transferência continua só no painel, mesmo com WhatsApp configurado.
    expect(notifications.map((notification) => notification.channel)).toEqual(["panel"]);
    expect(notifications[0]?.body).toMatch(/\n\nEste número já ligou 2 vezes; 1 pendência aberta: Enviar a segunda via do boleto\.$/);

    expect(result.message).not.toMatch(/ligou|boleto/);
    const started = (await eventsOf(app, ctx.callId)).find((event) => event.kind === "transfer_started");
    expect(started?.payload).toEqual({ to: "+5531999998888", ...args });
  });

  it("nada do bloco chega ao modelo: o resultado inteiro é o mesmo com e sem ligações anteriores ou pendências", async () => {
    // O modelo recebe o resultado inteiro (`JSON.stringify(result)` no OpenAI, `{ result }` no
    // Gemini), e não só `message`: a guarda compara o resultado serializado.
    const TITLE = "Enviar a segunda via do boleto";
    const scenarios = [
      { label: "nada", calls: 0, openFollowUps: [] },
      { label: "ligacoes", calls: 2, openFollowUps: [] },
      { label: "pendencias", calls: 0, openFollowUps: [TITLE] },
      { label: "as duas", calls: 12, openFollowUps: [TITLE, "Ligar de volta sobre o exame"] },
    ];
    const serialized: string[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      const ctx = await createFixture(app, `transfer guarda ${scenario.label}`, { transferTo: "+5531999998888" });
      await seedCallerHistory(app, ctx, `+553195555${String(index).padStart(4, "0")}`, scenario);
      const result = await runTool(transferToHuman, args, ctx);
      // O aviso do painel de fato levou a linha: a guarda não passa por falta do que vazar.
      if (scenario.calls + scenario.openFollowUps.length > 0) expect((await notificationsOf(app, ctx.organizationId))[0]?.body).toContain("Este número");
      serialized.push(JSON.stringify(result));
    }
    for (const text of serialized) {
      expect(text).toBe(serialized[0]);
      expect(text).not.toMatch(/ligou|pendência|Este número|boleto|exame|Resumo/);
    }
  });
});
