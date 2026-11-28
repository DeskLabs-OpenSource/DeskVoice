// A latência do pipeline ao lado da escolha (fatia 5c, docs/specs/2026-11-17-motor-de-voz-em-pipeline.md,
// seção 3.5): a mediana do `pipeline_turn_latency` das últimas ligações do agente, com o turno com
// ferramenta à parte. Sem turno medido, nada: a tela diz "sem medida ainda".
import { withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../../test/kit";
import { GET as latencyOf } from "./[id]/pipeline-latency/route";
import { POST as createAgent } from "./route";

const panel = startPanel();
afterAll(() => panel.close());

async function team(label: string) {
  const organizationId = await createOrganization(panel.app, label);
  const cookie = (await createUser(panel.app, organizationId, "owner")).cookie;
  const newAgent = async (name: string): Promise<string> => ((await call(createAgent, { method: "POST", cookie, body: { name, engine: "simulated" } })).data as { id: string }).id;
  let minute = 0;
  /** Uma ligação do agente, com um evento de latência por turno; cada ligação nova é mais recente que a anterior. */
  const callWith = async (agentId: string, turns: Array<Record<string, unknown>>): Promise<string> => {
    minute += 1;
    const startedAt = new Date(NOW.getTime() - 86_400_000 + minute * 60_000);
    const callId = await insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $3, 'pipeline', 0) returning id",
      [organizationId, agentId, startedAt],
    );
    await withSystem(panel.app, async (q) => {
      for (const [n, payload] of turns.entries()) {
        await q.exec("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, 'pipeline_turn_latency', $4)", [
          organizationId,
          callId,
          new Date(startedAt.getTime() + (n + 1) * 1000),
          JSON.stringify(payload),
        ]);
      }
    });
    return callId;
  };
  return { cookie, newAgent, callWith };
}

const turn = (totalMs: unknown, extra: Record<string, unknown> = {}) => ({ endpointMs: 100, brainFirstTextMs: 200, voiceFirstAudioMs: 100, totalMs, endFromArrival: false, tool: false, ...extra });

describe("a latência do pipeline do agente (fatia 5c)", () => {
  it("sem ligação medida: os dois grupos nulos, e a meta", async () => {
    const { cookie, newAgent } = await team("latencia vazia");
    const agentId = await newAgent("Sem ligação");
    expect((await call(latencyOf, { cookie, params: { id: agentId } })).data).toEqual({ recentCalls: 20, goalP50Ms: 1200, withoutTool: null, withTool: null });
  });

  it("a mediana dos turnos sem ferramenta, e a dos com ferramenta à parte", async () => {
    const { cookie, newAgent, callWith } = await team("latencia mediana");
    const agentId = await newAgent("Recepção");
    await callWith(agentId, [turn(1000), turn(2000)]);
    await callWith(agentId, [turn(1400), turn(9000, { tool: true }), turn(7000, { tool: true })]);
    expect((await call(latencyOf, { cookie, params: { id: agentId } })).data).toMatchObject({
      withoutTool: { turns: 3, calls: 2, p50Ms: 1400 },
      withTool: { turns: 2, calls: 1, p50Ms: 8000 },
    });
  });

  it("o turno é do agente que respondeu: depois de uma passagem, pelo `agentId` do evento", async () => {
    const { cookie, newAgent, callWith } = await team("latencia passagem");
    const first = await newAgent("Recepção");
    const second = await newAgent("Financeiro");
    // A ligação atendida pela recepção e passada ao financeiro: o segundo turno é dele.
    await callWith(first, [turn(1000), turn(3000, { agentId: second })]);
    expect((await call(latencyOf, { cookie, params: { id: first } })).data).toMatchObject({ withoutTool: { turns: 1, p50Ms: 1000 }, withTool: null });
    expect((await call(latencyOf, { cookie, params: { id: second } })).data).toMatchObject({ withoutTool: { turns: 1, p50Ms: 3000 }, withTool: null });
  });

  it("só as últimas 20 ligações entram, e o evento sem número não conta", async () => {
    const { cookie, newAgent, callWith } = await team("latencia recentes");
    const agentId = await newAgent("Recepção");
    // A mais antiga, lenta, fica de fora: entram as 20 seguintes, todas em 1 s.
    await callWith(agentId, [turn(60_000), turn(60_000), turn(60_000)]);
    for (let n = 0; n < 20; n++) await callWith(agentId, [turn(1000), turn("rápido")]);
    expect((await call(latencyOf, { cookie, params: { id: agentId } })).data).toMatchObject({ withoutTool: { turns: 20, calls: 20, p50Ms: 1000 } });
  });

  it("agente que não existe: 404", async () => {
    const { cookie } = await team("latencia 404");
    expect((await call(latencyOf, { cookie, params: { id: "0c000000-0000-4000-8000-0000000000ff" } })).status).toBe(404);
  });
});
