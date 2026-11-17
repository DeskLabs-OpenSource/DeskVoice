import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { createMember } from "./accounts";
import { claimTask, enqueueTask, KEEPS_RUNNING_WHEN_SUSPENDED, nextTaskRunAt, queueHealth } from "./queue";
import { reactivateOrganization, suspendOrganization, suspensionPreview } from "./suspension";
import { withOrg, withSystem } from "./with-org";

// Seção 3.3 do desenho do R8 e a fatia 4b: a transação da suspensão e da reativação.
const { app, owner } = openTestDbs();

// A fila é uma só para o banco inteiro. Como em `queue.db.test.ts`, estes testes vivem em 2001:
// nenhuma tarefa de outro arquivo é elegível nesse "agora", e as sobras deste são apagadas.
const t0 = new Date("2001-03-01T00:00:00Z");
const before = (ms: number): Date => new Date(t0.getTime() - ms);
const REASON = "Pagamento de novembro em atraso";

let actor: string;
let session: string;

beforeAll(async () => {
  // A organização de onde quem administra a instalação age; nenhum teste a suspende.
  session = await createOrganization(app, "suspension-admin");
  const created = await withSystem(app, (q) => createMember(q, { organizationId: session, email: `admin-${randomUUID()}@example.test`, name: "Quem administra", passwordHash: "x", role: "owner" }));
  if (!created) throw new Error("member not created");
  actor = created.accountId;
});
beforeEach(async () => {
  await owner.pool.query("delete from tasks where run_at < '2002-01-01'");
});
afterAll(async () => {
  await owner.pool.query("delete from tasks where run_at < '2002-01-01'");
  await app.close();
  await owner.close();
});

const enqueue = (organizationId: string, kind: string, runAt = before(60_000)): Promise<string> => withOrg(app, organizationId, (q) => enqueueTask(q, { kind, payload: {}, runAt }));
const tasksOf = async (organizationId: string) =>
  (await owner.pool.query<{ id: string; kind: string; status: string; last_error: string | null }>("select id, kind, status, last_error from tasks where organization_id = $1 order by kind", [organizationId])).rows;
const orgRow = async (organizationId: string) =>
  (await owner.pool.query<{ suspended_at: Date | null; suspended_reason: string | null }>("select suspended_at, suspended_reason from organizations where id = $1", [organizationId])).rows[0];
const orgEvents = async (organizationId: string) =>
  (await owner.pool.query<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown> }>("select kind, actor_user_id, payload from organization_events where organization_id = $1 order by id", [organizationId])).rows;
const installationEvents = async (organizationId: string) =>
  (await owner.pool.query<{ kind: string; actor_account_id: string | null; payload: Record<string, unknown> }>("select kind, actor_account_id, payload from installation_events where organization_id = $1 order by id", [organizationId]))
    .rows;
const suspend = (organizationId: string, reason = REASON, sessionOrganizationId = session) =>
  suspendOrganization(app, { organizationId, actorAccountId: actor, sessionOrganizationId, reason }, t0);

/** As quatro que continuam e três canceláveis, todas vencidas. */
async function fillQueue(organizationId: string): Promise<void> {
  for (const kind of [...KEEPS_RUNNING_WHEN_SUSPENDED, "follow_up", "deliver_notification", "summarize_call"]) await enqueue(organizationId, kind);
}

/** Suspende, à mão e só durante `fn`, toda organização ativa fora de `keep`, e devolve o banco como estava. */
async function withOnlyActive<T>(keep: string[], fn: () => Promise<T>): Promise<T> {
  const { rows } = await owner.pool.query<{ id: string }>("update organizations set suspended_at = $2 where suspended_at is null and not (id = any($1::uuid[])) returning id", [keep, t0]);
  try {
    return await fn();
  } finally {
    await owner.pool.query("update organizations set suspended_at = null where id = any($1::uuid[])", [rows.map((row) => row.id)]);
  }
}

describe("suspending an organization", () => {
  it("cancels A's cancelable queued tasks, keeps the guard routines queued and claimable, and leaves B untouched", async () => {
    const a = await createOrganization(app, "suspension-a");
    const b = await createOrganization(app, "suspension-b");
    await fillQueue(a);
    await fillQueue(b);
    // Já concluída e em curso não são `queued`: a suspensão não mexe nelas.
    const finished = await enqueue(a, "deliver_webhook");
    await owner.pool.query("update tasks set status = 'done' where id = $1", [finished]);
    const running = await enqueue(a, "transcribe_call");
    await owner.pool.query("update tasks set status = 'running' where id = $1", [running]);
    const bBefore = await tasksOf(b);

    expect(await suspensionPreview(app, a)).toEqual({ cancelableTasks: 3 });
    expect(await suspend(a, `  ${REASON}  `)).toEqual({ ok: true, canceledTasks: 3 });

    expect(await orgRow(a)).toEqual({ suspended_at: t0, suspended_reason: REASON });
    const after = await tasksOf(a);
    expect(after.filter((task) => task.status === "canceled").map((task) => task.kind)).toEqual(["deliver_notification", "follow_up", "summarize_call"]);
    expect(after.filter((task) => task.status === "canceled").every((task) => task.last_error === "organization_suspended")).toBe(true);
    expect(after.filter((task) => task.status === "queued").map((task) => task.kind)).toEqual([...KEEPS_RUNNING_WHEN_SUSPENDED].sort());
    expect(after.find((task) => task.id === finished)?.status).toBe("done");
    expect(after.find((task) => task.id === running)?.status).toBe("running");
    expect(await tasksOf(b)).toEqual(bBefore);

    // A fila pega as quatro de guarda de A e as sete de B, e nenhuma cancelada.
    const claimed: { organizationId: string; kind: string }[] = [];
    for (let task = await claimTask(app, t0); task !== null; task = await claimTask(app, t0)) claimed.push({ organizationId: task.organizationId, kind: task.kind });
    expect(claimed.filter((task) => task.organizationId === a).map((task) => task.kind).sort()).toEqual([...KEEPS_RUNNING_WHEN_SUSPENDED].sort());
    expect(claimed.filter((task) => task.organizationId === b)).toHaveLength(7);
    expect(claimed).toHaveLength(11);

    expect(await orgEvents(a)).toEqual([{ kind: "organization_suspended", actor_user_id: null, payload: { reason: REASON, canceled_tasks: 3 } }]);
    expect(await installationEvents(a)).toEqual([{ kind: "organization_suspended", actor_account_id: actor, payload: { reason: REASON, canceled_tasks: 3 } }]);
    expect(await orgEvents(b)).toEqual([]);
  });

  it("refuses the reason out of 10 to 500 characters, the session's organization, the suspended one and an unknown one, changing nothing", async () => {
    const a = await createOrganization(app, "suspension-refusals");
    await enqueue(a, "follow_up");
    expect(await suspend(a, "curto    ")).toEqual({ ok: false, reason: "invalid_reason" });
    expect(await suspend(a, `  ${"x".repeat(9)}  `)).toEqual({ ok: false, reason: "invalid_reason" });
    expect(await suspend(a, "x".repeat(501))).toEqual({ ok: false, reason: "invalid_reason" });
    expect(await suspend(a, REASON, a)).toEqual({ ok: false, reason: "own_organization" });
    expect(await suspend(randomUUID())).toEqual({ ok: false, reason: "not_found" });
    expect(await orgRow(a)).toEqual({ suspended_at: null, suspended_reason: null });
    expect((await tasksOf(a)).map((task) => task.status)).toEqual(["queued"]);
    expect(await orgEvents(a)).toEqual([]);
    expect(await installationEvents(a)).toEqual([]);

    expect(await suspend(a, "x".repeat(10))).toEqual({ ok: true, canceledTasks: 1 });
    expect(await suspend(a, "x".repeat(500))).toEqual({ ok: false, reason: "already_suspended" });
    expect(await orgRow(a)).toEqual({ suspended_at: t0, suspended_reason: "x".repeat(10) });
    expect(await installationEvents(a)).toHaveLength(1);
  });

  it("never leaves the installation without an active organization, even with two suspensions at once", async () => {
    const a = await createOrganization(app, "suspension-last-a");
    const b = await createOrganization(app, "suspension-last-b");
    await withOnlyActive([a, b, session], async () => {
      // A da sessão também é ativa: suspender A e B ao mesmo tempo passa, e ela fica.
      await owner.pool.query("update organizations set suspended_at = $2 where id = $1", [session, t0]);
      try {
        const results = await Promise.all([suspend(a, REASON, randomUUID()), suspend(b, REASON, randomUUID())]);
        expect(results.map((result) => (result.ok ? "ok" : result.reason)).sort()).toEqual(["last_active_organization", "ok"]);
        const active = (await owner.pool.query<{ n: number }>("select count(*)::int as n from organizations where suspended_at is null")).rows[0]?.n;
        expect(active).toBe(1);
        const left = (await orgRow(a))?.suspended_at === null ? a : b;
        expect(await suspend(left, REASON, randomUUID())).toEqual({ ok: false, reason: "last_active_organization" });
        expect(await installationEvents(left)).toEqual([]);
      } finally {
        await owner.pool.query("update organizations set suspended_at = null where id = $1", [session]);
      }
    });
  });
});

describe("reactivating an organization", () => {
  it("cancels what entered during the suspension, gives nothing back, and records organization_reactivated in both audits", async () => {
    const a = await createOrganization(app, "reactivation");
    await enqueue(a, "follow_up");
    expect(await suspend(a)).toEqual({ ok: true, canceledTasks: 1 });
    const canceledBefore = (await tasksOf(a)).find((task) => task.kind === "follow_up")?.id;

    // Entram durante a suspensão: uma cancelável (cancelada na reativação) e uma de guarda (fica).
    const during = await enqueue(a, "deliver_webhook");
    const guard = await enqueue(a, "purge_transcripts", t0);
    expect(await reactivateOrganization(app, { organizationId: a, actorAccountId: actor }, t0)).toEqual({ ok: true, canceledTasks: 1 });

    expect(await orgRow(a)).toEqual({ suspended_at: null, suspended_reason: null });
    const after = await tasksOf(a);
    expect(after.find((task) => task.id === during)).toMatchObject({ status: "canceled", last_error: "organization_suspended" });
    expect(after.find((task) => task.id === canceledBefore)).toMatchObject({ status: "canceled", last_error: "organization_suspended" });
    expect(after.find((task) => task.id === guard)?.status).toBe("queued");
    // Nada cancelado volta: a fila só pega a de guarda.
    expect(await claimTask(app, t0)).toMatchObject({ id: guard, organizationId: a });
    expect(await claimTask(app, t0)).toBeNull();

    expect((await orgEvents(a)).map((event) => [event.kind, event.payload])).toEqual([
      ["organization_suspended", { reason: REASON, canceled_tasks: 1 }],
      ["organization_reactivated", { canceled_tasks: 1 }],
    ]);
    expect((await installationEvents(a)).map((event) => [event.kind, event.actor_account_id, event.payload])).toEqual([
      ["organization_suspended", actor, { reason: REASON, canceled_tasks: 1 }],
      ["organization_reactivated", actor, { canceled_tasks: 1 }],
    ]);
  });

  it("refuses the organization that is not suspended, and the unknown one", async () => {
    const a = await createOrganization(app, "reactivation-active");
    expect(await reactivateOrganization(app, { organizationId: a, actorAccountId: actor }, t0)).toEqual({ ok: false, reason: "not_suspended" });
    expect(await reactivateOrganization(app, { organizationId: randomUUID(), actorAccountId: actor }, t0)).toEqual({ ok: false, reason: "not_found" });
    expect(await installationEvents(a)).toEqual([]);
    expect(await suspensionPreview(app, randomUUID())).toBeNull();
  });
});

describe("the queue around a suspended organization", () => {
  it("arms for the next eligible task, not for the due task of the suspended organization", async () => {
    const a = await createOrganization(app, "queue-next-a");
    const b = await createOrganization(app, "queue-next-b");
    expect(await suspend(a)).toEqual({ ok: true, canceledTasks: 0 });
    // Entrou depois da suspensão: fica `queued` e vencida, e ninguém pode pegá-la.
    await enqueue(a, "follow_up", before(3_600_000));
    const later = new Date(t0.getTime() + 60_000);
    await enqueue(b, "follow_up", later);

    expect(await nextTaskRunAt(app)).toEqual(later);
    expect((await queueHealth(app, t0)).oldestDueAt).toBeNull();
    expect(await claimTask(app, t0)).toBeNull();

    // A de guarda da suspensa é elegível, e a próxima hora passa a ser a dela.
    await enqueue(a, "purge_caller_notes", before(1000));
    expect(await nextTaskRunAt(app)).toEqual(before(1000));
    expect((await queueHealth(app, t0)).oldestDueAt).toEqual(before(1000));
  });
});
