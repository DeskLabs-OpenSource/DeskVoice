// O aviso de faixa sobreposta (R8, fatia 10): salvar uma linha cuja faixa cruza a de outra
// organização tiraria do ar as linhas por IP das duas (`apps/voice/src/trunks.ts`). A rota pergunta
// ANTES de gravar, e a resposta não diz qual linha, de quem nem em que endereço.
import { randomUUID } from "node:crypto";
import { withSystem } from "@deskvoice/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NOW, call, createOrganization, createUser, startPanel } from "../../../../test/kit";
import enLine from "../../../i18n/en/line";
import esLine from "../../../i18n/es/line";
import ptBRLine from "../../../i18n/pt-BR/line";
import { GET as installationEvents } from "./installation/events/route";
import { PATCH as switchTrunkFilter } from "./trunks/[id]/inbound-filter/route";
import { PATCH as patchTrunk } from "./trunks/[id]/route";
import { POST as createTrunk } from "./trunks/route";
import { TRUNK_OVERLAP_CHECKS_PER_MINUTE, trunkOverlapLimiter } from "./trunks/store";

const panel = startPanel();

beforeEach(async () => {
  // A regra olha as linhas da instalação inteira: as que outros arquivos deixaram no banco
  // descartável mudariam o grupo. Cada teste começa só com as linhas das organizações dele.
  await withSystem(panel.app, (q) => q.exec("delete from trunks"));
  // O limite por minuto é do processo e o relógio de teste é fixo: cada teste começa do zero.
  trunkOverlapLimiter.clear();
  panel.clock.at = NOW;
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

const accountOf = async (userId: string): Promise<string> =>
  (await withSystem(panel.app, (q) => q.one<{ id: string }>("select account_id as id from users where id = $1", [userId])))?.id ?? "";
/** As linhas inteiras dos eventos `trunk_overlap_refused` da organização, como estão no banco. */
const refusedEvents = (organizationId: string) =>
  withSystem(panel.app, (q) =>
    q.many<{ row: Record<string, unknown> }>("select to_jsonb(e) as row from installation_events e where kind = 'trunk_overlap_refused' and organization_id = $1 order by id", [
      organizationId,
    ]),
  );

/** As linhas inteiras dos eventos `trunk_overlap_confirmed` da organização, como estão no banco. */
const confirmedEvents = (organizationId: string) =>
  withSystem(panel.app, (q) =>
    q.many<{ row: Record<string, unknown> }>("select to_jsonb(e) as row from installation_events e where kind = 'trunk_overlap_confirmed' and organization_id = $1 order by id", [
      organizationId,
    ]),
  );

describe("auditoria e limite da conferência de faixa", () => {
  it("T7: um 409 grava exatamente 1 evento, com a organização e a conta de quem tentou, e nada da outra organização", async () => {
    const s = await scene();
    const tried = "203.0.113.5";
    expect(await s.create({ host: tried, authMode: "ip" })).toMatchObject({ status: 409, code: "trunk_overlap_unconfirmed" });
    expect(await s.count(s.a)).toBe(0);
    const events = await refusedEvents(s.a);
    expect(events).toHaveLength(1);
    const row = events[0]?.row ?? {};
    expect(row).toMatchObject({ kind: "trunk_overlap_refused", organization_id: s.a, actor_account_id: await accountOf(s.personA.id), payload: {} });
    const text = JSON.stringify(row);
    for (const secret of [s.bTrunk, s.b, B_NAME, B_LINE, B_RANGE, "203.0.113", tried, "Organização B", await accountOf(s.personB.id)]) expect(text).not.toContain(secret);
    // A B não ganhou evento nenhum.
    expect(await refusedEvents(s.b)).toEqual([]);
  });

  it("T8: o evento aparece na auditoria da instalação para quem a administra; a conta só da A recebe 403", async () => {
    const s = await scene();
    expect((await s.create({ host: "203.0.113.5", authMode: "ip" })).status).toBe(409);
    const admin = await createUser(panel.app, await createOrganization(panel.app, `Instalação ${randomUUID().slice(0, 8)}`), "owner");
    await withSystem(panel.app, async (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [await accountOf(admin.id), NOW]));
    const listed = await call(installationEvents, { cookie: admin.cookie });
    expect(listed.status).toBe(200);
    const mine = (listed.data as Array<{ kind: string; organizationId: string | null }>).filter((event) => event.kind === "trunk_overlap_refused" && event.organizationId === s.a);
    expect(mine).toHaveLength(1);
    expect((await call(installationEvents, { cookie: s.personA.cookie })).status).toBe(403);
  });

  it("T9: a 11ª conferência da A no mesmo minuto recebe 429, sem salvar e sem evento; 60 s depois volta a conferir", async () => {
    const s = await scene();
    // Conferências que respondem "não" também gastam: 9 que salvam e 1 que recusa.
    for (let index = 1; index < TRUNK_OVERLAP_CHECKS_PER_MINUTE; index += 1) {
      expect((await s.create({ name: `Livre ${index}`, host: `198.51.100.${index}`, authMode: "ip" })).status).toBe(200);
    }
    expect((await s.create({ host: "203.0.113.5", authMode: "ip" })).status).toBe(409);
    const before = await s.count(s.a);
    expect(before).toBe(TRUNK_OVERLAP_CHECKS_PER_MINUTE - 1);
    expect(await refusedEvents(s.a)).toHaveLength(1);

    const limited = await s.create({ host: "203.0.113.5", authMode: "ip" });
    expect(JSON.parse(limited.text)).toEqual({ ok: false, error: { code: "too_many_attempts", message: "Too many attempts. Wait a minute and try again." } });
    expect(limited.status).toBe(429);
    // Também a que salvaria: acima do teto, nada confere.
    expect((await s.create({ name: "Livre 99", host: "198.51.100.99", authMode: "ip" })).status).toBe(429);
    expect(await s.count(s.a)).toBe(before);
    expect(await refusedEvents(s.a)).toHaveLength(1);

    panel.clock.at = new Date(NOW.getTime() + 60_000);
    expect(await s.create({ host: "203.0.113.5", authMode: "ip" })).toMatchObject({ status: 409, code: "trunk_overlap_unconfirmed" });
    expect(await refusedEvents(s.a)).toHaveLength(2);
  });

  it("T10: a A no teto não afeta a B, que confere normalmente no mesmo minuto", async () => {
    const s = await scene();
    // A A tem uma linha por IP (a confirmação também gasta tentativa), e chega ao teto.
    expect((await s.create({ host: "198.51.100.7", authMode: "ip", confirmOverlap: true })).status).toBe(200);
    for (let index = 1; index < TRUNK_OVERLAP_CHECKS_PER_MINUTE; index += 1) expect((await s.create({ host: "203.0.113.5", authMode: "ip" })).status).toBe(409);
    expect((await s.create({ host: "203.0.113.5", authMode: "ip" })).status).toBe(429);
    // A B, na faixa da linha da A, recebe a pergunta.
    const fromB = await call(createTrunk, { method: "POST", cookie: s.personB.cookie, body: { name: "Outra da B", host: "198.51.100.7", authMode: "ip" } });
    expect(fromB).toMatchObject({ status: 409, code: "trunk_overlap_unconfirmed" });
    expect(await refusedEvents(s.b)).toHaveLength(1);
  });

  it("T11: a confirmação também gasta tentativa: com a A no teto, até a confirmação recebe 429, sem salvar e sem evento; trocar só o nome passa", async () => {
    const s = await scene();
    const mine = await s.create({ host: "198.51.100.9", authMode: "ip" });
    expect(mine.status).toBe(200);
    const id = (mine.data as { id: string }).id;
    for (let index = 1; index < TRUNK_OVERLAP_CHECKS_PER_MINUTE; index += 1) expect((await s.create({ host: "203.0.113.5", authMode: "ip" })).status).toBe(409);
    expect((await s.create({ host: "203.0.113.5", authMode: "ip" })).status).toBe(429);
    const refused = (await refusedEvents(s.a)).length;

    const limited = await s.create({ host: "203.0.113.5", authMode: "ip", confirmOverlap: true });
    expect(limited).toMatchObject({ status: 429, code: "too_many_attempts" });
    expect(await s.count(s.a)).toBe(1);
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { host: "203.0.113.2", confirmOverlap: true } })).status).toBe(429);
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { name: "Novo nome" } })).status).toBe(200);
    expect(await refusedEvents(s.a)).toHaveLength(refused);
    expect(await confirmedEvents(s.a)).toEqual([]);

    panel.clock.at = new Date(NOW.getTime() + 60 * 1000);
    expect((await s.create({ host: "203.0.113.5", authMode: "ip", confirmOverlap: true })).status).toBe(200);
  });

  it("T12: a confirmação que tira do ar a linha de outra organização grava 1 evento, com a organização e a conta de quem salvou, e nada da outra", async () => {
    const s = await scene();
    const tried = "203.0.113.5";
    const saved = await s.create({ host: tried, authMode: "ip", confirmOverlap: true });
    expect(saved.status).toBe(200);
    const events = await confirmedEvents(s.a);
    expect(events).toHaveLength(1);
    const row = events[0]?.row ?? {};
    expect(row).toMatchObject({ kind: "trunk_overlap_confirmed", organization_id: s.a, actor_account_id: await accountOf(s.personA.id), payload: {} });
    const text = JSON.stringify(row);
    for (const secret of [s.bTrunk, s.b, B_NAME, B_LINE, B_RANGE, "203.0.113", tried, "Organização B", await accountOf(s.personB.id)]) expect(text).not.toContain(secret);
    expect(await confirmedEvents(s.b)).toEqual([]);
    // A edição confirmada que leva outra linha para a faixa também grava.
    const other = await s.create({ host: "198.51.100.9", authMode: "ip" });
    const id = (other.data as { id: string }).id;
    expect((await call(patchTrunk, { method: "PATCH", cookie: s.personA.cookie, params: { id }, body: { host: "203.0.113.6", confirmOverlap: true } })).status).toBe(200);
    expect(await confirmedEvents(s.a)).toHaveLength(2);
    // Quem administra a instalação vê o evento.
    const admin = await createUser(panel.app, await createOrganization(panel.app, `Instalação ${randomUUID().slice(0, 8)}`), "owner");
    await withSystem(panel.app, async (q) => q.exec("update accounts set installation_admin_at = $2 where id = $1", [await accountOf(admin.id), NOW]));
    const listed = await call(installationEvents, { cookie: admin.cookie });
    const shown = (listed.data as Array<{ kind: string; organizationId: string | null }>).filter((event) => event.kind === "trunk_overlap_confirmed" && event.organizationId === s.a);
    expect(shown).toHaveLength(2);
  });

  it("T12: a confirmação que não tira linha nenhuma do ar não grava evento (a tela manda a confirmação só depois do aviso, mas a rota não confia nisso)", async () => {
    const s = await scene();
    expect((await s.create({ host: "198.51.100.7", authMode: "ip", confirmOverlap: true })).status).toBe(200);
    expect((await s.create({ host: "203.0.113.5", authMode: "ip", confirmOverlap: false })).status).toBe(409);
    expect(await confirmedEvents(s.a)).toEqual([]);
  });
});
