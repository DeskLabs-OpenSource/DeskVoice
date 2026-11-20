// O teto de gasto do mês, do lado do processo de voz (seção 3.4 do desenho do R8, fatia 7c,
// `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`): três das quatro
// portas do começo de uma chamada, a recebida pela operadora, a de saída e a pelo navegador. A do
// WhatsApp está em `whatsapp-calls.db.test.ts`, com o WaCalls falso de lá.
//
// O teto é gravado direto em `organization_limits` e o gasto direto em `usage_ledger`, pelo papel de
// sistema: o caminho da tela e da soma tem os testes dele (`packages/core/src/spend-cap.db.test.ts`).
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CALL_RECORDING_SETTING, INBOUND_LIMIT_SETTING, VOICEMAIL_ENABLED_SETTING, withOrg, withSystem, type Db, type OrgQuery } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import type { VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting } from "../../../packages/tools/test/helpers";
import { AsteriskCalls } from "./asterisk-transport";
import { inboundLimitReached, limitNoticedLately, SPEND_CAP_NOTICE } from "./inbound";
import { startOutboundCall } from "./outbound";
import { checkOutboundAllowed } from "./outbound-policy";
import { startVoiceServer, type VoiceServer } from "./server";
import { callOf, callsOf, createAgent, createOrganization, createPhoneNumber, createTrunk, eventsOf, fakeAri, fakeClock, ledgerOf, pricedSimulatedEngine, secretKey, t0, testSchedule, type FakeAri } from "./testing/db";
import { fakeAsterisk, waitFor, type FakeAsterisk } from "./testing/helpers";
import { unavailableNotice } from "./unavailable";

const { app, owner } = openTestDbs();
const TOKEN = "token-interno-de-teste";
const USER = "0c000000-0000-4000-8000-0000000000aa";
let scratch: string;
let server: VoiceServer | undefined;
const sockets: FakeAsterisk[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-spend-cap-"));
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.socket.destroy();
  await server?.close();
  server = undefined;
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  await app.close();
  await owner.close();
});

/** Uma organização com uma linha, um número e o agente do número (opcional), e a saída ligada o dia todo. */
async function line(label: string, number: string, agent: { language?: string } | null = {}) {
  const organizationId = await createOrganization(app, `${label}-${randomUUID()}`);
  const agentId = agent ? await createAgent(app, organizationId, { language: agent.language, script: [{ expectUserAudio: 100_000 }] }) : null;
  const trunkId = await createTrunk(app, organizationId, { callerId: number });
  await createPhoneNumber(app, organizationId, trunkId, number, agentId);
  await withSystem(app, (q) =>
    q.exec("insert into outbound_policy (organization_id, enabled, window_start, window_end, timezone) values ($1, true, '00:00', '23:59', 'UTC')", [organizationId]),
  );
  return { organizationId, agentId, trunkId };
}

const capAt = (organizationId: string, cents: number) =>
  withSystem(app, (q) => q.exec("insert into organization_limits (organization_id, monthly_spend_cap_cents) values ($1, $2)", [organizationId, cents]));

/** Gasto no mês de `t0`, numa chamada antiga da organização. */
async function spent(organizationId: string, microcents: number): Promise<void> {
  await withSystem(app, async (q) => {
    const call = await q.one<{ id: string }>(
      "insert into calls (organization_id, direction, channel, status, started_at, ended_at) values ($1, 'inbound', 'simulated', 'completed', $2, $2) returning id",
      [organizationId, new Date(t0.getTime() - 3_600_000)],
    );
    await q.exec("insert into usage_ledger (organization_id, call_id, engine, cost_cents, cost_microcents, at) values ($1, $2, 'simulated', round($3::numeric / 1000000)::int, $3, $4)", [
      organizationId,
      call?.id,
      microcents,
      new Date(t0.getTime() - 3_600_000),
    ]);
  });
}

/** O processo de voz com um motor que conta quantas vezes foi aberto. */
async function voice(clock = fakeClock(), db: Db = app): Promise<{ ari: FakeAri; opened: () => number; web: (body: object) => Promise<{ status: number; body: Record<string, unknown> }> }> {
  const simulated = pricedSimulatedEngine(60);
  let opened = 0;
  const counting: VoiceEngine = {
    ...simulated,
    id: "roteiro",
    label: "Motor de roteiro",
    connect(config, apiKey, options) {
      opened += 1;
      return simulated.connect(config, apiKey, options);
    },
  };
  const ari = fakeAri();
  const timers = testSchedule();
  server = await startVoiceServer({
    db,
    clock,
    engines: new Map([
      ["simulated", { ...counting, id: "simulated" }],
      ["roteiro", counting],
    ]),
    tools: await loadTools(),
    ari,
    secretKey,
    audioSocketPort: 0,
    internalPort: 0,
    webPort: 0,
    internalToken: TOKEN,
    trunksFile: path.join(scratch, `${randomUUID()}.conf`),
    publicIp: "203.0.113.10",
    host: "127.0.0.1",
    schedule: timers.schedule,
    resolveName: async () => ["192.0.2.53"],
    now: timers.now,
  });
  const internalPort = server.internalPort;
  const web = async (body: object) => {
    const response = await fetch(`http://127.0.0.1:${internalPort}/calls/web`, { method: "POST", headers: { "content-type": "application/json", "x-internal-token": TOKEN }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { ari, opened: () => opened, web };
}

let channels = 0;
/** Uma ligação chega pelo tronco; o dialplan abre o AudioSocket com o UUID que o processo pôs no canal. */
async function ring(ari: FakeAri, trunkId: string, exten: string): Promise<{ callId: string; asterisk: FakeAsterisk }> {
  const channelId = `canal-${(channels += 1)}`;
  ari.emit({ type: "StasisStart", args: ["inbound"], channel: { id: channelId, name: `PJSIP/trunk-${trunkId}-00000001`, dialplan: { exten }, caller: { number: "31999998888" } } });
  const variable = await waitFor(() => ari.log.find((entry) => entry.startsWith(`set ${channelId} AUDIOSOCKET_UUID=`)), "AUDIOSOCKET_UUID on the channel");
  await waitFor(() => ari.log.includes(`continue ${channelId} deskvoice-audio,s`), "the channel to go to the audio context");
  const callId = variable.split("=")[1] ?? "";
  const asterisk = await fakeAsterisk(server?.audioSocketPort ?? 0);
  sockets.push(asterisk);
  asterisk.sendUuid(callId);
  return { callId, asterisk };
}

const heard = (asterisk: FakeAsterisk): Buffer => Buffer.concat(asterisk.frames.filter((frame) => frame.type === 0x10).map((frame) => frame.payload));
const panelNotices = async (organizationId: string) => (await notificationsOf(app, organizationId)).filter((notice) => notice.channel === "panel");

describe("teto de gasto do mês: a ligação pela operadora", { timeout: 120_000 }, () => {
  it("T1: sem teto, atende com o motor mesmo com gasto alto no mês", async () => {
    const org = await line("cap-none", "+553130000001");
    await spent(org.organizationId, 9_000_000_000);
    const { ari, opened } = await voice();
    const answered = await ring(ari, org.trunkId, "553130000001");
    await waitFor(async () => (await callOf(app, answered.callId)).status === "in_progress", "the call in progress");
    expect(opened()).toBe(1);
  });

  it("T2: com a soma no teto, toca a fala de indisponível e desliga, sem motor e sem caixa postal, com o evento e um aviso; 1 microcentavo a menos atende", async () => {
    const capped = await line("cap-phone", "+553130000002", { language: "en-US" });
    await putSetting(app, capped.organizationId, VOICEMAIL_ENABLED_SETTING, true, false);
    await putSetting(app, capped.organizationId, CALL_RECORDING_SETTING, true, false);
    await capAt(capped.organizationId, 250);
    await spent(capped.organizationId, 249_999_999);
    const { ari, opened } = await voice();

    const below = await ring(ari, capped.trunkId, "553130000002");
    await waitFor(async () => (await callOf(app, below.callId)).status === "in_progress", "the call below the cap in progress");
    expect(opened()).toBe(1);

    await spent(capped.organizationId, 1);
    const refused = await ring(ari, capped.trunkId, "553130000002");
    expect(await callOf(app, refused.callId)).toMatchObject({ status: "refused", end_reason: "spend_cap_reached", agent_id: capped.agentId, ended_at: expect.any(Date) });
    expect(await withSystem(app, (q) => q.one("select voicemail from calls where id = $1", [refused.callId]))).toEqual({ voicemail: false });
    expect(await eventsOf(app, refused.callId)).toEqual([
      { kind: "call_refused", payload: { reason: "spend_cap_reached", capCents: 250, from: "+5531999998888", to: "+553130000002", dialed: "553130000002" } },
    ]);
    await waitFor(() => refused.asterisk.closed, "the AudioSocket to close after the notice");
    const notice = await unavailableNotice("en");
    expect(heard(refused.asterisk).subarray(0, notice.length).equals(notice)).toBe(true);
    expect(opened()).toBe(1);
    expect(await ledgerOf(app, refused.callId)).toEqual([]);
    expect(await panelNotices(capped.organizationId)).toEqual([expect.objectContaining({ call_id: refused.callId, body: SPEND_CAP_NOTICE("+553130000002", 250) })]);
    expect(SPEND_CAP_NOTICE("+553130000002", 250)).toContain("US$ 2.50");
    expect(SPEND_CAP_NOTICE("+553130000002", 250)).toContain("aproximado");
  });

  it("T2: número sem agente e com a caixa postal ligada, no teto: nenhum recado, a mesma recusa", async () => {
    const capped = await line("cap-voicemail", "+553130000003", null);
    await putSetting(app, capped.organizationId, VOICEMAIL_ENABLED_SETTING, true, false);
    await putSetting(app, capped.organizationId, CALL_RECORDING_SETTING, true, false);
    await capAt(capped.organizationId, 0);
    const { ari, opened } = await voice();
    const refused = await ring(ari, capped.trunkId, "553130000003");
    expect(await callOf(app, refused.callId)).toMatchObject({ status: "refused", end_reason: "spend_cap_reached", agent_id: null });
    expect(await withSystem(app, (q) => q.one("select voicemail from calls where id = $1", [refused.callId]))).toEqual({ voicemail: false });
    await waitFor(() => refused.asterisk.closed, "the AudioSocket to close after the notice");
    expect(opened()).toBe(0);
  });

  it("T4: o teto de uma organização não recusa a outra no mesmo processo", async () => {
    const capped = await line("cap-iso-a", "+553130000004");
    const other = await line("cap-iso-b", "+553130000005");
    await capAt(capped.organizationId, 0);
    await capAt(other.organizationId, 100);
    await spent(capped.organizationId, 5_000_000_000);
    const { ari } = await voice();
    const refused = await ring(ari, capped.trunkId, "553130000004");
    expect(await callOf(app, refused.callId)).toMatchObject({ end_reason: "spend_cap_reached" });
    const answered = await ring(ari, other.trunkId, "553130000005");
    await waitFor(async () => (await callOf(app, answered.callId)).status === "in_progress", "the other organization's call in progress");
  });

  it("T5: duas recusas em 10 minutos geram um aviso só; um aviso de `inbound_limit_reached` antes não cala o do teto; passados 10 minutos, avisa de novo", async () => {
    const capped = await line("cap-notice", "+553130000006");
    await capAt(capped.organizationId, 0);
    const clock = fakeClock();
    // Uma recusa pelo teto de simultâneas, com o aviso dela, 1 minuto antes.
    await withOrg(app, capped.organizationId, async (q) => {
      const call = await q.one<{ id: string }>(
        "insert into calls (organization_id, direction, channel, status, end_reason, started_at, ended_at) values ($1, 'inbound', 'phone', 'refused', 'inbound_limit_reached', $2, $2) returning id",
        [capped.organizationId, new Date(t0.getTime() - 60_000)],
      );
      await q.exec("insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, 'panel', null, 'ocupado', $3)", [capped.organizationId, call?.id, new Date(t0.getTime() - 60_000)]);
    });
    const { ari } = await voice(clock);
    const first = await ring(ari, capped.trunkId, "553130000006");
    clock.advance(9 * 60_000);
    const second = await ring(ari, capped.trunkId, "553130000006");
    expect(await callOf(app, second.callId)).toMatchObject({ end_reason: "spend_cap_reached" });
    expect((await panelNotices(capped.organizationId)).filter((notice) => notice.body.includes("teto de gasto"))).toEqual([expect.objectContaining({ call_id: first.callId })]);
    // E o aviso do teto não cala o de simultâneas: cada um conta pelo próprio `end_reason`.
    await withOrg(app, capped.organizationId, async (q) => {
      expect(await limitNoticedLately(q, clock, "spend_cap_reached")).toBe(true);
    });
    clock.advance(2 * 60_000);
    const third = await ring(ari, capped.trunkId, "553130000006");
    expect((await panelNotices(capped.organizationId)).filter((notice) => notice.body.includes("teto de gasto")).map((notice) => notice.call_id).sort()).toEqual([first.callId, third.callId].sort());
  });

  it("suspensa e no teto: a recusa é `organization_suspended`, sem o aviso do teto", async () => {
    // Sonda I1 do Verificador 2 (DESA-213): cai com o teto conferido antes da suspensão.
    const capped = await line("cap-suspended", "+553130000096");
    await capAt(capped.organizationId, 0);
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste' where id = $1", [capped.organizationId]));
    const { ari } = await voice(fakeClock());
    const r = await ring(ari, capped.trunkId, "553130000096");
    expect(await callOf(app, r.callId)).toMatchObject({ status: "refused", end_reason: "organization_suspended" });
    expect(await panelNotices(capped.organizationId)).toEqual([]);
  });

  it("T5: o aviso do teto não cala o de simultâneas", async () => {
    const org = await line("cap-notice-other", "+553130000007");
    const clock = fakeClock();
    await withOrg(app, org.organizationId, async (q) => {
      const call = await q.one<{ id: string }>(
        "insert into calls (organization_id, direction, channel, status, end_reason, started_at, ended_at) values ($1, 'inbound', 'phone', 'refused', 'spend_cap_reached', $2, $2) returning id",
        [org.organizationId, t0],
      );
      await q.exec("insert into notifications (organization_id, call_id, channel, target, body, created_at) values ($1, $2, 'panel', null, 'teto', $3)", [org.organizationId, call?.id, t0]);
      expect(await limitNoticedLately(q, clock)).toBe(false);
      expect(await limitNoticedLately(q, clock, "spend_cap_reached")).toBe(true);
    });
  });
});

describe("teto de gasto do mês: a ligação de saída", { timeout: 120_000 }, () => {
  it("T1/T2: sem teto liga; no teto é recusada antes de existir canal, sem aviso; 1 microcentavo a menos liga", async () => {
    const free = await line("cap-out-none", "+553130000010");
    const capped = await line("cap-out", "+553130000011");
    await spent(free.organizationId, 9_000_000_000);
    await capAt(capped.organizationId, 100);
    await spent(capped.organizationId, 99_999_999);
    const ari = fakeAri();
    const clock = fakeClock();
    const deps = { db: app, ari, clock, calls: new AsteriskCalls({ ari, db: app, clock, log: () => undefined }), log: () => undefined };

    expect(await startOutboundCall(deps, { organizationId: free.organizationId, agentId: free.agentId ?? "", toE164: "+5531911112222" })).toMatchObject({ callId: expect.any(String) });
    expect(await startOutboundCall(deps, { organizationId: capped.organizationId, agentId: capped.agentId ?? "", toE164: "+5531911112222" })).toMatchObject({ callId: expect.any(String) });
    expect(ari.originated).toHaveLength(2);

    await spent(capped.organizationId, 1);
    const refused = await startOutboundCall(deps, { organizationId: capped.organizationId, agentId: capped.agentId ?? "", toE164: "+5531911113333" });
    expect(refused).toMatchObject({ code: "spend_cap_reached" });
    expect(ari.originated).toHaveLength(2);
    expect((await callsOf(app, capped.organizationId)).filter((call) => call.end_reason === "spend_cap_reached")).toMatchObject([{ status: "refused" }]);
    expect(await panelNotices(capped.organizationId)).toEqual([]);
  });

  it("sem teto, a porta lê os limites uma vez só: a 7c não soma consulta (6, como antes dela)", async () => {
    // Critério de fracasso da 7c: a organização sem teto não ganha consulta por chamada. A trava e o teto
    // vêm da mesma leitura de `organization_limits`, passada a `spendCapReached`.
    const free = await line("cap-out-count", "+553130000013");
    await withSystem(app, (q) => q.exec("insert into organization_limits (organization_id, max_agents) values ($1, 5)", [free.organizationId]));
    const sql = await withOrg(app, free.organizationId, async (q) => {
      const seen: string[] = [];
      const counted = { organizationId: q.organizationId, one: (t: string, p?: unknown[]) => (seen.push(t), q.one(t, p)), many: (t: string, p?: unknown[]) => (seen.push(t), q.many(t, p)), exec: (t: string, p?: unknown[]) => (seen.push(t), q.exec(t, p)) } as OrgQuery;
      expect(await checkOutboundAllowed(counted, "+5531911112222", fakeClock())).toMatchObject({ allowed: true });
      return seen;
    });
    expect(sql.filter((text) => /organization_limits/.test(text))).toHaveLength(1);
    expect(sql.filter((text) => /usage_ledger/.test(text))).toEqual([]);
    expect(sql).toHaveLength(6);
  });

  it("a ordem: suspensa e trava da saída vêm antes do teto, e o teto vem antes da política", async () => {
    const capped = await line("cap-out-order", "+553130000012");
    await withSystem(app, (q) => q.exec("insert into organization_limits (organization_id, monthly_spend_cap_cents, outbound_allowed) values ($1, 0, false)", [capped.organizationId]));
    const clock = fakeClock();
    const decide = () => withOrg(app, capped.organizationId, (q) => checkOutboundAllowed(q, "+5531911112222", clock));
    expect(await decide()).toMatchObject({ allowed: false, code: "outbound_not_allowed" });
    await withSystem(app, (q) => q.exec("update organization_limits set outbound_allowed = true where organization_id = $1", [capped.organizationId]));
    await withSystem(app, (q) => q.exec("update outbound_policy set enabled = false where organization_id = $1", [capped.organizationId]));
    expect(await decide()).toMatchObject({ allowed: false, code: "spend_cap_reached" });
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste' where id = $1", [capped.organizationId]));
    expect(await decide()).toMatchObject({ allowed: false, code: "organization_suspended" });
  });
});

/**
 * O `Db` do processo de voz com um espião nas consultas da aplicação (`withOrg`): o texto de cada uma,
 * na ordem. Zera com `sql.length = 0` antes do trecho medido.
 */
function countingDb(db: Db): { db: Db; sql: string[] } {
  const sql: string[] = [];
  const bound = <T extends object>(target: T, prop: string | symbol) => {
    const value = Reflect.get(target, prop) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  };
  const pool = new Proxy(db.pool, {
    get(target, prop) {
      if (prop !== "connect") return bound(target, prop);
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(inner, key) {
            if (key !== "query") return bound(inner, key);
            return (text: string | { text: string }, ...rest: unknown[]) => {
              sql.push(typeof text === "string" ? text : text.text);
              return (inner.query as (...args: unknown[]) => unknown)(text, ...rest);
            };
          },
        });
      };
    },
  });
  return { db: { pool, systemPool: db.systemPool, close: () => db.close() }, sql };
}

describe("teto de gasto do mês: a chamada pelo navegador", { timeout: 120_000 }, () => {
  const MESSAGE = { code: "spend_cap_reached", message: "This organization reached its monthly spending cap. The installation administration can change the cap." };
  const webRows = (organizationId: string) =>
    withSystem(app, (q) => q.many<{ id: string; status: string; end_reason: string | null }>("select id, status, end_reason from calls where organization_id = $1 and channel = 'web' order by started_at, id", [organizationId]));
  const refusedRows = async (organizationId: string) => (await webRows(organizationId)).filter((row) => row.status === "refused");

  it("T1/T2: sem teto abre; no teto é recusada com `spend_cap_reached` e grava a linha recusada com `call_refused`; 1 microcentavo a menos abre", async () => {
    const free = await createOrganization(app, `cap-web-none-${randomUUID()}`);
    const freeAgent = await createAgent(app, free, { engine: "roteiro" });
    const capped = await createOrganization(app, `cap-web-${randomUUID()}`);
    const cappedAgent = await createAgent(app, capped, { engine: "roteiro" });
    await spent(free, 9_000_000_000);
    await capAt(capped, 100);
    await spent(capped, 99_999_999);
    const clock = fakeClock();
    const { web } = await voice(clock);

    expect((await web({ organizationId: free, agentId: freeAgent, userId: USER })).status).toBe(200);
    expect((await web({ organizationId: capped, agentId: cappedAgent, userId: USER })).status).toBe(200);
    expect(await webRows(capped)).toMatchObject([{ status: "ringing" }]);
    expect(await refusedRows(free)).toEqual([]);

    await spent(capped, 1);
    const refused = await web({ organizationId: capped, agentId: cappedAgent, userId: USER });
    // A resposta à tela é a de antes da linha do tempo: o mesmo código, a mesma frase, sem `callId`.
    expect(refused).toEqual({ status: 409, body: MESSAGE });
    const [row, ...others] = await refusedRows(capped);
    expect(others).toEqual([]);
    expect(await callOf(app, row?.id ?? "")).toMatchObject({
      status: "refused",
      end_reason: "spend_cap_reached",
      direction: "inbound",
      channel: "web",
      agent_id: cappedAgent,
      from_e164: null,
      to_e164: null,
      ended_at: clock.now(),
    });
    const events = await eventsOf(app, row?.id ?? "");
    expect(events).toEqual([{ kind: "call_refused", payload: { reason: "spend_cap_reached", channel: "web", userId: USER, capCents: 100 } }]);
    expect(JSON.stringify(events)).not.toMatch(/\+\d{8,}/);
    // Sem aviso no painel nesta fatia: quem clicou viu a recusa na tela.
    expect(await panelNotices(capped)).toEqual([]);
    // A vaga de simultâneas não fica presa pela recusa: com o teto tirado, duas mais abrem (a terceira das três).
    await withSystem(app, (q) => q.exec("update organization_limits set monthly_spend_cap_cents = null where organization_id = $1", [capped]));
    expect((await web({ organizationId: capped, agentId: cappedAgent, userId: USER })).status).toBe(200);
    expect((await web({ organizationId: capped, agentId: cappedAgent, userId: USER })).status).toBe(200);
    expect(await web({ organizationId: capped, agentId: cappedAgent, userId: USER })).toMatchObject({ status: 409, body: { code: "too_many_web_calls" } });
  });

  it("no teto, o agente que não existe na organização grava `agent_id` nulo e a recusa é a mesma", async () => {
    const capped = await createOrganization(app, `cap-web-noagent-${randomUUID()}`);
    const other = await createOrganization(app, `cap-web-other-${randomUUID()}`);
    const foreignAgent = await createAgent(app, other, { engine: "roteiro" });
    await capAt(capped, 0);
    const { web } = await voice();

    expect(await web({ organizationId: capped, agentId: randomUUID(), userId: USER })).toEqual({ status: 409, body: MESSAGE });
    expect(await web({ organizationId: capped, agentId: foreignAgent, userId: USER })).toEqual({ status: 409, body: MESSAGE });
    const rows = await refusedRows(capped);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(await callOf(app, row.id)).toMatchObject({ status: "refused", end_reason: "spend_cap_reached", agent_id: null });
    expect(await webRows(other)).toEqual([]);
  });

  it("só o teto grava: `agent_disabled` e `agent_not_found` com o teto ainda não atingido, nenhuma linha", async () => {
    const org = await createOrganization(app, `cap-web-disabled-${randomUUID()}`);
    const disabled = await createAgent(app, org, { engine: "roteiro", enabled: false });
    await capAt(org, 100);
    await spent(org, 99_999_999);
    const { web } = await voice();

    expect(await web({ organizationId: org, agentId: disabled, userId: USER })).toMatchObject({ status: 409, body: { code: "agent_disabled" } });
    expect(await web({ organizationId: org, agentId: randomUUID(), userId: USER })).toMatchObject({ status: 409, body: { code: "agent_not_found" } });
    expect(await webRows(org)).toEqual([]);
  });

  it("sem teto, ou com o teto ainda não atingido, a chamada pelo navegador faz as mesmas consultas de antes", async () => {
    // Critério de fracasso: a organização sem teto não ganha consulta, e a recusa só soma as dela.
    const free = await createOrganization(app, `cap-web-count-${randomUUID()}`);
    const freeAgent = await createAgent(app, free, { engine: "roteiro" });
    const below = await createOrganization(app, `cap-web-count-below-${randomUUID()}`);
    const belowAgent = await createAgent(app, below, { engine: "roteiro" });
    await capAt(below, 100);
    await spent(below, 99_999_999);
    const spy = countingDb(app);
    const { web } = await voice(fakeClock(), spy.db);

    const measured = async (body: object) => {
      spy.sql.length = 0;
      const response = await web(body);
      return { response, sql: [...spy.sql] };
    };
    const opened = await measured({ organizationId: free, agentId: freeAgent, userId: USER });
    expect(opened.response.status).toBe(200);
    // begin, set_config, organization_limits, agente, chamada, commit: como antes desta fatia.
    expect(opened.sql).toHaveLength(6);
    expect(opened.sql.filter((text) => /usage_ledger/.test(text))).toEqual([]);
    const disabledOne = await measured({ organizationId: free, agentId: randomUUID(), userId: USER });
    expect(disabledOne.response.body.code).toBe("agent_not_found");
    expect(disabledOne.sql).toHaveLength(5);

    const belowCap = await measured({ organizationId: below, agentId: belowAgent, userId: USER });
    expect(belowCap.response.status).toBe(200);
    expect(belowCap.sql).toHaveLength(8);
    expect(belowCap.sql.filter((text) => /usage_ledger/.test(text))).toHaveLength(1);
    expect(await refusedRows(free)).toEqual([]);
    expect(await refusedRows(below)).toEqual([]);
  });

  it("a linha recusada não ocupa vaga no teto de recebidas ao mesmo tempo", async () => {
    const org = await createOrganization(app, `cap-web-slot-${randomUUID()}`);
    const agentId = await createAgent(app, org, { engine: "roteiro" });
    await capAt(org, 0);
    await putSetting(app, org, INBOUND_LIMIT_SETTING, 1, false);
    const clock = fakeClock();
    const { web } = await voice(clock);
    expect(await web({ organizationId: org, agentId, userId: USER })).toEqual({ status: 409, body: MESSAGE });
    expect(await refusedRows(org)).toHaveLength(1);
    expect(await withOrg(app, org, (q) => inboundLimitReached(q, clock))).toEqual({ reached: false, limit: 1 });
    // O controle: uma recebida pela operadora tocando, com número, ocupa a única vaga.
    await withSystem(app, (q) =>
      q.exec("insert into calls (organization_id, direction, channel, from_e164, to_e164, status, started_at) values ($1, 'inbound', 'phone', '+5531999998888', '+553130000099', 'ringing', $2)", [org, clock.now()]),
    );
    expect(await withOrg(app, org, (q) => inboundLimitReached(q, clock))).toEqual({ reached: true, limit: 1 });
  });
});
