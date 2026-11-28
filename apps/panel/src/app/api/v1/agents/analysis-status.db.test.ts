// O que qualquer papel vê de quem lê as ligações do agente (R4, ajuste da fatia 5b): a escolha, o
// rótulo do cérebro e os avisos, pela mesma regra da tela de quem configura, sem a chave, o teste cru
// nem a lista de modelos.
import { encryptSecret, startSupportAccess, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { NOW, SECRET_KEY, call, createOrganization, createUser, insert, startPanel } from "../../../../../test/kit";
import { GET as readAgent } from "./[id]/route";
import { GET as analysisStatus } from "./[id]/analysis-status/route";

const panel = startPanel();
afterAll(() => panel.close());

const PRICE = { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "https://exemplo.invalid/precos", checkedOn: "2026-03-01" };
// A chave gravada, que nenhuma resposta pode trazer, nem cifrada.
const KEY = "sk-ant-chave-que-nao-pode-sair-0123456789";

async function setup(label: string) {
  const org = await createOrganization(panel.app, label);
  const owner = await createUser(panel.app, org, "owner");
  const operator = await createUser(panel.app, org, "operator");
  return { org, owner, operator };
}

/** A chave do cérebro, o teste dela e a lista guardada, como a tela de Cérebros grava. */
async function withBrain(org: string, brain: string, options: { key?: boolean; check?: string; models?: boolean } = {}): Promise<string> {
  const cipher = encryptSecret(KEY, SECRET_KEY);
  await withOrg(panel.app, org, async (q) => {
    if (options.key !== false) await q.exec("insert into settings (organization_id, key, value, secret) values ($1, $2, to_jsonb($3::text), true)", [org, `brain.${brain}.api_key`, cipher]);
    await q.exec("insert into settings (organization_id, key, value) values ($1, $2, $3)", [
      org,
      `brain.${brain}.key_check`,
      JSON.stringify({ result: options.check ?? "accepted", status: options.check && options.check !== "accepted" ? 401 : 200, checkedAt: NOW.toISOString() }),
    ]);
    if (options.models !== false) await q.exec("insert into settings (organization_id, key, value) values ($1, $2, $3)", [
      org,
      `brain.${brain}.models`,
      JSON.stringify({ fetchedAt: NOW.toISOString(), models: [{ id: "com-preco", label: "Com preço", price: PRICE }, { id: "claude-sem-preco", label: "Sem preço" }] }),
    ]);
  });
  return cipher;
}

const newAgent = (org: string, analysisBrain: unknown) =>
  insert(panel.app, org, "insert into agents (organization_id, name, engine, analysis_brain) values ($1, 'Vendas', 'simulated', $2::jsonb) returning id", [
    org,
    analysisBrain === null ? null : JSON.stringify(analysisBrain),
  ]);
const status = (cookie: string, id: string) => call(analysisStatus, { cookie, params: { id } });
const brain = (id: string, model: string) => ({ kind: "brain", brain: id, model });

describe("GET /agents/{id}/analysis-status", () => {
  it("a escolha de cada tipo, e o rótulo só com o cérebro", async () => {
    const { org, operator } = await setup("status escolha");
    await withBrain(org, "anthropic");
    const cases: Array<[unknown, object]> = [
      [null, { choice: "organization", brainLabel: null, model: null, problems: [] }],
      [{ kind: "engine" }, { choice: "engine", brainLabel: null, model: null, problems: [] }],
      [brain("anthropic", "com-preco"), { choice: "brain", brainLabel: "Anthropic", model: "com-preco", problems: [] }],
      [{ kind: "brain", brain: "anthropic" }, { choice: "invalid", brainLabel: null, model: null, problems: [] }],
    ];
    for (const [stored, expected] of cases) {
      const result = await status(operator.cookie, await newAgent(org, stored));
      expect(result.status).toBe(200);
      expect(result.data).toEqual(expected);
    }
  });

  it("um caso por aviso: chave recusada, chave apagada, modelo fora da lista, modelo sem preço", async () => {
    const { org, operator } = await setup("status avisos");
    await withBrain(org, "anthropic", { check: "invalid_key" });
    await withBrain(org, "openai", { key: false });
    await withBrain(org, "gemini");
    const problems = async (stored: unknown) => ((await status(operator.cookie, await newAgent(org, stored))).data as { problems: string[] }).problems;

    expect(await problems(brain("anthropic", "com-preco"))).toEqual(["key_gone"]);
    expect(await problems(brain("openai", "com-preco"))).toEqual(["key_gone"]);
    expect(await problems(brain("gemini", "claude-velho"))).toEqual(["model_gone"]);
    expect(await problems(brain("gemini", "claude-sem-preco"))).toEqual(["unmeasured"]);
    // O cérebro que não é mais descoberto: sem chave aceita, com o id no lugar do rótulo.
    const gone = (await status(operator.cookie, await newAgent(org, brain("sumiu", "m")))).data;
    expect(gone).toEqual({ choice: "brain", brainLabel: "sumiu", model: "m", problems: ["key_gone"] });
  });

  it("chave recusada e modelo fora da lista: só a chave, como a tela de quem configura mostra", async () => {
    const { org, operator } = await setup("status combinado");
    await withBrain(org, "anthropic", { check: "invalid_key" });
    const result = await status(operator.cookie, await newAgent(org, brain("anthropic", "claude-velho")));
    expect(result.data).toEqual({ choice: "brain", brainLabel: "Anthropic", model: "claude-velho", problems: ["key_gone"] });
  });

  it("o operador, o dono e a sessão de suporte leem; nada da chave, do teste cru nem da lista sai", async () => {
    const { org, owner, operator } = await setup("status papeis");
    const cipher = await withBrain(org, "anthropic", { check: "invalid_key" });
    const agent = await newAgent(org, brain("anthropic", "claude-sem-preco"));

    // A sessão de suporte da instalação entra como em produção: a conta que administra, de outra organização.
    const home = await createOrganization(panel.app, "status casa");
    const supporter = await createUser(panel.app, home, "owner");
    const account = (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [supporter.id])))?.id ?? "";
    await withSystem(panel.app, (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [account, NOW]));
    const sessionId = (await withSystem(panel.app, (q) => q.one<{ id: string }>("select id from sessions where user_id = $1", [supporter.id])))?.id ?? "";
    const started = await startSupportAccess(panel.app, { actorAccountId: account, sessionId, organizationId: org, reason: "Ajuda com a configuração", minutes: 60 }, NOW);
    expect(started.ok).toBe(true);

    for (const cookie of [operator.cookie, owner.cookie, supporter.cookie]) {
      const result = await status(cookie, agent);
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ choice: "brain", brainLabel: "Anthropic", model: "claude-sem-preco", problems: ["key_gone"] });
      expect(result.text).not.toContain(KEY);
      expect(result.text).not.toContain(KEY.slice(-12));
      expect(result.text).not.toContain(cipher);
      expect(result.text).not.toContain("invalid_key");
      expect(result.text).not.toContain("Com preço");
    }
  });

  it("agente de outra organização ou inexistente é 404", async () => {
    const { org, operator } = await setup("status isolamento");
    const other = await createOrganization(panel.app, "status outra");
    await withBrain(other, "anthropic");
    const foreign = await newAgent(other, brain("anthropic", "com-preco"));
    await newAgent(org, null);

    for (const id of [foreign, "00000000-0000-4000-8000-000000000000", "nao-e-uuid"]) {
      const result = await status(operator.cookie, id);
      expect([result.status, result.code]).toEqual([404, "not_found"]);
    }
  });

  it("os avisos só leem as configurações da própria organização", async () => {
    const { org, operator } = await setup("status settings meus");
    const other = await createOrganization(panel.app, "status settings outra");
    // A outra tem a chave aceita e a lista; a minha não tem chave do anthropic e tem a do openai sem lista.
    await withBrain(other, "anthropic");
    await withBrain(other, "openai");
    await withBrain(org, "openai", { models: false });
    const problems = async (stored: unknown) => ((await status(operator.cookie, await newAgent(org, stored))).data as { problems: string[] }).problems;

    expect(await problems(brain("anthropic", "com-preco"))).toEqual(["key_gone"]);
    expect(await problems(brain("openai", "com-preco"))).toEqual(["model_gone"]);
  });

  it("organização suspensa: 409, como a leitura do próprio agente (só as rotas da conta passam)", async () => {
    const { org, operator } = await setup("status suspensa");
    const agent = await newAgent(org, { kind: "engine" });
    await withSystem(panel.app, (q) => q.exec("update organizations set suspended_at = $2 where id = $1", [org, NOW]));
    for (const handler of [analysisStatus, readAgent]) {
      const result = await call(handler, { cookie: operator.cookie, params: { id: agent } });
      expect([result.status, result.code]).toEqual([409, "organization_suspended"]);
    }
  });
});
