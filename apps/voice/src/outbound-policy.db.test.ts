import { withOrg, withSystem } from "@deskvoice/core";
import { afterAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { checkOutboundAllowed, type OutboundDecision } from "./outbound-policy";
import { createOrganization } from "./testing/db";

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

const call = (organizationId: string, startedAt: string, options: { to?: string; from?: string | null; direction?: string; status?: string } = {}): Promise<number> =>
  withSystem(app, (q) =>
    q.exec("insert into calls (organization_id, direction, from_e164, to_e164, status, started_at) values ($1, $2, $3, $4, $5, $6)", [
      organizationId,
      options.direction ?? "outbound",
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
    const line = "+553133334444";
    // Ontem em São Paulo (02:30 UTC do dia 10 ainda é 23:30 do dia 9): não conta.
    await call(org, "2030-05-10T02:30:00Z");
    // Hoje em São Paulo, a partir da meia-noite local (03:00 UTC).
    await call(org, "2030-05-10T03:00:00Z");
    // Não contam: recebida, recusada pela política e feita por outra linha.
    await call(org, "2030-05-10T13:00:00Z", { direction: "inbound" });
    await call(org, "2030-05-10T13:00:00Z", { status: "refused" });
    await call(org, "2030-05-10T13:00:00Z", { from: "+553144445555" });
    expect(await check(org, TO, at(NOON_SP.toISOString()), line)).toEqual({ allowed: true });

    await call(org, "2030-05-10T14:00:00Z");
    expect(await check(org, TO, at(NOON_SP.toISOString()), line)).toMatchObject({ allowed: false, code: "daily_cap_reached" });
    // A outra linha tem o teto dela.
    expect(await check(org, TO, at(NOON_SP.toISOString()), "+553144445555")).toEqual({ allowed: true });
    // Sem dizer a linha, a conta é da organização inteira: 3 ligações hoje.
    expect(await check(org, TO, at(NOON_SP.toISOString()))).toMatchObject({ allowed: false, code: "daily_cap_reached" });
    // No dia seguinte o teto recomeça.
    expect(await check(org, TO, at("2030-05-11T15:00:00Z"), line)).toEqual({ allowed: true });
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
});
