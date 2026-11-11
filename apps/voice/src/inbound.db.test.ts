import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_INBOUND_LIMIT, INBOUND_LIMIT_SETTING, withSystem, type Clock } from "@deskvoice/core";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting } from "../../../packages/tools/test/helpers";
import type { AriChannel } from "./ari";
import { AsteriskCalls, type ExpectedCall } from "./asterisk-transport";
import { handleInbound } from "./inbound";
import { callsOf, createAgent, createCall, createOrganization, createPhoneNumber, createTrunk, eventsOf, fakeAri, fakeClock, type FakeAri } from "./testing/db";

const { app, owner } = openTestDbs();
afterAll(async () => {
  await app.close();
  await owner.close();
});

const NUMBER = "+553133334444";
const channel = (trunkId: string, exten: string, id = "canal-1", caller = "31999998888"): AriChannel => ({ id, name: `PJSIP/trunk-${trunkId}-0000002a`, dialplan: { exten }, caller: { number: caller } });

async function receive(incoming: AriChannel, clock: Clock = fakeClock()): Promise<{ ari: FakeAri; expected: ExpectedCall[] }> {
  const ari = fakeAri();
  const expected: ExpectedCall[] = [];
  const calls = new AsteriskCalls({ ari, db: app, clock, log: () => undefined });
  calls.expect = (call) => void expected.push(call);
  await handleInbound({ db: app, ari, clock, calls, log: () => undefined }, incoming);
  return { ari, expected };
}

async function line(label: string, options: { agent?: "none" | "disabled"; numbers?: string[] } = {}) {
  const organizationId = await createOrganization(app, label);
  const agentId = options.agent === "none" ? null : await createAgent(app, organizationId, { enabled: options.agent !== "disabled" });
  const trunkId = await createTrunk(app, organizationId);
  for (const number of options.numbers ?? [NUMBER]) await createPhoneNumber(app, organizationId, trunkId, number, agentId);
  return { organizationId, agentId, trunkId };
}

describe("chamada recebida", { timeout: 120_000 }, () => {
  it("roteia pelo tronco: cria a chamada, define o UUID do áudio e manda o canal para o AudioSocket", async () => {
    const { organizationId, agentId, trunkId } = await line("inbound-route");
    const { ari, expected } = await receive(channel(trunkId, "553133334444"));

    const calls = await callsOf(app, organizationId);
    expect(calls).toMatchObject([{ status: "ringing", direction: "inbound", agent_id: agentId, from_e164: "+5531999998888", to_e164: NUMBER, end_reason: null, ended_at: null }]);
    const callId = calls[0]?.id;
    expect(ari.log).toEqual([`set canal-1 AUDIOSOCKET_UUID=${callId}`, "continue canal-1 deskvoice-audio,s"]);
    expect(expected).toEqual([{ callId, channelId: "canal-1", organizationId, agentId, trunkId }]);
  });

  it("aceita o número discado nos formatos que as operadoras mandam", async () => {
    const { organizationId, trunkId } = await line("inbound-formats");
    for (const exten of ["3133334444", "03133334444", "+553133334444"]) {
      const { ari } = await receive(channel(trunkId, exten));
      expect(ari.log.at(-1), exten).toBe("continue canal-1 deskvoice-audio,s");
    }
    expect(await callsOf(app, organizationId)).toHaveLength(3);
  });

  it("duas organizações com o mesmo número: cada tronco entrega à sua, nunca à outra", async () => {
    const first = await line("inbound-same-a");
    const second = await line("inbound-same-b");
    await receive(channel(second.trunkId, "553133334444"));
    expect(await callsOf(app, first.organizationId)).toEqual([]);
    expect(await callsOf(app, second.organizationId)).toMatchObject([{ agent_id: second.agentId, status: "ringing" }]);
    await receive(channel(first.trunkId, "553133334444"));
    expect(await callsOf(app, first.organizationId)).toMatchObject([{ agent_id: first.agentId, status: "ringing" }]);
    expect(await callsOf(app, second.organizationId)).toHaveLength(1);
  });

  it("tronco desconhecido: recusa desligando o canal, sem criar nada", async () => {
    const { organizationId } = await line("inbound-unknown");
    for (const name of ["PJSIP/trunk-11111111-2222-4333-8444-555555555555-00000001", "PJSIP/ramal-100-00000001", "PJSIP/trunk-x'; drop table calls;--", undefined]) {
      const { ari, expected } = await receive({ id: "canal-9", name, dialplan: { exten: "553133334444" } });
      expect(ari.log, String(name)).toEqual(["hangup canal-9"]);
      expect(expected).toEqual([]);
    }
    expect(await callsOf(app, organizationId)).toEqual([]);
  });

  it("número sem agente: recusa, com a chamada gravada como recusada, o evento e o aviso no painel", async () => {
    const { organizationId, trunkId } = await line("inbound-no-agent", { agent: "none" });
    const { ari, expected } = await receive(channel(trunkId, "553133334444"));
    expect(ari.log).toEqual(["hangup canal-1"]);
    expect(expected).toEqual([]);

    const calls = await callsOf(app, organizationId);
    expect(calls).toMatchObject([{ status: "refused", end_reason: "no_agent", agent_id: null, to_e164: NUMBER, ended_at: expect.any(Date) }]);
    expect(await eventsOf(app, calls[0]?.id ?? "")).toEqual([{ kind: "call_refused", payload: { reason: "no_agent", from: "+5531999998888", to: NUMBER, dialed: "553133334444" } }]);
    const notices = await notificationsOf(app, organizationId);
    expect(notices).toMatchObject([{ channel: "panel", call_id: calls[0]?.id }]);
    expect(notices[0]?.body).toMatch(/\+553133334444.*nenhum agente/);
  });

  it("número que o tronco não tem: recusa com evento, sem atender por engano", async () => {
    const { organizationId, trunkId } = await line("inbound-wrong-number", { numbers: [NUMBER, "+553144445555"] });
    const { ari } = await receive(channel(trunkId, "553122221111"));
    expect(ari.log).toEqual(["hangup canal-1"]);
    expect(await callsOf(app, organizationId)).toMatchObject([{ status: "refused", end_reason: "no_agent", to_e164: "+553122221111" }]);
  });

  it("agente desligado: recusa com o motivo próprio", async () => {
    const { organizationId, agentId, trunkId } = await line("inbound-disabled", { agent: "disabled" });
    const { ari } = await receive(channel(trunkId, "553133334444"));
    expect(ari.log).toEqual(["hangup canal-1"]);
    const calls = await callsOf(app, organizationId);
    expect(calls).toMatchObject([{ status: "refused", end_reason: "agent_disabled", agent_id: agentId }]);
    expect((await eventsOf(app, calls[0]?.id ?? ""))[0]).toMatchObject({ kind: "call_refused", payload: { reason: "agent_disabled" } });
    expect((await notificationsOf(app, organizationId))[0]?.body).toMatch(/agente desse número está desligado/);
  });

  it("`s` em tronco de número único vale como o número dele; com dois números, recusa", async () => {
    const single = await line("inbound-s-single");
    const { ari } = await receive(channel(single.trunkId, "s"));
    expect(ari.log.at(-1)).toBe("continue canal-1 deskvoice-audio,s");
    expect(await callsOf(app, single.organizationId)).toMatchObject([{ status: "ringing", to_e164: NUMBER, agent_id: single.agentId }]);

    const double = await line("inbound-s-double", { numbers: [NUMBER, "+553144445555"] });
    const refused = await receive(channel(double.trunkId, "s"));
    expect(refused.ari.log).toEqual(["hangup canal-1"]);
    expect(await callsOf(app, double.organizationId)).toMatchObject([{ status: "refused", end_reason: "no_agent", to_e164: null }]);
  });

  it("se o Asterisk não aceita o comando, o canal é desligado em vez de ficar pendurado", async () => {
    const { trunkId } = await line("inbound-ari-down");
    const ari = fakeAri();
    const clock = fakeClock();
    const calls = new AsteriskCalls({ ari, db: app, clock, log: () => undefined });
    let attempts = 0;
    ari.setVariable = async () => {
      attempts += 1;
      throw new Error("ARI is down");
    };
    await handleInbound({ db: app, ari, clock, calls, log: () => undefined }, channel(trunkId, "s"));
    expect(attempts).toBe(1);
    expect(ari.log).toEqual(["hangup canal-1"]);
  });
});

describe("teto de ligações recebidas ao mesmo tempo", { timeout: 120_000 }, () => {
  const ACCEPTED = "continue canal-1 deskvoice-audio,s";
  const BUSY = ["hangup canal-1 busy"];
  const incoming = (trunkId: string): AriChannel => channel(trunkId, "553133334444");
  const setLimit = (organizationId: string, value: unknown): Promise<void> => putSetting(app, organizationId, INBOUND_LIMIT_SETTING, value, false);
  const statusesOf = async (organizationId: string): Promise<string[]> => (await callsOf(app, organizationId)).map((call) => call.status).sort();

  it("abaixo do teto de fábrica aceita; no teto recusa com ocupado, evento e aviso, sem entregar a chamada ao áudio", async () => {
    const { organizationId, agentId, trunkId } = await line("inbound-limit-default");
    const clock = fakeClock();
    for (let n = 0; n < DEFAULT_INBOUND_LIMIT; n += 1) expect((await receive(incoming(trunkId), clock)).ari.log.at(-1), `ligação ${n + 1}`).toBe(ACCEPTED);

    const { ari, expected } = await receive(incoming(trunkId), clock);
    expect(ari.log).toEqual(BUSY);
    expect(expected).toEqual([]);
    const refused = (await callsOf(app, organizationId)).filter((call) => call.status === "refused");
    expect(refused).toMatchObject([{ end_reason: "inbound_limit_reached", agent_id: agentId, to_e164: NUMBER, engine: null, cost_cents: 0, ended_at: expect.any(Date) }]);
    expect(await eventsOf(app, refused[0]?.id ?? "")).toEqual([
      { kind: "call_refused", payload: { reason: "inbound_limit_reached", from: "+5531999998888", to: NUMBER, dialed: "553133334444", limit: DEFAULT_INBOUND_LIMIT } },
    ]);
    const notices = await notificationsOf(app, organizationId);
    expect(notices).toMatchObject([{ channel: "panel", call_id: refused[0]?.id }]);
    expect(notices[0]?.body).toMatch(/\+553133334444.*ocupado.*5 ligações/);

    // Rajada: cada recusa fica no histórico, mas o aviso sai uma vez por janela.
    expect((await receive(incoming(trunkId), clock)).ari.log).toEqual(BUSY);
    expect(await notificationsOf(app, organizationId)).toHaveLength(1);
    clock.advance(11 * 60 * 1000);
    expect((await receive(incoming(trunkId), clock)).ari.log).toEqual(BUSY);
    expect(await notificationsOf(app, organizationId)).toHaveLength(2);
    expect(await statusesOf(organizationId)).toEqual([...Array<string>(3).fill("refused"), ...Array<string>(DEFAULT_INBOUND_LIMIT).fill("ringing")]);
  });

  it("vale o teto que o operador gravou; valor fora da faixa cai no de fábrica", async () => {
    const { organizationId, trunkId } = await line("inbound-limit-setting");
    await setLimit(organizationId, 2);
    expect((await receive(incoming(trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
    expect((await receive(incoming(trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
    expect((await receive(incoming(trunkId))).ari.log).toEqual(BUSY);

    await withSystem(app, (q) => q.exec("delete from settings where organization_id = $1 and key = $2", [organizationId, INBOUND_LIMIT_SETTING]));
    await setLimit(organizationId, 0);
    for (let n = 2; n < DEFAULT_INBOUND_LIMIT; n += 1) expect((await receive(incoming(trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
    expect((await receive(incoming(trunkId))).ari.log).toEqual(BUSY);
  });

  it("chamada que termina libera a vaga, em andamento continua ocupando", async () => {
    const { organizationId, trunkId } = await line("inbound-limit-release");
    await setLimit(organizationId, 1);
    expect((await receive(incoming(trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
    const [first] = await callsOf(app, organizationId);
    await withSystem(app, (q) => q.exec("update calls set status = 'in_progress' where id = $1", [first?.id]));
    expect((await receive(incoming(trunkId))).ari.log).toEqual(BUSY);

    await withSystem(app, (q) => q.exec("update calls set status = 'completed', ended_at = started_at where id = $1", [first?.id]));
    expect((await receive(incoming(trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
  });

  it("organização cheia não tira vaga de outra", async () => {
    const full = await line("inbound-limit-full");
    const other = await line("inbound-limit-other");
    await setLimit(full.organizationId, 1);
    await setLimit(other.organizationId, 1);
    expect((await receive(incoming(full.trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
    expect((await receive(incoming(full.trunkId))).ari.log).toEqual(BUSY);

    expect((await receive(incoming(other.trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
    expect(await statusesOf(other.organizationId)).toEqual(["ringing"]);
    expect(await notificationsOf(app, other.organizationId)).toEqual([]);
  });

  it("chamada pelo navegador e ligação de saída não ocupam vaga", async () => {
    const { organizationId, agentId, trunkId } = await line("inbound-limit-other-kinds");
    await setLimit(organizationId, 1);
    // A chamada pelo navegador nasce como `web-calls.ts` a cria: `inbound`, sem número de destino.
    await createCall(app, organizationId, agentId ?? "", fakeClock().now());
    await withSystem(app, (q) =>
      q.exec("insert into calls (organization_id, agent_id, direction, from_e164, to_e164, status, started_at) values ($1, $2, 'outbound', $3, '+5531988887777', 'in_progress', $4)", [organizationId, agentId, NUMBER, fakeClock().now()]),
    );
    expect((await receive(incoming(trunkId))).ari.log.at(-1)).toBe(ACCEPTED);
    expect((await receive(incoming(trunkId))).ari.log).toEqual(BUSY);
  });

  it("ligações que chegam juntas na última vaga: só uma passa", async () => {
    const { organizationId, trunkId } = await line("inbound-limit-race");
    await setLimit(organizationId, 2);
    expect((await receive(incoming(trunkId))).ari.log.at(-1)).toBe(ACCEPTED);

    // O teste segura a linha da organização até as seis estarem paradas na conferência do teto:
    // assim todas chegam com a mesma contagem, e é a trava, não a sorte, que decide quem passa.
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding = (): void => undefined;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const holder = withSystem(app, async (q) => {
      await q.one("select 1 as locked from organizations where id = $1 for no key update", [organizationId]);
      holding();
      await released;
    });
    await held;

    const clock = fakeClock();
    let settled = 0;
    const arriving = Array.from({ length: 6 }, () => receive(incoming(trunkId), clock).finally(() => (settled += 1)));
    const waitingOnLock = async (): Promise<number> => (await withSystem(app, (q) => q.one<{ count: number }>("select count(*)::int as count from pg_locks where not granted")))?.count ?? 0;
    const deadline = performance.now() + 20_000;
    // Sem a trava no código ninguém espera: as seis terminam, e as contas abaixo reprovam.
    try {
      while (settled < 6 && (await waitingOnLock()) < 6) {
        if (performance.now() > deadline) throw new Error("Timed out waiting for the six calls to reach the limit check");
      }
    } finally {
      // Sempre solta: uma espera que estoura não pode deixar a transação e as seis penduradas.
      release();
    }
    await holder;
    const together = await Promise.all(arriving);

    expect(together.filter(({ ari }) => ari.log.at(-1) === ACCEPTED)).toHaveLength(1);
    expect(together.filter(({ ari }) => ari.log.join() === BUSY.join())).toHaveLength(5);
    expect(await statusesOf(organizationId)).toEqual([...Array<string>(5).fill("refused"), "ringing", "ringing"]);
    expect(await notificationsOf(app, organizationId)).toHaveLength(1);
  });
});
