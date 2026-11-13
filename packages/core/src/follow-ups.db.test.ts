import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { assignFollowUp, closeFollowUp, createFollowUp, purgeFollowUps, returnFollowUpsToTeam } from "./follow-ups";
import type { Db } from "./types";
import { withOrg, withSystem } from "./with-org";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const at = new Date("2026-04-01T13:00:00Z");
const later = (minutes: number): Date => new Date(at.getTime() + minutes * 60_000);
const TITLE = "Retornar para Joana sobre o exame";
const DETAILS = "Ela quer saber se o exame de sangue já saiu.";
const NOTE = "Retornei; o exame sai amanhã.";

async function insert(db: Db, sql: string, params: unknown[]): Promise<string> {
  const id = randomUUID();
  await withSystem(db, (q) => q.exec(sql, [id, ...params]));
  return id;
}

/** Organização, pessoa, agente (com ela como dono das pendências, ou sem dono) e ligação recebida. */
async function scene(label: string, options: { ownedBy?: "person" | "team"; direction?: "inbound" | "outbound" } = {}) {
  const org = await createOrganization(app, label);
  const person = await insert(app, "insert into users (id, organization_id, email, name, password_hash, role) values ($1, $2, $3, 'Pessoa', 'x', 'operator')", [org, `${randomUUID()}@example.com`]);
  const agent = await insert(app, "insert into agents (id, organization_id, name, engine, follow_up_owner_user_id) values ($1, $2, 'Recepção', 'simulated', $3)", [
    org,
    options.ownedBy === "team" ? null : person,
  ]);
  const call = await insert(app, "insert into calls (id, organization_id, agent_id, direction, from_e164, to_e164, status, started_at) values ($1, $2, $3, $4, '+5531999990001', '+5531999990002', 'in_progress', $5)", [
    org,
    agent,
    options.direction ?? "inbound",
    at,
  ]);
  const create = () => withOrg(app, org, (q) => createFollowUp(q, { callId: call, agentId: agent, title: TITLE, details: DETAILS, dueAt: later(30) }, at));
  return { org, person, agent, call, create };
}

/** Espera alguma consulta com `text` ficar parada numa trava. Devolve se ficou; o prazo só existe para não travar. */
async function someoneWaitsOn(text: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const { rows } = await owner.pool.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and position($1 in query) > 0",
      [text],
    );
    if ((rows[0]?.n ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

const eventsOf = (call: string) =>
  withSystem(app, (q) => q.many<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from call_events where call_id = $1 order by id", [call]));
const followUpOf = (id: string) => withSystem(app, (q) => q.one("select caller_e164, owner_user_id, status, closed_by, closed_at, closing_note from follow_ups where id = $1", [id]));

describe("createFollowUp", () => {
  it("nasce com o dono do agente, o telefone de quem ligou, o evento sem texto e o lembrete marcado para o prazo", async () => {
    const { person, call, create } = await scene("follow-up create");
    const created = await create();

    expect(created.ownerUserId).toBe(person);
    expect(await followUpOf(created.id)).toMatchObject({ caller_e164: "+5531999990001", owner_user_id: person, status: "open", closed_at: null });
    expect(await eventsOf(call)).toEqual([{ kind: "follow_up_created", payload: { followUpId: created.id, ownerUserId: person, dueAt: later(30).toISOString(), status: "open" } }]);
    const tasks = await withSystem(app, (q) => q.many("select id, kind, payload, run_at, call_id from tasks where id = $1", [created.taskId]));
    expect(tasks).toEqual([{ id: created.taskId, kind: "follow_up", payload: { followUpId: created.id, stage: "due" }, run_at: later(30), call_id: call }]);
  });

  it("sem dono no agente, é da equipe; na ligação que o sistema fez, o telefone é o de destino", async () => {
    const { call, create } = await scene("follow-up team", { ownedBy: "team", direction: "outbound" });
    const created = await create();
    expect(await followUpOf(created.id)).toMatchObject({ caller_e164: "+5531999990002", owner_user_id: null });
    expect((await eventsOf(call))[0]?.payload).toMatchObject({ ownerUserId: null });
  });

  it("com o dono do agente desativado, a pendência nova vai para a equipe", async () => {
    const { person, create } = await scene("follow-up disabled owner");
    await withSystem(app, (q) => q.exec("update users set disabled_at = $2 where id = $1", [person, at]));
    expect((await create()).ownerUserId).toBeNull();
  });
});

describe("a corrida com a desativação", () => {
  it("a pendência nova espera a desativação em curso do dono e então vai para a equipe", async () => {
    const { org, person, create } = await scene("follow-up disable race");
    let release: () => void = () => undefined;
    let updated: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const didUpdate = new Promise<void>((resolve) => (updated = resolve));
    // A desativação já gravou e devolveu à equipe o que havia; a transação ainda não confirmou.
    const disabling = withOrg(app, org, async (q) => {
      await q.exec("update users set disabled_at = $2 where id = $1", [person, at]);
      await returnFollowUpsToTeam(q, person, at);
      updated();
      await held;
    });
    await didUpdate;
    const creating = create();
    try {
      // Com a trava, a leitura da pessoa espera a desativação. Sem ela, leria a pessoa ainda ativa.
      expect(await someoneWaitsOn("for share")).toBe(true);
    } finally {
      release();
      await disabling;
    }
    expect((await creating).ownerUserId).toBeNull();
  });
});

describe("closeFollowUp", () => {
  it("grava follow_up_closed na linha do tempo da ligação de origem, sem título nem nota, e não fecha duas vezes", async () => {
    const { org, person, call, create } = await scene("follow-up close");
    const { id } = await create();

    expect(await withOrg(app, org, (q) => closeFollowUp(q, id, { status: "done", note: NOTE, closedBy: person }, later(60)))).toBe("closed");
    expect(await followUpOf(id)).toMatchObject({ status: "done", closed_by: person, closed_at: later(60), closing_note: NOTE });
    const closed = (await eventsOf(call)).at(-1);
    expect(closed).toEqual({ kind: "follow_up_closed", payload: { followUpId: id, ownerUserId: person, dueAt: later(30).toISOString(), status: "done", closedBy: person } });
    const timeline = JSON.stringify(await eventsOf(call));
    expect(timeline).not.toContain("Joana");
    expect(timeline).not.toContain("amanhã");

    expect(await withOrg(app, org, (q) => closeFollowUp(q, id, { status: "canceled", note: "x", closedBy: person }, later(61)))).toBe("already_closed");
    expect(await withOrg(app, org, (q) => closeFollowUp(q, randomUUID(), { status: "done", note: "x", closedBy: person }, later(61)))).toBe("not_found");
    expect((await eventsOf(call)).filter((event) => event.kind === "follow_up_closed")).toHaveLength(1);
  });
});

describe("assignFollowUp e returnFollowUpsToTeam", () => {
  it("troca o dono só para pessoa ativa; pessoa desativada devolve as abertas à equipe, com o motivo na linha do tempo", async () => {
    const { org, person, call, create } = await scene("follow-up assign", { ownedBy: "team" });
    const { id } = await create();
    const closed = await create();
    await withOrg(app, org, (q) => assignFollowUp(q, closed.id, person, later(1)));
    await withOrg(app, org, (q) => closeFollowUp(q, closed.id, { status: "done", note: NOTE, closedBy: person }, later(2)));

    expect(await withOrg(app, org, (q) => assignFollowUp(q, id, person, later(3)))).toBe("assigned");
    expect(await withOrg(app, org, (q) => assignFollowUp(q, closed.id, null, later(3)))).toBe("closed");
    expect(await withOrg(app, org, (q) => assignFollowUp(q, id, randomUUID(), later(3)))).toBe("owner_unavailable");

    expect(await withOrg(app, org, (q) => returnFollowUpsToTeam(q, person, later(4)))).toBe(1);
    expect(await followUpOf(id)).toMatchObject({ owner_user_id: null, status: "open" });
    // A fechada fica como estava: é histórico, com o dono de quando foi fechada.
    expect(await followUpOf(closed.id)).toMatchObject({ owner_user_id: person, status: "done" });
    const assigned = (await eventsOf(call)).filter((event) => event.kind === "follow_up_assigned").map((event) => event.payload);
    expect(assigned.at(-1)).toEqual({ followUpId: id, ownerUserId: null, dueAt: later(30).toISOString(), status: "open", reason: "owner_disabled" });
  });
});

describe("purgeFollowUps", () => {
  it("apaga só as fechadas antes do limite, contando do fecho; a aberta, por mais velha que seja, fica", async () => {
    const { org, person, create } = await scene("follow-up purge");
    const old = await create();
    const recent = await create();
    const open = await create();
    await withOrg(app, org, (q) => closeFollowUp(q, old.id, { status: "canceled", note: "Desistiu.", closedBy: person }, later(10)));
    await withOrg(app, org, (q) => closeFollowUp(q, recent.id, { status: "done", note: NOTE, closedBy: person }, later(100)));

    expect(await withOrg(app, org, (q) => purgeFollowUps(q, later(50)))).toBe(1);
    expect(await followUpOf(old.id)).toBeNull();
    expect(await followUpOf(recent.id)).not.toBeNull();
    expect(await followUpOf(open.id)).not.toBeNull();
  });

  it("recusa rodar fora de withOrg", async () => {
    await expect(withSystem(app, (q) => purgeFollowUps(q, at))).rejects.toThrow(/inside withOrg/);
  });
});
