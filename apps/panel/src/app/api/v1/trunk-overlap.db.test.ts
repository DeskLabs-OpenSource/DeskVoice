// O aviso de faixa sobreposta (R8, fatia 10): salvar uma linha cuja faixa cruza a de outra
// organização tiraria do ar as linhas por IP das duas (`apps/voice/src/trunks.ts`). A rota pergunta
// ANTES de gravar, e a resposta não diz qual linha, de quem nem em que endereço.
import { randomUUID } from "node:crypto";
import { withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import enLine from "../../../i18n/en/line";
import esLine from "../../../i18n/es/line";
import ptBRLine from "../../../i18n/pt-BR/line";
import { PATCH as switchTrunkFilter } from "./trunks/[id]/inbound-filter/route";
import { PATCH as patchTrunk } from "./trunks/[id]/route";
import { POST as createTrunk } from "./trunks/route";

const panel = startPanel();

beforeEach(async () => {
  // A regra olha as linhas da instalação inteira: as que outros arquivos deixaram no banco
  // descartável mudariam o grupo. Cada teste começa só com as linhas das organizações dele.
  await withSystem(panel.app, (q) => q.exec("delete from trunks"));
  panel.voice.respond = () => Response.json({ applied: true, detail: "1 line(s) written, reloaded and listed by the telephony server.", skipped: [] });
});
afterAll(async () => {
  await panel.close();
});

const B_NAME = `Organização B ${randomUUID().slice(0, 8)}`;
const B_LINE = "Operadora da B";
const B_RANGE = "203.0.113.0/29";

/** Duas organizações; a B tem uma linha por IP em `203.0.113.0/29`. */
async function scene() {
  const a = await createOrganization(panel.app, `Organização A ${randomUUID().slice(0, 8)}`);
  const personA = await createUser(panel.app, a, "owner");
  const b = await createOrganization(panel.app, B_NAME);
  const personB = await createUser(panel.app, b, "owner");
  const created = await call(createTrunk, { method: "POST", cookie: personB.cookie, body: { name: B_LINE, host: B_RANGE, authMode: "ip" } });
  expect(created.status).toBe(200);
  const bTrunk = (created.data as { id: string }).id;
  const create = (body: Record<string, unknown>) => call(createTrunk, { method: "POST", cookie: personA.cookie, body: { name: "Linha da A", ...body } });
  const count = async (organizationId: string): Promise<number> =>
    (await withSystem(panel.app, (q) => q.one<{ n: number }>("select count(*)::int as n from trunks where organization_id = $1", [organizationId])))?.n ?? -1;
  return { a, b, personA, personB, bTrunk, create, count };
}

describe("aviso de faixa sobreposta", () => {
  it("T1: a linha por IP da A na faixa da B pede confirmação e não grava; com a confirmação, grava", async () => {
    const s = await scene();
    const refused = await s.create({ host: "203.0.113.5", authMode: "ip" });
    expect(refused).toMatchObject({ status: 409, code: "trunk_overlap_unconfirmed" });
    expect(await s.count(s.a)).toBe(0);
    expect(panel.voice.requests.some((request) => JSON.stringify(request).includes(s.a))).toBe(false);

    const saved = await s.create({ host: "203.0.113.5", authMode: "ip", confirmOverlap: true });
    expect(saved.status).toBe(200);
    expect(await s.count(s.a)).toBe(1);
  });

  it("T1: a edição que leva a linha para a faixa da B pede confirmação e não grava", async () => {
    const s = await scene();
    const mine = await s.create({ host: "198.51.100.9", authMode: "ip" });
    expect(mine.status).toBe(200);
    const id = (mine.data as { id: string }).id;
    const host = async (): Promise<string | undefined> =>
      (await withSystem(panel.app, (q) => q.one<{ host: string }>("select host from trunks where id = $1", [id])))?.host;

    const refused = await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { host: "203.0.113.6" } });
    expect(refused).toMatchObject({ status: 409, code: "trunk_overlap_unconfirmed" });
    expect(await host()).toBe("198.51.100.9");
    // O extra também conta: é o que entra no `identify` da linha por IP.
    const byExtra = await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { matchExtra: ["203.0.113.0/30"] } });
    expect(byExtra).toMatchObject({ status: 409, code: "trunk_overlap_unconfirmed" });

    const saved = await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { host: "203.0.113.6", confirmOverlap: true } });
    expect(saved.status).toBe(200);
    expect(await host()).toBe("203.0.113.6");
  });

  it("T2: a mesma faixa dentro da mesma organização não pergunta (é configuração repetida dela)", async () => {
    const s = await scene();
    const again = await call(createTrunk, { method: "POST", cookie: s.personB.cookie, body: { name: "Outra da B", host: "203.0.113.5", authMode: "ip" } });
    expect(again.status).toBe(200);
  });

  it("T2: com uma organização só na instalação, nunca pergunta", async () => {
    const only = await createOrganization(panel.app, `Sozinha ${randomUUID().slice(0, 8)}`);
    const person = await createUser(panel.app, only, "owner");
    for (const host of ["203.0.113.0/29", "203.0.113.5", "203.0.113.0/24"]) {
      expect((await call(createTrunk, { method: "POST", cookie: person.cookie, body: { name: host, host, authMode: "ip" } })).status).toBe(200);
    }
  });

  it("T3: a linha por registro da A com o servidor na faixa da B também pergunta (a linha por IP da B cai)", async () => {
    const s = await scene();
    const body = { host: "203.0.113.5", authMode: "register", username: "conta100", password: "segredo" };
    expect(await s.create(body)).toMatchObject({ status: 409, code: "trunk_overlap_unconfirmed" });
    expect(await s.count(s.a)).toBe(0);
    expect((await s.create({ ...body, confirmOverlap: true })).status).toBe(200);
  });

  it("a linha por registro da A com servidor por nome, ou com extras na faixa da B, não pergunta (não entra no `identify`)", async () => {
    const s = await scene();
    expect((await s.create({ host: "sip.operadora.example", authMode: "register", username: "conta100", password: "segredo" })).status).toBe(200);
    expect((await s.create({ host: "198.51.100.40", authMode: "register", username: "conta101", password: "segredo", matchExtra: ["203.0.113.4"] })).status).toBe(200);
  });

  it("T4: o 409 não traz id, nome, endereço nem a organização da linha da B", async () => {
    const s = await scene();
    const refused = await s.create({ host: "203.0.113.5", authMode: "ip" });
    expect(refused.status).toBe(409);
    for (const secret of [s.bTrunk, s.b, B_NAME, B_LINE, B_RANGE, "203.0.113.0", "Organização B"]) expect(refused.text).not.toContain(secret);
    expect(JSON.parse(refused.text)).toEqual({
      ok: false,
      error: {
        code: "trunk_overlap_unconfirmed",
        message:
          "Another organization of this installation has a line in a range that overlaps this one. If you save, the lines recognized by IP of both stop receiving calls until one of them changes its address.",
      },
    });
  });

  it("T4: a frase da tela é fixa, sem lacuna para nome ou endereço", () => {
    for (const t of [ptBRLine, enLine, esLine]) {
      for (const text of [t.overlapWarning, t.overlapSave, t.overlapBack]) expect(text).not.toMatch(/[{}]/);
    }
    expect(ptBRLine.overlapWarning).toBe(
      "Existe uma linha de outra organização desta instalação numa faixa que cruza esta. Se você salvar, as linhas por IP das duas param de receber chamadas, até uma delas mudar o endereço.",
    );
  });

  it("T6: mudar só o nome, o número ou o filtro de uma linha que já está num grupo misto não pergunta", async () => {
    const s = await scene();
    const mine = await s.create({ host: "203.0.113.5", authMode: "ip", confirmOverlap: true });
    const id = (mine.data as { id: string }).id;
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { name: "Novo nome" } })).status).toBe(200);
    // O formulário manda a linha inteira de volta: os mesmos endereços também não perguntam.
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { name: "Outro", host: "203.0.113.5", authMode: "ip", matchExtra: [] } })).status).toBe(200);
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personB.cookie, params: { id: s.bTrunk }, body: { name: "Renomeada" } })).status).toBe(200);
    // A rota do filtro de entrada não mexe em endereço: nunca pergunta.
    const reg = await s.create({ host: "203.0.113.6", authMode: "register", username: "conta100", password: "segredo", confirmOverlap: true });
    const filter = await call(switchTrunkFilter, { method: "PATCH", cookie: s.personA.cookie, params: { id: (reg.data as { id: string }).id }, body: { enabled: false } });
    expect(filter.status).toBe(200);
  });

  it("uma linha que já está fora (grupo misto) e muda de endereço dentro do grupo não pergunta: nada novo sai do ar", async () => {
    const s = await scene();
    const mine = await s.create({ host: "203.0.113.5", authMode: "ip", confirmOverlap: true });
    const id = (mine.data as { id: string }).id;
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { host: "203.0.113.4" } })).status).toBe(200);
    // Sair da faixa também não pergunta.
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { host: "198.51.100.9" } })).status).toBe(200);
  });
});
