import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCall, createOrganization, openTestDbs, waitFor } from "../test/helpers";
import { claimTask, completeTask, enqueueTask, failTask, listenTasks, MAX_TASK_ATTEMPTS, queueHealth } from "./queue";
import { withOrg } from "./with-org";

const { app, owner } = openTestDbs();
let org: string;

// A fila é uma só para o banco inteiro. Estes testes vivem em 2001: nenhuma tarefa de outro
// arquivo (todas com `run_at` no presente) é elegível nesse "agora", e as sobras de execuções
// anteriores deste arquivo são apagadas antes de cada teste.
const t0 = new Date("2001-01-01T00:00:00Z");
const plus = (ms: number): Date => new Date(t0.getTime() + ms);

beforeAll(async () => {
  org = await createOrganization(app, "queue");
});
beforeEach(async () => {
  await owner.pool.query("delete from tasks where run_at < '2002-01-01'");
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

const enqueue = (kind: string, runAt: Date, extra: { callId?: string; payload?: object } = {}): Promise<string> =>
  withOrg(app, org, (q) => enqueueTask(q, { kind, payload: extra.payload ?? {}, callId: extra.callId, runAt }));
const taskRow = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await owner.pool.query("select status, attempts, last_error, run_at from tasks where id = $1", [id])).rows[0];

describe("queue", () => {
  it("hands a task to exactly one of two concurrent claims", async () => {
    const id = await enqueue("race", t0);
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimTask(app, t0)));
    expect(claims.filter((claim) => claim !== null).map((claim) => claim?.id)).toEqual([id]);
    expect(await taskRow(id)).toMatchObject({ status: "running", attempts: 1 });
  });

  it("returns the claimed task with its organization, call and payload", async () => {
    const callId = await createCall(app, org, t0);
    const id = await enqueue("summarize_call", t0, { callId, payload: { tone: "short" } });
    expect(await claimTask(app, t0)).toEqual({ id, organizationId: org, callId, kind: "summarize_call", payload: { tone: "short" }, attempts: 1 });
    expect(await claimTask(app, t0)).toBeNull();
  });

  it("does not claim a task whose run_at is in the future", async () => {
    const id = await enqueue("later", plus(60_000));
    expect(await claimTask(app, t0)).toBeNull();
    expect(await claimTask(app, plus(59_999))).toBeNull();
    expect((await claimTask(app, plus(60_000)))?.id).toBe(id);
  });

  it("claims the oldest due task first", async () => {
    const second = await enqueue("b", plus(2000));
    const first = await enqueue("a", plus(1000));
    expect((await claimTask(app, plus(5000)))?.id).toBe(first);
    expect((await claimTask(app, plus(5000)))?.id).toBe(second);
  });

  it("defaults run_at to the moment of enqueueing", async () => {
    const id = await withOrg(app, org, (q) => enqueueTask(q, { kind: "now", payload: {} }));
    const row = await taskRow(id);
    // O padrão vem do relógio do BANCO (o insert usa `now()`), então a conferência é contra ele:
    // comparar com o relógio desta máquina amarraria o teste ao dia em que o CI roda.
    const { rows } = await owner.pool.query<{ now: Date }>("select now() as now");
    expect(Math.abs((row?.run_at as Date).getTime() - (rows[0]?.now.getTime() ?? 0))).toBeLessThan(60_000);
    await owner.pool.query("delete from tasks where id = $1", [id]);
  });

  it("marks a completed task as done", async () => {
    const id = await enqueue("ok", t0);
    await claimTask(app, t0);
    await completeTask(app, id);
    expect(await taskRow(id)).toMatchObject({ status: "done", attempts: 1 });
    expect(await claimTask(app, plus(3_600_000))).toBeNull();
  });

  it("reschedules a failed task with growing delay and gives up after the last attempt", async () => {
    const id = await enqueue("flaky", t0);
    let now = t0;
    const delays: number[] = [];

    for (let attempt = 1; attempt < MAX_TASK_ATTEMPTS; attempt++) {
      expect((await claimTask(app, now))?.attempts).toBe(attempt);
      const outcome = await failTask(app, id, `error ${attempt}`, now);
      expect(outcome.status).toBe("queued");
      expect(await taskRow(id)).toMatchObject({ status: "queued", attempts: attempt, last_error: `error ${attempt}`, run_at: outcome.runAt });
      delays.push(outcome.runAt.getTime() - now.getTime());
      expect(await claimTask(app, new Date(outcome.runAt.getTime() - 1))).toBeNull();
      now = outcome.runAt;
    }
    expect(delays.every((delay) => delay > 0)).toBe(true);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);

    expect((await claimTask(app, now))?.attempts).toBe(MAX_TASK_ATTEMPTS);
    expect((await failTask(app, id, "last error", now)).status).toBe("failed");
    expect(await taskRow(id)).toMatchObject({ status: "failed", attempts: MAX_TASK_ATTEMPTS, last_error: "last error" });
    expect(await claimTask(app, plus(365 * 86_400_000))).toBeNull();
  });

  it("refuses to complete or fail a task that is not running", async () => {
    const id = await enqueue("idle", t0);
    await expect(completeTask(app, id)).rejects.toThrow(/not running/);
    await expect(failTask(app, id, "x", t0)).rejects.toThrow(/not running/);
    expect(await taskRow(id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("wakes a listener when a task is enqueued, and stops when asked", async () => {
    let wakes = 0;
    const stop = await listenTasks(app, () => {
      wakes += 1;
    });
    await enqueue("wake", t0);
    await waitFor(() => wakes === 1, "the tasks notification");

    await stop();
    await enqueue("after stop", t0);
    // Uma segunda escuta recebe o aviso da tarefa nova; a que parou, não.
    let later = 0;
    const stopLater = await listenTasks(app, () => {
      later += 1;
    });
    await enqueue("for the second listener", t0);
    await waitFor(() => later === 1, "the second listener");
    await stopLater();
    expect(wakes).toBe(1);
  });

  it("does not wake when the enqueueing transaction rolls back", async () => {
    let wakes = 0;
    const stop = await listenTasks(app, () => {
      wakes += 1;
    });
    await expect(
      withOrg(app, org, async (q) => {
        await enqueueTask(q, { kind: "ghost", payload: {}, runAt: t0 });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await enqueue("real", t0);
    await waitFor(() => wakes >= 1, "the tasks notification");
    await stop();
    expect(wakes).toBe(1);
  });

  it("health counts the processes listening to the queue, and stops counting the one that left", async () => {
    // Em série com os outros arquivos, e cada um fecha as próprias escutas: a conta parte de zero.
    expect((await queueHealth(app, t0)).listeners).toBe(0);
    const stop = await listenTasks(app, () => undefined);
    expect((await queueHealth(app, t0)).listeners).toBe(1);
    await stop();
    // A conexão é destruída ao parar; o Postgres tira a sessão da lista em instantes.
    const deadline = performance.now() + 5000;
    while ((await queueHealth(app, t0)).listeners !== 0 && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await queueHealth(app, t0)).listeners).toBe(0);
  });

  it("health reports since when the oldest due task waits, ignoring future, running and finished ones", async () => {
    expect((await queueHealth(app, t0)).oldestDueAt).toBeNull();
    await enqueue("later", plus(60_000));
    expect((await queueHealth(app, t0)).oldestDueAt).toBeNull();
    const done = await enqueue("done", plus(-120_000));
    await claimTask(app, plus(-120_000));
    await completeTask(app, done);
    const waiting = plus(-60_000);
    await enqueue("waiting", waiting);
    await enqueue("newer", plus(-1000));
    expect((await queueHealth(app, t0)).oldestDueAt).toEqual(waiting);
    await claimTask(app, t0);
    expect((await queueHealth(app, t0)).oldestDueAt).toEqual(plus(-1000));
  });
});
