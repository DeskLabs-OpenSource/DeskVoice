import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../core/test/helpers";
import { createFixture, createUser, eventsOf, tasksOf, t0 } from "../../test/helpers";
import { runTool } from "../run-tool";
import createTask from "./create_task";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const followUpsOf = (organizationId: string) =>
  withSystem(app, (q) => q.many("select id, call_id, title, details, owner_user_id, due_at, status from follow_ups where organization_id = $1", [organizationId]));

describe("create_task", () => {
  it("abre a pendência com o dono do agente, marca o lembrete para o prazo, e o tool_called não leva o título nem os detalhes", async () => {
    const ctx = await createFixture(app, "create task");
    const person = await createUser(app, ctx.organizationId, null);
    await withSystem(app, (q) => q.exec("update agents set follow_up_owner_user_id = $2 where id = $1", [ctx.agentId, person]));
    const result = await runTool(createTask, { title: "Retornar para Maria", details: "Quer o orçamento por e-mail.", due_in_minutes: 90 }, ctx);

    const dueAt = new Date(t0.getTime() + 90 * 60_000);
    const followUps = await followUpsOf(ctx.organizationId);
    expect(followUps).toEqual([{ id: expect.any(String), call_id: ctx.callId, title: "Retornar para Maria", details: "Quer o orçamento por e-mail.", owner_user_id: person, due_at: dueAt, status: "open" }]);
    const tasks = await tasksOf(app, ctx.organizationId);
    expect(tasks).toEqual([expect.objectContaining({ kind: "follow_up", payload: { followUpId: followUps[0]?.id, stage: "due" }, status: "queued", run_at: dueAt, call_id: ctx.callId })]);
    expect(result).toMatchObject({ ok: true, data: { followUpId: followUps[0]?.id, taskId: tasks[0]?.id } });

    const events = await eventsOf(app, ctx.callId);
    expect(events.map((event) => event.kind)).toEqual(["tool_called", "follow_up_created", "tool_result"]);
    expect(events[0]?.payload).toEqual({ name: "create_task", args: { omitted: "personal_text" } });
    const timeline = JSON.stringify(events);
    expect(timeline).not.toContain("Maria");
    expect(timeline).not.toContain("orçamento");
  });

  it("sem dono configurado no agente, a pendência é da equipe e vence na hora", async () => {
    const ctx = await createFixture(app, "create task now");
    await runTool(createTask, { title: "Conferir cadastro", details: "CPF divergente." }, ctx);
    expect(await followUpsOf(ctx.organizationId)).toMatchObject([{ owner_user_id: null, due_at: t0 }]);
    expect((await tasksOf(app, ctx.organizationId))[0]?.run_at).toEqual(t0);
  });

  it("recusa prazo negativo e título em branco, sem abrir pendência", async () => {
    const ctx = await createFixture(app, "create task negative");
    expect((await runTool(createTask, { title: "x", details: "y", due_in_minutes: -5 }, ctx)).ok).toBe(false);
    expect((await runTool(createTask, { title: "   ", details: "y" }, ctx)).ok).toBe(false);
    expect(await followUpsOf(ctx.organizationId)).toEqual([]);
    expect(await tasksOf(app, ctx.organizationId)).toEqual([]);
  });
});
