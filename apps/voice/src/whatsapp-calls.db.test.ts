// A ligação recebida pelo WhatsApp, de ponta a ponta no processo de voz: um WaCalls falso (HTTP, SSE
// e um par WebRTC de verdade no papel do dele, com o canal `pcm` a 16 kHz), o motor nas mãos do
// teste e o banco real.
import { encryptSecret, INBOUND_LIMIT_SETTING, whatsappCallsWanted, withSystem } from "@deskvoice/core";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting } from "../../../packages/tools/test/helpers";
import type { CallSession } from "./call-session";
import { silentLogger } from "./log";
import { callOf, callsOf, createAgent, createOrganization, eventsOf, kindsOf, manualEngine, secretKey, sessionHarness, type ManualEngine, type SessionHarness } from "./testing/db";
import { LOOPBACK_PEER, startFakeWacalls, type FakeCall } from "./testing/fake-wacalls";
import { manualTime, waitFor } from "./testing/helpers";
import { failureTone } from "./transport";
import { wacallsSessionName } from "./wacalls-client";
import { createWhatsAppCalls, type WhatsAppCalls } from "./whatsapp-calls";

const { app, owner } = openTestDbs();
const wacalls = await startFakeWacalls();
afterAll(async () => {
  await wacalls.stop();
  await app.close();
  await owner.close();
});

const NUMBER = "+553133330000";
const CALLER = "+5531988887777";

let engine: ManualEngine;
let harness: SessionHarness;
let time: ReturnType<typeof manualTime>;
let channel: WhatsAppCalls;
let sessions: CallSession[];
beforeEach(async () => {
  wacalls.requests.length = 0;
  wacalls.state.refuseAccept = false;
  engine = manualEngine();
  harness = await sessionHarness(app, [engine.engine]);
  time = manualTime();
  sessions = [];
  channel = createWhatsAppCalls(wacalls.options, {
    schedule: time.schedule,
    log: silentLogger,
    answer: { db: app, clock: harness.clock, now: time.now, session: harness.deps, onSession: (session) => void sessions.push(session), peerConfig: LOOPBACK_PEER },
  });
  channel.listen();
  await waitFor(() => wacalls.streams() >= 1, "the events stream");
});
afterEach(async () => {
  for (const session of sessions) session.stop("test_over");
  // A fala que ainda estiver na fila só sai com o relógio da cadência andando.
  let over = false;
  void Promise.all(sessions.map((session) => session.done)).then(() => (over = true));
  await pump(() => over, "the calls to end");
  channel.close();
  await harness.approvals.close();
  // A escuta parada não reage a mais nada (`listenWacalls` ignora o que chegar depois de `stop`); o
  // falso derruba o que sobrar aberto, para o próximo teste contar só a dele.
  wacalls.dropStreams();
});

/** Uma organização com o número conectado no WaCalls e, se pedido, o agente que atende. */
async function connected(label: string, options: { agent?: "none" | "disabled"; key?: boolean; transferTo?: string; tools?: string[] } = {}) {
  const organizationId = await createOrganization(app, label);
  const agentId = options.agent === "none" ? null : await createAgent(app, organizationId, { engine: "manual", enabled: options.agent !== "disabled", greeting: "Clínica Bem Viver, bom dia.", transferTo: options.transferTo ?? null, tools: options.tools });
  if (options.key !== false) await putSetting(app, organizationId, "engine.manual.api_key", encryptSecret("sk-teste", secretKey));
  await withSystem(app, (q) =>
    q.exec("insert into whatsapp_call_sessions (organization_id, session_name, service_wanted, status, phone_e164, agent_id) values ($1, $2, true, 'connected', $3, $4)", [
      organizationId,
      wacallsSessionName(organizationId),
      NUMBER,
      agentId,
    ]),
  );
  const session = wacalls.paired(wacallsSessionName(organizationId), NUMBER.slice(1));
  return { organizationId, agentId, ring: () => wacalls.ring(session, `${CALLER.slice(1)}@s.whatsapp.net`) };
}

const callPaths = (call: FakeCall): string[] =>
  wacalls.requests.filter((request) => request.path.split("/")[5] === call.id).map((request) => `${request.method} ${request.path.split("/")[6] ?? call.id}`);
/** Anda o relógio da cadência até a condição valer: cada passo é um pedaço de 20 ms. */
const pump = <T>(probe: () => T | Promise<T>, what: string) =>
  waitFor(async () => {
    time.advance(20);
    return probe();
  }, what);
const answeredCall = async (organizationId: string) => (await waitFor(async () => (await callsOf(app, organizationId)).find((call) => call.status === "in_progress"), "the call in progress")).id;

describe("ligação pelo WhatsApp: entrada e atendimento", { timeout: 60_000 }, () => {
  it("atende na hora: troca o SDP e atende com um dono próprio da chamada, e a conversa abre com o aviso e a saudação", async () => {
    const { organizationId, agentId, ring } = await connected("wa-answer");
    const call = ring();
    const callId = await answeredCall(organizationId);
    const clientId = `deskvoice-call-${callId}`;
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept"]);
    expect(call.offers).toEqual([clientId]);
    expect(call.owner).toBe(clientId);
    expect(await callOf(app, callId)).toMatchObject({ direction: "inbound", agent_id: agentId, from_e164: CALLER, to_e164: NUMBER, engine: "manual" });
    expect((await eventsOf(app, callId)).slice(0, 3)).toEqual([
      { kind: "call_started", payload: { direction: "inbound", from: CALLER, to: NUMBER, agentId, channel: "whatsapp" } },
      { kind: "call_answered", payload: { engine: "manual" } },
      { kind: "recording_notice", payload: { text: expect.any(String) } },
    ]);
    expect(engine.configs[0]?.greeting).toMatch(/^Esta ligação .* Clínica Bem Viver, bom dia\.$/);
  });

  it("a fala do agente só sai depois de o áudio com o WhatsApp ficar de pé, a 16 kHz; a voz de quem ligou chega ao motor a 8 kHz", async () => {
    const { organizationId, ring } = await connected("wa-audio");
    const call = ring();
    await answeredCall(organizationId);
    engine.emit("audio", Buffer.alloc(3200, 1));
    time.advance(1000);
    expect(call.leg?.received ?? []).toEqual([]);
    wacalls.connectMedia(call);
    await pump(() => (call.leg?.received.length ?? 0) >= 12, "the greeting and some silence");
    const frames = call.leg?.received ?? [];
    expect(frames.every((frame) => frame.length === 640)).toBe(true);
    expect(frames.slice(0, 10).every((frame) => frame.some((byte) => byte !== 0))).toBe(true);
    expect(frames[11]?.every((byte) => byte === 0)).toBe(true);

    wacalls.speak(call, Buffer.alloc(1920, 2));
    await waitFor(() => engine.audioBytes === 960, "the caller audio at 8 kHz");
  });

  it("quem ligou desliga: a chamada fecha como desligada por quem ligou, sem mandar desligar de novo no WaCalls", async () => {
    const { organizationId, ring } = await connected("wa-caller-hangup");
    const call = ring();
    const callId = await answeredCall(organizationId);
    wacalls.connectMedia(call);
    wacalls.hangUp(call);
    await waitFor(async () => (await callOf(app, callId)).status === "completed", "the call to close");
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "caller_hangup" });
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept"]);
  });

  it("o agente encerra (tempo máximo): a despedida sai, e só então a ligação é desligada no WaCalls", async () => {
    const { organizationId, ring } = await connected("wa-agent-ends");
    const call = ring();
    const callId = await answeredCall(organizationId);
    wacalls.connectMedia(call);
    expect(harness.timers.fire(600_000)).toBe(1);
    expect(engine.said.at(-1)).toMatch(/tempo máximo/);
    harness.timers.fire(6000);
    await pump(() => call.status === "ended", "the DELETE");
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept", `DELETE ${call.id}`]);
    await waitFor(async () => (await callOf(app, callId)).status === "completed", "the call to close");
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "max_duration" });
  });

  it("transferir não existe neste canal: a ferramenta responde para oferecer recado, sem evento de transferência", async () => {
    const { organizationId, ring } = await connected("wa-transfer", { transferTo: "+5531977776666", tools: ["transfer_to_human"] });
    ring();
    const callId = await answeredCall(organizationId);
    engine.emit("toolCall", { id: "t1", name: "transfer_to_human", args: { reason: "pediu uma pessoa", summary: "Quer falar com a recepção." } });
    await waitFor(() => engine.toolResults.length === 1, "the tool result");
    expect(engine.toolResults[0]?.result).toMatchObject({ ok: false, message: expect.stringMatching(/não há como transferir.*notify_human/) });
    expect(await kindsOf(app, callId)).not.toContain("transfer_started");
  });

  it("o motor cai no meio: quem ligou ouve o sinal de falha, o painel recebe o aviso, e a ligação é desligada, sem transferência", async () => {
    const { organizationId, ring } = await connected("wa-engine-drops", { transferTo: "+5531977776666" });
    const call = ring();
    const callId = await answeredCall(organizationId);
    wacalls.connectMedia(call);
    engine.emit("closed", "provider_error");
    await pump(() => call.status === "ended", "the DELETE");
    const tone = Buffer.concat(call.leg?.received ?? []).filter((byte) => byte !== 0).length;
    expect(tone).toBeGreaterThan(failureTone().filter((byte) => byte !== 0).length);
    await waitFor(async () => (await callOf(app, callId)).status === "failed", "the call to close");
    expect(await callOf(app, callId)).toMatchObject({ end_reason: "engine_failed" });
    expect(await kindsOf(app, callId)).not.toContain("transfer_started");
    expect((await notificationsOf(app, organizationId)).at(-1)?.body).toMatch(/caiu no meio.*foi encerrada/);
  });

  it("motor sem chave: atende, quem ligou ouve o sinal de falha e a ligação cai; o painel recebe o aviso", async () => {
    const { organizationId, ring } = await connected("wa-no-key", { key: false });
    const call = ring();
    await waitFor(() => call.owner !== null, "the accept");
    wacalls.connectMedia(call);
    await pump(() => call.status === "ended", "the DELETE");
    expect(Buffer.concat(call.leg?.received ?? []).some((byte) => byte !== 0)).toBe(true);
    const [refused] = await callsOf(app, organizationId);
    expect(refused).toMatchObject({ status: "refused", end_reason: "engine_not_configured" });
    expect((await notificationsOf(app, organizationId))[0]?.body).toMatch(/não está pronto/);
  });

  it("o WaCalls recusa o atendimento: a chamada fecha como falha, o painel é avisado, e nada é desligado no WaCalls", async () => {
    const { organizationId, ring } = await connected("wa-accept-refused");
    wacalls.state.refuseAccept = true;
    const call = ring();
    const [failed] = await waitFor(async () => {
      const calls = await callsOf(app, organizationId);
      return calls[0]?.status === "failed" ? calls : null;
    }, "the failed call");
    expect(failed).toMatchObject({ end_reason: "whatsapp_answer_failed" });
    expect(await kindsOf(app, failed?.id ?? "")).toEqual(["call_ended"]);
    expect((await notificationsOf(app, organizationId))[0]?.body).toMatch(/não pôde ser atendida.*continuou tocando no celular/);
    expect(callPaths(call)).toEqual(["POST webrtc", "POST accept"]);
  });
});

describe("ligação pelo WhatsApp: quando o agente não atende, ela segue tocando no celular", { timeout: 60_000 }, () => {
  /** Recusada: linha, evento e aviso, e nenhum pedido ao WaCalls para aquela ligação. */
  async function refusedBy(organizationId: string, call: FakeCall) {
    const [refused] = await waitFor(async () => {
      const calls = (await callsOf(app, organizationId)).filter((row) => row.status === "refused");
      return calls.length > 0 ? calls : null;
    }, "the refused call");
    expect(callPaths(call)).toEqual([]);
    expect(call.status).toBe("ringing");
    return { refused, events: await eventsOf(app, refused?.id ?? ""), notices: await notificationsOf(app, organizationId) };
  }

  it("sem agente escolhido", async () => {
    const { organizationId, ring } = await connected("wa-no-agent", { agent: "none" });
    const { refused, events, notices } = await refusedBy(organizationId, ring());
    expect(refused).toMatchObject({ end_reason: "no_agent", from_e164: CALLER, to_e164: NUMBER });
    expect(events).toEqual([{ kind: "call_refused", payload: { reason: "no_agent", from: CALLER, to: NUMBER, channel: "whatsapp" } }]);
    expect(notices[0]?.body).toMatch(/nenhum agente atende.*continuou tocando no celular.*Configurações/);
  });

  it("agente desligado", async () => {
    const { organizationId, ring } = await connected("wa-agent-off", { agent: "disabled" });
    const { refused, notices } = await refusedBy(organizationId, ring());
    expect(refused).toMatchObject({ end_reason: "agent_disabled" });
    expect(notices[0]?.body).toMatch(/agente desse número está desligado/);
  });

  it("teto de recebidas: a ligação da operadora em andamento conta, no mesmo teto", async () => {
    const { organizationId, agentId, ring } = await connected("wa-limit");
    await putSetting(app, organizationId, INBOUND_LIMIT_SETTING, 1, false);
    await withSystem(app, (q) =>
      q.exec("insert into calls (organization_id, agent_id, direction, from_e164, to_e164, status, started_at) values ($1, $2, 'inbound', '+5531911112222', '+553144445555', 'in_progress', $3)", [
        organizationId,
        agentId,
        harness.clock.now(),
      ]),
    );
    const { refused, events, notices } = await refusedBy(organizationId, ring());
    expect(refused).toMatchObject({ end_reason: "inbound_limit_reached" });
    expect(events[0]?.payload).toMatchObject({ reason: "inbound_limit_reached", channel: "whatsapp", limit: 1 });
    expect(notices[0]?.body).toMatch(/já havia 1 ligações recebidas em andamento, pela operadora e pelo WhatsApp/);
  });

  it("teto de recebidas: a ligação do WhatsApp em andamento ocupa a vaga da seguinte", async () => {
    const { organizationId, ring } = await connected("wa-limit-two");
    await putSetting(app, organizationId, INBOUND_LIMIT_SETTING, 1, false);
    const first = ring();
    await answeredCall(organizationId);
    const second = ring();
    await refusedBy(organizationId, second);
    expect(callPaths(first)).toEqual(["POST webrtc", "POST accept"]);
  });
});

describe("ligação pelo WhatsApp: a partida do processo de voz", { timeout: 60_000 }, () => {
  it("diz que alguma organização pediu o serviço, para o processo ouvir o WaCalls desde a partida", async () => {
    await connected("wa-wanted");
    expect(await whatsappCallsWanted(app)).toBe(true);
  });
});
