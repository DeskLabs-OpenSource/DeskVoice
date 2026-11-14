import { RUBRIC, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as detail } from "./calls/[id]/route";
import { GET as list } from "./calls/route";

/** A análise que chega à tela: a nota na lista, a análise lida com o schema de `core` no detalhe. */
const panel = startPanel();
afterAll(() => panel.close());

const FULL = {
  rubricVersion: 1,
  model: "gemini-2.5-flash",
  criteria: RUBRIC.map((criterion, index) => ({ id: criterion.id, status: index === 4 ? "partial" : "met", evidence: index === 0 ? "Aqui é a Ana, da clínica" : "" })),
  temperature: { start: "cold", middle: "warm", end: "hot" },
  objections: [{ objection: "Preço", quote: "está caro para mim agora", response: "Explicou o parcelamento", handled: "addressed" }],
  strengths: ["Ouviu antes de oferecer"],
  weaknesses: [],
  nextStep: "Retornar na segunda",
  droppedObjections: 0,
};
const PURGED = {
  rubricVersion: 1,
  model: "gemini-2.5-flash",
  criteria: FULL.criteria.map(({ id, status }) => ({ id, status })),
  temperature: FULL.temperature,
  objectionCount: 1,
  purged: true,
};

async function setAnalysis(callId: string, analysis: unknown, score: number | null, erased = false): Promise<void> {
  await withSystem(panel.app, (q) =>
    q.exec("update calls set analysis = $2::jsonb, analysis_score = $3, analyzed_at = $4, erased_at = $5 where id = $1", [callId, analysis === null ? null : JSON.stringify(analysis), score, NOW, erased ? NOW : null]),
  );
}

describe("call analysis in the panel API", () => {
  it("lists the score, or null with no analysis, and the detail returns the analysis as stored", async () => {
    const organizationId = await createOrganization(panel.app, "analysis-full");
    const { cookie } = await createUser(panel.app, organizationId, "operator");
    const analyzed = await createCall(panel.app, organizationId, NOW);
    const plain = await createCall(panel.app, organizationId, NOW);
    await setAnalysis(analyzed, FULL, 9);

    const rows = (await call(list, { cookie })).data as Array<{ id: string; analysisScore: number | null }>;
    expect(rows.find((row) => row.id === analyzed)?.analysisScore).toBe(9);
    expect(rows.find((row) => row.id === plain)?.analysisScore).toBeNull();

    const shown = await call(detail, { cookie, params: { id: analyzed } });
    expect(shown.status).toBe(200);
    expect(shown.data).toMatchObject({ analysisScore: 9, analysis: FULL, analysisUnreadable: false, erased: false });

    expect((await call(detail, { cookie, params: { id: plain } })).data).toMatchObject({ analysis: null, analysisUnreadable: false, analysisScore: null });
  });

  it("returns the purged form without any text, and says when the holder asked for the erasure", async () => {
    const organizationId = await createOrganization(panel.app, "analysis-purged");
    const { cookie } = await createUser(panel.app, organizationId, "operator");
    const purged = await createCall(panel.app, organizationId, NOW);
    const erased = await createCall(panel.app, organizationId, NOW);
    await setAnalysis(purged, PURGED, 9);
    await setAnalysis(erased, PURGED, 9, true);

    const fromPurged = await call(detail, { cookie, params: { id: purged } });
    expect(fromPurged.data).toMatchObject({ analysis: PURGED, erased: false });
    expect(fromPurged.text).not.toContain("Ana");
    expect((await call(detail, { cookie, params: { id: erased } })).data).toMatchObject({ analysis: PURGED, erased: true });
  });

  it("keeps the score of a call erased while the analysis ran, with no analysis and no text", async () => {
    const organizationId = await createOrganization(panel.app, "analysis-erased-midway");
    const { cookie } = await createUser(panel.app, organizationId, "operator");
    const midway = await createCall(panel.app, organizationId, NOW);
    // O que a rotina grava quando o apagamento chega enquanto o provedor responde.
    await setAnalysis(midway, null, 7, true);

    const rows = (await call(list, { cookie })).data as Array<{ id: string; analysisScore: number | null }>;
    expect(rows.find((row) => row.id === midway)?.analysisScore).toBe(7);
    const shown = await call(detail, { cookie, params: { id: midway } });
    expect(shown.status).toBe(200);
    expect(shown.data).toMatchObject({ analysis: null, analysisScore: 7, analysisUnreadable: false, erased: true });
  });

  it("keeps the detail up and flags an analysis out of shape, without sending the raw value", async () => {
    const organizationId = await createOrganization(panel.app, "analysis-unreadable");
    const { cookie } = await createUser(panel.app, organizationId, "operator");
    const broken = await createCall(panel.app, organizationId, NOW);
    // Inteira e com `purged` ao mesmo tempo: nenhuma das duas formas estritas aceita.
    await setAnalysis(broken, { ...FULL, purged: true }, 9);

    const shown = await call(detail, { cookie, params: { id: broken } });
    expect(shown.status).toBe(200);
    expect(shown.data).toMatchObject({ id: broken, analysis: null, analysisUnreadable: true });
    expect(shown.text).not.toContain("Ana");
  });
});
