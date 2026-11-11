import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { tasksOf } from "../../../packages/tools/test/helpers";
import { closeOrphanCalls } from "./reconcile";
import { approvalsOf, callOf, createAgent, createCall, createOrganization, eventsOf, fakeClock } from "./testing/db";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const setStatus = (callId: string, status: string, endReason: string | null = null) =>
  withSystem(app, (q) => q.exec("update calls set status = $2, end_reason = $3, ended_at = case when $3::text is null then null else started_at end where id = $1", [callId, status, endReason]));

describe("chamadas órfãs na partida do processo", { timeout: 120_000 }, () => {
  it("fecha o que o processo anterior deixou aberto, uma vez só, e não toca no que já tinha terminado", async () => {
    const clock = fakeClock();
    const first = await createOrganization(app, "orphans-a");
    const second = await createOrganization(app, "orphans-b");
    const agentA = await createAgent(app, first);
    const agentB = await createAgent(app, second);
    const ringing = await createCall(app, first, agentA, clock.now());
    const live = await createCall(app, second, agentB, clock.now());
    await setStatus(live, "in_progress");
    const finished = await createCall(app, first, agentA, clock.now());
    await setStatus(finished, "completed", "caller_hangup");
    const transferred = await createCall(app, second, agentB, clock.now());
    await setStatus(transferred, "transferred", "transferred");
    // A chamada ao vivo tinha alguém esperando uma aprovação.
    await withSystem(app, (q) =>
      q.exec("insert into approvals (organization_id, call_id, question, default_on_timeout, expires_at) values ($1, $2, 'Pode?', 'denied', $3)", [second, live, new Date(clock.now().getTime() + 60_000)]),
    );
    const untouched = [await callOf(app, finished), await callOf(app, transferred)];

    clock.advance(5000);
    const logs: string[] = [];
    expect(await closeOrphanCalls(app, clock, (_level, message) => void logs.push(message))).toBeGreaterThanOrEqual(2);

    for (const [callId, organizationId] of [[ringing, first], [live, second]] as const) {
      expect(await callOf(app, callId)).toMatchObject({ status: "failed", end_reason: "process_restarted", ended_at: clock.now() });
      const events = await eventsOf(app, callId);
      expect(events).toEqual([
        { kind: "call_ended", payload: { status: "failed", reason: "process_restarted" } },
        { kind: "task_queued", payload: { taskId: expect.any(String), kind: "summarize_call" } },
      ]);
      expect((await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call" && task.call_id === callId)).toHaveLength(1);
    }
    expect(await approvalsOf(app, live)).toMatchObject([{ status: "expired" }]);
    expect(logs).toContain("calls left open by the previous process were closed");

    // O que já tinha terminado fica exatamente como estava, sem evento novo.
    expect([await callOf(app, finished), await callOf(app, transferred)]).toEqual(untouched);
    expect(await eventsOf(app, finished)).toEqual([]);
    expect(await eventsOf(app, transferred)).toEqual([]);

    // A partida roda de novo (o processo reiniciou outra vez): nada em dobro.
    clock.advance(5000);
    expect(await closeOrphanCalls(app, clock, () => undefined)).toBe(0);
    for (const [callId, organizationId] of [[ringing, first], [live, second]] as const) {
      expect(await eventsOf(app, callId)).toHaveLength(2);
      expect((await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call" && task.call_id === callId)).toHaveLength(1);
      expect((await callOf(app, callId)).ended_at).not.toEqual(clock.now());
    }
  });
});
