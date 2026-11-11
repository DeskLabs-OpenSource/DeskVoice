import { randomUUID } from "node:crypto";
import { listen, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { createCall, createOrganization, depsFor, openTestDbs, t0, task, tasksOf, until } from "../../test/helpers";
import expireApproval from "./expire_approval";

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
const rowOf = (id: string): Promise<{ status: string; decided_at: Date | null } | null> => withSystem(app, (q) => q.one("select status, decided_at from approvals where id = $1", [id]));
const run = (org: string, approvalId: unknown): Promise<void> => expireApproval.run(task(org, "expire_approval", { approvalId }), depsFor(app));

describe("expire_approval", () => {
  it("vence só o pedido da tarefa, avisa o canal approvals e não deixa tarefa nova na fila", async () => {
    const org = await createOrganization(app, "expire one");
    const callId = await createCall(app, org, t0);
    const target = await createApproval(org, callId, t0);
    const sibling = await createApproval(org, callId, new Date(t0.getTime() - 60_000));

    const notified: string[] = [];
    const stop = await listen(app, "approvals", (id) => notified.push(id));
    await run(org, target);
    await until(() => notified.includes(target), "the approvals notification");
    await stop();

    expect(await rowOf(target)).toEqual({ status: "expired", decided_at: t0 });
    // Outro pedido vencido da mesma organização tem a própria tarefa: este não é tocado.
    expect(await rowOf(sibling)).toEqual({ status: "pending", decided_at: null });
    expect(notified).not.toContain(sibling);
    // Tarefa pontual: nada se reagenda.
    expect(await tasksOf(app, org)).toEqual([]);
  });

  it("pedido já decidido não é tocado, e rodar de novo num vencido não muda nada", async () => {
    const org = await createOrganization(app, "expire decided");
    const callId = await createCall(app, org, t0);
    const approved = await createApproval(org, callId, new Date(t0.getTime() - 1000), "approved");
    const before = await rowOf(approved);
    await run(org, approved);
    expect(await rowOf(approved)).toEqual(before);

    const expiredByTool = await createApproval(org, callId, new Date(t0.getTime() - 1000), "expired");
    await run(org, expiredByTool);
    expect(await rowOf(expiredByTool)).toEqual({ status: "expired", decided_at: null });
  });

  it("não vence pedido cujo prazo ainda não chegou nem pedido de outra organização", async () => {
    const org = await createOrganization(app, "expire early");
    const other = await createOrganization(app, "expire foreign");
    const early = await createApproval(org, await createCall(app, org, t0), new Date(t0.getTime() + 1));
    const foreign = await createApproval(other, await createCall(app, other, t0), new Date(t0.getTime() - 1000));
    await run(org, early);
    await run(org, foreign);
    expect([(await rowOf(early))?.status, (await rowOf(foreign))?.status]).toEqual(["pending", "pending"]);
  });

  it("recusa tarefa sem o id do pedido", async () => {
    const org = await createOrganization(app, "expire invalid");
    await expect(run(org, undefined)).rejects.toThrow();
  });
});
