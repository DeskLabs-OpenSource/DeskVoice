import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, notificationsOf, tasksOf, t0 } from "../../test/helpers";
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
});
