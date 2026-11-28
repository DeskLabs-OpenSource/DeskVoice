// O custo por peça do pipeline (fatia 5c, docs/specs/2026-11-17-motor-de-voz-em-pipeline.md): o detalhe da
// chamada diz quanto custou a transcrição, o cérebro e a voz, e Custos soma o mesmo por peça. A linha sem
// custo medido, e a peça sem linha nenhuma, nunca aparecem como zero. A chamada do motor direto não muda:
// a classificação do desfecho pelo cérebro (R4) grava `brain:<id>` sem agente, em qualquer chamada, e fica
// de fora das peças.
import { withSystem } from "@deskvoice/core";
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
  const agentId = ((await call(createAgent, { method: "POST", cookie, body: { name: `Agente ${label}`, engine: "simulated" } })).data as { id: string }).id;
  const newCall = (engine: string): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into calls (organization_id, agent_id, direction, channel, status, started_at, answered_at, ended_at, engine, cost_cents) values ($1, $2, 'inbound', 'phone', 'completed', $3, $3, $4, $5, 0) returning id",
      [organizationId, agentId, at(0), at(60), engine],
    );
  /** Uma linha do extrato. `agent: false` é a linha sem trecho, como a da classificação do desfecho. */
  const line = (callId: string, engine: string, microcents: number, options: { measured?: boolean; estimated?: boolean; model?: string; agent?: boolean; when?: number } = {}): Promise<string> =>
    insert(
      panel.app,
      organizationId,
      "insert into usage_ledger (organization_id, call_id, agent_id, engine, model, seconds, cost_cents, cost_microcents, cost_measured, cost_estimated, at) values ($1, $2, $3, $4, $5, 0, round($6::numeric / 1000000)::int, $6, $7, $8, $9) returning id",
      [organizationId, callId, options.agent === false ? null : agentId, engine, options.model ?? null, microcents, options.measured ?? true, options.estimated ?? false, at(options.when ?? 90)],
    );
  return { organizationId, cookie, agentId, newCall, line };
}

interface PieceRow {
  piece: string;
  id: string | null;
  label: string | null;
  model: string | null;
  costCents: number;
  lines: number;
  unmeasuredCount: number;
  estimatedCount: number;
}
interface EngineRow {
  engine: string;
  source: string | null;
  piece: string | null;
  label: string;
  costCents: number;
  unmeasuredCount: number;
  estimatedCount: number;
  priceCheckedOn: string | null;
}

describe("o custo por peça do pipeline (fatia 5c)", () => {
  it("o detalhe: cada peça com o custo dela, na ordem da fala; a linha não medida e a estimada marcadas; a classificação fora das peças", async () => {
    const { cookie, newCall, line } = await team("peca detalhe");
    const callId = await newCall("pipeline");
    await line(callId, "transcriber:simulated", 2 * CENT, { when: 91 });
    await line(callId, "brain:openai", 5 * CENT, { model: "gpt-5-nano", when: 92 });
    // O pedido cancelado no fim (estimado) e o modelo sem preço (não medido), no mesmo cérebro.
    await line(callId, "brain:openai", 1 * CENT, { model: "gpt-5-nano", estimated: true, when: 93 });
    await line(callId, "synthesizer:elevenlabs", 0, { measured: false, model: "eleven_flash_v2_5", when: 94 });
    // A classificação do desfecho pelo cérebro, depois da ligação e sem agente.
    await line(callId, "brain:openai", 3 * CENT, { model: "gpt-5-mini", agent: false, when: 200 });

    const detail = (await call(getCall, { cookie, params: { id: callId } })).data as { costByPiece: PieceRow[]; unmeasuredCount: number; estimatedCount: number };
    expect(detail.costByPiece).toEqual([
      { piece: "transcriber", id: "simulated", label: "Transcritor simulado (sem chave)", model: null, costCents: 2, lines: 1, unmeasuredCount: 0, estimatedCount: 0 },
      { piece: "brain", id: "openai", label: "OpenAI", model: "gpt-5-nano", costCents: 6, lines: 2, unmeasuredCount: 0, estimatedCount: 1 },
      { piece: "synthesizer", id: "elevenlabs", label: expect.stringContaining("ElevenLabs"), model: "eleven_flash_v2_5", costCents: 0, lines: 1, unmeasuredCount: 1, estimatedCount: 0 },
    ]);
    // O total da chamada continua o extrato inteiro, com a classificação.
    expect(detail).toMatchObject({ unmeasuredCount: 1, estimatedCount: 1 });
  });

  it("a peça sem linha nenhuma no extrato vem com `lines: 0`, sem id, e não some da lista", async () => {
    const { cookie, newCall, line } = await team("peca sem linha");
    const callId = await newCall("pipeline");
    await line(callId, "transcriber:simulated", 2 * CENT);
    await line(callId, "brain:openai", 5 * CENT, { model: "gpt-5-nano" });
    const detail = (await call(getCall, { cookie, params: { id: callId } })).data as { costByPiece: PieceRow[] };
    expect(detail.costByPiece.map((row) => [row.piece, row.id, row.lines])).toEqual([
      ["transcriber", "simulated", 1],
      ["brain", "openai", 1],
      ["synthesizer", null, 0],
    ]);
  });

  it("a chamada do motor direto não ganha lista de peças, mesmo com a classificação pelo cérebro no extrato", async () => {
    const { cookie, newCall, line } = await team("peca motor direto");
    const callId = await newCall("gemini-live");
    await line(callId, "gemini-live", 7 * CENT);
    await line(callId, "brain:openai", 3 * CENT, { model: "gpt-5-mini", agent: false, when: 200 });
    const detail = (await call(getCall, { cookie, params: { id: callId } })).data as { costByPiece: PieceRow[] };
    expect(detail.costByPiece).toEqual([]);
  });

  it("a chamada passada a um agente no pipeline ganha a lista, pela passagem", async () => {
    const { organizationId, cookie, newCall, line } = await team("peca passagem");
    const callId = await newCall("gemini-live");
    await line(callId, "gemini-live", 7 * CENT);
    await withSystem(panel.app, (q) =>
      q.exec("insert into call_events (organization_id, call_id, at, kind, payload) values ($1, $2, $3, 'agent_handoff', $4)", [organizationId, callId, at(30), JSON.stringify({ engine: "pipeline" })]),
    );
    await line(callId, "brain:openai", 5 * CENT, { model: "gpt-5-nano" });
    const detail = (await call(getCall, { cookie, params: { id: callId } })).data as { costByPiece: PieceRow[] };
    expect(detail.costByPiece.map((row) => [row.piece, row.id, row.costCents])).toEqual([
      ["transcriber", null, 0],
      ["brain", "openai", 5],
      ["synthesizer", null, 0],
    ]);
  });

  it("Custos soma o mesmo por peça, com o nome dela, e a classificação pelo cérebro sai à parte, como sempre", async () => {
    const { cookie, newCall, line } = await team("peca custos");
    const first = await newCall("pipeline");
    await line(first, "transcriber:simulated", 2 * CENT);
    await line(first, "brain:openai", 5 * CENT, { model: "gpt-5-nano" });
    await line(first, "synthesizer:elevenlabs", 0, { measured: false });
    await line(first, "brain:openai", 3 * CENT, { model: "gpt-5-mini", agent: false, when: 200 });
    const second = await newCall("pipeline");
    await line(second, "brain:openai", 4 * CENT, { model: "gpt-5-nano", estimated: true });
    await line(second, "synthesizer:elevenlabs", 1 * CENT);

    const read = (await call(costs, { cookie })).data as { byEngine: EngineRow[] };
    const byKey = new Map(read.byEngine.map((row) => [`${row.engine}|${row.piece ?? ""}`, row]));
    expect(byKey.get("transcriber:simulated|transcriber")).toMatchObject({ label: "Transcritor simulado (sem chave)", costCents: 2, unmeasuredCount: 0, estimatedCount: 0, priceCheckedOn: null });
    expect(byKey.get("brain:openai|brain")).toMatchObject({ label: "OpenAI", costCents: 9, unmeasuredCount: 0, estimatedCount: 1 });
    expect(byKey.get("synthesizer:elevenlabs|synthesizer")).toMatchObject({ costCents: 1, unmeasuredCount: 1 });
    // A classificação: a mesma linha de antes da 5c, sem peça e com o rótulo cru.
    expect(byKey.get("brain:openai|")).toMatchObject({ source: null, piece: null, label: "brain:openai", costCents: 3 });
    expect(read.byEngine).toHaveLength(4);
  });

  it("Custos sem peça nenhuma: as linhas dos motores diretos são as de sempre, só com `piece: null`", async () => {
    const { cookie, newCall, line } = await team("peca custos direto");
    const callId = await newCall("simulated");
    await line(callId, "simulated", 12 * CENT);
    const read = (await call(costs, { cookie })).data as { byEngine: EngineRow[] };
    expect(read.byEngine).toEqual([expect.objectContaining({ engine: "simulated", source: null, piece: null, costCents: 12 })]);
  });
});
