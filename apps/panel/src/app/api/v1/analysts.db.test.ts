// Os analistas ao vivo pela API (desenho 2026-11-17-analistas-ao-vivo, seções 2.1 e 3.1, fatia 2): o
// CRUD dentro da organização, o analista do agente, e a confirmação do fornecedor quando o modelo de
// decisão manda o texto da ligação para fora do servidor, com o recibo só de acréscimo.
import { withOrg } from "@deskvoice/core";
import type { DecisionModel } from "@deskvoice/voice-engine";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, createOrganization, createUser, NOW, startPanel } from "../../../../test/kit";
import type * as Pieces from "../../../server/pieces";
import { PATCH as patchAgent } from "./agents/[id]/route";
import { POST as createAgent } from "./agents/route";
import { DELETE as deleteAnalyst, GET as getAnalyst, PATCH as patchAnalyst } from "./analysts/[id]/route";
import { GET as listAnalysts, POST as createAnalyst } from "./analysts/route";
import { DELETE as removeMember } from "./team/users/[id]/route";

// Um segundo modelo que processa fora, só neste teste: com ele se prova que trocar o Jev por outro
// modelo de fora pede a confirmação de novo. Os modelos de verdade (`jev`, `simulated`) continuam.
vi.mock("../../../server/pieces", async (importOriginal) => {
  const original = await importOriginal<typeof Pieces>();
  const other: DecisionModel = {
    id: "other_remote",
    label: "Outro remoto",
    provider: "acme",
    processingLocation: { kind: "undeclared" },
    pricing: { checkedOn: "2026-11-17", source: "teste" },
    decide: () => Promise.reject(new Error("never called here")),
  };
  return { ...original, listDecisionModels: async () => [...(await original.listDecisionModels()), other] };
});

const panel = startPanel();
let org: string;
let otherOrg: string;
let owner: string;
let admin: { id: string; cookie: string };
let operator: string;
let otherOwner: string;

beforeAll(async () => {
  org = await createOrganization(panel.app, "analysts");
  otherOrg = await createOrganization(panel.app, "analysts-other");
  owner = (await createUser(panel.app, org, "owner")).cookie;
  admin = await createUser(panel.app, org, "admin");
  operator = (await createUser(panel.app, org, "operator")).cookie;
  otherOwner = (await createUser(panel.app, otherOrg, "owner")).cookie;
});
afterAll(() => panel.close());

const price = { key: "price", label: "Preço", guidance: "Reforce o que está incluso; não ofereça desconto, quem decide desconto é a equipe." };
interface Analyst {
  id: string;
  name: string;
  decisionModel: string;
  temperature: boolean;
  objections: unknown[];
  providerConfirmedBy: string | null;
  providerConfirmedAt: string | null;
}

const newAnalyst = async (cookie: string, body: Record<string, unknown>): Promise<Analyst> => {
  const created = await call(createAnalyst, { method: "POST", cookie, body });
  expect([created.status, created.message]).toEqual([200, undefined]);
  return created.data as Analyst;
};
const newAgent = async (cookie: string, name: string, extra: Record<string, unknown> = {}): Promise<string> => {
  const created = await call(createAgent, { method: "POST", cookie, body: { name, engine: "simulated", ...extra } });
  expect([created.status, created.message]).toEqual([200, undefined]);
  return (created.data as { id: string }).id;
};
const receipts = (organizationId: string, analystId: string) =>
  withOrg(panel.app, organizationId, (q) =>
    q.many<{ kind: string; actor_user_id: string | null; payload: Record<string, unknown>; at: Date }>(
      "select kind, actor_user_id, payload, at from organization_events where kind = 'analyst_provider_confirmed' and payload->>'analystId' = $1 order by id",
      [analystId],
    ),
  );
const analystRow = (organizationId: string, id: string) =>
  withOrg(panel.app, organizationId, (q) => q.one<Record<string, unknown>>("select name, decision_model, provider_confirmed_by, provider_confirmed_at from analysts where id = $1", [id]));
const analystOfAgent = (organizationId: string, id: string) =>
  withOrg(panel.app, organizationId, async (q) => (await q.one<{ analyst_id: string | null }>("select analyst_id from agents where id = $1", [id]))?.analyst_id);

describe("o cadastro do analista", () => {
  it("dono e administradora criam, leem, editam e apagam; o operador só lê", async () => {
    const created = await newAnalyst(owner, { name: "Jev", decisionModel: "simulated", objections: [price] });
    expect(created).toMatchObject({ name: "Jev", decisionModel: "simulated", temperature: true, objections: [price], providerConfirmedBy: null, providerConfirmedAt: null });
    expect((await call(getAnalyst, { cookie: operator, params: { id: created.id } })).data).toMatchObject({ id: created.id, name: "Jev" });
    expect((await call(listAnalysts, { cookie: operator })).data).toContainEqual(expect.objectContaining({ id: created.id }));

    const edited = await call(patchAnalyst, { method: "PATCH", cookie: admin.cookie, params: { id: created.id }, body: { name: "Laya", temperature: false } });
    expect([edited.status, edited.data]).toMatchObject([200, { name: "Laya", temperature: false, objections: [price] }]);

    for (const attempt of [
      call(createAnalyst, { method: "POST", cookie: operator, body: { name: "Op", decisionModel: "simulated" } }),
      call(patchAnalyst, { method: "PATCH", cookie: operator, params: { id: created.id }, body: { name: "Op" } }),
      call(deleteAnalyst, { method: "DELETE", cookie: operator, params: { id: created.id } }),
    ]) {
      expect([(await attempt).status, (await attempt).code]).toEqual([403, "forbidden"]);
    }
    expect(await analystRow(org, created.id)).toMatchObject({ name: "Laya" });
    expect((await call(deleteAnalyst, { method: "DELETE", cookie: owner, params: { id: created.id } })).data).toEqual({ agentsUnlinked: 0 });
    expect((await call(getAnalyst, { cookie: owner, params: { id: created.id } })).status).toBe(404);
  });

  it("os limites da seção 3.1 são cobrados, e nada é gravado", async () => {
    const before = await withOrg(panel.app, org, (q) => q.many("select id from analysts"));
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...price, key: `o${i}` }));
    const cases: Record<string, unknown>[] = [
      { name: "", decisionModel: "simulated" },
      { name: "x".repeat(41), decisionModel: "simulated" },
      { name: "Nove", decisionModel: "simulated", objections: [...eight, { ...price, key: "o8" }] },
      { name: "Chave", decisionModel: "simulated", objections: [{ ...price, key: "Preço" }] },
      { name: "None", decisionModel: "simulated", objections: [{ ...price, key: "none" }] },
      { name: "Repetida", decisionModel: "simulated", objections: [price, { ...price, label: "Outro" }] },
      { name: "Rótulo", decisionModel: "simulated", objections: [{ ...price, label: "x".repeat(61) }] },
      { name: "Orientação", decisionModel: "simulated", objections: [{ ...price, guidance: "y".repeat(281) }] },
    ];
    for (const body of cases) {
      const result = await call(createAnalyst, { method: "POST", cookie: owner, body });
      expect([result.status, result.code], JSON.stringify(body).slice(0, 80)).toEqual([400, "validation_error"]);
    }
    expect(await newAnalyst(owner, { name: "x".repeat(40), decisionModel: "simulated", objections: eight })).toMatchObject({ objections: eight });
    expect((await withOrg(panel.app, org, (q) => q.many("select id from analysts"))).length).toBe(before.length + 1);
  });

  it("o nome é único na organização, e outra organização pode usar o mesmo", async () => {
    await newAnalyst(owner, { name: "Único", decisionModel: "simulated" });
    const repeated = await call(createAnalyst, { method: "POST", cookie: owner, body: { name: "Único", decisionModel: "simulated" } });
    expect([repeated.status, repeated.code]).toEqual([409, "already_exists"]);
    await newAnalyst(otherOwner, { name: "Único", decisionModel: "simulated" });
  });

  it("o nome é único sem diferença de maiúsculas, no POST e no PATCH; outra organização pode usar a mesma grafia", async () => {
    await newAnalyst(owner, { name: "Jev", decisionModel: "simulated" });
    const created = await call(createAnalyst, { method: "POST", cookie: owner, body: { name: "jev", decisionModel: "simulated" } });
    expect([created.status, created.code]).toEqual([409, "already_exists"]);
    const other = await newAnalyst(owner, { name: "Outro nome", decisionModel: "simulated" });
    const renamed = await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: other.id }, body: { name: "jev" } });
    expect([renamed.status, renamed.code]).toEqual([409, "already_exists"]);
    expect(await analystRow(org, other.id)).toMatchObject({ name: "Outro nome" });
    await newAnalyst(otherOwner, { name: "jev", decisionModel: "simulated" });
  });

  it("o modelo de decisão precisa estar instalado", async () => {
    // `nao_instalado` não existe em deciders/. O Laya serviu de exemplo até a fatia 8a, que o instalou.
    for (const decisionModel of ["nao_instalado", "", "JEV"]) {
      const result = await call(createAnalyst, { method: "POST", cookie: owner, body: { name: `M ${decisionModel}`, decisionModel } });
      expect([result.status, result.code]).toEqual([400, "validation_error"]);
    }
    const analyst = await newAnalyst(owner, { name: "Instalado", decisionModel: "simulated" });
    const patched = await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: analyst.id }, body: { decisionModel: "nao_instalado" } });
    expect([patched.status, patched.code]).toEqual([400, "validation_error"]);
    expect(await analystRow(org, analyst.id)).toMatchObject({ decision_model: "simulated" });
  });

  it("um analista de uma organização não aparece nem muda na outra", async () => {
    const theirs = await newAnalyst(otherOwner, { name: "Deles", decisionModel: "simulated", objections: [price] });
    expect((await call(getAnalyst, { cookie: owner, params: { id: theirs.id } })).status).toBe(404);
    expect((await call(listAnalysts, { cookie: owner })).data).not.toContainEqual(expect.objectContaining({ id: theirs.id }));
    expect((await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: theirs.id }, body: { name: "Meu" } })).status).toBe(404);
    expect((await call(deleteAnalyst, { method: "DELETE", cookie: owner, params: { id: theirs.id } })).status).toBe(404);
    expect(await analystRow(otherOrg, theirs.id)).toMatchObject({ name: "Deles" });
  });
});

describe("o analista do agente", () => {
  it("nasce nulo, aceita um analista desta organização e recusa o de outra", async () => {
    const mine = await newAnalyst(owner, { name: "Do agente", decisionModel: "simulated" });
    const theirs = await newAnalyst(otherOwner, { name: "De fora", decisionModel: "simulated" });
    const agent = await newAgent(owner, "Recepção analista");
    expect(await analystOfAgent(org, agent)).toBeNull();

    const linked = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: agent }, body: { analystId: mine.id } });
    expect([linked.status, linked.data]).toMatchObject([200, { analystId: mine.id }]);
    for (const analystId of [theirs.id, "00000000-0000-4000-8000-000000000000"]) {
      const refused = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: agent }, body: { analystId } });
      expect([refused.status, refused.code]).toEqual([400, "analyst_invalid"]);
      const onCreate = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Nova analista", engine: "simulated", analystId } });
      expect([onCreate.status, onCreate.code]).toEqual([400, "analyst_invalid"]);
    }
    expect(await analystOfAgent(org, agent)).toBe(mine.id);
    // Mudar outro campo não mexe no analista; nulo tira.
    expect((await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: agent }, body: { name: "Recepção!" } })).data).toMatchObject({ analystId: mine.id });
    expect((await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: agent }, body: { analystId: null } })).data).toMatchObject({ analystId: null });
    expect(await newAgent(owner, "Com analista", { analystId: mine.id })).toBeTruthy();
  });

  it("apagar o analista deixa os agentes com nulo e diz quantos perderam o analista", async () => {
    const analyst = await newAnalyst(owner, { name: "Apagável", decisionModel: "simulated" });
    const keeper = await newAnalyst(owner, { name: "Fica", decisionModel: "simulated" });
    const a = await newAgent(owner, "A", { analystId: analyst.id });
    const b = await newAgent(owner, "B", { analystId: analyst.id });
    const c = await newAgent(owner, "C", { analystId: keeper.id });
    const removed = await call(deleteAnalyst, { method: "DELETE", cookie: owner, params: { id: analyst.id } });
    expect([removed.status, removed.data]).toEqual([200, { agentsUnlinked: 2 }]);
    expect([await analystOfAgent(org, a), await analystOfAgent(org, b), await analystOfAgent(org, c)]).toEqual([null, null, keeper.id]);
  });
});

describe("modelo que processa fora do servidor (o Jev)", () => {
  it("sem a confirmação nomeando o fornecedor, a rota recusa e nada é gravado", async () => {
    for (const extra of [{}, { confirmedProvider: "openai" }]) {
      const result = await call(createAnalyst, { method: "POST", cookie: owner, body: { name: "Jev sem", decisionModel: "jev", ...extra } });
      expect(result.status).toBe(400);
      expect(result.code).toBe("confirmedProvider" in extra ? "provider_confirmation_invalid" : "provider_confirmation_required");
      expect(result.message).toContain("typesafe");
    }
    expect(await withOrg(panel.app, org, (q) => q.one("select 1 from analysts where name = 'Jev sem'"))).toBeNull();
    expect(await withOrg(panel.app, org, (q) => q.one("select 1 from organization_events where kind = 'analyst_provider_confirmed' and payload->>'analystName' = 'Jev sem'"))).toBeNull();
  });

  it("com a confirmação, grava quem confirmou e quando, e o recibo na mesma transação", async () => {
    panel.clock.at = new Date(NOW.getTime() + 60_000);
    const analyst = await newAnalyst(admin.cookie, { name: "Jev confirmado", decisionModel: "jev", confirmedProvider: "typesafe", objections: [price] });
    // A tela mostra quem confirmou pelo nome de hoje (fatia 4); o recibo guarda o do momento.
    expect(analyst).toMatchObject({ providerConfirmedBy: admin.id, providerConfirmedByName: "Test admin", providerConfirmedAt: panel.clock.at.toISOString() });
    expect((await call(getAnalyst, { cookie: owner, params: { id: analyst.id } })).data).toMatchObject({ providerConfirmedByName: "Test admin" });
    const [receipt, ...more] = await receipts(org, analyst.id);
    expect(more).toEqual([]);
    expect(receipt).toEqual({
      kind: "analyst_provider_confirmed",
      actor_user_id: admin.id,
      at: panel.clock.at,
      payload: { analystId: analyst.id, analystName: "Jev confirmado", decisionModel: "jev", provider: "typesafe", confirmedByName: "Test admin" },
    });
    // Nem e-mail nem texto da ligação no recibo; as objeções e a orientação também não.
    expect(JSON.stringify(receipt?.payload)).not.toMatch(/@|Reforce|price/);

    // Editar o nome ou as objeções com o mesmo modelo não pede de novo, nem grava outro recibo.
    const renamed = await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: analyst.id }, body: { name: "Jev 2", objections: [] } });
    expect([renamed.status, renamed.data]).toMatchObject([200, { name: "Jev 2", providerConfirmedBy: admin.id }]);
    expect(await receipts(org, analyst.id)).toHaveLength(1);
    panel.clock.at = NOW;
  });

  it("trocar por outro modelo que também processa fora pede a confirmação de novo, nomeando o novo fornecedor", async () => {
    const analyst = await newAnalyst(owner, { name: "Troca", decisionModel: "jev", confirmedProvider: "typesafe" });
    for (const extra of [{}, { confirmedProvider: "typesafe" }]) {
      const result = await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: analyst.id }, body: { decisionModel: "other_remote", ...extra } });
      expect(result.status).toBe(400);
      expect(result.message).toContain("acme");
    }
    expect(await analystRow(org, analyst.id)).toMatchObject({ decision_model: "jev" });
    const switched = await call(patchAnalyst, { method: "PATCH", cookie: admin.cookie, params: { id: analyst.id }, body: { decisionModel: "other_remote", confirmedProvider: "acme" } });
    expect([switched.status, switched.data]).toMatchObject([200, { decisionModel: "other_remote", providerConfirmedBy: admin.id }]);
    expect((await receipts(org, analyst.id)).map((r) => r.payload.provider)).toEqual(["typesafe", "acme"]);
  });

  it("com o simulado, não pede confirmação nem grava recibo; voltar ao Jev pede de novo", async () => {
    const analyst = await newAnalyst(owner, { name: "Vai e volta", decisionModel: "jev", confirmedProvider: "typesafe" });
    const local = await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: analyst.id }, body: { decisionModel: "simulated", confirmedProvider: "typesafe" } });
    expect([local.status, local.data]).toMatchObject([200, { decisionModel: "simulated", providerConfirmedBy: null, providerConfirmedByName: null, providerConfirmedAt: null }]);
    const simulated = await newAnalyst(owner, { name: "Só simulado", decisionModel: "simulated", confirmedProvider: "none" });
    expect(await receipts(org, simulated.id)).toEqual([]);
    expect(await receipts(org, analyst.id)).toHaveLength(1);

    const back = await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: analyst.id }, body: { decisionModel: "jev" } });
    expect([back.status, back.code]).toEqual([400, "provider_confirmation_required"]);
  });

  it("apagar quem confirmou zera provider_confirmed_by, e o recibo continua com o nome", async () => {
    const leaving = await createUser(panel.app, org, "admin");
    const analyst = await newAnalyst(leaving.cookie, { name: "Quem saiu", decisionModel: "jev", confirmedProvider: "typesafe" });
    expect((await call(removeMember, { method: "DELETE", cookie: owner, params: { id: leaving.id } })).status).toBe(200);

    expect(await analystRow(org, analyst.id)).toMatchObject({ provider_confirmed_by: null, provider_confirmed_at: NOW });
    // A tela diz "uma pessoa que não está mais na equipe": o nome some com a pessoa, e a hora fica.
    expect((await call(getAnalyst, { cookie: owner, params: { id: analyst.id } })).data).toMatchObject({ providerConfirmedBy: null, providerConfirmedByName: null, providerConfirmedAt: NOW.toISOString() });
    const [receipt] = await receipts(org, analyst.id);
    expect(receipt).toMatchObject({ actor_user_id: null, payload: { confirmedByName: "Test admin", provider: "typesafe", analystName: "Quem saiu" } });
    // A confirmação continua valendo para o mesmo modelo: a hora fica, e editar não pede de novo.
    expect((await call(patchAnalyst, { method: "PATCH", cookie: owner, params: { id: analyst.id }, body: { name: "Quem saiu 2" } })).status).toBe(200);
  });
});
