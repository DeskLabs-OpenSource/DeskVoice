import { encryptSecret, withOrg } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { SECRET_KEY, call, createOrganization, createUser, startPanel } from "../../../../../test/kit";
import { GET as listBrains } from "../brains/route";
import { GET as readAgent, PATCH as patchAgent } from "./[id]/route";
import { POST as createAgent } from "./route";

const panel = startPanel();
afterAll(() => panel.close());

const PRICE = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "https://exemplo.invalid/precos", checkedOn: "2026-03-01" };

async function setup(label: string) {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  return { org, cookie: owner.cookie };
}

/** A chave do cérebro e a lista guardada dela, como a tela de Cérebros grava. */
const withBrain = (org: string, brain: string, options: { key?: boolean } = {}) =>
  withOrg(panel.app, org, async (q) => {
    if (options.key !== false)
      await q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, to_jsonb($3::text), true)", [org, `brain.${brain}.api_key`, encryptSecret("chave-inventada", SECRET_KEY)]);
    await q.exec("insert into settings (organization_id, key, value) values ($1, $2, $3)", [
      org,
      `brain.${brain}.models`,
      JSON.stringify({ fetchedAt: "2026-03-01T15:00:00.000Z", models: [{ id: "com-preco", label: "Com preço", price: PRICE }, { id: "sem-preco", label: "Sem preço" }] }),
    ]);
  });

type Agent = { id: string; name: string; analysisBrain: unknown };
const create = (cookie: string, body: object) => call(createAgent, { method: "POST", cookie, body: { name: "Vendas", engine: "simulated", ...body } });
const newAgent = async (cookie: string, name = "Vendas"): Promise<Agent> => (await create(cookie, { name })).data as Agent;
const patch = (cookie: string, id: string, body: object) => call(patchAgent, { method: "PATCH", cookie, params: { id }, body });
const read = async (cookie: string, id: string) => (await call(readAgent, { cookie, params: { id } })).data as Agent;
const stored = (org: string, id: string) => withOrg(panel.app, org, async (q) => (await q.one<{ analysis_brain: unknown }>("select analysis_brain from agents where id = $1", [id]))?.analysis_brain);
const refusal = (result: { status: number; code: string | undefined }) => [result.status, result.code];

describe("agents.analysis_brain: quem lê a ligação, escolhido no agente", () => {
  it("nasce nulo (segue a organização), e o GET devolve a escolha gravada", async () => {
    const { org, cookie } = await setup("agente cerebro nulo");
    await withBrain(org, "openai");
    const agent = await newAgent(cookie);
    expect(agent.analysisBrain).toBeNull();
    expect(await stored(org, agent.id)).toBeNull();

    expect((await patch(cookie, agent.id, { analysisBrain: { kind: "brain", brain: "openai", model: "com-preco" } })).status).toBe(200);
    expect((await read(cookie, agent.id)).analysisBrain).toEqual({ kind: "brain", brain: "openai", model: "com-preco" });

    expect((await patch(cookie, agent.id, { analysisBrain: { kind: "engine" } })).status).toBe(200);
    expect((await read(cookie, agent.id)).analysisBrain).toEqual({ kind: "engine" });

    expect((await patch(cookie, agent.id, { analysisBrain: null })).status).toBe(200);
    expect((await read(cookie, agent.id)).analysisBrain).toBeNull();
    expect(await stored(org, agent.id)).toBeNull();
  });

  it("salvar outro campo não mexe na escolha", async () => {
    const { org, cookie } = await setup("agente cerebro outro campo");
    await withBrain(org, "openai");
    const agent = await newAgent(cookie);
    await patch(cookie, agent.id, { analysisBrain: { kind: "brain", brain: "openai", model: "com-preco" } });

    expect((await patch(cookie, agent.id, { name: "Vendas 2" })).status).toBe(200);
    expect(await stored(org, agent.id)).toEqual({ kind: "brain", brain: "openai", model: "com-preco" });

    // Nem a escolha fora da forma gravada à mão: o `null` do JSON não vira o nulo da coluna.
    await withOrg(panel.app, org, (q) => q.exec("update agents set analysis_brain = 'null'::jsonb where id = $1", [agent.id]));
    expect((await patch(cookie, agent.id, { name: "Vendas 3" })).status).toBe(200);
    const raw = await withOrg(panel.app, org, (q) => q.one<{ kind: string | null }>("select jsonb_typeof(analysis_brain) as kind from agents where id = $1", [agent.id]));
    expect(raw?.kind).toBe("null");
  });

  it("T7: a mesma conferência da organização, e acceptUnmeasured não é gravado", async () => {
    const { org, cookie } = await setup("agente cerebro recusas");
    await withBrain(org, "openai");
    await withBrain(org, "anthropic", { key: false });
    const agent = await newAgent(cookie);
    const brain = (brainId: string, model: string) => ({ analysisBrain: { kind: "brain", brain: brainId, model } });

    expect(refusal(await patch(cookie, agent.id, brain("openai", "fora-da-lista")))).toEqual([400, "brain_model_not_listed"]);
    expect(refusal(await patch(cookie, agent.id, brain("openai", "sem-preco")))).toEqual([400, "brain_model_unmeasured"]);
    expect(refusal(await patch(cookie, agent.id, brain("anthropic", "com-preco")))).toEqual([400, "brain_no_key"]);
    expect(refusal(await patch(cookie, agent.id, brain("nao-existe", "com-preco")))).toEqual([400, "unknown_brain"]);
    expect(await stored(org, agent.id)).toBeNull();

    expect((await patch(cookie, agent.id, { ...brain("openai", "sem-preco"), acceptUnmeasured: true })).status).toBe(200);
    expect(await stored(org, agent.id)).toEqual({ kind: "brain", brain: "openai", model: "sem-preco" });
  });

  it("forma errada é recusada pelo zod, com o caminho do campo", async () => {
    const { org, cookie } = await setup("agente cerebro forma");
    await withBrain(org, "openai");
    const agent = await newAgent(cookie);

    for (const analysisBrain of [{ kind: "brain", brain: "openai" }, { kind: "outro" }, { brain: "openai", model: "com-preco" }, { kind: "engine", brain: "openai" }, "openai"]) {
      expect(refusal(await patch(cookie, agent.id, { analysisBrain }))).toEqual([400, "validation_error"]);
    }
    expect(await stored(org, agent.id)).toBeNull();
  });

  it("criar o agente segue a mesma regra", async () => {
    const { org, cookie } = await setup("agente cerebro criar");
    await withBrain(org, "openai");

    expect(refusal(await create(cookie, { analysisBrain: { kind: "brain", brain: "openai", model: "sem-preco" } }))).toEqual([400, "brain_model_unmeasured"]);
    const created = await create(cookie, { analysisBrain: { kind: "brain", brain: "openai", model: "com-preco" } });
    expect(created.status).toBe(200);
    expect(await stored(org, (created.data as Agent).id)).toEqual({ kind: "brain", brain: "openai", model: "com-preco" });
  });

  it("T7: agente de outra organização não é visto; a lista de outra organização não vale", async () => {
    const a = await setup("agente cerebro org a");
    const b = await setup("agente cerebro org b");
    await withBrain(a.org, "openai");
    const deA = await newAgent(a.cookie);
    const deB = await newAgent(b.cookie);

    expect(refusal(await patch(b.cookie, deA.id, { analysisBrain: { kind: "engine" } }))).toEqual([404, "not_found"]);
    expect(refusal(await patch(b.cookie, deB.id, { analysisBrain: { kind: "brain", brain: "openai", model: "com-preco" } }))).toEqual([400, "brain_no_key"]);
    expect(await stored(a.org, deA.id)).toBeNull();
  });

  it("T7: quem não é dono nem administrador não escolhe", async () => {
    const { org, cookie } = await setup("agente cerebro operador");
    await withBrain(org, "openai");
    const agent = await newAgent(cookie);
    const operator = await createUser(panel.app, org, "operator");

    expect((await patch(operator.cookie, agent.id, { analysisBrain: { kind: "brain", brain: "openai", model: "com-preco" } })).status).toBe(403);
    expect(await stored(org, agent.id)).toBeNull();
  });

  it("a lista de cérebros diz quais agentes escolheram cada um (só id e nome)", async () => {
    const { org, cookie } = await setup("agente cerebro lista");
    await withBrain(org, "openai");
    const vendas = await newAgent(cookie, "Vendas");
    const suporte = await newAgent(cookie, "Suporte");
    const recepcao = await newAgent(cookie, "Recepção");
    await patch(cookie, vendas.id, { analysisBrain: { kind: "brain", brain: "openai", model: "com-preco" } });
    await patch(cookie, suporte.id, { analysisBrain: { kind: "brain", brain: "openai", model: "com-preco" } });
    await patch(cookie, recepcao.id, { analysisBrain: { kind: "engine" } });

    const brains = (await call(listBrains, { cookie })).data as Array<{ id: string; agents: unknown }>;
    expect(brains.find((brain) => brain.id === "openai")?.agents).toEqual([
      { id: suporte.id, name: "Suporte" },
      { id: vendas.id, name: "Vendas" },
    ]);
    expect(brains.filter((brain) => brain.id !== "openai").every((brain) => Array.isArray(brain.agents) && brain.agents.length === 0)).toBe(true);
  });
});
