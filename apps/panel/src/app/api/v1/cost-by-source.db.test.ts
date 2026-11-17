// O custo do analista ao vivo na tela de Custos (desenho R6, fatia 4): o filtro da fala e o analista
// gravam o mesmo modelo de decisão em `engine` (`jev`), e só o `source` os separa. Sem a separação, o
// custo do analista "não apareceria", que é o segundo fracasso da seção 1 do desenho.
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, insert, startPanel } from "../../../../test/kit";
import { POST as createAgent } from "./agents/route";
import { GET as costs } from "./system/costs/route";

const panel = startPanel();
afterAll(() => panel.close());

const CENT = 1_000_000; // micro-centavos
const at = (seconds: number): Date => new Date(NOW.getTime() - 3_600_000 + seconds * 1000);

interface EngineRow {
  engine: string;
  source: "analyst" | null;
  label: string;
  costCents: number;
  callSeconds: number;
  estimatedCount: number;
}

describe("Custos separa o analista pelo source", () => {
  it("o mesmo modelo no filtro e no analista vira duas linhas, com o nome do modelo, e o analista sem minutos", async () => {
    const organizationId = await createOrganization(panel.app, "custo do analista");
    const cookie = (await createUser(panel.app, organizationId, "owner")).cookie;
    const agentId = ((await call(createAgent, { method: "POST", cookie, body: { name: "Recepção", engine: "simulated" } })).data as { id: string }).id;
    const callId = await insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $4, 'simulated', 0) returning id",
      [organizationId, agentId, at(0), at(120)],
    );
    const line = (engine: string, microcents: number, source: string | null, estimated = false): Promise<string> =>
      insert(
        panel.app,
        organizationId,
        "insert into usage_ledger (organization_id, call_id, agent_id, engine, seconds, cost_cents, cost_microcents, cost_estimated, source, at) values ($1, $2, $3, $4, 0, round($5::numeric / 1000000)::int, $5, $6, $7, $8) returning id",
        [organizationId, callId, agentId, engine, microcents, estimated, source, at(60)],
      );
    await line("simulated", 10 * CENT, null);
    await line("jev", 3 * CENT, null);
    await line("jev", 5 * CENT, "analyst");
    await line("jev", 2 * CENT, "analyst", true);

    const read = (await call(costs, { cookie })).data as { totalCents: number; byEngine: EngineRow[] };
    expect(read.totalCents).toBe(20);
    const rows = read.byEngine.map(({ engine, source, label, costCents, callSeconds, estimatedCount }) => ({ engine, source, label, costCents, callSeconds, estimatedCount }));
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { engine: "simulated", source: null, label: expect.any(String), costCents: 10, callSeconds: 120, estimatedCount: 0 },
        { engine: "jev", source: null, label: "Jev (TypeSafe)", costCents: 3, callSeconds: 0, estimatedCount: 0 },
        // A estimativa do analista (pedido atrasado) entra no valor e é contada, como a do filtro.
        { engine: "jev", source: "analyst", label: "Jev (TypeSafe)", costCents: 7, callSeconds: 0, estimatedCount: 1 },
      ]),
    );
  });
});
