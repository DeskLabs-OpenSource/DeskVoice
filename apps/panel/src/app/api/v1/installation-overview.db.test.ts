// A visão geral da instalação (R8, seção 3.7, fatia 6). O aceite: para cada organização, cada número
// da visão geral é o que a rota da própria organização devolve (`system/costs` para o custo do mês,
// `system/health` para a linha e o motor). O teste compara as duas respostas, não um número escrito
// à mão.
import { randomUUID } from "node:crypto";
import { enqueueTask, startSupportAccess, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { clearInstallationState as clear, openTestDbs } from "../../../../../../packages/core/test/helpers";
import { call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import type { HealthCheck } from "../../../server/health";
import { GET as overview } from "./installation/overview/route";
import { GET as costs } from "./system/costs/route";
import { GET as health } from "./system/health/route";

const panel = startPanel();
const { owner } = openTestDbs();

// Meio de março em UTC; em Tóquio já é dia 21 e, em São Paulo, ainda 20.
const NOW = new Date("2026-03-20T20:00:00.000Z");
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

interface Row {
  id: string;
  name: string;
  suspendedAt: string | null;
  calls: { from: string; to: string; count: number };
  cost: { from: string; to: string; cents: number; unmeasuredCount: number; estimatedCount: number };
  trunk: { connected: number; attention: number; down: number; check: HealthCheck } | null;
  engine: { state: "own_key" | "no_key" | "key_failed"; check: HealthCheck };
  queue: { late: number; failedLast24h: number };
  spendCapCents: number | null;
}
interface Overview {
  voiceAnswered: boolean;
  organizations: Row[];
}
type Line = HealthCheck & { id: string };

const administers = (accountId: string): Promise<void> =>
  withSystem(panel.app, (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [accountId, NOW])).then(() => undefined);
const accountOf = async (userId: string): Promise<string> =>
  (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [userId])))?.id ?? "";

const at = (iso: string): Date => new Date(iso);
const HOUR = 3_600_000;

/** Uma organização com ligações, extrato, linhas, chaves e fila, todos diferentes da outra. */
async function organization(label: string, zone: string | null) {
  const org = await createOrganization(panel.app, `Visão ${label}`);
  const person = await createUser(panel.app, org, "owner");
  if (zone) await insert(panel.app, org, "insert into outbound_policy (organization_id, timezone) values ($1, $2) returning organization_id", [org, zone]);
  const newCall = (startedAt: Date): Promise<string> =>
    insert(panel.app, org, "insert into calls (organization_id, direction, channel, status, started_at) values ($1, 'inbound', 'phone', 'completed', $2) returning id", [org, startedAt]);
  const ledger = (callId: string, microcents: number, cost: "measured" | "unmeasured" | "estimated", when: Date): Promise<string> =>
    insert(
      panel.app,
      org,
      "insert into usage_ledger (organization_id, call_id, engine, seconds, cost_cents, cost_microcents, cost_measured, cost_estimated, at) values ($1, $2, 'simulated', 0, round($3::numeric / 1000000)::int, $3, $4, $5, $6) returning id",
      [org, callId, microcents, cost !== "unmeasured", cost === "estimated", when],
    );
  const trunk = (): Promise<string> => insert(panel.app, org, "insert into trunks (organization_id, name, host, auth_mode) values ($1, 'Operadora', 'sip.example.test', 'ip') returning id", [org]);
  const setting = (key: string, value: unknown, secret: boolean): Promise<string> =>
    insert(panel.app, org, "insert into settings (organization_id, key, value, secret) values ($1, $2, $3, $4) returning key", [org, key, JSON.stringify(value), secret]);
  const task = async (status: string, runAt: Date): Promise<void> => {
    const id = await withOrg(panel.app, org, (q) => enqueueTask(q, { kind: "summarize_call", payload: {}, runAt }));
    await withSystem(panel.app, (q) => q.exec("update tasks set status = $2 where id = $1", [id, status]));
  };
  return { org, person, newCall, ledger, trunk, setting, task };
}

/** Duas organizações com tudo diferente, e uma pessoa que administra a instalação. */
async function scene() {
  const a = await organization("A", null); // São Paulo, o padrão
  const b = await organization("B", "Asia/Tokyo");

  // Ligações: A tem três nos últimos 30 dias e uma antes; B, uma.
  const a1 = await a.newCall(at("2026-03-19T12:00:00Z"));
  await a.newCall(at("2026-02-25T12:00:00Z"));
  await a.newCall(at("2026-02-18T12:00:00Z")); // 19/02 em São Paulo é o primeiro dia da janela; 18/02, fora
  await a.newCall(at("2026-02-19T12:00:00Z"));
  const b1 = await b.newCall(at("2026-03-20T16:00:00Z")); // já dia 21 em Tóquio

  // Custo: em A, um medido e um estimado em março, um não medido, e um em fevereiro pelo fuso
  // (01/03 às 02h UTC ainda é 28/02 em São Paulo). Em B, 01/03 às 02h UTC já é março em Tóquio.
  await a.ledger(a1, 1_234_567, "measured", at("2026-03-10T12:00:00Z"));
  await a.ledger(a1, 2_500_000, "estimated", at("2026-03-11T12:00:00Z"));
  await a.ledger(a1, 0, "unmeasured", at("2026-03-12T12:00:00Z"));
  await a.ledger(a1, 9_000_000, "measured", at("2026-03-01T02:00:00Z"));
  // Duas linhas de menos de meio centavo: somar o `cost_cents` arredondado de cada linha daria um centavo a menos.
  await a.ledger(a1, 400_000, "measured", at("2026-03-13T12:00:00Z"));
  await a.ledger(a1, 400_000, "measured", at("2026-03-14T12:00:00Z"));
  await b.ledger(b1, 7_777_777, "measured", at("2026-03-01T02:00:00Z"));
  await b.ledger(b1, 400_000, "measured", at("2026-03-20T16:00:00Z"));

  // Linhas: A tem uma no ar e uma caída; B, uma com aviso.
  const [aUp, aDown, bWarn] = [await a.trunk(), await a.trunk(), await b.trunk()];
  panel.voice.respond = (url) => {
    if (url === "http://voice.test/health")
      return Response.json({
        asterisk: { status: "ok", detail: "connected" },
        trunks: [
          { id: aUp, status: "ok", detail: "The provider answers." },
          { id: aDown, status: "fail", detail: "The provider does not answer." },
          { id: bWarn, status: "warn", detail: "Not checked yet." },
          // Uma linha de outra organização, que nenhuma das duas lê.
          { id: randomUUID(), status: "fail", detail: "The provider does not answer." },
        ],
      });
    throw new Error(`unexpected request to ${url}`);
  };

  // Motor: A tem a chave recusada no último teste; B não tem chave.
  await a.setting("engine.openai-realtime.api_key", "cifrada", true);
  await a.setting("engine.openai-realtime.key_check", { result: "rejected", model: "gpt-realtime", checkedAt: "2026-03-19T10:00:00.000Z" }, false);

  // Fila: em A, uma em atraso e uma falha nas últimas 24 horas; em B, uma falha antiga.
  await a.task("queued", new Date(NOW.getTime() - HOUR));
  await a.task("queued", new Date(NOW.getTime() + HOUR));
  await a.task("failed", new Date(NOW.getTime() - 2 * HOUR));
  await b.task("failed", new Date(NOW.getTime() - 30 * HOUR));

  const admin = await createUser(panel.app, a.org, "admin");
  await administers(await accountOf(admin.id));
  return { a, b, admin };
}

const read = async (cookie: string): Promise<Overview> => {
  const result = await call(overview, { cookie });
  expect(result.status).toBe(200);
  return result.data as Overview;
};
const rowOf = (data: Overview, org: string): Row => {
  const row = data.organizations.find((candidate) => candidate.id === org);
  if (!row) throw new Error(`organization ${org} is not in the overview`);
  return row;
};
const healthLine = async (cookie: string, id: string): Promise<HealthCheck> => {
  const report = (await call(health, { cookie })).data as { checks: Line[] };
  const found = report.checks.find((line) => line.id === id);
  if (!found) throw new Error(`the health has no ${id} line`);
  const { status, reason, params, action } = found;
  return { status, reason, params, action };
};

describe("installation overview", () => {
  it("each organization's numbers are the ones its own screens show (costs for the month, health for line and engine)", async () => {
    const { a, b, admin } = await scene();
    const data = await read(admin.cookie);
    expect(data.voiceAnswered).toBe(true);

    for (const { org, person } of [a, b]) {
      const row = rowOf(data, org);
      // Custo do mês: o que Custos devolve com o mesmo período.
      const own = (await call(costs, { cookie: person.cookie, query: `?from=${row.cost.from}&to=${row.cost.to}` })).data as { totalCents: number; unmeasuredCount: number; estimatedCount: number };
      expect({ cents: row.cost.cents, unmeasuredCount: row.cost.unmeasuredCount, estimatedCount: row.cost.estimatedCount }).toEqual({
        cents: own.totalCents,
        unmeasuredCount: own.unmeasuredCount,
        estimatedCount: own.estimatedCount,
      });
      // Linha e motor: as linhas da Saúde da própria organização.
      expect(row.trunk?.check).toEqual(await healthLine(person.cookie, "trunk"));
      expect(row.engine.check).toEqual(await healthLine(person.cookie, "engine"));
    }

    // O período é o do fuso de cada uma, e os números são os de cada uma, não trocados.
    const [rowA, rowB] = [rowOf(data, a.org), rowOf(data, b.org)];
    expect([rowA.cost.from, rowA.cost.to, rowB.cost.from, rowB.cost.to]).toEqual(["2026-03-01", "2026-03-20", "2026-03-01", "2026-03-21"]);
    expect([rowA.cost.cents, rowA.cost.unmeasuredCount, rowA.cost.estimatedCount]).toEqual([5, 1, 1]);
    expect([rowB.cost.cents, rowB.cost.unmeasuredCount, rowB.cost.estimatedCount]).toEqual([8, 0, 0]);
    expect([rowA.calls, rowB.calls]).toEqual([
      { from: "2026-02-19", to: "2026-03-20", count: 3 },
      { from: "2026-02-20", to: "2026-03-21", count: 1 },
    ]);
    // A linha em aviso de B pede atenção; não caiu.
    expect([rowA.trunk, rowB.trunk].map((trunk) => [trunk?.connected, trunk?.attention, trunk?.down])).toEqual([
      [1, 0, 1],
      [0, 1, 0],
    ]);
    expect([rowA.engine.state, rowB.engine.state]).toEqual(["key_failed", "no_key"]);
    expect([rowA.queue, rowB.queue]).toEqual([
      { late: 1, failedLast24h: 1 },
      { late: 0, failedLast24h: 0 },
    ]);
  });

  it("the monthly cap column (7c): null without a cap, the cap in cents with it, next to the same month's cost", async () => {
    const { a, b, admin } = await scene();
    await withSystem(panel.app, (q) => q.exec("insert into organization_limits (organization_id, monthly_spend_cap_cents) values ($1, 5000)", [b.org]));
    await withSystem(panel.app, (q) => q.exec("insert into organization_limits (organization_id, max_agents) values ($1, 3)", [a.org]));
    const data = await read(admin.cookie);
    expect([rowOf(data, a.org).spendCapCents, rowOf(data, b.org).spendCapCents]).toEqual([null, 5000]);
    expect(rowOf(data, b.org).cost.cents).toBe(8);
  });

  it("a line with a warning needs attention and is not counted as down; only a failing line is", async () => {
    const c = await organization("C", null);
    const d = await organization("D", null);
    const [cUp, cWarn, cDown, dUp, dWarn] = [await c.trunk(), await c.trunk(), await c.trunk(), await d.trunk(), await d.trunk()];
    panel.voice.respond = (url) => {
      if (url === "http://voice.test/health")
        return Response.json({
          asterisk: { status: "ok", detail: "connected" },
          trunks: [
            { id: cUp, status: "ok", detail: "The provider answers." },
            { id: cWarn, status: "warn", detail: "Not checked yet." },
            { id: cDown, status: "fail", detail: "The provider does not answer." },
            { id: dUp, status: "ok", detail: "The provider answers." },
            { id: dWarn, status: "warn", detail: "The address set needs attention." },
          ],
        });
      throw new Error(`unexpected request to ${url}`);
    };
    const admin = await createUser(panel.app, c.org, "admin");
    await administers(await accountOf(admin.id));
    const data = await read(admin.cookie);
    const [rowC, rowD] = [rowOf(data, c.org), rowOf(data, d.org)];
    expect([rowC.trunk?.connected, rowC.trunk?.attention, rowC.trunk?.down, rowC.trunk?.check.status]).toEqual([1, 1, 1, "fail"]);
    expect([rowD.trunk?.connected, rowD.trunk?.attention, rowD.trunk?.down, rowD.trunk?.check.status]).toEqual([1, 1, 0, "warn"]);
    // A cor é a da Saúde de cada uma.
    expect(rowC.trunk?.check).toEqual(await healthLine(c.person.cookie, "trunk"));
    expect(rowD.trunk?.check).toEqual(await healthLine(d.person.cookie, "trunk"));
  });

  it("an own key whose last test was inconclusive is 'own key' in the colour of the organization's health (warn)", async () => {
    const e = await organization("E", null);
    await e.setting("engine.openai-realtime.api_key", "cifrada", true);
    await e.setting("engine.openai-realtime.key_check", { result: "rate_limited", model: "gpt-realtime", checkedAt: "2026-03-19T10:00:00.000Z" }, false);
    const admin = await createUser(panel.app, e.org, "admin");
    await administers(await accountOf(admin.id));
    const row = rowOf(await read(admin.cookie), e.org);
    expect([row.engine.state, row.engine.check.status, row.engine.check.reason]).toEqual(["own_key", "warn", "engine_check_inconclusive"]);
    expect(row.engine.check).toEqual(await healthLine(e.person.cookie, "engine"));
  });

  it("calls the voice process once, and says it did not answer instead of zero lines down", async () => {
    const { a, b, admin } = await scene();
    const requests: string[] = [];
    panel.voice.respond = (url) => {
      requests.push(url);
      throw new Error("connect ECONNREFUSED");
    };
    const data = await read(admin.cookie);
    expect(requests).toEqual(["http://voice.test/health"]);
    expect(data.voiceAnswered).toBe(false);
    expect([rowOf(data, a.org).trunk, rowOf(data, b.org).trunk]).toEqual([null, null]);
    // O resto segue: o motor não depende do processo de voz.
    expect(rowOf(data, a.org).engine.state).toBe("key_failed");
  });

  it("a suspended organization shows up with its state and its numbers", async () => {
    const { b, admin } = await scene();
    await withSystem(panel.app, (q) => q.exec("update organizations set suspended_at = $2, suspended_reason = 'teste da fatia 6' where id = $1", [b.org, NOW]));
    const row = rowOf(await read(admin.cookie), b.org);
    expect(row.suspendedAt).toBe(NOW.toISOString());
    expect(row.cost.cents).toBe(8);
  });

  it("who does not administer the installation gets 403, and so does the installation's support session", async () => {
    const { a, b } = await scene();
    const operator = await createUser(panel.app, a.org, "operator");
    for (const cookie of [operator.cookie, b.person.cookie]) {
      const result = await call(overview, { cookie });
      expect([result.status, result.code]).toEqual([403, "forbidden"]);
    }

    // O acesso de suporte (seção 3.6): quem administra a instalação, `member` da organização de
    // casa, entra em B pela própria sessão, com `startSupportAccess`, como na tela.
    const home = await createOrganization(panel.app, "Casa do suporte");
    const supporter = await createUser(panel.app, home, "owner");
    const account = (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [supporter.id])))?.id ?? "";
    await administers(account);
    const sessionId = (await withSystem(panel.app, (q) => q.one<{ id: string }>("select id from sessions where user_id = $1", [supporter.id])))?.id ?? "";
    const started = await startSupportAccess(panel.app, { actorAccountId: account, sessionId, organizationId: b.org, reason: "Ajuda com a configuração", minutes: 60 }, NOW);
    if (!started.ok) throw new Error(`the support access did not start: ${started.reason}`);
    const result = await call(overview, { cookie: supporter.cookie });
    expect([result.status, result.code]).toEqual([403, "support_session_forbidden"]);
  });
});
