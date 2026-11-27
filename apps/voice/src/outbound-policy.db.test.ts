import { withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { AsteriskCalls } from "./asterisk-transport";
import { startOutboundCall } from "./outbound";
import { checkOutboundAllowed, type OutboundDecision } from "./outbound-policy";
import { callsOf, createAgent, createOrganization, createPhoneNumber, createTrunk, eventsOf, fakeAri, fakeClock } from "./testing/db";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const TO = "+5531999998888";
// 10/05/2030 15:00 UTC = 12:00 em São Paulo (UTC-3).
const NOON_SP = new Date("2030-05-10T15:00:00Z");
const at = (iso: string) => ({ now: () => new Date(iso) });

async function organization(label: string, policy: Record<string, unknown> | null = {}): Promise<string> {
  const id = await createOrganization(app, label);
  if (policy) {
    const columns = { enabled: true, ...policy };
    const names = Object.keys(columns);
    await withSystem(app, (q) =>
      q.exec(`insert into outbound_policy (organization_id, ${names.join(", ")}) values ($1, ${names.map((_, index) => `$${index + 2}`).join(", ")})`, [id, ...Object.values(columns)]),
    );
  }
  return id;
}

const check = (organizationId: string, to: string, now: { now(): Date }, line?: string | null): Promise<OutboundDecision> =>
  withOrg(app, organizationId, (q) => checkOutboundAllowed(q, to, now, line));

const call = (organizationId: string, startedAt: string, options: { to?: string; from?: string | null; trunk?: string | null; direction?: string; status?: string } = {}): Promise<number> =>
  withSystem(app, (q) =>
    q.exec("insert into calls (organization_id, direction, channel, trunk_id, from_e164, to_e164, status, started_at) values ($1, $2, 'phone', $3, $4, $5, $6, $7)", [
      organizationId,
      options.direction ?? "outbound",
      options.trunk ?? null,
      options.from === undefined ? "+553133334444" : options.from,
      options.to ?? "+5531911110000",
      options.status ?? "completed",
      new Date(startedAt),
    ]),
  );

describe("checkOutboundAllowed", { timeout: 120_000 }, () => {
  it("permite quando a política está ligada e nada impede", async () => {
    const org = await organization("policy-ok");
    expect(await check(org, TO, at(NOON_SP.toISOString()))).toEqual({ allowed: true });
  });

  it("outbound_disabled: sem política nenhuma e com a política desligada (o padrão)", async () => {
    expect(await check(await organization("policy-none", null), TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "outbound_disabled" });
    expect(await check(await organization("policy-off", { enabled: false }), TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "outbound_disabled" });
    const defaults = await createOrganization(app, "policy-defaults");
    await withSystem(app, (q) => q.exec("insert into outbound_policy (organization_id) values ($1)", [defaults]));
    expect(await check(defaults, TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "outbound_disabled" });
  });

  it("do_not_call: o número é normalizado para E.164 antes de comparar", async () => {
    const org = await organization("policy-dnc");
    await withSystem(app, (q) => q.exec("insert into do_not_call (organization_id, e164, reason) values ($1, $2, 'pediu')", [org, TO]));
    for (const written of [TO, "(31) 99999-8888", "031999998888", "+55 31 99999 8888"]) {
      expect(await check(org, written, at(NOON_SP.toISOString())), written).toMatchObject({ allowed: false, code: "do_not_call" });
    }
    expect(await check(org, "+5531999997777", at(NOON_SP.toISOString()))).toEqual({ allowed: true });
    // A lista é da organização: a de outra não vale aqui.
    expect(await check(await organization("policy-dnc-other"), TO, at(NOON_SP.toISOString()))).toEqual({ allowed: true });
  });

  it("outside_window: a janela vale no fuso da política, não em UTC nem no da máquina", async () => {
    const org = await organization("policy-window"); // 09:00 às 20:00, America/Sao_Paulo
    // 11:59 UTC é 08:59 em São Paulo: fora, embora em UTC esteja dentro.
    expect(await check(org, TO, at("2030-05-10T11:59:00Z"))).toMatchObject({ allowed: false, code: "outside_window", message: expect.stringContaining("09:00 to 20:00 (America/Sao_Paulo)") });
    expect(await check(org, TO, at("2030-05-10T12:00:00Z"))).toEqual({ allowed: true });
    // 22:59 UTC é 19:59 em São Paulo: dentro, embora em UTC esteja fora.
    expect(await check(org, TO, at("2030-05-10T22:59:00Z"))).toEqual({ allowed: true });
    expect(await check(org, TO, at("2030-05-10T23:00:00Z"))).toMatchObject({ allowed: false, code: "outside_window" });

    // O mesmo instante, em outro fuso: 12:00 UTC é 21:00 em Tóquio.
    const tokyo = await organization("policy-window-tokyo", { timezone: "Asia/Tokyo" });
    expect(await check(tokyo, TO, at("2030-05-10T12:00:00Z"))).toMatchObject({ allowed: false, code: "outside_window" });
    expect(await check(tokyo, TO, at("2030-05-10T00:00:00Z"))).toEqual({ allowed: true });
  });

  it("janela que atravessa a meia-noite vale nas duas pontas", async () => {
    const org = await organization("policy-overnight", { window_start: "22:00", window_end: "06:00" });
    expect(await check(org, TO, at("2030-05-11T02:00:00Z"))).toEqual({ allowed: true }); // 23:00 em São Paulo
    expect(await check(org, TO, at("2030-05-11T08:59:00Z"))).toEqual({ allowed: true }); // 05:59
    expect(await check(org, TO, at("2030-05-11T09:00:00Z"))).toMatchObject({ code: "outside_window" }); // 06:00
    expect(await check(org, TO, at(NOON_SP.toISOString()))).toMatchObject({ code: "outside_window" });
  });

  it("daily_cap_reached: conta as ligações de saída do dia no fuso da política, por linha", async () => {
    const org = await organization("policy-cap", { daily_cap_per_line: 2 });
    const line = await createTrunk(app, org, { callerId: "+553133334444" });
    const other = await createTrunk(app, org, { callerId: "+553144445555" });
    // Ontem em São Paulo (02:30 UTC do dia 10 ainda é 23:30 do dia 9): não conta.
    await call(org, "2030-05-10T02:30:00Z", { trunk: line });
    // Hoje em São Paulo, a partir da meia-noite local (03:00 UTC).
    await call(org, "2030-05-10T03:00:00Z", { trunk: line });
    // Não contam: recebida, recusada pela política e feita por outra linha.
    await call(org, "2030-05-10T13:00:00Z", { trunk: line, direction: "inbound" });
    await call(org, "2030-05-10T13:00:00Z", { trunk: line, status: "refused" });
    await call(org, "2030-05-10T13:00:00Z", { trunk: other, from: "+553144445555" });
    expect(await check(org, TO, at(NOON_SP.toISOString()), line)).toEqual({ allowed: true });

    await call(org, "2030-05-10T14:00:00Z", { trunk: line });
    expect(await check(org, TO, at(NOON_SP.toISOString()), line)).toMatchObject({ allowed: false, code: "daily_cap_reached" });
    // A outra linha tem o teto dela.
    expect(await check(org, TO, at(NOON_SP.toISOString()), other)).toEqual({ allowed: true });
    // Sem dizer a linha, a conta é da organização inteira: 3 ligações hoje.
    expect(await check(org, TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "daily_cap_reached" });
    // No dia seguinte o teto recomeça.
    expect(await check(org, TO, at("2030-05-11T15:00:00Z"), line)).toEqual({ allowed: true });
  });

  it("daily_cap_reached: a conta segue a linha, e não o número; trocar o número não devolve ligações ao teto", async () => {
    const org = await organization("policy-cap-renumber", { daily_cap_per_line: 2 });
    const line = await createTrunk(app, org, { callerId: "+553133334444" });
    // Duas ligações hoje, com o número antigo.
    await call(org, "2030-05-10T13:00:00Z", { trunk: line, from: "+553133334444" });
    await call(org, "2030-05-10T14:00:00Z", { trunk: line, from: "+553133334444" });
    expect(await check(org, TO, at(NOON_SP.toISOString()), line)).toMatchObject({ code: "daily_cap_reached" });
    // A linha ganha outro número: o teto do dia segue cheio.
    await withSystem(app, (q) => q.exec("update trunks set caller_id_e164 = '+553155556666' where id = $1", [line]));
    expect(await check(org, TO, at(NOON_SP.toISOString()), line)).toMatchObject({ code: "daily_cap_reached" });
    // Outra linha que herda o número antigo não herda a conta da primeira.
    const reused = await createTrunk(app, org, { callerId: "+553133334444" });
    expect(await check(org, TO, at(NOON_SP.toISOString()), reused)).toEqual({ allowed: true });
  });

  it("daily_cap_reached pela porta única: a ligação grava a linha, e trocar o número no meio do dia não abre o teto", async () => {
    const org = await createOrganization(app, "cap-renumber-door");
    const agentId = await createAgent(app, org);
    const trunkId = await createTrunk(app, org, { callerId: "+553177770001" });
    await createPhoneNumber(app, org, trunkId, "+553177770001", agentId);
    await withSystem(app, (q) =>
      q.exec("insert into outbound_policy (organization_id, enabled, daily_cap_per_line, window_start, window_end, timezone) values ($1, true, 2, '00:00', '23:59', 'UTC')", [org]),
    );
    const ari = fakeAri();
    const clock = fakeClock();
    const deps = { db: app, ari, clock, calls: new AsteriskCalls({ ari, db: app, clock, log: () => undefined }), log: () => undefined };
    const dial = (to: string) => startOutboundCall(deps, { organizationId: org, agentId, toE164: to });

    expect(await dial("+5531911110001")).toMatchObject({ callId: expect.any(String) });
    // O número da linha muda (a tela da linha deixa): a contagem do dia fica com a linha.
    await withSystem(app, (q) => q.exec("update trunks set caller_id_e164 = '+553177770002' where id = $1", [trunkId]));
    expect(await dial("+5531911110002")).toMatchObject({ callId: expect.any(String) });
    await withSystem(app, (q) => q.exec("update trunks set caller_id_e164 = '+553177770003' where id = $1", [trunkId]));
    expect(await dial("+5531911110003")).toMatchObject({ code: "daily_cap_reached" });
    expect(ari.originated).toHaveLength(2);
    const lines = await withSystem(app, (q) => q.many<{ trunk_id: string | null; from_e164: string | null; status: string }>("select trunk_id, from_e164, status from calls where organization_id = $1 order by started_at, id", [org]));
    expect(lines.map((row) => row.trunk_id)).toEqual([trunkId, trunkId, trunkId]);
    expect(lines.map((row) => row.status).sort()).toEqual(["refused", "ringing", "ringing"]);
  });

  it("attempts_exhausted: conta as ligações de saída para aquele número, em qualquer dia", async () => {
    const org = await organization("policy-attempts", { max_attempts_per_contact: 2 });
    await call(org, "2030-05-01T15:00:00Z", { to: TO });
    await call(org, "2030-05-02T15:00:00Z", { to: TO, status: "refused" });
    await call(org, "2030-05-02T15:00:00Z", { to: TO, direction: "inbound" });
    expect(await check(org, TO, at(NOON_SP.toISOString()))).toEqual({ allowed: true });
    await call(org, "2030-05-03T15:00:00Z", { to: TO, status: "failed" });
    expect(await check(org, "(31) 99999-8888", at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "attempts_exhausted" });
    expect(await check(org, "+5531999997777", at(NOON_SP.toISOString()))).toEqual({ allowed: true });
  });

  it("cada recusa traz código e mensagem; a ordem é desligada, não ligar, janela, teto, tentativas", async () => {
    const org = await organization("policy-order", { daily_cap_per_line: 0, max_attempts_per_contact: 0 });
    await withSystem(app, (q) => q.exec("insert into do_not_call (organization_id, e164) values ($1, $2)", [org, TO]));
    const night = at("2030-05-10T05:00:00Z");
    expect(await check(org, TO, night)).toMatchObject({ code: "do_not_call", message: expect.stringContaining(TO) });
    expect(await check(org, "+5531999997777", night)).toMatchObject({ code: "outside_window" });
    expect(await check(org, "+5531999997777", at(NOON_SP.toISOString()))).toMatchObject({ code: "daily_cap_reached" });
  });

  it("organization_suspended: a organização suspensa não liga, nem com a política ligada; a outra da instalação segue", async () => {
    const suspended = await organization("policy-suspended");
    const other = await organization("policy-suspended-other");
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = $2, suspended_reason = 'teste da fatia 4a' where id = $1", [suspended, NOON_SP]));
    expect(await check(suspended, TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "organization_suspended" });
    expect(await check(other, TO, at(NOON_SP.toISOString()))).toEqual({ allowed: true });
  });

  // A trava da administração da instalação (seção 3.4 do R8, fatia 7b). Gravada direto no banco, pelo
  // papel de sistema: quem grava pela tela é a rota da instalação, testada no painel.
  const lock = (organizationId: string, outboundAllowed: boolean) =>
    withSystem(app, (q) =>
      q.exec(
        "insert into organization_limits (organization_id, outbound_allowed) values ($1, $2) on conflict (organization_id) do update set outbound_allowed = excluded.outbound_allowed",
        [organizationId, outboundAllowed],
      ),
    );

  it("T1: outbound_allowed = true não liga a saída de quem a tem desligada; com a política ligada, permite", async () => {
    const off = await organization("lock-true-off", { enabled: false });
    await lock(off, true);
    expect(await check(off, TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "outbound_disabled" });
    const none = await organization("lock-true-none", null);
    await lock(none, true);
    expect(await check(none, TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "outbound_disabled" });
    const on = await organization("lock-true-on");
    await lock(on, true);
    expect(await check(on, TO, at(NOON_SP.toISOString()))).toEqual({ allowed: true });
  });

  it("T2: outbound_allowed = false recusa com a política ligada, antes da política; a política fica como estava", async () => {
    const org = await organization("lock-false");
    const other = await organization("lock-false-other");
    await lock(org, false);
    expect(await check(org, TO, at(NOON_SP.toISOString()))).toEqual({
      allowed: false,
      code: "outbound_not_allowed",
      message: "Outbound calls were turned off for this organization by the installation administration.",
    });
    // A trava vem antes de não ligar e da janela: a recusa é dela, e não da política.
    await withSystem(app, (q) => q.exec("insert into do_not_call (organization_id, e164) values ($1, $2)", [org, TO]));
    expect(await check(org, TO, at("2030-05-10T05:00:00Z"))).toMatchObject({ code: "outbound_not_allowed" });
    expect(await withSystem(app, (q) => q.one("select enabled from outbound_policy where organization_id = $1", [org]))).toEqual({ enabled: true });
    expect(await check(other, "+5531999997777", at(NOON_SP.toISOString()))).toEqual({ allowed: true });
    // Destravar devolve a escolha da organização.
    await lock(org, true);
    expect(await check(org, "+5531999997777", at(NOON_SP.toISOString()))).toEqual({ allowed: true });
  });

  it("T2: pela porta única, a ligação nasce recusada com o motivo, e nenhum canal é originado", async () => {
    const line = async (label: string, number: string) => {
      const organizationId = await createOrganization(app, label);
      const agentId = await createAgent(app, organizationId);
      const trunkId = await createTrunk(app, organizationId, { callerId: number });
      await createPhoneNumber(app, organizationId, trunkId, number, agentId);
      await withSystem(app, (q) =>
        q.exec("insert into outbound_policy (organization_id, enabled, window_start, window_end, timezone) values ($1, true, '00:00', '23:59', 'UTC')", [organizationId]),
      );
      return { organizationId, agentId };
    };
    const locked = await line("lock-outbound", "+553177776666");
    const free = await line("lock-outbound-other", "+553177775555");
    await lock(locked.organizationId, false);
    const ari = fakeAri();
    const clock = fakeClock();
    const deps = { db: app, ari, clock, calls: new AsteriskCalls({ ari, db: app, clock, log: () => undefined }), log: () => undefined };

    const refused = await startOutboundCall(deps, { organizationId: locked.organizationId, agentId: locked.agentId, toE164: "+5531911112222" });
    expect(refused).toMatchObject({ code: "outbound_not_allowed" });
    const calls = await callsOf(app, locked.organizationId);
    expect(calls).toMatchObject([{ direction: "outbound", status: "refused", end_reason: "outbound_not_allowed" }]);
    expect(await eventsOf(app, calls[0]?.id ?? "")).toEqual([{ kind: "call_refused", payload: { reason: "outbound_not_allowed", message: expect.any(String), to: "+5531911112222" } }]);
    expect(ari.originated).toEqual([]);

    expect(await startOutboundCall(deps, { organizationId: free.organizationId, agentId: free.agentId, toE164: "+5531911112222" })).toMatchObject({ callId: expect.any(String) });
    expect(ari.originated).toHaveLength(1);
  });

  it("T3: suspensa e travada, a recusa é da suspensão", async () => {
    const org = await organization("lock-suspended");
    await lock(org, false);
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = $2, suspended_reason = 'teste da fatia 7b' where id = $1", [org, NOON_SP]));
    expect(await check(org, TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "organization_suspended" });
  });
});
