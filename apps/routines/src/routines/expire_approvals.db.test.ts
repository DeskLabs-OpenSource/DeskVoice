import { randomUUID } from "node:crypto";
import { listen, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, t0, task, tasksOf, until } from "../../test/helpers";
import expireApprovals, { ensureExpireApprovals } from "./expire_approvals";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

async function createApproval(org: string, callId: string, expiresAt: Date, status = "pending"): Promise<string> {
  const id = randomUUID();
  await withSystem(app, (q) =>
    q.exec("insert into approvals (id, organization_id, call_id, question, default_on_timeout, expires_at, status) values ($1, $2, $3, 'Pode?', 'denied', $4, $5)", [id, org, callId, expiresAt, status]),
  );
  return id;
}
const statusOf = async (id: string): Promise<string | undefined> => (await withSystem(app, (q) => q.one<{ status: string }>("select status from approvals where id = $1", [id])))?.status;
const queued = async (org: string) => (await tasksOf(app, org)).filter((row) => row.kind === "expire_approvals" && row.status === "queued");

describe("expire_approvals", () => {
  it("vence só as pendentes que passaram do prazo, só na organização da tarefa, e avisa o canal approvals", async () => {
    const org = await createOrganization(app, "expire");
    const other = await createOrganization(app, "expire other");
    const callId = await createCall(app, org, t0);
    const overdue = await createApproval(org, callId, new Date(t0.getTime() - 1));
    const dueNow = await createApproval(org, callId, t0);
    const future = await createApproval(org, callId, new Date(t0.getTime() + 1));
    const decided = await createApproval(org, callId, new Date(t0.getTime() - 60_000), "approved");
    const foreign = await createApproval(other, await createCall(app, other, t0), new Date(t0.getTime() - 60_000));

    const notified: string[] = [];
    const stop = await listen(app, "approvals", (id) => notified.push(id));
    await expireApprovals.run(task(org, "expire_approvals"), depsFor(app));
    await until(() => notified.includes(overdue) && notified.includes(dueNow), "the approvals notifications");
    await stop();

    expect(await Promise.all([overdue, dueNow, future, decided, foreign].map(statusOf))).toEqual(["expired", "expired", "pending", "approved", "pending"]);
    expect(notified).not.toContain(future);
  });

  it("deixa a próxima execução agendada para 30 s depois, e nunca mais de uma por organização", async () => {
    const org = await createOrganization(app, "expire recurring");
    await expireApprovals.run(task(org, "expire_approvals"), depsFor(app));
    await expireApprovals.run(task(org, "expire_approvals"), depsFor(app));
    expect((await queued(org)).map((row) => row.run_at)).toEqual([new Date(t0.getTime() + 30_000)]);
  });

  it("garantias concorrentes criam uma tarefa só", async () => {
    const org = await createOrganization(app, "expire race");
    await Promise.all(Array.from({ length: 8 }, () => withOrg(app, org, (q) => ensureExpireApprovals(q, org, t0))));
    expect(await queued(org)).toHaveLength(1);
  });

  it("o seed liga a corrente das organizações que não têm tarefa, sem duplicar as que têm", async () => {
    const org = await createOrganization(app, "expire seed");
    await expireApprovals.seed?.(depsFor(app));
    await expireApprovals.seed?.(depsFor(app));
    expect((await queued(org)).map((row) => row.run_at)).toEqual([t0]);
  });
});
