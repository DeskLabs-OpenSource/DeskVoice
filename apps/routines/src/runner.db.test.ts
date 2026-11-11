import { enqueueTask, withOrg, withSystem, type ClaimedTask } from "@deskvoice/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCall, createOrganization, eventsOf, openTestDbs, secretKey, until } from "../test/helpers";
import { startRunner, type Runner, type Schedule } from "./runner";
import type { Routine } from "./types";

const { app, owner } = openTestDbs();
let org: string;

// A fila é uma só para o banco inteiro. Estes testes vivem em 2003: as tarefas dos outros
// arquivos têm `run_at` em outra época, e as sobras do passado são apagadas antes de cada teste.
const t0 = new Date("2003-01-01T00:00:00Z");
let now = t0;
const clock = { now: () => now };

interface FakeTimer {
  fn: () => void;
  delayMs: number;
  cancelled: boolean;
}
let timers: FakeTimer[] = [];
const schedule: Schedule = (fn, delayMs) => {
  const timer: FakeTimer = { fn, delayMs, cancelled: false };
  timers.push(timer);
  return () => {
    timer.cancelled = true;
  };
};
const liveTimer = (): FakeTimer | undefined => timers.find((timer) => !timer.cancelled);
/** O tempo passa: o relógio avança e o timer armado dispara. */
function fire(timer: FakeTimer): void {
  now = new Date(now.getTime() + timer.delayMs);
  timer.cancelled = true;
  timer.fn();
}

let runners: Runner[] = [];
const start = async (routines: Routine[]): Promise<Runner> => {
  const runner = await startRunner({ db: app, clock, secretKey, schedule, routines: new Map(routines.map((routine) => [routine.kind, routine])) });
  runners.push(runner);
  return runner;
};

const enqueue = (kind: string, runAt: Date, callId?: string): Promise<string> => withOrg(app, org, (q) => enqueueTask(q, { kind, payload: { n: 1 }, callId, runAt }));
const taskRow = (id: string): Promise<{ status: string; attempts: number; last_error: string | null; run_at: Date } | null> =>
  withSystem(app, (q) => q.one("select status, attempts, last_error, run_at from tasks where id = $1", [id]));
const statusIs = (id: string, status: string) => async (): Promise<boolean> => (await taskRow(id))?.status === status;

beforeAll(async () => {
  org = await createOrganization(app, "runner");
});
beforeEach(async () => {
  now = t0;
  timers = [];
  await withSystem(app, (q) => q.exec("delete from tasks where run_at < '2004-01-01'"));
});
afterEach(async () => {
  await Promise.all(runners.map((runner) => runner.close()));
  runners = [];
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("runner", () => {
  it("acorda pela notificação da fila, executa a rotina do tipo e conclui a tarefa", async () => {
    const seen: ClaimedTask[] = [];
    await start([{ kind: "greet", run: async (task) => void seen.push(task) }]);
    const callId = await createCall(app, org, t0);

    const id = await enqueue("greet", t0, callId);
    await until(statusIs(id, "done"), "the task to be done");

    expect(seen).toEqual([{ id, organizationId: org, callId, kind: "greet", payload: { n: 1 }, attempts: 1 }]);
    // O evento é gravado depois de a tarefa ser concluída.
    await until(async () => (await eventsOf(app, callId)).length === 1, "the task_finished event");
    expect(await eventsOf(app, callId)).toEqual([{ kind: "task_finished", at: t0, payload: { taskId: id, kind: "greet", outcome: "done", attempt: 1 } }]);
  });

  it("executa o que já estava na fila quando sobe", async () => {
    const id = await enqueue("greet", t0);
    await start([{ kind: "greet", run: async () => undefined }]);
    await until(statusIs(id, "done"), "the backlog to be drained");
  });

  it("dorme até a hora da tarefa agendada e a pega quando o relógio chega lá", async () => {
    let ran = 0;
    await start([{ kind: "later", run: async () => void ran++ }]);
    const id = await enqueue("later", new Date(t0.getTime() + 60_000));

    await until(() => liveTimer()?.delayMs === 60_000, "a timer armed for the scheduled task");
    expect(ran).toBe(0);
    expect(await taskRow(id)).toMatchObject({ status: "queued", attempts: 0 });

    fire(liveTimer() as FakeTimer);
    await until(statusIs(id, "done"), "the scheduled task to run");
    expect(ran).toBe(1);
  });

  it("tenta três vezes com recuo, sem notificação, e então marca failed", async () => {
    let runs = 0;
    await start([
      {
        kind: "flaky",
        run: async () => {
          runs += 1;
          throw new Error(`boom ${runs}`);
        },
      },
    ]);
    const callId = await createCall(app, org, t0);
    const id = await enqueue("flaky", t0, callId);

    for (const attempt of [1, 2]) {
      await until(async () => (await taskRow(id))?.last_error === `boom ${attempt}`, `attempt ${attempt} to fail`);
      const row = await taskRow(id);
      expect(row).toMatchObject({ status: "queued", attempts: attempt });
      // Só o timer acorda o runner para a nova tentativa: reagendar não notifica.
      const delayMs = (row?.run_at.getTime() ?? 0) - now.getTime();
      expect(delayMs).toBeGreaterThan(0);
      await until(() => liveTimer()?.delayMs === delayMs, "the retry timer armed for the new run_at");
      const timer = liveTimer() as FakeTimer;
      fire(timer);
    }

    await until(statusIs(id, "failed"), "the task to be given up");
    expect(await taskRow(id)).toMatchObject({ status: "failed", attempts: 3, last_error: "boom 3" });
    expect(runs).toBe(3);
    await until(async () => (await eventsOf(app, callId)).length === 3, "the three task_finished events");
    expect((await eventsOf(app, callId)).map((event) => event.payload)).toEqual([
      { taskId: id, kind: "flaky", outcome: "retrying", attempt: 1, error: "boom 1" },
      { taskId: id, kind: "flaky", outcome: "retrying", attempt: 2, error: "boom 2" },
      { taskId: id, kind: "flaky", outcome: "failed", attempt: 3, error: "boom 3" },
    ]);
  });

  it("duas instâncias nunca executam a mesma tarefa", async () => {
    const runs: string[] = [];
    const routine: Routine = {
      kind: "shared",
      run: async (task) => {
        runs.push(task.id);
        // Cede a vez: dá à outra instância a chance de pegar a mesma tarefa, se pudesse.
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
    await start([routine]);
    await start([routine]);

    const ids = await Promise.all(Array.from({ length: 12 }, () => enqueue("shared", t0)));
    await until(async () => (await Promise.all(ids.map((id) => statusIs(id, "done")()))).every(Boolean), "all tasks to be done");

    expect([...runs].sort()).toEqual([...ids].sort());
  });

  it("tipo desconhecido falha com mensagem clara, sem derrubar o runner", async () => {
    await start([{ kind: "known", run: async () => undefined }]);
    const unknown = await enqueue("mystery", t0);
    const known = await enqueue("known", t0);

    await until(statusIs(known, "done"), "the known task to run after the unknown one");
    expect(await taskRow(unknown)).toMatchObject({ status: "queued", attempts: 1, last_error: 'Unknown task kind "mystery": no file in src/routines handles it' });
  });

  it("na partida devolve à fila a tarefa presa em running há mais de 10 minutos, e só ela", async () => {
    const stale = await enqueue("greet", new Date(t0.getTime() - 11 * 60_000));
    const recent = await enqueue("greet", new Date(t0.getTime() - 9 * 60_000));
    await withSystem(app, (q) => q.exec("update tasks set status = 'running', attempts = 1 where id = any($1)", [[stale, recent]]));

    await start([{ kind: "greet", run: async () => undefined }]);
    await until(statusIs(stale, "done"), "the stale task to be recovered and run");

    expect(await taskRow(stale)).toMatchObject({ status: "done", attempts: 2 });
    expect(await taskRow(recent)).toMatchObject({ status: "running", attempts: 1 });
    await withSystem(app, (q) => q.exec("delete from tasks where id = $1", [recent]));
  });

  it("chama o seed de cada rotina uma vez ao subir", async () => {
    let seeds = 0;
    await start([{ kind: "recurring", run: async () => undefined, seed: async () => void seeds++ }]);
    expect(seeds).toBe(1);
  });

  it("close não deixa timer vivo e o runner fechado não pega mais nada", async () => {
    const runner = await start([{ kind: "later", run: async () => undefined }]);
    await enqueue("later", new Date(t0.getTime() + 60_000));
    await until(() => liveTimer() !== undefined, "a timer armed");
    const armed = liveTimer() as FakeTimer;

    await runner.close();
    expect(timers.every((timer) => timer.cancelled)).toBe(true);

    // Mesmo que o timer antigo dispare ou chegue tarefa nova, nada roda nem é rearmado.
    now = new Date(t0.getTime() + 120_000);
    armed.fn();
    const late = await enqueue("later", t0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await taskRow(late)).toMatchObject({ status: "queued", attempts: 0 });
    expect(timers.every((timer) => timer.cancelled)).toBe(true);
  });
});
