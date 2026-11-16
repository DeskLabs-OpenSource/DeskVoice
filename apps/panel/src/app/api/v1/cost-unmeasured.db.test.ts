// O custo não medido na tela (R4, fatia 4b; desenho do catálogo de cérebros, 3.5 e 3.6): a linha do
// extrato com `cost_measured = false` tem custo zero, e o zero não é grátis. Cada soma de `/costs`
// (o total, cada dia, cada agente e cada motor) e o total da chamada dizem quantas linhas assim têm
// (`unmeasuredCount`), com o mesmo dia e o mesmo agente por linha da soma.
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { POST as createAgent } from "./agents/route";
import { GET as getCall } from "./calls/[id]/route";
import { GET as costs } from "./system/costs/route";

const panel = startPanel();
afterAll(() => panel.close());

const CENT = 1_000_000; // micro-centavos
const at = (seconds: number): Date => new Date(NOW.getTime() - 3_600_000 + seconds * 1000);
const TODAY = NOW.toISOString().slice(0, 10);

async function team(label: string) {
  const organizationId = await createOrganization(panel.app, label);
  const cookie = (await createUser(panel.app, organizationId, "owner")).cookie;
  const newAgent = async (name: string): Promise<string> =>
    ((await call(createAgent, { method: "POST", cookie, body: { name, engine: "simulated" } })).data as { id: string }).id;
  const agentId = await newAgent(`Agente ${label}`);
  const newCall = (): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $4, 'simulated', 0) returning id",
      [organizationId, agentId, at(0), at(60)],
    );
  const line = (
    callId: string,
    engine: string,
    microcents: number,
    measured: boolean,
    options: { model?: string; when?: Date; agentId?: string } = {},
  ): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into usage_ledger (organization_id, call_id, agent_id, engine, model, seconds, cost_cents, cost_microcents, cost_measured, at) values ($1, $2, $3, $4, $5, 0, round($6::numeric / 1000000)::int, $6, $7, $8) returning id",
      [organizationId, callId, options.agentId ?? null, engine, options.model ?? null, microcents, measured, options.when ?? at(90)],
    );
  return { organizationId, cookie, agentId, newAgent, newCall, line };
}

interface Costs {
  totalCents: number;
  unmeasuredCount: number;
  byDay: Array<{ day: string; costCents: number; unmeasuredCount: number }>;
  byAgent: Array<{ agentId: string | null; costCents: number; unmeasuredCount: number }>;
  byEngine: Array<{ engine: string; costCents: number; unmeasuredCount: number }>;
}

describe("custo não medido na tela", () => {
  it("sem linha não medida, toda soma conta zero: quem atualiza não vê diferença", async () => {
    const { cookie, agentId, newCall, line } = await team("custo todo medido");
    const callId = await newCall();
    await line(callId, "simulated", 12 * CENT, true);

    const read = (await call(costs, { cookie })).data as Costs;
    expect(read.totalCents).toBe(12);
    expect(read.unmeasuredCount).toBe(0);
    expect(read.byDay).toEqual([expect.objectContaining({ day: TODAY, costCents: 12, unmeasuredCount: 0 })]);
    expect(read.byAgent).toEqual([expect.objectContaining({ agentId, costCents: 12, unmeasuredCount: 0 })]);
    expect(read.byEngine).toEqual([expect.objectContaining({ engine: "simulated", costCents: 12, unmeasuredCount: 0 })]);
    expect((await call(getCall, { cookie, params: { id: callId } })).data).toMatchObject({ costCents: 0, unmeasuredCount: 0 });
  });

  it("uma linha medida e uma não medida: a soma da medida e a contagem da não medida, em cada soma e na chamada", async () => {
    const { cookie, agentId, newCall, line } = await team("custo nao medido");
    // A voz medida e duas leituras por um modelo sem preço, na mesma ligação.
    const lida = await newCall();
    await line(lida, "simulated", 12 * CENT, true);
    await line(lida, "brain:openai", 0, false, { model: "modelo-sem-preco" });
    await line(lida, "brain:openai", 0, false, { model: "modelo-sem-preco" });
    // Outra ligação, toda medida.
    const medida = await newCall();
    await line(medida, "simulated", 3 * CENT, true);

    const read = (await call(costs, { cookie })).data as Costs;
    // O total não muda: o não medido não entra como zero medido, ele é contado ao lado.
    expect(read.totalCents).toBe(15);
    expect(read.unmeasuredCount).toBe(2);
    expect(read.byDay).toEqual([expect.objectContaining({ day: TODAY, costCents: 15, unmeasuredCount: 2 })]);
    expect(read.byAgent).toEqual([expect.objectContaining({ agentId, costCents: 15, unmeasuredCount: 2 })]);
    expect(read.byEngine).toContainEqual(expect.objectContaining({ engine: "brain:openai", costCents: 0, unmeasuredCount: 2 }));
    expect(read.byEngine).toContainEqual(expect.objectContaining({ engine: "simulated", costCents: 15, unmeasuredCount: 0 }));

    expect((await call(getCall, { cookie, params: { id: lida } })).data).toMatchObject({ unmeasuredCount: 2 });
    expect((await call(getCall, { cookie, params: { id: medida } })).data).toMatchObject({ unmeasuredCount: 0 });
  });

  it("o dia da linha não medida é o do fuso da organização, como o da soma", async () => {
    const { cookie, newCall, line } = await team("custo nao medido meia-noite");
    // 02:00 em UTC do dia 1º é 23:00 do dia anterior em São Paulo (o fuso padrão).
    const callId = await newCall();
    await line(callId, "brain:openai", 0, false, { model: "modelo-sem-preco", when: new Date("2026-03-01T02:00:00.000Z") });
    await line(callId, "simulated", 4 * CENT, true, { when: new Date("2026-03-01T12:00:00.000Z") });

    const read = (await call(costs, { cookie, query: "?from=2026-02-28&to=2026-03-01" })).data as Costs;
    expect(read.byDay).toEqual([
      expect.objectContaining({ day: "2026-02-28", costCents: 0, unmeasuredCount: 1 }),
      expect.objectContaining({ day: "2026-03-01", costCents: 4, unmeasuredCount: 0 }),
    ]);
  });

  it("o total conta as linhas não medidas de todos os dias, e não só as de um", async () => {
    const { cookie, newCall, line } = await team("custo nao medido dois dias");
    const callId = await newCall();
    await line(callId, "simulated", 4 * CENT, true, { when: new Date("2026-02-28T12:00:00.000Z") });
    await line(callId, "brain:openai", 0, false, { model: "modelo-sem-preco", when: new Date("2026-02-28T13:00:00.000Z") });
    await line(callId, "brain:openai", 0, false, { model: "modelo-sem-preco", when: new Date("2026-03-01T12:00:00.000Z") });
    await line(callId, "brain:openai", 0, false, { model: "modelo-sem-preco", when: new Date("2026-03-01T13:00:00.000Z") });

    const read = (await call(costs, { cookie, query: "?from=2026-02-28&to=2026-03-01" })).data as Costs;
    expect(read.byDay).toEqual([
      expect.objectContaining({ day: "2026-02-28", unmeasuredCount: 1 }),
      expect.objectContaining({ day: "2026-03-01", unmeasuredCount: 2 }),
    ]);
    expect(read.unmeasuredCount).toBe(3);
  });

  it("numa ligação com passagem, a linha não medida conta no agente do trecho dela", async () => {
    const { cookie, agentId, newAgent, newCall, line } = await team("custo nao medido passagem");
    const destino = await newAgent("Agente de destino");
    const callId = await newCall();
    await line(callId, "simulated", 5 * CENT, true, { agentId });
    await line(callId, "brain:openai", 0, false, { model: "modelo-sem-preco", agentId: destino });

    const read = (await call(costs, { cookie })).data as Costs;
    expect(read.byAgent).toContainEqual(expect.objectContaining({ agentId, costCents: 5, unmeasuredCount: 0 }));
    expect(read.byAgent).toContainEqual(expect.objectContaining({ agentId: destino, costCents: 0, unmeasuredCount: 1 }));
  });

  it("fora do período, a linha não medida não conta", async () => {
    const { cookie, newCall, line } = await team("custo nao medido fora do periodo");
    await line(await newCall(), "brain:openai", 0, false, { model: "modelo-sem-preco" });
    const read = (await call(costs, { cookie, query: "?from=2020-01-01&to=2020-01-31" })).data as Costs;
    expect(read.unmeasuredCount).toBe(0);
  });

  it("a linha não medida de outra organização não aparece aqui", async () => {
    const a = await team("custo nao medido org a");
    const b = await team("custo nao medido org b");
    await a.line(await a.newCall(), "brain:openai", 0, false, { model: "modelo-sem-preco" });
    await b.line(await b.newCall(), "simulated", 5 * CENT, true);
    const read = (await call(costs, { cookie: b.cookie })).data as Costs;
    expect(read.unmeasuredCount).toBe(0);
    expect(read.byEngine.every((row) => row.unmeasuredCount === 0)).toBe(true);
  });
});
