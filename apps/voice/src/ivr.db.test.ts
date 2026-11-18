// O menu por teclas (#223) de ponta a ponta no processo de voz: a chamada que chega pelo tronco num
// número em `mode = 'ivr'`, o AudioSocket de verdade com o quadro de tecla do Asterisk, a passagem à
// conversa no mesmo transporte (T2) e a transferência pelo caminho de sempre; o ramo do inbound (a
// organização suspensa antes do menu, T10; o teto; a caixa postal fora); e o banco, que não deixa um
// estado ruim nem atravessar organização (T7).
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CALL_RECORDING_SETTING, INBOUND_LIMIT_SETTING, VOICEMAIL_ENABLED_SETTING, withOrg, withSystem } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting } from "../../../packages/tools/test/helpers";
import type { AriChannel } from "./ari";
import { AsteriskCalls, type ExpectedCall } from "./asterisk-transport";
import { handleInbound } from "./inbound";
import { startVoiceServer, type VoiceServer } from "./server";
import { callOf, callsOf, createAgent, createOrganization, createPhoneNumber, createTrunk, eventsOf, fakeAri, fakeClock, pricedSimulatedEngine, secretKey, testSchedule, type FakeAri } from "./testing/db";
import { fakeAsterisk, waitFor, type FakeAsterisk } from "./testing/helpers";
import { answerByMenu, createIvrMenu, promptTone } from "./testing/ivr";

const { app, owner } = openTestDbs();
let scratch: string;
let server: VoiceServer | undefined;
const sockets: FakeAsterisk[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-ivr-"));
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

const PERSON = "+5531988887777";
const DTMF = 0x03;

/** Uma organização com um tronco, um número com agente, e o número posto para atender pelo menu. */
async function line(label: string, number: string, options: { agentOnNumber?: boolean } = {}) {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { script: [{ expectUserAudio: 100_000 }] });
  const trunkId = await createTrunk(app, organizationId, { callerId: number });
  const phoneNumberId = await createPhoneNumber(app, organizationId, trunkId, number, options.agentOnNumber === false ? null : agentId);
  const menuId = await createIvrMenu(app, organizationId, {
    name: "Menu principal",
    options: [
      { digit: "1", label: "Recepção", action: "agent", agentId },
      { digit: "2", label: "Financeiro", action: "transfer", transferE164: PERSON },
    ],
  });
  await answerByMenu(app, phoneNumberId, menuId);
  return { organizationId, agentId, trunkId, phoneNumberId, menuId };
}

async function voice(): Promise<FakeAri> {
  const ari = fakeAri();
  const timers = testSchedule();
  server = await startVoiceServer({
    db: app,
    clock: fakeClock(),
    engines: new Map([["simulated", pricedSimulatedEngine(60)]]),
    tools: await loadTools(),
    ari,
    secretKey,
    audioSocketPort: 0,
    internalPort: 0,
    webPort: 0,
    internalToken: "token-de-teste",
    trunksFile: path.join(scratch, `${randomUUID()}.conf`),
    publicIp: "203.0.113.10",
    host: "127.0.0.1",
    schedule: timers.schedule,
    resolveName: async () => ["192.0.2.53"],
    now: timers.now,
  });
  return ari;
}

async function ring(ari: FakeAri, trunkId: string, exten: string, channelId: string): Promise<{ callId: string; asterisk: FakeAsterisk }> {
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
const ivrKinds = async (callId: string): Promise<string[]> => (await eventsOf(app, callId)).map((event) => event.kind).filter((kind) => kind.startsWith("ivr_"));

describe("URA de ponta a ponta, pelo AudioSocket", { timeout: 120_000 }, () => {
  it("T2: o anúncio toca, a tecla 1 passa à conversa no mesmo áudio; a tecla depois não é da URA, e o desligar de quem ligou encerra a conversa uma vez só", async () => {
    const { organizationId, agentId, trunkId } = await line("ivr-e2e-agent", "+553133331111");
    const ari = await voice();
    const { callId, asterisk } = await ring(ari, trunkId, "553133331111", "canal-ura");

    // Sem agente até a escolha: quem atende é o menu.
    await waitFor(async () => (await ivrKinds(callId)).includes("ivr_started"), "ivr_started");
    expect(await callOf(app, callId)).toMatchObject({ status: "in_progress", agent_id: null });
    const prompt = promptTone();
    await waitFor(() => heard(asterisk).length >= prompt.length, "the whole prompt");
    expect(heard(asterisk).subarray(0, prompt.length).equals(prompt)).toBe(true);

    asterisk.send(DTMF, Buffer.from("1"));
    await waitFor(async () => (await eventsOf(app, callId)).some((event) => event.kind === "call_answered"), "the conversation to answer");
    expect(await callOf(app, callId)).toMatchObject({ status: "in_progress", agent_id: agentId, engine: "simulated" });
    const events = await eventsOf(app, callId);
    expect(events.slice(0, 3)).toEqual([
      { kind: "ivr_started", payload: { menu_id: expect.any(String) } },
      { kind: "ivr_option_chosen", payload: { digit: "1", label: "Recepção", action: "agent", elapsed_ms: expect.any(Number) } },
      { kind: "call_started", payload: expect.objectContaining({ direction: "inbound", agentId }) },
    ]);

    // Depois da passagem, a tecla não vira evento da URA.
    asterisk.send(DTMF, Buffer.from("2"));
    asterisk.sendAudio(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await ivrKinds(callId)).toEqual(["ivr_started", "ivr_option_chosen"]);
    expect(ari.log.some((entry) => entry.includes("deskvoice-transfer"))).toBe(false);

    asterisk.hangup();
    await waitFor(async () => (await callOf(app, callId)).ended_at !== null, "the call to end");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ended = (await eventsOf(app, callId)).filter((event) => event.kind === "call_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.payload).toMatchObject({ reason: "caller_hangup" });
    expect(await callsOf(app, organizationId)).toMatchObject([{ status: "completed", end_reason: "caller_hangup" }]);
  });

  it("T3 pelo Asterisk: a tecla 2 transfere pelo caminho de sempre; sem resposta, os eventos e o aviso de hoje", async () => {
    const { organizationId, trunkId } = await line("ivr-e2e-transfer", "+553133332222");
    const ari = await voice();
    const { callId, asterisk } = await ring(ari, trunkId, "553133332222", "canal-ura-2");
    await waitFor(() => heard(asterisk).length >= 320, "the prompt to start");
    asterisk.send(DTMF, Buffer.from("2"));

    await waitFor(() => asterisk.closed, "the AudioSocket to close for the transfer");
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: "canal-ura-2" } });
    await waitFor(() => ari.log.includes("continue canal-ura-2 deskvoice-transfer,s"), "the transfer dialplan");
    expect(ari.log).toContain("set canal-ura-2 DESKVOICE_TRANSFER_TO=5531988887777");
    ari.emit({ type: "StasisStart", args: ["transfer-ended", "NOANSWER"], channel: { id: "canal-ura-2" } });
    await waitFor(async () => (await eventsOf(app, callId)).some((event) => event.kind === "transfer_completed"), "transfer_completed");

    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transfer_unanswered" });
    expect((await eventsOf(app, callId)).find((event) => event.kind === "transfer_completed")?.payload).toEqual({ to: PERSON, status: "NOANSWER", answered: false });
    expect(await notificationsOf(app, organizationId)).toMatchObject([{ call_id: callId, body: expect.stringContaining(`Ninguém atendeu a transferência para ${PERSON}`) }]);
  });
});

const channel = (trunkId: string, exten: string): AriChannel => ({ id: "canal-1", name: `PJSIP/trunk-${trunkId}-0000002a`, dialplan: { exten }, caller: { number: "31999998888" } });

async function receive(incoming: AriChannel): Promise<{ ari: FakeAri; expected: ExpectedCall[] }> {
  const ari = fakeAri();
  const clock = fakeClock();
  const expected: ExpectedCall[] = [];
  const calls = new AsteriskCalls({ ari, db: app, clock, log: () => undefined });
  calls.expect = (call) => void expected.push(call);
  await handleInbound({ db: app, ari, clock, calls, log: () => undefined }, incoming);
  return { ari, expected };
}

describe("o ramo do inbound", { timeout: 120_000 }, () => {
  it("o número em `ivr` cria a chamada sem agente, contando como conversa, e leva o menu lido, com as opções e o áudio", async () => {
    const { organizationId, trunkId, menuId, agentId } = await line("ivr-inbound", "+553133333333");
    const { ari, expected } = await receive(channel(trunkId, "553133333333"));
    const [call] = await callsOf(app, organizationId);
    expect(call).toMatchObject({ status: "ringing", agent_id: null, end_reason: null });
    expect(await withSystem(app, (q) => q.one("select voicemail from calls where id = $1", [call?.id]))).toEqual({ voicemail: false });
    expect(ari.log.at(-1)).toBe("continue canal-1 deskvoice-audio,s");
    expect(expected).toEqual([
      {
        callId: call?.id,
        channelId: "canal-1",
        organizationId,
        agentId: null,
        trunkId,
        ivr: {
          menu: {
            id: menuId,
            name: "Menu principal",
            language: "pt-BR",
            promptAudio: promptTone(),
            timeoutMs: 5000,
            maxAttempts: 3,
            onNoChoice: "person",
            options: [
              { digit: "1", label: "Recepção", action: "agent", agentId, transferE164: null },
              { digit: "2", label: "Financeiro", action: "transfer", agentId: null, transferE164: PERSON },
            ],
          },
        },
      },
    ]);
  });

  it("o número em `ivr` não precisa de agente, e não cai na caixa postal por falta dele", async () => {
    const { organizationId, trunkId } = await line("ivr-no-agent", "+553133334444", { agentOnNumber: false });
    await putSetting(app, organizationId, VOICEMAIL_ENABLED_SETTING, true, false);
    await putSetting(app, organizationId, CALL_RECORDING_SETTING, true, false);
    const { expected } = await receive(channel(trunkId, "553133334444"));
    expect(expected).toMatchObject([{ agentId: null, ivr: { menu: expect.any(Object) } }]);
    expect(expected[0]?.voicemail).toBeUndefined();
    expect(await callsOf(app, organizationId)).toMatchObject([{ status: "ringing", end_reason: null }]);
    expect(await notificationsOf(app, organizationId)).toEqual([]);
  });

  it("no teto de ligações recebidas, o menu dá ocupado como a conversa", async () => {
    const { organizationId, trunkId } = await line("ivr-limit", "+553133335555");
    await putSetting(app, organizationId, INBOUND_LIMIT_SETTING, 1, false);
    const first = await receive(channel(trunkId, "553133335555"));
    expect(first.expected).toHaveLength(1);
    const second = await receive(channel(trunkId, "553133335555"));
    expect(second.expected).toEqual([]);
    expect(second.ari.log).toEqual(["hangup canal-1 busy"]);
    expect((await callsOf(app, organizationId)).map((call) => call.end_reason).sort()).toEqual(["inbound_limit_reached", null]);
  });

  it("T10: organização suspensa com o número em `ivr` toca a fala de indisponível, e não o menu", async () => {
    const { organizationId, trunkId } = await line("ivr-suspended", "+553133336666");
    await withSystem(app, (q) => q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste da URA' where id = $1", [organizationId]));
    const { expected } = await receive(channel(trunkId, "553133336666"));
    expect(expected).toHaveLength(1);
    expect(expected[0]?.unavailable).toEqual({ language: "pt-BR" });
    expect(expected[0]?.ivr).toBeUndefined();
    expect(await callsOf(app, organizationId)).toMatchObject([{ status: "refused", end_reason: "organization_suspended" }]);
  });
});

describe("o banco do menu (T7 e os `check`s)", { timeout: 120_000 }, () => {
  it("a organização B não lê o menu, as opções nem o áudio da A, e não aponta o número nem a opção dela para o menu da A", async () => {
    const a = await line("ivr-db-a", "+553133337777");
    const b = await line("ivr-db-b", "+553133338888");
    const seen = await withOrg(app, b.organizationId, async (q) => ({
      menus: await q.many("select id, prompt_audio from ivr_menus where id = $1", [a.menuId]),
      options: await q.many("select id from ivr_options where menu_id = $1", [a.menuId]),
      changed: await q.exec("update ivr_menus set name = 'tomado' where id = $1", [a.menuId]),
    }));
    expect(seen).toEqual({ menus: [], options: [], changed: 0 });
    await expect(withOrg(app, b.organizationId, (q) => q.exec("update phone_numbers set ivr_menu_id = $2 where id = $1", [b.phoneNumberId, a.menuId]))).rejects.toThrow(/foreign key/);
    await expect(
      withOrg(app, b.organizationId, (q) =>
        q.exec("insert into ivr_options (organization_id, menu_id, digit, label, action, transfer_e164) values ($1, $2, '5', 'Intruso', 'transfer', '+5531900000000')", [b.organizationId, a.menuId]),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      withOrg(app, b.organizationId, (q) => q.exec("insert into ivr_options (organization_id, menu_id, digit, label, action, agent_id) values ($1, $2, '5', 'Intruso', 'agent', $3)", [b.organizationId, b.menuId, a.agentId])),
    ).rejects.toThrow(/foreign key/);
    expect(await withSystem(app, (q) => q.one("select name, octet_length(prompt_audio) as bytes from ivr_menus where id = $1", [a.menuId]))).toEqual({ name: "Menu principal", bytes: 16_000 });
  });

  it("não há número em `ivr` sem menu, opção sem destino, menu em uso apagado, agente de uma opção apagado, nem anúncio acima de 60 s", async () => {
    const { organizationId, phoneNumberId, menuId, agentId } = await line("ivr-db-checks", "+553133339999");
    const rejects = (sql: string, params: unknown[]) => expect(withOrg(app, organizationId, (q) => q.exec(sql, params))).rejects.toThrow();
    await rejects("update phone_numbers set ivr_menu_id = null where id = $1", [phoneNumberId]);
    await rejects("insert into ivr_options (organization_id, menu_id, digit, label, action) values ($1, $2, '3', 'Pessoa', 'transfer')", [organizationId, menuId]);
    await rejects("insert into ivr_options (organization_id, menu_id, digit, label, action, transfer_e164) values ($1, $2, '3', 'IA', 'agent', '+5531900000000')", [organizationId, menuId]);
    await rejects("insert into ivr_options (organization_id, menu_id, digit, label, action, transfer_e164) values ($1, $2, '1', 'Repetida', 'transfer', '+5531900000000')", [organizationId, menuId]);
    await rejects("insert into ivr_options (organization_id, menu_id, digit, label, action) values ($1, $2, '12', 'Duas teclas', 'hangup')", [organizationId, menuId]);
    await rejects("delete from ivr_menus where id = $1", [menuId]);
    await rejects("delete from agents where id = $1", [agentId]);
    await rejects("update ivr_menus set prompt_audio = $2, prompt_audio_ms = 60001 where id = $1", [menuId, Buffer.alloc(960_002)]);
    await rejects("update ivr_menus set prompt_audio = null where id = $1", [menuId]);
    // Um número que já existia segue em `ai`, sem menu.
    const fresh = await createPhoneNumber(app, organizationId, (await withSystem(app, (q) => q.one<{ trunk_id: string }>("select trunk_id from phone_numbers where id = $1", [phoneNumberId])))?.trunk_id ?? "", "+553133330001", agentId);
    expect(await withSystem(app, (q) => q.one("select mode, ivr_menu_id from phone_numbers where id = $1", [fresh]))).toEqual({ mode: "ai", ivr_menu_id: null });
  });
});
