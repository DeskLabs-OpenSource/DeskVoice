// O custo do teste do agente no extrato (fatia 7b, seção 5.5 de docs/specs/2026-11-21-testes-do-agente.md).
// A linha do teste tem `source = 'test'` e nenhuma ligação. O aceite: o total do mês (`costTotal`)
// é a soma das linhas de Custos (por dia, por agente e por motor) e o número da visão da
// instalação. Apagar a rodada não apaga a linha nem muda o total.
//
// Sabotagem: com `join calls` no lugar do `left join` em `system/costs`, a linha do teste some da
// lista por agente, e a soma dela deixa de bater com o total.
import { costTotal, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { POST as createAgent } from "./agents/route";
import { GET as overview } from "./installation/overview/route";
import { GET as costs } from "./system/costs/route";

const panel = startPanel();
const { owner } = openTestDbs();
const clearInstallationState = (): Promise<void> => clear(owner);
beforeEach(async () => {
  panel.clock.at = NOW;
  await clearInstallationState();
});
afterAll(async () => {
  await clearInstallationState();
  await owner.close();
  await panel.close();
});

const CENT = 1_000_000; // micro-centavos
const at = (seconds: number): Date => new Date(NOW.getTime() - 3_600_000 + seconds * 1000);
const sum = (rows: { costCents: number }[]): number => rows.reduce((total, row) => total + row.costCents, 0);

interface Costs {
  from: string;
  to: string;
  totalCents: number;
  byDay: { costCents: number }[];
  byAgent: { agentId: string | null; costCents: number; calls: number }[];
  byEngine: { engine: string; source: string | null; costCents: number; callSeconds: number }[];
}

describe("o custo do teste do agente no extrato", () => {
  it("total do mês = soma das linhas de Custos = visão da instalação, antes e depois de apagar a rodada", async () => {
    const organizationId = await createOrganization(panel.app, "custo do teste do agente");
    const person = await createUser(panel.app, organizationId, "owner");
    const agentId = ((await call(createAgent, { method: "POST", cookie: person.cookie, body: { name: "Lia", engine: "simulated" } })).data as { id: string }).id;

    // Uma ligação com 3 centavos, e uma rodada de teste com 7 centavos em duas linhas.
    const callId = await insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $4, 'openai-realtime', 3) returning id",
      [organizationId, agentId, at(0), at(120)],
    );
    await insert(
      panel.app,
      organizationId,
      "insert into usage_ledger (organization_id, call_id, agent_id, engine, seconds, cost_cents, cost_microcents, at) values ($1, $2, $3, 'openai-realtime', 0, 3, $4, $5) returning id",
      [organizationId, callId, agentId, 3 * CENT, at(60)],
    );
    const testId = await insert(panel.app, organizationId, "insert into agent_tests (organization_id, agent_id, name, turns) values ($1, $2, 'Remarcar', '[]') returning id", [organizationId, agentId]);
    const runId = await insert(
      panel.app,
      organizationId,
      "insert into agent_test_runs (organization_id, test_id, status, engine, config_hash, started_at, finished_at) values ($1, $2, 'passed', 'openai-realtime', 'x', $3, $3) returning id",
      [organizationId, testId, at(200)],
    );
    for (const [cents, second] of [
      [4, 210],
      [3, 220],
    ] as const) {
      await insert(
        panel.app,
        organizationId,
        "insert into usage_ledger (organization_id, call_id, test_run_id, agent_id, engine, seconds, cost_cents, cost_microcents, source, at) values ($1, null, $2, $3, 'openai-realtime', 0, $4, $5, 'test', $6) returning id",
        [organizationId, runId, agentId, cents, cents * CENT, at(second)],
      );
    }

    const admin = await createUser(panel.app, organizationId, "admin");
    const account = await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [admin.id]));
    await withSystem(panel.app, (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [account?.id, NOW]));

    const check = async (): Promise<Costs> => {
      const read = (await call(costs, { cookie: person.cookie })).data as Costs;
      const total = await withOrg(panel.app, organizationId, (q) => costTotal(q, { from: read.from, to: read.to }));
      expect(total.microcents).toBe(10 * CENT);
      expect(read.totalCents).toBe(10);
      expect(sum(read.byDay)).toBe(10);
      expect(sum(read.byAgent)).toBe(10);
      expect(sum(read.byEngine)).toBe(10);
      // A visão da instalação soma o mês pela mesma função.
      const view = (await call(overview, { cookie: admin.cookie })).data as { organizations: { id: string; cost: { cents: number } }[] };
      expect(view.organizations.find((row) => row.id === organizationId)?.cost.cents).toBe(10);
      return read;
    };

    const before = await check();
    // O teste sai numa linha própria do motor, sem minutos; o agente conta só a ligação.
    expect(before.byEngine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ engine: "openai-realtime", source: null, costCents: 3, callSeconds: 120 }),
        expect.objectContaining({ engine: "openai-realtime", source: "test", costCents: 7, callSeconds: 0 }),
      ]),
    );
    expect(before.byAgent).toEqual([expect.objectContaining({ agentId, costCents: 10, calls: 1 })]);

    // Apagar a rodada: passa, e as linhas ficam sem ligação e sem rodada, com o total igual.
    await withOrg(panel.app, organizationId, (q) => q.exec("delete from agent_test_runs where id = $1", [runId]));
    const lines = await withSystem(panel.app, (q) =>
      q.many<{ call_id: string | null; test_run_id: string | null; organization_id: string }>(
        "select call_id, test_run_id, organization_id from usage_ledger where organization_id = $1 and source = 'test'",
        [organizationId],
      ),
    );
    expect(lines).toEqual([
      { call_id: null, test_run_id: null, organization_id: organizationId },
      { call_id: null, test_run_id: null, organization_id: organizationId },
    ]);
    await check();

    // Apagar o teste, que leva as rodadas, também não muda o total.
    await withOrg(panel.app, organizationId, (q) => q.exec("delete from agent_tests where id = $1", [testId]));
    await check();
  });

  it("a forma da linha: a de teste não tem ligação, e a de ligação não tem rodada", async () => {
    const organizationId = await createOrganization(panel.app, "forma da linha do extrato");
    const callId = await insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, direction, channel, status, started_at, engine, cost_cents) values ($1, 'inbound', 'phone', 'completed', $2, 'simulated', 0) returning id",
      [organizationId, at(0)],
    );
    const line = (callIdOrNull: string | null, source: string | null) =>
      insert(
        panel.app,
        organizationId,
        "insert into usage_ledger (organization_id, call_id, engine, seconds, cost_cents, cost_microcents, source, at) values ($1, $2, 'simulated', 0, 0, 0, $3, $4) returning id",
        [organizationId, callIdOrNull, source, at(1)],
      );
    await expect(line(callId, "test")).rejects.toThrow(/usage_ledger_call_or_test/);
    await expect(line(null, null)).rejects.toThrow(/usage_ledger_call_or_test/);
    await expect(line(null, "analyst")).rejects.toThrow(/usage_ledger_call_or_test/);
    await expect(line(callId, "outra")).rejects.toThrow(/usage_ledger_source_check/);
    expect(await line(null, "test")).toEqual(expect.any(String));
    expect(await line(callId, null)).toEqual(expect.any(String));
  });
});
