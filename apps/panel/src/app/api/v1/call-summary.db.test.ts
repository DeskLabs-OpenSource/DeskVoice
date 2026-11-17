import { PURGED_SUMMARY_TEXT, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, call, createCall, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { GET as detail } from "./calls/[id]/route";

/** O resumo que a tela da chamada recebe: inteiro enquanto existe, e o aviso quando saiu pelo prazo. */
const panel = startPanel();
afterAll(() => panel.close());

async function setSummaries(purgedCall: string, keptCall: string): Promise<void> {
  await withSystem(panel.app, async (q) => {
    await q.exec("update calls set summary = $2 where id = $1", [purgedCall, PURGED_SUMMARY_TEXT]);
    await q.exec("update calls set summary = $2 where id = $1", [keptCall, "Desfecho: concluída.\nConversa:\nCliente: Queria o horário.\nAgente: Abrimos às nove."]);
  });
}

describe("call summary in the panel API", () => {
  it("diz que o resumo saiu com o prazo em vez de mostrar o marcador, e entrega inteiro o que está dentro do prazo", async () => {
    const organizationId = await createOrganization(panel.app, "summary-purged");
    const { cookie } = await createUser(panel.app, organizationId, "operator");
    const purged = await createCall(panel.app, organizationId, NOW);
    const kept = await createCall(panel.app, organizationId, NOW);
    await setSummaries(purged, kept);

    // O marcador não chega à tela: a resposta diz que o resumo saiu, e o campo vem vazio para a tela
    // escrever a frase no idioma de quem lê.
    expect((await call(detail, { cookie, params: { id: purged } })).data).toMatchObject({ summary: null, summaryPurged: true });
    const shown = await call(detail, { cookie, params: { id: kept } });
    expect(shown.data).toMatchObject({ summaryPurged: false });
    expect((shown.data as { summary: string }).summary).toContain("Cliente:");
  });
});
