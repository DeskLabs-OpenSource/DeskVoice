// O custo estimado na tela e as marcas na lista de Chamadas (DESA-82, desenho na DESA-81). A linha
// do extrato com `cost_estimated = true` (fatia 7a) tem um valor que entra no total e no teto, e
// cada soma de `/costs` (o total, cada dia, cada agente e cada motor), o detalhe da chamada e cada
// linha da lista de Chamadas dizem quantas linhas assim têm (`estimatedCount`). A lista também diz
// quantas não têm custo medido (`unmeasuredCount`), para a ligação lida só por um modelo sem preço
// não aparecer como R$ 0,00.
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { POST as createAgent } from "./agents/route";
import { GET as getCall } from "./calls/[id]/route";
import { GET as listCalls } from "./calls/route";
import { GET as costs } from "./system/costs/route";

const panel = startPanel();
afterAll(() => panel.close());

const CENT = 1_000_000; // micro-centavos
const at = (seconds: number): Date => new Date(NOW.getTime() - 3_600_000 + seconds * 1000);
const TODAY = NOW.toISOString().slice(0, 10);

async function team(label: string) {
  const organizationId = await createOrganization(panel.app, label);
  const cookie = (await createUser(panel.app, organizationId, "owner")).cookie;
  const agentId = ((await call(createAgent, { method: "POST", cookie, body: { name: `Agente ${label}`, engine: "simulated" } })).data as { id: string }).id;
  const newCall = (): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $4, 'simulated', 0) returning id",
      [organizationId, agentId, at(0), at(60)],
    );
  const line = (callId: string, engine: string, microcents: number, cost: "measured" | "unmeasured" | "estimated"): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into usage_ledger (organization_id, call_id, engine, model, seconds, cost_cents, cost_microcents, cost_measured, cost_estimated, at) values ($1, $2, $3, $4, 0, round($5::numeric / 1000000)::int, $5, $6, $7, $8) returning id",
      [organizationId, callId, engine, engine.startsWith("brain:") ? "modelo" : null, microcents, cost !== "unmeasured", cost === "estimated", at(90)],
    );
  return { cookie, agentId, newCall, line };
}

interface Counts {
  costCents: number;
  unmeasuredCount: number;
  estimatedCount: number;
}
interface Costs {
  totalCents: number;
  unmeasuredCount: number;
  estimatedCount: number;
  byDay: Array<Counts & { day: string }>;
  byAgent: Array<Counts & { agentId: string | null }>;
  byEngine: Array<Counts & { engine: string }>;
}
type ListedCall = Counts & { id: string };

describe("custo estimado na tela", () => {
  it("sem linha estimada, toda soma conta zero: quem atualiza não vê diferença", async () => {
    const { cookie, agentId, newCall, line } = await team("custo sem estimativa");
    const callId = await newCall();
    await line(callId, "simulated", 12 * CENT, "measured");

    const read = (await call(costs, { cookie })).data as Costs;
    expect(read.estimatedCount).toBe(0);
    expect(read.byDay).toEqual([expect.objectContaining({ day: TODAY, estimatedCount: 0 })]);
    expect(read.byAgent).toEqual([expect.objectContaining({ agentId, estimatedCount: 0 })]);
    expect(read.byEngine).toEqual([expect.objectContaining({ engine: "simulated", estimatedCount: 0 })]);
    expect((await call(getCall, { cookie, params: { id: callId } })).data).toMatchObject({ estimatedCount: 0 });
  });

  it("a linha estimada conta no total, no dia, no agente, no motor e na chamada, e o valor dela entra na soma", async () => {
    const { cookie, agentId, newCall, line } = await team("custo estimado");
    const callId = await newCall();
    await line(callId, "simulated", 12 * CENT, "measured");
    await line(callId, "brain:openai", 30 * CENT, "estimated");

    const read = (await call(costs, { cookie })).data as Costs;
    // A estimativa entra no valor, ao contrário do não medido.
    expect(read.totalCents).toBe(42);
    expect(read.estimatedCount).toBe(1);
    expect(read.unmeasuredCount).toBe(0);
    expect(read.byDay).toEqual([expect.objectContaining({ day: TODAY, costCents: 42, estimatedCount: 1, unmeasuredCount: 0 })]);
    expect(read.byAgent).toEqual([expect.objectContaining({ agentId, costCents: 42, estimatedCount: 1 })]);
    expect(read.byEngine).toContainEqual(expect.objectContaining({ engine: "brain:openai", costCents: 30, estimatedCount: 1 }));
    expect(read.byEngine).toContainEqual(expect.objectContaining({ engine: "simulated", costCents: 12, estimatedCount: 0 }));

    const detail = (await call(getCall, { cookie, params: { id: callId } })).data as { estimatedCount: number; unmeasuredCount: number; costByAgent: Array<Counts & { agentId: string | null }> };
    expect(detail).toMatchObject({ estimatedCount: 1, unmeasuredCount: 0 });
    expect(detail.costByAgent).toEqual([expect.objectContaining({ agentId, costCents: 42, estimatedCount: 1, unmeasuredCount: 0 })]);
  });

  it("estimada e não medida na mesma soma: as duas contagens, cada uma a sua", async () => {
    const { cookie, newCall, line } = await team("custo estimado e nao medido");
    const callId = await newCall();
    await line(callId, "brain:openai", 30 * CENT, "estimated");
    await line(callId, "brain:openai", 0, "unmeasured");

    const read = (await call(costs, { cookie })).data as Costs;
    expect(read).toMatchObject({ totalCents: 30, estimatedCount: 1, unmeasuredCount: 1 });
    expect((await call(getCall, { cookie, params: { id: callId } })).data).toMatchObject({ estimatedCount: 1, unmeasuredCount: 1 });
  });
});

describe("marcas na lista de Chamadas", () => {
  it("cada ligação da lista diz quantas linhas do extrato dela não têm custo medido e quantas são estimadas", async () => {
    const { cookie, newCall, line } = await team("lista de chamadas");
    const soNaoMedida = await newCall();
    await line(soNaoMedida, "brain:openai", 0, "unmeasured");
    const estimada = await newCall();
    await line(estimada, "brain:openai", 30 * CENT, "estimated");
    const medida = await newCall();
    await line(medida, "simulated", 3 * CENT, "measured");
    const semExtrato = await newCall();

    const list = (await call(listCalls, { cookie })).data as ListedCall[];
    const byId = new Map(list.map((row) => [row.id, row]));
    expect(byId.get(soNaoMedida)).toMatchObject({ costCents: 0, unmeasuredCount: 1, estimatedCount: 0 });
    expect(byId.get(estimada)).toMatchObject({ unmeasuredCount: 0, estimatedCount: 1 });
    expect(byId.get(medida)).toMatchObject({ unmeasuredCount: 0, estimatedCount: 0 });
    // Sem linha nenhuma no extrato, as contagens são zero, e não nulas.
    expect(byId.get(semExtrato)).toMatchObject({ unmeasuredCount: 0, estimatedCount: 0 });
  });

  it("a linha do extrato de outra organização não conta na lista", async () => {
    const a = await team("lista org a");
    const b = await team("lista org b");
    const daA = await a.newCall();
    await a.line(daA, "brain:openai", 0, "unmeasured");
    await a.line(daA, "brain:openai", 30 * CENT, "estimated");
    const daB = await b.newCall();
    await b.line(daB, "simulated", 5 * CENT, "measured");

    const list = (await call(listCalls, { cookie: b.cookie })).data as ListedCall[];
    expect(list.map((row) => row.id)).toEqual([daB]);
    expect(list[0]).toMatchObject({ unmeasuredCount: 0, estimatedCount: 0 });
  });
});
