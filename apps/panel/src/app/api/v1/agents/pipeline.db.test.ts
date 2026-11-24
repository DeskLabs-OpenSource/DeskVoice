// O servidor grava `agents.pipeline` (desenho do pipeline, fatia 5a, com a seção 9.1): uma escolha
// válida grava e volta no GET, e `null` limpa; cada recusa é 422, diz qual peça, e não grava nada; a
// voz que leva o texto para fora do servidor só passa com a confirmação da fatia 1b; o simulado só nos
// testes; e o agente sem `pipeline` fica como era. A recusa na abertura da ligação (a coluna fora da
// forma, a L2 da DESA-421) está em `apps/voice/src/call-session-pipeline.db.test.ts`.
import type * as brainsModule from "../../../../server/brains";
import type * as synthesizersModule from "../../../../server/synthesizers";
import type * as transcribersModule from "../../../../server/transcribers";
import { encryptSecret, withOrg, type OrgQuery } from "@deskvoice/core";
import { loadTranscribers } from "@deskvoice/voice-engine";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NOW, SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../../test/kit";
import { listTranscribers } from "../../../../server/transcribers";
import { DELETE as removeVoiceKey } from "../synthesizers/[synthesizer]/key/route";
import { GET as readAgent, PATCH as patchAgent } from "./[id]/route";
import { GET as listAgents, POST as createAgent } from "./route";

// As peças reais têm todas `chat` e preço, e nenhuma transcrição é de fora: as recusas 2, 3 e a da
// transcrição de fora pedem peças falsas, que só entram na pasta quando o teste liga `fakes.on`.
const fakes = vi.hoisted(() => ({ on: false }));
vi.mock("../../../../server/brains", async (importOriginal) => {
  const original = await importOriginal<typeof brainsModule>();
  return {
    ...original,
    listBrains: async () => {
      const all = await original.listBrains();
      const openai = all.find((brain) => brain.id === "openai");
      return fakes.on && openai ? [...all, { ...openai, id: "mudo", label: "Cérebro que não conversa", chat: undefined }] : all;
    },
  };
});
vi.mock("../../../../server/synthesizers", async (importOriginal) => {
  const original = await importOriginal<typeof synthesizersModule>();
  return {
    ...original,
    listAllSynthesizers: async () => {
      const all = await original.listAllSynthesizers();
      const simulated = all.find((piece) => piece.id === "simulated");
      return fakes.on && simulated ? [...all, { ...simulated, id: "sem-preco", label: "Voz sem preço", pricingOf: () => undefined }] : all;
    },
  };
});
vi.mock("../../../../server/transcribers", async (importOriginal) => {
  const original = await importOriginal<typeof transcribersModule>();
  return {
    ...original,
    listTranscribers: async () => {
      const all = await original.listTranscribers();
      const simulated = all.find((piece) => piece.id === "simulated");
      return fakes.on && simulated ? [...all, { ...simulated, id: "de-fora", label: "Transcrição de fora", processingLocation: { kind: "undeclared" as const } }] : all;
    },
  };
});

const panel = startPanel();
afterAll(() => panel.close());
afterEach(() => {
  fakes.on = false;
  panel.deps.simulatedPieces = undefined;
});

const PRICE = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "https://exemplo.invalid/precos", checkedOn: "2026-03-01" };
/** A escolha válida: a transcrição simulada (só nos testes), o cérebro com preço e a ElevenLabs confirmada. */
const CHOICE = { transcriber: "simulated", brain: "openai", model: "com-preco", synthesizer: "elevenlabs", voiceId: "v-ze" };

const put = (q: OrgQuery, org: string, key: string, value: unknown, secret = false) =>
  q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, $3, $4)", [org, key, JSON.stringify(value), secret]);

/**
 * Uma organização pronta para o pipeline, como as telas gravam: a chave e a lista do cérebro (um modelo
 * com preço, um sem) e a chave da ElevenLabs com a confirmação nomeando o fornecedor (fatia 1b).
 */
async function setup(label: string, options: { consent?: boolean } = {}) {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  await withOrg(panel.app, org, async (q) => {
    await put(q, org, "brain.openai.api_key", encryptSecret("chave-inventada-do-cerebro", SECRET_KEY), true);
    await put(q, org, "brain.openai.models", { fetchedAt: "2026-03-01T15:00:00.000Z", models: [{ id: "com-preco", label: "Com preço", price: PRICE }, { id: "sem-preco", label: "Sem preço" }] });
    await put(q, org, "brain.mudo.models", { fetchedAt: "2026-03-01T15:00:00.000Z", models: [{ id: "com-preco", label: "Com preço", price: PRICE }] });
    await put(q, org, "synthesizer.elevenlabs.api_key", encryptSecret("chave-inventada-da-voz", SECRET_KEY), true);
    if (options.consent !== false) await put(q, org, "synthesizer.elevenlabs.consent", { userId: owner.id, confirmedAt: NOW.toISOString() });
  });
  return { org, cookie: owner.cookie };
}

type Agent = { id: string; name: string; pipeline: unknown } & Record<string, unknown>;
const create = (cookie: string, body: object) => call(createAgent, { method: "POST", cookie, body: { name: "Recepção", engine: "simulated", ...body } });
const patch = (cookie: string, id: string, body: object) => call(patchAgent, { method: "PATCH", cookie, params: { id }, body });
const read = async (cookie: string, id: string) => (await call(readAgent, { cookie, params: { id } })).data as Agent;
/** O valor da coluna e se ela é o nulo do SQL (e não o `null` do JSON). */
const stored = (org: string, id: string) =>
  withOrg(panel.app, org, async (q) => q.one<{ pipeline: unknown; sql_null: boolean }>("select pipeline, pipeline is null as sql_null from agents where id = $1", [id]));
const detail = (result: { text: string }) => (JSON.parse(result.text) as { error?: { detail?: Record<string, string> } }).error?.detail;

describe("agents.pipeline: a escolha das peças pela API (fatia 5a)", () => {
  it("a pasta dos transcritores do painel acha as mesmas peças que a da sessão", async () => {
    expect((await listTranscribers()).map((piece) => piece.id).sort()).toEqual([...(await loadTranscribers()).keys()].sort());
  });

  it("uma escolha válida grava e volta no GET, pelo POST e pelo PATCH; `null` limpa, com o nulo do SQL", async () => {
    panel.deps.simulatedPieces = true;
    const { org, cookie } = await setup("pipeline valido");
    const created = await create(cookie, { pipeline: CHOICE });
    expect(created.status).toBe(200);
    const agent = created.data as Agent;
    expect(agent.pipeline).toEqual(CHOICE);
    expect((await read(cookie, agent.id)).pipeline).toEqual(CHOICE);
    expect((await stored(org, agent.id))?.pipeline).toEqual(CHOICE);

    const other = { ...CHOICE, voiceId: "v-bia" };
    expect((await patch(cookie, agent.id, { pipeline: other })).status).toBe(200);
    expect((await read(cookie, agent.id)).pipeline).toEqual(other);
    expect(((await call(listAgents, { cookie })).data as Agent[]).find((each) => each.id === agent.id)?.pipeline).toEqual(other);

    expect((await patch(cookie, agent.id, { pipeline: null })).status).toBe(200);
    expect((await read(cookie, agent.id)).pipeline).toBeNull();
    expect(await stored(org, agent.id)).toEqual({ pipeline: null, sql_null: true });

    // Gravar `pipeline` não troca o `engine`: os dois convivem, e quem decide na ligação é a sessão.
    expect((await patch(cookie, agent.id, { pipeline: CHOICE })).status).toBe(200);
    expect((await read(cookie, agent.id)).engine).toBe("simulated");
  });

  it("salvar outro campo não regrava a escolha, nem a fora da forma gravada à mão", async () => {
    panel.deps.simulatedPieces = true;
    const { org, cookie } = await setup("pipeline outro campo");
    const agent = (await create(cookie, { pipeline: CHOICE })).data as Agent;
    expect((await patch(cookie, agent.id, { name: "Vendas" })).status).toBe(200);
    expect((await stored(org, agent.id))?.pipeline).toEqual(CHOICE);

    const handWritten = { transcriber: "simulated", brain: "openai" };
    await withOrg(panel.app, org, (q) => q.exec("update agents set pipeline = $2 where id = $1", [agent.id, JSON.stringify(handWritten)]));
    expect((await patch(cookie, agent.id, { name: "Suporte" })).status).toBe(200);
    expect((await stored(org, agent.id))?.pipeline).toEqual(handWritten);
  });

  it("a escolha fora da forma não passa da validação, e nada é gravado", async () => {
    panel.deps.simulatedPieces = true;
    const { org, cookie } = await setup("pipeline forma");
    const agent = (await create(cookie, { pipeline: CHOICE })).data as Agent;
    for (const wrong of [{ ...CHOICE, voiceId: undefined }, { ...CHOICE, model: "" }, "simulated", [CHOICE]]) {
      const result = await patch(cookie, agent.id, { pipeline: wrong });
      expect([result.status, result.code]).toEqual([400, "validation_error"]);
    }
    expect((await stored(org, agent.id))?.pipeline).toEqual(CHOICE);
  });
});

describe("agents.pipeline: as recusas, 422 com a peça, e nada gravado", () => {
  /** Cada recusa pelo PATCH (a escolha válida de antes fica) e pelo POST (nenhum agente novo). */
  async function refused(label: string, choice: object, expected: { code: string; piece: string; pieceId: string; model?: string; says: string[] }, options: { consent?: boolean } = {}) {
    const { org, cookie } = await setup(label, options);
    panel.deps.simulatedPieces = true;
    const valid = { ...CHOICE, synthesizer: options.consent === false ? "simulated" : CHOICE.synthesizer };
    const agent = (await create(cookie, { pipeline: valid })).data as Agent;
    const simulatedPieces = choice === CHOICE_SIMULATED ? undefined : true;
    panel.deps.simulatedPieces = simulatedPieces;
    const before = await withOrg(panel.app, org, (q) => q.many("select id from agents"));
    for (const result of [await patch(cookie, agent.id, { pipeline: choice }), await create(cookie, { name: "Outro", pipeline: choice })]) {
      expect([result.status, result.code]).toEqual([422, expected.code]);
      expect(detail(result)).toEqual({ piece: expected.piece, pieceId: expected.pieceId, ...(expected.model !== undefined && { model: expected.model }) });
      for (const part of expected.says) expect(result.message).toContain(part);
    }
    expect((await stored(org, agent.id))?.pipeline).toEqual(valid);
    expect(await withOrg(panel.app, org, (q) => q.many("select id from agents"))).toEqual(before);
  }
  const CHOICE_SIMULATED = { ...CHOICE };

  it("1: a peça que não está na pasta, cada uma das três", async () => {
    await refused("pipeline sem transcricao", { ...CHOICE, transcriber: "deepgram" }, { code: "pipeline_piece_unknown", piece: "transcriber", pieceId: "deepgram", says: ['"deepgram"', "transcriber"] });
    await refused("pipeline sem cerebro", { ...CHOICE, brain: "cerebro-novo" }, { code: "pipeline_piece_unknown", piece: "brain", pieceId: "cerebro-novo", says: ['"cerebro-novo"', "brain"] });
    await refused("pipeline sem voz", { ...CHOICE, synthesizer: "voz-nova" }, { code: "pipeline_piece_unknown", piece: "synthesizer", pieceId: "voz-nova", says: ['"voz-nova"', "voice"] });
  });

  it("2: o cérebro sem `chat`, e o modelo fora da lista ou nela sem preço (a regra da 3b-2)", async () => {
    fakes.on = true;
    await refused("pipeline cerebro mudo", { ...CHOICE, brain: "mudo" }, { code: "pipeline_brain_cannot_chat", piece: "brain", pieceId: "mudo", says: ['"mudo"', "conversation"] });
    await refused("pipeline modelo sem preco", { ...CHOICE, model: "sem-preco" }, { code: "pipeline_piece_unpriced", piece: "brain", pieceId: "openai", model: "sem-preco", says: ['"sem-preco"', '"openai"', "no known price"] });
    await refused("pipeline modelo fora", { ...CHOICE, model: "fora-da-lista" }, { code: "pipeline_piece_unpriced", piece: "brain", pieceId: "openai", model: "fora-da-lista", says: ['"fora-da-lista"', "no known price"] });
  });

  it("3: a voz sem preço para o modelo padrão dela", async () => {
    fakes.on = true;
    await refused("pipeline voz sem preco", { ...CHOICE, synthesizer: "sem-preco" }, { code: "pipeline_piece_unpriced", piece: "synthesizer", pieceId: "sem-preco", model: "simulated", says: ['"sem-preco"', "no known price"] });
  });

  it("4 (9.1): a peça que leva o dado de quem ligou para fora sem confirmação gravada diz qual é e onde confirmar", async () => {
    await refused(
      "pipeline voz sem confirmacao",
      CHOICE,
      { code: "pipeline_piece_unconfirmed", piece: "synthesizer", pieceId: "elevenlabs", says: ["ElevenLabs", "outside this server", "Settings → Voice"] },
      { consent: false },
    );
    fakes.on = true;
    await refused("pipeline transcricao de fora", { ...CHOICE, transcriber: "de-fora" }, { code: "pipeline_piece_unconfirmed", piece: "transcriber", pieceId: "de-fora", says: ["Transcrição de fora", "caller's audio", "outside this server"] });
  });

  it("5: o transcritor simulado fora do ambiente de teste (a instalação nunca o liga)", async () => {
    await refused("pipeline simulado", CHOICE_SIMULATED, { code: "pipeline_piece_test_only", piece: "transcriber", pieceId: "simulated", says: ["simulated transcriber", "tests"] });
  });

  it("a confirmação apagada depois de gravar: a próxima gravação recusa, e o agente gravado fica como está", async () => {
    panel.deps.simulatedPieces = true;
    const { org, cookie } = await setup("pipeline confirmacao apagada");
    const agent = (await create(cookie, { pipeline: CHOICE })).data as Agent;
    // A confirmação sai com a chave (fatia 1b): é a única forma de a tela apagá-la.
    expect((await call(removeVoiceKey, { method: "DELETE", cookie, params: { synthesizer: "elevenlabs" } })).status).toBe(200);
    const again = await patch(cookie, agent.id, { pipeline: CHOICE });
    expect([again.status, again.code, detail(again)]).toEqual([422, "pipeline_piece_unconfirmed", { piece: "synthesizer", pieceId: "elevenlabs" }]);
    // O agente gravado não é tocado: a abertura da ligação recusa pela chave que falta (a recusa que já existe).
    expect((await stored(org, agent.id))?.pipeline).toEqual(CHOICE);
    expect((await patch(cookie, agent.id, { name: "Vendas" })).status).toBe(200);
    expect((await stored(org, agent.id))?.pipeline).toEqual(CHOICE);
  });
});

describe("o agente sem pipeline fica como era", () => {
  it("criado e editado sem `pipeline`: a coluna fica no nulo do SQL, e a resposta só ganha `pipeline: null`", async () => {
    const { org, cookie } = await setup("pipeline ausente");
    const created = await create(cookie, { instructions: "Atenda bem." });
    expect(created.status).toBe(200);
    const agent = created.data as Agent;
    expect(agent.pipeline).toBeNull();
    expect(await stored(org, agent.id)).toEqual({ pipeline: null, sql_null: true });
    expect((await patch(cookie, agent.id, { name: "Vendas", engine: "simulated", maxCallSeconds: 300 })).status).toBe(200);
    const after = await read(cookie, agent.id);
    expect(await stored(org, agent.id)).toEqual({ pipeline: null, sql_null: true });
    // Os campos de antes da 5a, todos, e nenhum outro além de `pipeline`.
    expect(Object.keys(after).sort()).toEqual(
      [
        "id",
        "name",
        "roleLabel",
        "instructions",
        "greeting",
        "engine",
        "voiceId",
        "language",
        "tools",
        "enabled",
        "maxCallSeconds",
        "costCeilingCents",
        "transferTo",
        "transferReturnsToAgent",
        "callerIdleGuard",
        "followUpOwnerUserId",
        "vocabulary",
        "listeningEnvironment",
        "agentHandoffTargets",
        "dropFollowUp",
        "dropFollowUpMessage",
        "analystId",
        "analysisBrain",
        "pipeline",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(after).toMatchObject({ name: "Vendas", engine: "simulated", maxCallSeconds: 300, instructions: "Atenda bem.", pipeline: null });
  });
});
