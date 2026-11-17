// O custo de cada agente na tela (fatia 4c do desenho de 13/11, seções 4.3 e 7; registro 0020): em
// Custos e na tela da chamada, cada linha do extrato fica com o agente do trecho dela, e os minutos
// de cada motor saem dos trechos. O total não muda.
import { recordEvent, withOrg } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { DELETE as deleteAgent } from "./agents/[id]/route";
import { POST as createAgent } from "./agents/route";
import { GET as getCall } from "./calls/[id]/route";
import { GET as costs } from "./system/costs/route";

const panel = startPanel();
afterAll(() => panel.close());

const at = (seconds: number): Date => new Date(NOW.getTime() - 3_600_000 + seconds * 1000);
const CENT = 1_000_000; // micro-centavos

interface Costs {
  totalCents: number;
  byDay: Array<{ day: string; costCents: number; billedSeconds: number }>;
  byAgent: Array<{ agentId: string | null; name: string | null; costCents: number; calls: number }>;
  byEngine: Array<{ engine: string; costCents: number; callSeconds: number }>;
}
interface CostByAgent {
  costCents: number;
  costByAgent: Array<{ agentId: string | null; name: string | null; costCents: number; unmeasuredCount: number; estimatedCount: number }>;
}

async function team(label: string) {
  const organizationId = await createOrganization(panel.app, label);
  const cookie = (await createUser(panel.app, organizationId, "owner")).cookie;
  const agent = async (name: string): Promise<string> => {
    const created = await call(createAgent, { method: "POST", cookie, body: { name, engine: "simulated" } });
    expect(created.status).toBe(200);
    return (created.data as { id: string }).id;
  };
  /** Uma ligação atendida por `agentId` com `engine`, do segundo `from` ao `to` (contados de uma hora antes de NOW). */
  const newCall = (agentId: string | null, engine: string, from: number, to: number): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $4, $5, 0) returning id",
      [organizationId, agentId, at(from), at(to), engine],
    );
  const line = (callId: string, agentId: string | null, engine: string, microcents: number, second: number): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into usage_ledger (organization_id, call_id, agent_id, engine, seconds, cost_cents, cost_microcents, at) values ($1, $2, $3, $4, 0, round($5::numeric / 1000000)::int, $5, $6) returning id",
      [organizationId, callId, agentId, engine, microcents, at(second)],
    );
  const handoff = (callId: string, from: string, to: string, second: number, engine?: string): Promise<void> =>
    withOrg(panel.app, organizationId, (q) =>
      recordEvent(q, callId, "agent_handoff", { from: { id: from, name: "x" }, to: { id: to, name: "y" }, ...(engine && { engine }), reason: "r", summary: "s" }, at(second)),
    );
  const readCosts = async (): Promise<Costs> => (await call(costs, { cookie })).data as Costs;
  const readCall = async (id: string): Promise<CostByAgent> => (await call(getCall, { cookie, params: { id } })).data as CostByAgent;
  return { organizationId, cookie, agent, newCall, line, handoff, readCosts, readCall };
}

// As consultas da tela de Custos antes da 4c, copiadas do `route.ts` de `520cb81`: sem passagem, a
// tela nova precisa dar o mesmo.
const ZONE = "cross join (select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone) z";
const BEFORE_BY_AGENT = `select c.agent_id as "agentId", a.name, coalesce(sum(l.cost_microcents), 0)::text as microcents, count(distinct l.call_id)::int as calls
   from usage_ledger l join calls c on c.id = l.call_id left join agents a on a.id = c.agent_id ${ZONE}
  where (l.at at time zone z.zone)::date between $1::date and $2::date group by 1, 2 order by 3 desc`;
const BEFORE_BY_ENGINE = `with scoped as (select l.engine, l.call_id, l.cost_microcents from usage_ledger l ${ZONE} where (l.at at time zone z.zone)::date between $1::date and $2::date),
      answered as (
        select c.engine, coalesce(sum(extract(epoch from (c.ended_at - c.answered_at))), 0)::int as seconds
          from calls c ${ZONE}
         where c.answered_at is not null and c.ended_at is not null and (c.ended_at at time zone z.zone)::date between $1::date and $2::date
         group by 1)
 select s.engine, coalesce(sum(s.cost_microcents), 0)::text as microcents, coalesce(a.seconds, 0)::int as seconds
   from scoped s left join answered a on a.engine = s.engine group by s.engine, a.seconds order by coalesce(sum(s.cost_microcents), 0) desc`;

async function before(organizationId: string, period: { from: string; to: string }) {
  return withOrg(panel.app, organizationId, async (q) => ({
    byAgent: (await q.many<{ agentId: string | null; name: string | null; microcents: string; calls: number }>(BEFORE_BY_AGENT, [period.from, period.to])).map((row) => ({
      agentId: row.agentId,
      name: row.name,
      costCents: Math.round(Number(row.microcents) / CENT),
      calls: row.calls,
    })),
    byEngine: (await q.many<{ engine: string; microcents: string; seconds: number }>(BEFORE_BY_ENGINE, [period.from, period.to])).map((row) => ({
      engine: row.engine,
      costCents: Math.round(Number(row.microcents) / CENT),
      callSeconds: row.seconds,
    })),
  }));
}
const shape = (costsRead: Costs) => ({
  byAgent: costsRead.byAgent.map(({ agentId, name, costCents, calls }) => ({ agentId, name, costCents, calls })),
  byEngine: costsRead.byEngine.map(({ engine, costCents, callSeconds }) => ({ engine, costCents, callSeconds })),
});

describe("Custos com passagem entre agentes", () => {
  it("A atende e passa para B, cada trecho custa 10 c: 10 c para cada um, o total continua 20 c, e os minutos saem dos trechos", async () => {
    const { agent, newCall, line, handoff, readCosts, readCall } = await team("cost-by-agent-basic");
    const recepcao = await agent("Recepção");
    const agenda = await agent("Agenda");
    // 300 s de ligação: 120 s da recepção no OpenAI, 180 s da agenda no Gemini.
    const callId = await newCall(recepcao, "openai-realtime", 0, 300);
    await handoff(callId, recepcao, agenda, 120, "gemini-live");
    await line(callId, recepcao, "openai-realtime", 10 * CENT, 110);
    await line(callId, agenda, "gemini-live", 10 * CENT, 290);

    const read = await readCosts();
    expect(read.totalCents).toBe(20);
    expect(read.byAgent).toEqual(
      expect.arrayContaining([
        { agentId: recepcao, name: "Recepção", costCents: 10, calls: 1, unmeasuredCount: 0, estimatedCount: 0 },
        { agentId: agenda, name: "Agenda", costCents: 10, calls: 1, unmeasuredCount: 0, estimatedCount: 0 },
      ]),
    );
    expect(read.byAgent).toHaveLength(2);
    expect(shape(read).byEngine).toEqual(
      expect.arrayContaining([
        { engine: "openai-realtime", costCents: 10, callSeconds: 120 },
        { engine: "gemini-live", costCents: 10, callSeconds: 180 },
      ]),
    );
    // Na tela da chamada, o custo de cada agente, na ordem em que gastou.
    expect((await readCall(callId)).costByAgent).toEqual([
      { agentId: recepcao, name: "Recepção", costCents: 10, unmeasuredCount: 0, estimatedCount: 0 },
      { agentId: agenda, name: "Agenda", costCents: 10, unmeasuredCount: 0, estimatedCount: 0 },
    ]);
  });

  it("três trechos, a volta ao primeiro motor inclusive: cada motor soma os trechos dele, e a classificação depois da ligação fica com quem atendeu", async () => {
    const { agent, newCall, line, handoff, readCosts, readCall } = await team("cost-by-agent-three");
    const recepcao = await agent("Recepção");
    const agenda = await agent("Agenda");
    const financeiro = await agent("Financeiro");
    const callId = await newCall(recepcao, "openai-realtime", 0, 400);
    await handoff(callId, recepcao, agenda, 100, "gemini-live");
    await handoff(callId, agenda, financeiro, 250, "openai-realtime");
    await line(callId, recepcao, "openai-realtime", 3 * CENT, 90);
    await line(callId, agenda, "gemini-live", 4 * CENT, 240);
    await line(callId, financeiro, "openai-realtime", 5 * CENT, 390);
    // A classificação depois da ligação não tem trecho: `agent_id` nulo, e fica com quem atendeu.
    await line(callId, null, "openai-realtime", 34_000, 500);

    const read = await readCosts();
    expect(read.totalCents).toBe(12);
    expect(read.byAgent).toEqual(
      expect.arrayContaining([
        { agentId: recepcao, name: "Recepção", costCents: 3, calls: 1, unmeasuredCount: 0, estimatedCount: 0 },
        { agentId: agenda, name: "Agenda", costCents: 4, calls: 1, unmeasuredCount: 0, estimatedCount: 0 },
        { agentId: financeiro, name: "Financeiro", costCents: 5, calls: 1, unmeasuredCount: 0, estimatedCount: 0 },
      ]),
    );
    // OpenAI: 100 s + 150 s; Gemini: 150 s. A soma é a duração da ligação.
    expect(shape(read).byEngine).toEqual(
      expect.arrayContaining([
        { engine: "openai-realtime", costCents: 8, callSeconds: 250 },
        { engine: "gemini-live", costCents: 4, callSeconds: 150 },
      ]),
    );
    expect((await readCall(callId)).costByAgent.map((row) => [row.name, row.costCents])).toEqual([
      ["Recepção", 3],
      ["Agenda", 4],
      ["Financeiro", 5],
    ]);
  });

  it("a ligação sem passagem dá o mesmo que a tela de antes, inclusive a linha antiga com agent_id nulo", async () => {
    const { organizationId, agent, newCall, line, readCosts, readCall } = await team("cost-by-agent-same");
    const recepcao = await agent("Recepção");
    const vendas = await agent("Vendas");
    const first = await newCall(recepcao, "openai-realtime", 0, 159);
    const second = await newCall(vendas, "gemini-live", 200, 261);
    const third = await newCall(recepcao, "gemini-live", 300, 330);
    // Linhas de antes da 4a: `agent_id` nulo, ficam com quem atendeu.
    await line(first, null, "openai-realtime", 12 * CENT, 100);
    await line(first, null, "openai-realtime", 34_000, 160);
    await line(second, vendas, "gemini-live", 7 * CENT + 600_000, 250);
    await line(third, recepcao, "gemini-live", 2 * CENT, 320);

    const read = await readCosts();
    const old = await before(organizationId, { from: "2026-01-31", to: "2026-03-01" });
    expect(shape(read)).toEqual(old);
    expect(read.totalCents).toBe(22);
    expect(read.byAgent).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: recepcao, costCents: 14, calls: 2 })]));
    // Com um agente só, a tela da chamada não muda: a lista tem um item, e a tela não a mostra.
    expect((await readCall(first)).costByAgent).toEqual([{ agentId: recepcao, name: "Recepção", costCents: 12, unmeasuredCount: 0, estimatedCount: 0 }]);
  });

  it("a passagem gravada antes da 4c, sem o motor no evento, deixa a ligação inteira no motor que atendeu, como antes", async () => {
    const { organizationId, agent, newCall, line, handoff, readCosts } = await team("cost-by-agent-untold");
    const recepcao = await agent("Recepção");
    const agenda = await agent("Agenda");
    const callId = await newCall(recepcao, "openai-realtime", 0, 300);
    await handoff(callId, recepcao, agenda, 120);
    await line(callId, recepcao, "openai-realtime", 10 * CENT, 110);
    await line(callId, agenda, "gemini-live", 10 * CENT, 290);

    const read = await readCosts();
    expect(read.byEngine.map(({ engine, callSeconds }) => ({ engine, callSeconds }))).toEqual(
      expect.arrayContaining([
        { engine: "openai-realtime", callSeconds: 300 },
        { engine: "gemini-live", callSeconds: 0 },
      ]),
    );
    expect(shape(read).byEngine).toEqual((await before(organizationId, { from: "2026-01-31", to: "2026-03-01" })).byEngine);
    expect(read.totalCents).toBe(20);
  });
});

describe("o agente apagado", () => {
  it("apagar o destino põe o trecho dele no agente que atendeu; apagar quem atendeu põe em Agente apagado; o total não muda", async () => {
    const { cookie, agent, newCall, line, handoff, readCosts, readCall } = await team("cost-by-agent-deleted");
    const recepcao = await agent("Recepção");
    const agenda = await agent("Agenda");
    const callId = await newCall(recepcao, "openai-realtime", 0, 300);
    await handoff(callId, recepcao, agenda, 120, "gemini-live");
    await line(callId, recepcao, "openai-realtime", 10 * CENT, 110);
    await line(callId, agenda, "gemini-live", 10 * CENT, 290);

    // O destino apagado: `on delete set null` deixa o `agent_id` da linha nulo, e ela volta para quem atendeu.
    expect((await call(deleteAgent, { method: "DELETE", cookie, params: { id: agenda } })).status).toBe(200);
    let read = await readCosts();
    expect(read.totalCents).toBe(20);
    expect(read.byAgent).toEqual([{ agentId: recepcao, name: "Recepção", costCents: 20, calls: 1, unmeasuredCount: 0, estimatedCount: 0 }]);
    expect((await readCall(callId)).costByAgent).toEqual([{ agentId: recepcao, name: "Recepção", costCents: 20, unmeasuredCount: 0, estimatedCount: 0 }]);
    // Os minutos de cada motor não dependem do agente: ficam como estavam.
    expect(read.byEngine.map(({ engine, callSeconds }) => [engine, callSeconds])).toEqual(expect.arrayContaining([["openai-realtime", 120], ["gemini-live", 180]]));

    // Quem atendeu também apagado: a ligação inteira fica em "Agente apagado".
    expect((await call(deleteAgent, { method: "DELETE", cookie, params: { id: recepcao } })).status).toBe(200);
    read = await readCosts();
    expect(read.totalCents).toBe(20);
    expect(read.byAgent).toEqual([{ agentId: null, name: null, costCents: 20, calls: 1, unmeasuredCount: 0, estimatedCount: 0 }]);
    expect((await readCall(callId)).costByAgent).toEqual([{ agentId: null, name: null, costCents: 20, unmeasuredCount: 0, estimatedCount: 0 }]);
  });

  it("apagar quem atendeu deixa o trecho do destino com o destino", async () => {
    const { cookie, agent, newCall, line, handoff, readCosts, readCall } = await team("cost-by-agent-deleted-first");
    const recepcao = await agent("Recepção");
    const agenda = await agent("Agenda");
    const callId = await newCall(recepcao, "openai-realtime", 0, 300);
    await handoff(callId, recepcao, agenda, 120, "gemini-live");
    await line(callId, recepcao, "openai-realtime", 10 * CENT, 110);
    await line(callId, agenda, "gemini-live", 10 * CENT, 290);
    expect((await call(deleteAgent, { method: "DELETE", cookie, params: { id: recepcao } })).status).toBe(200);
    const read = await readCosts();
    expect(read.totalCents).toBe(20);
    expect(read.byAgent).toEqual(
      expect.arrayContaining([
        { agentId: null, name: null, costCents: 10, calls: 1, unmeasuredCount: 0, estimatedCount: 0 },
        { agentId: agenda, name: "Agenda", costCents: 10, calls: 1, unmeasuredCount: 0, estimatedCount: 0 },
      ]),
    );
    expect((await readCall(callId)).costByAgent).toEqual([
      { agentId: null, name: null, costCents: 10, unmeasuredCount: 0, estimatedCount: 0 },
      { agentId: agenda, name: "Agenda", costCents: 10, unmeasuredCount: 0, estimatedCount: 0 },
    ]);
  });
});

describe("isolamento", () => {
  let x: Awaited<ReturnType<typeof team>>;
  let y: Awaited<ReturnType<typeof team>>;
  let callX: string;
  beforeAll(async () => {
    x = await team("cost-by-agent-x");
    y = await team("cost-by-agent-y");
    const recepcao = await x.agent("Recepção X");
    const agenda = await x.agent("Agenda X");
    callX = await x.newCall(recepcao, "openai-realtime", 0, 300);
    await x.handoff(callX, recepcao, agenda, 120, "gemini-live");
    await x.line(callX, recepcao, "openai-realtime", 10 * CENT, 110);
    await x.line(callX, agenda, "gemini-live", 10 * CENT, 290);
    const ownY = await y.agent("Recepção Y");
    const callY = await y.newCall(ownY, "simulated", 0, 60);
    await y.line(callY, ownY, "simulated", 3 * CENT, 50);
  });

  it("Custos da organização Y não mostra agente, trecho nem minuto da X", async () => {
    const read = await y.readCosts();
    expect(read.totalCents).toBe(3);
    expect(read.byAgent.map((row) => row.name)).toEqual(["Recepção Y"]);
    expect(read.byEngine.map((row) => [row.engine, row.callSeconds])).toEqual([["simulated", 60]]);
    expect((await x.readCosts()).totalCents).toBe(20);
  });

  it("a tela da chamada da X não existe para a Y, nem o custo por agente dela", async () => {
    const result = await call(getCall, { cookie: y.cookie, params: { id: callX } });
    expect([result.status, result.code]).toEqual([404, "not_found"]);
    expect(result.text).not.toContain("Agenda X");
    expect((await x.readCall(callX)).costByAgent).toHaveLength(2);
  });
});
