// Teste de ponta a ponta do processo de voz: um Asterisk falso (cliente AudioSocket por TCP de
// verdade e eventos de ARI), o motor simulado seguindo um roteiro, e o banco real.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadTools } from "@deskvoice/tools";
import type { SimulatedScript } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting, tasksOf } from "../../../packages/tools/test/helpers";
import { startVoiceServer, type VoiceServer } from "./server";
import {
  approvalsOf,
  callOf,
  createAgent,
  createOrganization,
  createPhoneNumber,
  createTrunk,
  decideApproval,
  eventsOf,
  fakeAri,
  fakeClock,
  kindsOf,
  ledgerOf,
  pricedSimulatedEngine,
  secretKey,
  simulatedSpeechMs,
  testSchedule,
  type AgentOptions,
  type FakeAri,
} from "./testing/db";
import { fakeAsterisk, waitFor, type FakeAsterisk } from "./testing/helpers";

const { app, owner } = openTestDbs();
let scratch: string;
let server: VoiceServer | undefined;
let asterisk: FakeAsterisk | undefined;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-e2e-"));
});
afterEach(async () => {
  asterisk?.socket.destroy();
  await server?.close();
  server = undefined;
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  await app.close();
  await owner.close();
});

const GREETING = "Clínica Bem Viver, bom dia. Como posso ajudar?";
const NOTICE = "Esta ligação pode ser gravada.";
const WAIT_LINE = "Um instante, por favor. Vou conferir isso com um responsável.";
const approvalStep = (defaultOnTimeout: "approved" | "denied" = "denied") => ({
  toolCall: {
    name: "request_approval",
    args: { question: "Posso dar 10% de desconto no pacote?", context: "Cliente quer fechar o pacote de três sessões hoje.", default_on_timeout: defaultOnTimeout, timeout_seconds: 30 },
  },
});
const SCRIPT: SimulatedScript = [
  { expectUserAudio: 1000, text: "Quero remarcar e pedir um desconto." },
  approvalStep(),
  { say: "Obrigada por aguardar." },
  { say: "Vou transferir você para a recepção." },
  { toolCall: { name: "transfer_to_human", args: { reason: "Fechar o horário com a recepção.", summary: "Marina quer remarcar a limpeza de pele e fechar o pacote." } } },
];

interface Scene {
  ari: FakeAri;
  clock: ReturnType<typeof fakeClock>;
  timers: ReturnType<typeof testSchedule>;
  organizationId: string;
  trunkId: string;
  callId: string;
  channelId: string;
  asterisk: FakeAsterisk;
}

/** Sobe o processo de voz, faz uma ligação chegar pelo tronco e conecta o áudio dela. */
async function incomingCall(label: string, agent: AgentOptions, settings: Record<string, unknown> = {}): Promise<Scene> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { greeting: GREETING, tools: ["request_approval", "transfer_to_human", "end_call"], ...agent });
  const trunkId = await createTrunk(app, organizationId, { callerId: "+553133334444" });
  await createPhoneNumber(app, organizationId, trunkId, "+553133334444", agentId);
  for (const [key, value] of Object.entries(settings)) await putSetting(app, organizationId, key, value, false);

  const ari = fakeAri();
  const clock = fakeClock();
  const timers = testSchedule();
  server = await startVoiceServer({
    db: app,
    clock,
    engines: new Map([["simulated", pricedSimulatedEngine(60)]]),
    tools: await loadTools(),
    ari,
    secretKey,
    audioSocketPort: 0,
    internalPort: 0,
    internalToken: "token-de-teste",
    trunksFile: path.join(scratch, `${organizationId}.conf`),
    publicIp: "203.0.113.10",
    host: "127.0.0.1",
    schedule: timers.schedule,
    now: timers.now,
  });

  const channelId = `canal-${organizationId.slice(0, 8)}`;
  ari.emit({ type: "StasisStart", args: ["inbound"], channel: { id: channelId, name: `PJSIP/trunk-${trunkId}-00000001`, dialplan: { exten: "553133334444" }, caller: { number: "31999998888" } } });
  // O dialplan abre o AudioSocket com o UUID que o processo de voz definiu no canal.
  const variable = await waitFor(() => ari.log.find((line) => line.startsWith(`set ${channelId} AUDIOSOCKET_UUID=`)), "AUDIOSOCKET_UUID on the channel");
  await waitFor(() => ari.log.includes(`continue ${channelId} deskvoice-audio,s`), "the channel to go to the audio context");
  const callId = variable.split("=")[1] ?? "";
  asterisk = await fakeAsterisk(server.audioSocketPort);
  asterisk.sendUuid(callId);
  return { ari, clock, timers, organizationId, trunkId, callId, channelId, asterisk };
}

const pendingApproval = (callId: string) => waitFor(async () => (await approvalsOf(app, callId)).find((approval) => approval.status === "pending"), "the pending approval in the database");
const saidWaitLine = (callId: string) =>
  waitFor(async () => (await eventsOf(app, callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === WAIT_LINE), "the agent to say it is checking");
const ended = (callId: string) => waitFor(async () => (await kindsOf(app, callId)).includes("task_queued"), "the call to end");

describe("chamada de ponta a ponta", { timeout: 120_000 }, () => {
  it("atende, espera a aprovação decidida no painel, transfere e deixa o resumo na fila", async () => {
    const { ari, clock, organizationId, trunkId, callId, channelId, asterisk } = await incomingCall("e2e", { script: SCRIPT, transferTo: "+5531988887777" }, { "recording_notice.text": NOTICE });
    // Quem ligou fala depois de ouvir a saudação e o aviso (o motor simulado só conta o áudio que
    // chega quando o roteiro está esperando por ele).
    const openingFrames = (simulatedSpeechMs(GREETING) + simulatedSpeechMs(NOTICE)) / 20;
    await waitFor(() => asterisk.frames.filter((frame) => frame.type === 0x10).length >= openingFrames, "the greeting and the notice to be heard");
    asterisk.sendAudio(1000);

    // A aprovação aparece no banco, pendente, ENQUANTO a ferramenta espera: é o que prova que
    // cada consulta da chamada confirma na hora, e é o que deixa o painel mostrá-la.
    const approval = await pendingApproval(callId);
    expect(approval.question).toBe("Posso dar 10% de desconto no pacote?");
    await saidWaitLine(callId);
    expect((await notificationsOf(app, organizationId)).map((notification) => notification.channel)).toEqual(["panel"]);
    expect(await kindsOf(app, callId)).not.toContain("approval_decided");
    expect((await callOf(app, callId)).status).toBe("in_progress");

    clock.advance(4000);
    expect(await decideApproval(app, approval.id, "approved", clock.now())).toBe(1);
    await ended(callId);

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual([
      "call_started",
      "call_answered",
      "recording_notice",
      "transcript_agent", // saudação
      "transcript_agent", // aviso de gravação
      "transcript_user",
      "tool_called", // request_approval
      "approval_requested",
      "transcript_agent", // "um instante"
      "approval_decided",
      "tool_result",
      "transcript_agent",
      "transcript_agent",
      "tool_called", // transfer_to_human
      "transfer_started",
      "tool_result",
      "call_ended",
      "task_queued",
    ]);
    const payloads = events.map((event) => event.payload);
    expect(payloads[0]).toEqual({ direction: "inbound", from: "+5531999998888", to: "+553133334444", agentId: expect.any(String) });
    expect(payloads[2]).toEqual({ text: NOTICE });
    expect([payloads[3], payloads[4], payloads[5]]).toEqual([{ text: GREETING }, { text: NOTICE }, { text: "Quero remarcar e pedir um desconto." }]);
    expect(payloads[9]).toEqual({ approvalId: approval.id, outcome: "approved", decision: "approved" });
    expect(payloads[10]).toMatchObject({ name: "request_approval", ok: true });
    expect(payloads[14]).toMatchObject({ to: "+5531988887777" });

    // Custo: 1 s de quem ligou mais a fala do agente, a 60 centavos por minuto (1 centavo por segundo).
    const spoken = [GREETING, NOTICE, WAIT_LINE, "Obrigada por aguardar.", "Vou transferir você para a recepção."].map(simulatedSpeechMs);
    const seconds = (1000 + spoken.reduce((sum, ms) => sum + ms, 0)) / 1000;
    const cost = Math.ceil(seconds);
    expect(cost).toBeGreaterThan(5);
    expect(payloads[16]).toEqual({ status: "transferred", reason: "transferred", costCents: cost, seconds: Math.round(seconds) });
    expect(await ledgerOf(app, callId)).toEqual([{ engine: "simulated", seconds: Math.round(seconds), input_tokens: 0, output_tokens: 0, cost_cents: cost }]);
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transferred", engine: "simulated", cost_cents: cost, answered_at: expect.any(Date), ended_at: clock.now() });

    const tasks = (await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call");
    expect(tasks).toMatchObject([{ kind: "summarize_call", payload: {}, status: "queued", call_id: callId }]);
    expect(payloads[17]).toEqual({ taskId: tasks[0]?.id, kind: "summarize_call" });

    // A fala do agente chegou ao Asterisk, e a transferência fecha o AudioSocket sem derrubar o canal.
    await waitFor(() => asterisk.closed, "the AudioSocket to close");
    expect(asterisk.frames.filter((frame) => frame.type === 0x10).length).toBeGreaterThan(50);
    expect(asterisk.frames.some((frame) => frame.type === 0x00)).toBe(false);
    expect(ari.log.some((line) => line.startsWith("hangup"))).toBe(false);

    // O dialplan devolve o canal à Stasis, e o processo o manda discar para o humano.
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`continue ${channelId} deskvoice-transfer,s`), "the channel to go to the transfer context");
    expect(ari.log).toContain(`set ${channelId} DESKVOICE_TRANSFER_TO=5531988887777`);
    expect(ari.log).toContain(`set ${channelId} DESKVOICE_TRUNK=trunk-${trunkId}`);

    ari.emit({ type: "StasisStart", args: ["transfer-ended", "ANSWER"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`hangup ${channelId}`), "the channel to be hung up after the transfer");
    expect((await eventsOf(app, callId)).at(-1)).toEqual({ kind: "transfer_completed", payload: { to: "+5531988887777", status: "ANSWER", answered: true } });
  });

  it("transferência que ninguém atende fica registrada como não atendida", async () => {
    const script: SimulatedScript = [{ toolCall: { name: "transfer_to_human", args: { reason: "Pediu um humano.", summary: "Quer falar com a recepção." } } }];
    const { ari, callId, channelId, asterisk } = await incomingCall("e2e-noanswer", { script, transferTo: "+5531988887777" });
    await ended(callId);
    await waitFor(() => asterisk.closed, "the AudioSocket to close");
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`continue ${channelId} deskvoice-transfer,s`), "the transfer to start");
    ari.emit({ type: "StasisStart", args: ["transfer-ended", "NOANSWER"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`hangup ${channelId}`), "the hangup");
    expect((await eventsOf(app, callId)).at(-1)).toEqual({ kind: "transfer_completed", payload: { to: "+5531988887777", status: "NOANSWER", answered: false } });
  });

  it("aprovação negada: o agente é informado e a chamada segue até o agente encerrar", async () => {
    const script: SimulatedScript = [approvalStep(), { say: "Infelizmente não consigo o desconto." }, { toolCall: { name: "end_call", args: { reason: "A cliente se despediu." } } }];
    const { ari, clock, callId, channelId, asterisk } = await incomingCall("e2e-denied", { script });
    const approval = await pendingApproval(callId);
    await saidWaitLine(callId);
    await decideApproval(app, approval.id, "denied", clock.now());
    await ended(callId);

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual([
      "call_started", "call_answered", "transcript_agent", "tool_called", "approval_requested", "transcript_agent",
      "approval_decided", "tool_result", "transcript_agent", "tool_called", "tool_result", "call_ended", "task_queued",
    ]);
    expect(events[6]?.payload).toEqual({ approvalId: approval.id, outcome: "denied", decision: "denied" });
    expect(events[7]?.payload.message).toMatch(/NEGOU/);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "end_call" });

    // Sem transferência pedida, o canal que volta do AudioSocket é desligado.
    await waitFor(() => asterisk.closed, "the AudioSocket to close");
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`hangup ${channelId}`), "the hangup");
    expect(ari.log.some((line) => line.includes("deskvoice-transfer"))).toBe(false);
  });

  it("aprovação sem resposta: vence no prazo, aplica o padrão e o agente segue", async () => {
    const script: SimulatedScript = [approvalStep("approved"), { say: "Pode seguir com o desconto." }, { toolCall: { name: "end_call", args: { reason: "Concluído." } } }];
    const { timers, clock, callId } = await incomingCall("e2e-expired", { script });
    const approval = await pendingApproval(callId);
    await saidWaitLine(callId);
    expect(timers.held()).toContain(30_000);
    clock.advance(30_000);
    expect(timers.fire(30_000)).toBe(1);
    await ended(callId);

    const events = await eventsOf(app, callId);
    expect(events.find((event) => event.kind === "approval_decided")?.payload).toEqual({ approvalId: approval.id, outcome: "expired", decision: "approved" });
    expect(events.find((event) => event.kind === "tool_result")?.payload.message).toMatch(/Ninguém respondeu no prazo.*APROVADO/);
    expect((await approvalsOf(app, callId))[0]?.status).toBe("expired");
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "end_call" });
  });

  it("quem ligou desliga no meio de uma espera: fecha tudo uma vez só, sem evento duplicado", async () => {
    const script: SimulatedScript = [approvalStep(), { say: "Isto nunca é dito." }];
    const { ari, organizationId, callId, channelId, asterisk } = await incomingCall("e2e-hangup", { script, transferTo: "+5531988887777" });
    await pendingApproval(callId);
    await saidWaitLine(callId);

    // O desligar chega ao mesmo tempo que o processo é mandado encerrar: dois pedidos de fim.
    asterisk.hangup();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_ended"), "the call to end");
    await server?.close();
    server = undefined;

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual([
      "call_started", "call_answered", "transcript_agent", "tool_called", "approval_requested", "transcript_agent", "tool_result", "call_ended", "task_queued",
    ]);
    // A ferramenta em espera foi solta, com o motivo para o operador, antes do fim da chamada.
    expect(events[6]?.payload).toMatchObject({ name: "request_approval", ok: false, error: "The call ended before the tool finished" });
    expect(events[7]?.payload).toMatchObject({ status: "completed", reason: "caller_hangup" });
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    expect((await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call")).toHaveLength(1);
    expect(await ledgerOf(app, callId)).toHaveLength(1);

    // O canal morre do lado do Asterisk; nada mais é gravado por causa disso.
    ari.emit({ type: "ChannelDestroyed", channel: { id: channelId }, cause_txt: "Normal Clearing" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await kindsOf(app, callId)).toHaveLength(9);
  });

  it("fecha a conexão de áudio de uma chamada que ninguém espera", async () => {
    const { asterisk } = await incomingCall("e2e-unknown", { script: [{ expectUserAudio: 100_000 }] });
    const stranger = await fakeAsterisk(server?.audioSocketPort ?? 0);
    stranger.sendUuid("11111111-2222-4333-8444-555555555555");
    await waitFor(() => stranger.closed, "the unknown connection to be closed");
    expect(asterisk.closed).toBe(false);
  });

  it("chamada que o Asterisk derruba antes de o áudio conectar termina como falha, com evento", async () => {
    const organizationId = await createOrganization(app, "e2e-noaudio");
    const agentId = await createAgent(app, organizationId, {});
    const trunkId = await createTrunk(app, organizationId);
    await createPhoneNumber(app, organizationId, trunkId, "+553133334444", agentId);
    const ari = fakeAri();
    server = await startVoiceServer({
      db: app, clock: fakeClock(), engines: new Map(), tools: new Map(), ari, secretKey, audioSocketPort: 0, internalPort: 0, internalToken: undefined,
      trunksFile: path.join(scratch, `${organizationId}.conf`), publicIp: null, host: "127.0.0.1",
    });
    ari.emit({ type: "StasisStart", args: ["inbound"], channel: { id: "canal-x", name: `PJSIP/trunk-${trunkId}-0000000a`, dialplan: { exten: "s" } } });
    const variable = await waitFor(() => ari.log.find((line) => line.startsWith("set canal-x AUDIOSOCKET_UUID=")), "the call to be created");
    const callId = variable.split("=")[1] ?? "";
    ari.emit({ type: "ChannelDestroyed", channel: { id: "canal-x" }, cause_txt: "User busy" });
    await waitFor(async () => (await callOf(app, callId)).status === "failed", "the call to be marked failed");
    expect(await callOf(app, callId)).toMatchObject({ status: "failed", end_reason: "no_answer" });
    expect(await eventsOf(app, callId)).toEqual([{ kind: "call_ended", payload: { status: "failed", reason: "no_answer", cause: "User busy" } }]);
  });
});
