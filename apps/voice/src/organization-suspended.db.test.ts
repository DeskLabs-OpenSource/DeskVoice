// A organização suspensa, do lado do processo de voz (seção 3.3 do desenho do R8,
// `docs/specs/2026-11-17-varias-organizacoes-e-administracao-da-instalacao.md`, fatia 4a): a ligação
// que chega pela operadora é atendida só para ouvir a fala de indisponível, e desliga, sem abrir o
// motor de voz. A outra organização da mesma instalação segue atendendo, no mesmo processo.
//
// `suspended_at` é marcado direto no banco: as ações que o marcam são da fatia 4b.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CALL_RECORDING_SETTING, VOICEMAIL_ENABLED_SETTING, withSystem } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import type { VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting } from "../../../packages/tools/test/helpers";
import { AsteriskCalls } from "./asterisk-transport";
import { startOutboundCall } from "./outbound";
import { startVoiceServer, type VoiceServer } from "./server";
import { callOf, callsOf, createAgent, createOrganization, createPhoneNumber, createTrunk, eventsOf, fakeAri, fakeClock, ledgerOf, pricedSimulatedEngine, secretKey, testSchedule, type FakeAri } from "./testing/db";
import { fakeAsterisk, waitFor, type FakeAsterisk } from "./testing/helpers";
import { unavailableNotice } from "./unavailable";

const { app, owner } = openTestDbs();
let scratch: string;
let server: VoiceServer | undefined;
const sockets: FakeAsterisk[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-suspended-"));
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

const suspend = (organizationId: string) =>
  withSystem(app, (q) => q.exec("update organizations set suspended_at = now(), suspended_reason = 'teste da fatia 4a' where id = $1", [organizationId]));

/** Uma organização com uma linha e um número; o agente do número é opcional. */
async function line(label: string, number: string, agent: { language?: string } | null = {}) {
  const organizationId = await createOrganization(app, label);
  const agentId = agent ? await createAgent(app, organizationId, { language: agent.language, script: [{ expectUserAudio: 100_000 }] }) : null;
  const trunkId = await createTrunk(app, organizationId, { callerId: number });
  await createPhoneNumber(app, organizationId, trunkId, number, agentId);
  return { organizationId, agentId, trunkId };
}

/** O processo de voz com um motor que conta quantas vezes foi aberto. */
async function voice(): Promise<{ ari: FakeAri; opened: () => number }> {
  const simulated = pricedSimulatedEngine(60);
  let opened = 0;
  const counting: VoiceEngine = {
    ...simulated,
    connect(config, apiKey, options) {
      opened += 1;
      return simulated.connect(config, apiKey, options);
    },
  };
  const ari = fakeAri();
  const timers = testSchedule();
  server = await startVoiceServer({
    db: app,
    clock: fakeClock(),
    engines: new Map([["simulated", counting]]),
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
  return { ari, opened: () => opened };
}

/** Uma ligação chega pelo tronco; o dialplan abre o AudioSocket com o UUID que o processo pôs no canal. */
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

/** Tudo o que saiu para quem ligou, emendado. */
const heard = (asterisk: FakeAsterisk): Buffer => Buffer.concat(asterisk.frames.filter((frame) => frame.type === 0x10).map((frame) => frame.payload));

describe("organização suspensa: a ligação pela operadora", { timeout: 120_000 }, () => {
  it("atende, toca a fala de indisponível no idioma do agente do número e desliga, sem abrir o motor; a outra organização segue atendendo", async () => {
    const suspended = await line("suspended-phone", "+553133334444", { language: "en-US" });
    const active = await line("suspended-phone-other", "+553144445555");
    await suspend(suspended.organizationId);
    const { ari, opened } = await voice();

    const refused = await ring(ari, suspended.trunkId, "553133334444", "canal-suspensa");
    expect(await callOf(app, refused.callId)).toMatchObject({ status: "refused", end_reason: "organization_suspended", agent_id: suspended.agentId, to_e164: "+553133334444", ended_at: expect.any(Date) });
    expect(await eventsOf(app, refused.callId)).toEqual([
      { kind: "call_refused", payload: { reason: "organization_suspended", from: "+5531999998888", to: "+553133334444", dialed: "553133334444" } },
    ]);

    // A fala inteira sai, e só então o processo fecha o áudio, que devolve o canal para ser desligado.
    await waitFor(() => refused.asterisk.closed, "the AudioSocket to close after the notice");
    const notice = await unavailableNotice("en");
    const audio = heard(refused.asterisk);
    expect(audio.subarray(0, notice.length).equals(notice)).toBe(true);
    expect(audio.length - notice.length).toBeLessThan(320);
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: "canal-suspensa" } });
    await waitFor(() => ari.log.includes("hangup canal-suspensa"), "the channel to be hung up");

    // Nada de motor, de custo nem de aviso: a organização suspensa não gasta.
    expect(opened()).toBe(0);
    expect(await ledgerOf(app, refused.callId)).toEqual([]);
    expect(await notificationsOf(app, suspended.organizationId)).toEqual([]);
    // Tocar a fala não muda a chamada: ela nasceu recusada e assim fica.
    expect(await callOf(app, refused.callId)).toMatchObject({ status: "refused", end_reason: "organization_suspended" });
    expect(await eventsOf(app, refused.callId)).toHaveLength(1);

    // A outra organização, no mesmo processo e no mesmo instante: atende com o motor, como sempre.
    const answered = await ring(ari, active.trunkId, "553144445555", "canal-ativa");
    await waitFor(async () => (await callOf(app, answered.callId)).status === "in_progress", "the other organization's call in progress");
    expect(opened()).toBe(1);
    expect(await callsOf(app, active.organizationId)).toMatchObject([{ status: "in_progress", end_reason: null }]);
  });

  it("antes de olhar o agente: número sem agente e com a caixa postal ligada também ouve a fala, no idioma padrão, e nenhum recado é gravado", async () => {
    const suspended = await line("suspended-no-agent", "+553155556666", null);
    await putSetting(app, suspended.organizationId, VOICEMAIL_ENABLED_SETTING, true, false);
    await putSetting(app, suspended.organizationId, CALL_RECORDING_SETTING, true, false);
    await suspend(suspended.organizationId);
    const { ari, opened } = await voice();

    const refused = await ring(ari, suspended.trunkId, "553155556666", "canal-sem-agente");
    expect(await callOf(app, refused.callId)).toMatchObject({ status: "refused", end_reason: "organization_suspended", agent_id: null });
    expect(await withSystem(app, (q) => q.one("select voicemail from calls where id = $1", [refused.callId]))).toEqual({ voicemail: false });
    await waitFor(() => refused.asterisk.closed, "the AudioSocket to close after the notice");
    const notice = await unavailableNotice("pt-BR");
    expect(heard(refused.asterisk).subarray(0, notice.length).equals(notice)).toBe(true);
    expect(opened()).toBe(0);
    expect(await notificationsOf(app, suspended.organizationId)).toEqual([]);
  });
});

describe("organização suspensa: a ligação de saída", { timeout: 120_000 }, () => {
  it("é recusada antes de existir canal, com a chamada recusada e o motivo; a outra organização liga", async () => {
    const suspended = await line("suspended-outbound", "+553177778888");
    const active = await line("suspended-outbound-other", "+553177779999");
    for (const organizationId of [suspended.organizationId, active.organizationId]) {
      await withSystem(app, (q) =>
        q.exec("insert into outbound_policy (organization_id, enabled, window_start, window_end, timezone) values ($1, true, '00:00', '23:59', 'UTC')", [organizationId]),
      );
    }
    await suspend(suspended.organizationId);
    const ari = fakeAri();
    const clock = fakeClock();
    const deps = { db: app, ari, clock, calls: new AsteriskCalls({ ari, db: app, clock, log: () => undefined }), log: () => undefined };

    const refused = await startOutboundCall(deps, { organizationId: suspended.organizationId, agentId: suspended.agentId ?? "", toE164: "+5531911112222" });
    expect(refused).toMatchObject({ code: "organization_suspended" });
    expect(await callsOf(app, suspended.organizationId)).toMatchObject([{ direction: "outbound", status: "refused", end_reason: "organization_suspended" }]);
    expect(ari.originated).toEqual([]);

    const placed = await startOutboundCall(deps, { organizationId: active.organizationId, agentId: active.agentId ?? "", toE164: "+5531911112222" });
    expect(placed).toMatchObject({ callId: expect.any(String) });
    expect(ari.originated).toHaveLength(1);
  });
});
