// "Pode passar a ligação para" pela API do agente (fatia 4b do desenho de 13/11, seção 4.2; registro
// 0020): a escrita confere os destinos com motivo legível, sempre dentro da organização (`withOrg`),
// e apagar um agente tira o id dele da lista dos outros.
import { createDb, withOrg, withSystem } from "@deskvoice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forceHandoffTargets } from "../../../../../../packages/core/test/helpers";
import { call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import { requireHandoffTargets } from "../../../server/shapes";
import { DELETE as deleteAgent, GET as getAgent, PATCH as patchAgent } from "./agents/[id]/route";
import { GET as listAgents, POST as createAgent } from "./agents/route";

const panel = startPanel();
// O dono do schema: só ele desliga o gatilho de checagem, para plantar o caso que não existe por construção.
const schemaOwner = createDb(process.env.TEST_MIGRATION_DATABASE_URL ?? "");
let org: string;
let otherOrg: string;
let owner: string;
let admin: string;
let operator: string;
let otherOwner: string;

beforeAll(async () => {
  org = await createOrganization(panel.app, "handoff-targets");
  otherOrg = await createOrganization(panel.app, "handoff-targets-other");
  owner = (await createUser(panel.app, org, "owner")).cookie;
  admin = (await createUser(panel.app, org, "admin")).cookie;
  operator = (await createUser(panel.app, org, "operator")).cookie;
  otherOwner = (await createUser(panel.app, otherOrg, "owner")).cookie;
});
afterAll(async () => {
  await schemaOwner.close();
  await panel.close();
});

const newAgent = async (cookie: string, name: string, extra: Record<string, unknown> = {}): Promise<string> => {
  const created = await call(createAgent, { method: "POST", cookie, body: { name, engine: "simulated", ...extra } });
  expect(created.status).toBe(200);
  return (created.data as { id: string }).id;
};
const targetsOf = (organizationId: string, id: string): Promise<string[] | undefined> =>
  withOrg(panel.app, organizationId, async (q) => (await q.one<{ agent_handoff_targets: string[] }>("select agent_handoff_targets from agents where id = $1", [id]))?.agent_handoff_targets);

describe("Pode passar a ligação para", () => {
  it("vem vazia de fábrica, e quem pode editar o agente marca e desmarca os destinos", async () => {
    const recepcao = await newAgent(owner, "Recepção");
    const vendas = await newAgent(owner, "Vendas");
    const agenda = await newAgent(owner, "Agenda");
    expect((await call(getAgent, { cookie: owner, params: { id: recepcao } })).data).toMatchObject({ agentHandoffTargets: [] });

    const saved = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets: [vendas, agenda, vendas] } });
    expect([saved.status, saved.data]).toMatchObject([200, { agentHandoffTargets: [vendas, agenda] }]);
    expect(await targetsOf(org, recepcao)).toEqual([vendas, agenda]);
    // Mudar outro campo não mexe na lista.
    expect((await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { name: "Recepção!" } })).data).toMatchObject({ agentHandoffTargets: [vendas, agenda] });
    // A administradora também marca; a lista de agentes devolve o campo.
    expect((await call(patchAgent, { method: "PATCH", cookie: admin, params: { id: recepcao }, body: { agentHandoffTargets: [agenda] } })).status).toBe(200);
    expect((await call(listAgents, { cookie: owner })).data).toContainEqual(expect.objectContaining({ id: recepcao, agentHandoffTargets: [agenda] }));
    // A criação também aceita.
    const nova = await newAgent(owner, "Triagem", { agentHandoffTargets: [vendas] });
    expect(await targetsOf(org, nova)).toEqual([vendas]);
    // O operador lê, mas não muda.
    const refused = await call(patchAgent, { method: "PATCH", cookie: operator, params: { id: recepcao }, body: { agentHandoffTargets: [] } });
    expect([refused.status, refused.code]).toEqual([403, "forbidden"]);
    expect(await targetsOf(org, recepcao)).toEqual([agenda]);
    expect((await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets: [] } })).data).toMatchObject({ agentHandoffTargets: [] });
  });

  it("o próprio agente, um que não existe e um de outra organização voltam erro legível, e nada é gravado", async () => {
    const recepcao = await newAgent(owner, "Recepção B");
    const vendas = await newAgent(owner, "Vendas B");
    const intruso = await newAgent(otherOwner, "Intruso");
    await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets: [vendas] } });

    const cases: unknown[][] = [[recepcao], [vendas, recepcao], ["00000000-0000-4000-8000-000000000000"], [intruso], [vendas, intruso]];
    for (const agentHandoffTargets of cases) {
      const result = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets } });
      expect([result.status, result.code]).toEqual([400, "handoff_target_invalid"]);
    }
    expect(await targetsOf(org, recepcao)).toEqual([vendas]);
    const onCreate = await call(createAgent, { method: "POST", cookie: owner, body: { name: "Nova B", engine: "simulated", agentHandoffTargets: [intruso] } });
    expect([onCreate.status, onCreate.code]).toEqual([400, "handoff_target_invalid"]);
    // Um texto que não é id é erro de validação, também com motivo.
    const malformed = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets: ["vendas"] } });
    expect([malformed.status, malformed.code]).toEqual([400, "validation_error"]);
    // A outra organização também não marca um agente desta.
    const reverse = await call(patchAgent, { method: "PATCH", cookie: otherOwner, params: { id: intruso }, body: { agentHandoffTargets: [vendas] } });
    expect([reverse.status, reverse.code]).toEqual([400, "handoff_target_invalid"]);
    expect(await targetsOf(otherOrg, intruso)).toEqual([]);
  });

  it("apagar um destino pelo painel tira o id dele da lista, e o agente que o tinha continua editável", async () => {
    const recepcao = await newAgent(owner, "Recepção C");
    const vendas = await newAgent(owner, "Vendas C");
    const agenda = await newAgent(owner, "Agenda C");
    await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets: [vendas, agenda] } });
    await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: agenda }, body: { agentHandoffTargets: [vendas] } });
    // Um agente de outra organização com o mesmo id na lista não existe por construção; plantado
    // por fora do gatilho, ele mostra que a limpeza não sai da organização de quem foi apagado.
    const intruso = await newAgent(otherOwner, "Intruso C");
    await forceHandoffTargets(schemaOwner, intruso, [vendas]);

    expect((await call(deleteAgent, { method: "DELETE", cookie: owner, params: { id: vendas } })).status).toBe(200);
    expect(await targetsOf(org, recepcao)).toEqual([agenda]);
    expect(await targetsOf(org, agenda)).toEqual([]);
    expect(await targetsOf(otherOrg, intruso)).toEqual([vendas]);

    const renamed = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { name: "Recepção C2" } });
    expect([renamed.status, renamed.data]).toMatchObject([200, { name: "Recepção C2", agentHandoffTargets: [agenda] }]);
    const both = await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: agenda }, body: { name: "Agenda C2", agentHandoffTargets: [recepcao] } });
    expect([both.status, both.data]).toMatchObject([200, { agentHandoffTargets: [recepcao] }]);
  });
  it("pelo caminho de sistema, que atravessa o isolamento por linha, a limpeza continua só na organização de quem foi apagado", async () => {
    const recepcao = await newAgent(owner, "Recepção D");
    const vendas = await newAgent(owner, "Vendas D");
    await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets: [vendas] } });
    const intruso = await newAgent(otherOwner, "Intruso D");
    await forceHandoffTargets(schemaOwner, intruso, [vendas]);
    await withSystem(panel.app, (q) => q.exec("delete from agents where id = $1", [vendas]));
    expect(await targetsOf(org, recepcao)).toEqual([]);
    expect(await targetsOf(otherOrg, intruso)).toEqual([vendas]);
  });

  it("apagar dois destinos numa instrução só tira os dois da lista, e os que ficam mantêm a ordem (ressalva do PR 306)", async () => {
    const recepcao = await newAgent(owner, "Recepção E");
    const vendas = await newAgent(owner, "Vendas E");
    const agenda = await newAgent(owner, "Agenda E");
    const suporte = await newAgent(owner, "Suporte E");
    const triagem = await newAgent(owner, "Triagem E");
    await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: recepcao }, body: { agentHandoffTargets: [vendas, suporte, agenda] } });
    await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: triagem }, body: { agentHandoffTargets: [agenda, vendas] } });
    // Antes, a limpeza de Vendas deixava Agenda (já apagada) na lista, e a checagem recusava com `check_violation`.
    expect(await withOrg(panel.app, org, (q) => q.exec("delete from agents where id = any($1::uuid[])", [[vendas, agenda]]))).toBe(2);
    expect(await targetsOf(org, recepcao)).toEqual([suporte]);
    expect(await targetsOf(org, triagem)).toEqual([]);
    // Pelo caminho de sistema também, com o próprio dono da lista na mesma instrução.
    const outro = await newAgent(owner, "Outro E");
    await call(patchAgent, { method: "PATCH", cookie: owner, params: { id: suporte }, body: { agentHandoffTargets: [outro, recepcao] } });
    await withSystem(panel.app, (q) => q.exec("delete from agents where id = any($1::uuid[])", [[outro, recepcao, triagem]]));
    expect(await targetsOf(org, suporte)).toEqual([]);
  });
});

/** Alguém do banco espera uma trava numa consulta que contém `text`. */
async function someoneWaitsOn(text: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    // Pelo papel da aplicação, o mesmo das duas transações: só ele lê o texto da consulta delas.
    const waiting = await withOrg(panel.app, org, (q) =>
      q.one<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and position($1 in query) > 0", [text]),
    );
    if ((waiting?.n ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

describe("a corrida entre marcar um destino e apagá-lo (ressalva do PR 306)", () => {
  it("o destino conferido fica travado até a escrita acabar: o apagamento espera e depois o tira da lista", async () => {
    const recepcao = await newAgent(owner, "Recepção F");
    const vendas = await newAgent(owner, "Vendas F");
    let release: () => void = () => undefined;
    let checked: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const didCheck = new Promise<void>((resolve) => (checked = resolve));
    // A escrita do agente, como na rota: confere os destinos, e só depois grava. Entre as duas, alguém apaga o destino.
    const saving = withOrg(panel.app, org, async (q) => {
      await requireHandoffTargets(q, recepcao, [vendas]);
      checked();
      await held;
      await q.exec("update agents set agent_handoff_targets = $2 where id = $1", [recepcao, [vendas]]);
    });
    await didCheck;
    const deleting = call(deleteAgent, { method: "DELETE", cookie: owner, params: { id: vendas } });
    try {
      // Com a trava, o apagamento espera a escrita. Sem ela, apagaria antes, e a escrita cairia em
      // `check_violation`, que a pessoa leria como erro cru.
      expect(await someoneWaitsOn("delete from agents")).toBe(true);
    } finally {
      release();
    }
    await saving;
    expect((await deleting).status).toBe(200);
    // O apagamento veio depois da escrita, e a limpeza tirou o destino da lista.
    expect(await targetsOf(org, recepcao)).toEqual([]);
  });
});
