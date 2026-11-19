import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganization, openTestDbs } from "../test/helpers";
import { createAccount } from "./accounts";
import { costTotal, organizationDays } from "./costs";
import { monthCost, setOrganizationLimits, spendCapReached } from "./limits";
import type { OrgQuery } from "./types";
import { withOrg, withSystem } from "./with-org";

// Seção 3.4 do desenho do R8, fatia 7c: o teto de gasto do mês por organização.
const { app, owner } = openTestDbs();
// 15/03, meio-dia em São Paulo: o mês corrente da organização é março.
const NOW = new Date("2026-03-15T15:00:00.000Z");

let actor: string;
beforeAll(async () => {
  actor = (await withSystem(app, (q) => createAccount(q, { email: `spend-cap-${randomUUID()}@example.test`, passwordHash: "x" }))) ?? "";
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

/** Uma organização com uma chamada, para pendurar as linhas do extrato. */
async function organization(timezone?: string): Promise<{ id: string; callId: string }> {
  const id = await createOrganization(app, `spend-cap-${randomUUID()}`);
  if (timezone) await withSystem(app, (q) => q.exec("insert into outbound_policy (organization_id, timezone) values ($1, $2)", [id, timezone]));
  const callId = await withOrg(app, id, async (q) => {
    const call = await q.one<{ id: string }>("insert into calls (organization_id, direction, channel, status, started_at) values ($1, 'inbound', 'simulated', 'completed', $2) returning id", [id, NOW]);
    return call?.id ?? "";
  });
  return { id, callId };
}

async function spend(org: { id: string; callId: string }, microcents: number, at: Date, extra: { estimated?: boolean; measured?: boolean } = {}): Promise<void> {
  await withOrg(app, org.id, (q) =>
    q.exec(
      "insert into usage_ledger (organization_id, call_id, engine, cost_cents, cost_microcents, cost_estimated, cost_measured, at) values ($1, $2, 'simulated', round($3::numeric / 1000000)::int, $3, $4, $5, $6)",
      [org.id, org.callId, microcents, extra.estimated ?? false, extra.measured ?? true, at],
    ),
  );
}

const cap = (org: { id: string }, cents: number | null) => setOrganizationLimits(app, org.id, { monthlySpendCapCents: cents }, actor, NOW);
const check = (org: { id: string }) => withOrg(app, org.id, (q) => spendCapReached(q, NOW));

/** Um `OrgQuery` que conta as consultas e reprova qualquer leitura do extrato. */
function watched(q: OrgQuery): { q: OrgQuery; sql: string[] } {
  const sql: string[] = [];
  const guard = (text: string): void => {
    sql.push(text);
    if (/usage_ledger/.test(text)) throw new Error("read usage_ledger");
  };
  return {
    sql,
    q: {
      organizationId: q.organizationId,
      one: (text, params) => (guard(text), q.one(text, params)),
      many: (text, params) => (guard(text), q.many(text, params)),
      exec: (text, params) => (guard(text), q.exec(text, params)),
    } as OrgQuery,
  };
}

describe("spendCapReached", () => {
  it("T1: sem linha de limites, ou com o teto nulo, não soma nada e não recusa", async () => {
    const org = await organization();
    await spend(org, 10_000_000_000, NOW);
    await withOrg(app, org.id, async (q) => {
      const spy = watched(q);
      expect(await spendCapReached(spy.q, NOW)).toEqual({ reached: false });
      expect(spy.sql).toHaveLength(1);
    });
    // Com linha, mas com o teto nulo (outra coluna preenchida).
    await setOrganizationLimits(app, org.id, { maxAgents: 3 }, actor, NOW);
    await withOrg(app, org.id, async (q) => {
      const spy = watched(q);
      expect(await spendCapReached(spy.q, NOW)).toEqual({ reached: false });
      expect(spy.sql).toHaveLength(1);
    });
  });

  it("T2: recusa com a soma exatamente no teto (convertido, nunca arredondando a soma) e passa com 1 microcentavo a menos", async () => {
    const org = await organization();
    await cap(org, 500);
    // 499 999 999 + 1: em `cost_cents` cada linha arredondada daria 500 + 0, e a soma de microcentavos é 500 000 000.
    await spend(org, 499_999_999, NOW);
    expect(await check(org)).toEqual({ reached: false });
    await spend(org, 1, NOW);
    expect(await check(org)).toEqual({ reached: true, capCents: 500, spentMicrocents: 500_000_000 });
  });

  it("T2: a soma pelo `cost_cents` arredondado não serve: 3 linhas de 0,4 centavo somam 1,2 centavo, e não 0", async () => {
    const org = await organization();
    await cap(org, 1);
    for (let i = 0; i < 3; i += 1) await spend(org, 400_000, NOW);
    expect(await check(org)).toEqual({ reached: true, capCents: 1, spentMicrocents: 1_200_000 });
  });

  it("teto 0 recusa toda chamada, mesmo sem gasto nenhum", async () => {
    const org = await organization();
    await cap(org, 0);
    expect(await check(org)).toEqual({ reached: true, capCents: 0, spentMicrocents: 0 });
  });

  it("T3: o gasto às 23h30 do último dia do mês anterior, no fuso da organização (já o mês seguinte em UTC), não conta", async () => {
    const org = await organization("America/Sao_Paulo");
    await cap(org, 100);
    // 28/02 23h30 em São Paulo = 01/03 02h30 em UTC.
    await spend(org, 100_000_000, new Date("2026-03-01T02:30:00.000Z"));
    expect(await check(org)).toEqual({ reached: false });
    // 01/03 00h30 em São Paulo conta.
    await spend(org, 100_000_000, new Date("2026-03-01T03:30:00.000Z"));
    expect(await check(org)).toEqual({ reached: true, capCents: 100, spentMicrocents: 100_000_000 });
  });

  it("T3: o fuso é o da organização: em Tóquio, o mesmo instante já é março", async () => {
    const org = await organization("Asia/Tokyo");
    await cap(org, 100);
    // 28/02 15h30 em UTC = 01/03 00h30 em Tóquio.
    await spend(org, 100_000_000, new Date("2026-02-28T15:30:00.000Z"));
    expect(await check(org)).toEqual({ reached: true, capCents: 100, spentMicrocents: 100_000_000 });
  });

  it("T4: o gasto da organização B não conta no teto da A", async () => {
    const a = await organization();
    const b = await organization();
    await cap(a, 100);
    await spend(b, 900_000_000, NOW);
    expect(await check(a)).toEqual({ reached: false });
    await spend(a, 99_999_999, NOW);
    expect(await check(a)).toEqual({ reached: false });
  });

  it("T6: a soma do teto é a da tela de Custos do mês, com custo estimado e com linha não medida na massa", async () => {
    const org = await organization();
    await spend(org, 123_456_789, NOW, { estimated: true });
    await spend(org, 0, NOW, { measured: false });
    await spend(org, 1_000_001, new Date("2026-03-02T12:00:00.000Z"));
    await spend(org, 7_000_000, new Date("2026-02-20T12:00:00.000Z"));
    const { screen, month } = await withOrg(app, org.id, async (q) => {
      const days = await organizationDays(q, NOW);
      return { screen: await costTotal(q, { from: days.monthStart, to: days.today }), month: await monthCost(q, NOW) };
    });
    expect(month).toEqual({ from: "2026-03-01", to: "2026-03-15", ...screen });
    expect(screen).toEqual({ microcents: 124_456_790, unmeasuredCount: 1, estimatedCount: 1 });
    await cap(org, 124);
    expect(await check(org)).toEqual({ reached: true, capCents: 124, spentMicrocents: screen.microcents });
    await cap(org, 125);
    expect(await check(org)).toEqual({ reached: false });
  });
});

describe("setOrganizationLimits com o teto do mês", () => {
  it("grava o teto, registra o antes e o depois na auditoria, tira com null e recusa o que não é inteiro de 0 para cima", async () => {
    const org = await organization();
    expect(await cap(org, 5000)).toEqual({ ok: true, limits: { monthlySpendCapCents: 5000, maxTrunks: null, maxAgents: null, outboundAllowed: true } });
    await cap(org, 5000);
    await cap(org, null);
    const events = await owner.pool.query("select payload from installation_events where kind = 'organization_limits_changed' and organization_id = $1 order by id", [org.id]);
    expect(events.rows.map((row) => row.payload)).toEqual([
      { before: { monthly_spend_cap_cents: null }, after: { monthly_spend_cap_cents: 5000 } },
      { before: { monthly_spend_cap_cents: 5000 }, after: { monthly_spend_cap_cents: null } },
    ]);
    for (const value of [-1, 1.5, "10", Number.NaN]) {
      await expect(setOrganizationLimits(app, org.id, { monthlySpendCapCents: value as number }, actor, NOW)).rejects.toThrow(/non-negative integer/);
    }
  });

  it("a organização lê o teto e não o escreve", async () => {
    const org = await organization();
    await cap(org, 100);
    await expect(withOrg(app, org.id, (q) => q.exec("update organization_limits set monthly_spend_cap_cents = null where organization_id = $1", [org.id]))).rejects.toThrow(/permission denied/);
  });
});
