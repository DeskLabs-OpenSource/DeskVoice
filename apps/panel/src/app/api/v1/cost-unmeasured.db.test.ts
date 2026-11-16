// O custo não medido na tela (R4, fatia 4b; desenho do catálogo de cérebros, 3.5 e 3.6): a linha do
// extrato com `cost_measured = false` tem custo zero, e o zero não é grátis. `/costs` diz onde há
// linha assim (total, dia, agente e motor), e o detalhe da chamada diz se a dela tem.
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { POST as createAgent } from "./agents/route";
import { GET as getCall } from "./calls/[id]/route";
import { GET as costs } from "./system/costs/route";

const panel = startPanel();
afterAll(() => panel.close());

const CENT = 1_000_000; // micro-centavos
const at = (seconds: number): Date => new Date(NOW.getTime() - 3_600_000 + seconds * 1000);

async function team(label: string) {
  const organizationId = await createOrganization(panel.app, label);
  const cookie = (await createUser(panel.app, organizationId, "owner")).cookie;
  const created = await call(createAgent, { method: "POST", cookie, body: { name: `Agente ${label}`, engine: "simulated" } });
  const agentId = (created.data as { id: string }).id;
  const newCall = (): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $4, 'simulated', 0) returning id",
      [organizationId, agentId, at(0), at(60)],
    );
  const line = (callId: string, engine: string, microcents: number, measured: boolean, model: string | null = null): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into usage_ledger (organization_id, call_id, engine, model, seconds, cost_cents, cost_microcents, cost_measured, at) values ($1, $2, $3, $4, 0, round($5::numeric / 1000000)::int, $5, $6, $7) returning id",
      [organizationId, callId, engine, model, microcents, measured, at(90)],
    );
  return { organizationId, cookie, agentId, newCall, line };
}

interface Costs {
  totalCents: number;
  byEngine: Array<{ engine: string; costCents: number }>;
  unmeasured: { calls: number; days: string[]; agentIds: Array<string | null>; engines: string[] };
}

describe("custo não medido na tela", () => {
  it("sem linha não medida, nada marcado: quem atualiza não vê diferença", async () => {
    const { cookie, newCall, line } = await team("custo todo medido");
    const callId = await newCall();
    await line(callId, "simulated", 12 * CENT, true);

    const read = (await call(costs, { cookie })).data as Costs;
    expect(read.totalCents).toBe(12);
    expect(read.unmeasured).toEqual({ calls: 0, days: [], agentIds: [], engines: [] });
    expect((await call(getCall, { cookie, params: { id: callId } })).data).toMatchObject({ costUnmeasured: false });
  });

  it("a linha não medida marca o total, o dia, o agente e o motor dela, e a chamada", async () => {
    const { cookie, agentId, newCall, line } = await team("custo nao medido");
    // A voz medida e a leitura por um modelo sem preço, na mesma ligação.
    const lida = await newCall();
    await line(lida, "simulated", 12 * CENT, true);
    await line(lida, "brain:openai", 0, false, "modelo-sem-preco");
    // Outra ligação, toda medida.
    const medida = await newCall();
    await line(medida, "simulated", 3 * CENT, true);

    const read = (await call(costs, { cookie })).data as Costs;
    // O total não muda: o não medido não entra como zero medido, ele é marcado ao lado.
    expect(read.totalCents).toBe(15);
    expect(read.unmeasured).toEqual({ calls: 1, days: [NOW.toISOString().slice(0, 10)], agentIds: [agentId], engines: ["brain:openai"] });
    expect(read.byEngine).toContainEqual(expect.objectContaining({ engine: "brain:openai", costCents: 0 }));

    expect((await call(getCall, { cookie, params: { id: lida } })).data).toMatchObject({ costUnmeasured: true });
    expect((await call(getCall, { cookie, params: { id: medida } })).data).toMatchObject({ costUnmeasured: false });
  });

  it("fora do período, a linha não medida não marca nada", async () => {
    const { cookie, newCall, line } = await team("custo nao medido fora do periodo");
    await line(await newCall(), "brain:openai", 0, false, "modelo-sem-preco");
    const read = (await call(costs, { cookie, query: "?from=2020-01-01&to=2020-01-31" })).data as Costs;
    expect(read.unmeasured).toEqual({ calls: 0, days: [], agentIds: [], engines: [] });
  });

  it("a linha não medida de outra organização não aparece aqui", async () => {
    const a = await team("custo nao medido org a");
    const b = await team("custo nao medido org b");
    await a.line(await a.newCall(), "brain:openai", 0, false, "modelo-sem-preco");
    await b.line(await b.newCall(), "simulated", 5 * CENT, true);
    const read = (await call(costs, { cookie: b.cookie })).data as Costs;
    expect(read.unmeasured.calls).toBe(0);
  });
});
