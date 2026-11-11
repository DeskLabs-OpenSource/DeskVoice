import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, eventsOf, tasksOf, t0 } from "../../test/helpers";
import { runTool } from "../run-tool";
import createTask from "./create_task";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("create_task", () => {
  it("enfileira follow_up para o momento pedido e registra task_queued", async () => {
    const ctx = await createFixture(app, "create task");
    const result = await runTool(createTask, { title: "Retornar para Maria", details: "Quer o orçamento por e-mail.", due_in_minutes: 90 }, ctx);

    const runAt = new Date(t0.getTime() + 90 * 60_000);
    const tasks = await tasksOf(app, ctx.organizationId);
    expect(tasks).toEqual([expect.objectContaining({ kind: "follow_up", payload: { title: "Retornar para Maria", details: "Quer o orçamento por e-mail." }, status: "queued", run_at: runAt, call_id: ctx.callId })]);
    expect(result).toMatchObject({ ok: true, data: { taskId: tasks[0]?.id } });
    const events = await eventsOf(app, ctx.callId);
    expect(events.map((event) => event.kind)).toEqual(["tool_called", "task_queued", "tool_result"]);
    expect(events[1]?.payload).toEqual({ taskId: tasks[0]?.id, kind: "follow_up", title: "Retornar para Maria", runAt: runAt.toISOString() });
  });

  it("sem prazo, fica elegível na hora", async () => {
    const ctx = await createFixture(app, "create task now");
    await runTool(createTask, { title: "Conferir cadastro", details: "CPF divergente." }, ctx);
    expect((await tasksOf(app, ctx.organizationId))[0]?.run_at).toEqual(t0);
  });

  it("recusa prazo negativo", async () => {
    const ctx = await createFixture(app, "create task negative");
    expect((await runTool(createTask, { title: "x", details: "y", due_in_minutes: -5 }, ctx)).ok).toBe(false);
    expect(await tasksOf(app, ctx.organizationId)).toEqual([]);
  });
});
