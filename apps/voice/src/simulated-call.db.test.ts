// Teste de ponta a ponta do processo de voz: um Asterisk falso (cliente AudioSocket por TCP de
// verdade e eventos de ARI), o motor simulado seguindo um roteiro, e o banco real.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptSecret, withSystem } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import type { SimulatedScript, VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting, tasksOf } from "../../../packages/tools/test/helpers";
import { createPipelineEngine } from "../../../packages/voice-engine/src/engines/pipeline";
import { FixedSpeechCache } from "../../../packages/voice-engine/src/synthesis";
import { brainKeySetting, brainModelsSetting, DEFAULT_RECORDING_NOTICE } from "./call-session";
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
import { startFakeBrain, text, tool, usage, type FakeBrain } from "./testing/fake-brain";
import { fakeAsterisk, waitFor, type FakeAsterisk } from "./testing/helpers";

const { app, owner } = openTestDbs();
let scratch: string;
let server: VoiceServer | undefined;
let asterisk: FakeAsterisk | undefined;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-e2e-"));
});
let fakeBrain: FakeBrain | undefined;

afterEach(async () => {
  asterisk?.socket.destroy();
  await server?.close();
  server = undefined;
  await fakeBrain?.stop();
  fakeBrain = undefined;
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  await app.close();
  await owner.close();
});

const GREETING = "Clínica Bem Viver, bom dia. Como posso ajudar?";
const NOTICE = "Esta ligação pode ser gravada.";
const WAIT_LINE = "Um instante, por favor. Vou conferir isso com um responsável.";
const approvalStep = () => ({
  toolCall: {
    name: "request_approval",
    args: { question: "Posso dar 10% de desconto no pacote?", context: "Cliente quer fechar o pacote de três sessões hoje.", timeout_seconds: 30 },
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
async function incomingCall(label: string, agent: AgentOptions, settings: Record<string, unknown> = {}, options: { engines?: Map<string, VoiceEngine>; pipeline?: unknown; secrets?: Record<string, unknown>; simulatedPieces?: boolean } = {}): Promise<Scene> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { greeting: GREETING, tools: ["request_approval", "transfer_to_human", "end_call"], ...agent });
  const trunkId = await createTrunk(app, organizationId, { callerId: "+553133334444" });
  await createPhoneNumber(app, organizationId, trunkId, "+553133334444", agentId);
  for (const [key, value] of Object.entries(settings)) await putSetting(app, organizationId, key, value, false);
  for (const [key, value] of Object.entries(options.secrets ?? {})) await putSetting(app, organizationId, key, value);
  if (options.pipeline !== undefined) await withSystem(app, (q) => q.exec("update agents set pipeline = $2 where id = $1", [agentId, JSON.stringify(options.pipeline)]));

  const ari = fakeAri();
  const clock = fakeClock();
  const timers = testSchedule();
  server = await startVoiceServer({
    db: app,
    clock,
    engines: options.engines ?? new Map([["simulated", pricedSimulatedEngine(60)]]),
    tools: await loadTools(),
    ari,
    secretKey,
    audioSocketPort: 0,
    internalPort: 0, webPort: 0,
    internalToken: "token-de-teste",
    trunksFile: path.join(scratch, `${organizationId}.conf`),
    publicIp: "203.0.113.10",
    host: "127.0.0.1",
    schedule: timers.schedule,
    resolveName: async () => ["192.0.2.53"],
    now: timers.now,
    ...(options.simulatedPieces === true && { simulatedPieces: true }),
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
const ended = (callId: string) => waitFor(async () => (await kindsOf(app, callId)).filter((kind) => kind === "task_queued").length === 2, "the call to end");

describe("chamada de ponta a ponta", { timeout: 120_000 }, () => {
  it("atende, espera a aprovação decidida no painel, transfere e deixa o resumo na fila", async () => {
    // A volta da transferência não atendida desligada: a ligação termina antes de discar, como antes da fatia 5a.
    const { ari, clock, organizationId, trunkId, callId, channelId, asterisk } = await incomingCall("e2e", { script: SCRIPT, transferTo: "+5531988887777", transferReturnsToAgent: false }, { "recording_notice.text": NOTICE });
    // Quem ligou fala depois de ouvir a saudação e o aviso (o motor simulado só conta o áudio que
    // chega quando o roteiro está esperando por ele).
    const openingFrames = simulatedSpeechMs(`${NOTICE} ${GREETING}`) / 20;
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
      "transcript_agent", // abertura: o aviso de gravação e, depois, a saudação
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
      "task_queued",
    ]);
    const payloads = events.map((event) => event.payload);
    expect(payloads[0]).toEqual({ direction: "inbound", from: "+5531999998888", to: "+553133334444", agentId: expect.any(String) });
    expect(payloads[2]).toEqual({ text: NOTICE });
    expect([payloads[3], payloads[4]]).toEqual([{ text: `${NOTICE} ${GREETING}` }, { text: "Quero remarcar e pedir um desconto." }]);
    expect(payloads[8]).toEqual({ approvalId: approval.id, outcome: "approved", decision: "approved" });
    expect(payloads[9]).toMatchObject({ name: "request_approval", ok: true });
    expect(payloads[13]).toMatchObject({ to: "+5531988887777" });

    // Custo: 1 s de quem ligou mais a fala do agente, a 60 centavos por minuto (1 centavo por segundo).
    const spoken = [`${NOTICE} ${GREETING}`, WAIT_LINE, "Obrigada por aguardar.", "Vou transferir você para a recepção."].map(simulatedSpeechMs);
    const seconds = (1000 + spoken.reduce((sum, ms) => sum + ms, 0)) / 1000;
    const cost = Math.ceil(seconds);
    expect(cost).toBeGreaterThan(5);
    expect(payloads[15]).toEqual({ status: "transferred", reason: "transferred", costCents: cost, seconds: Math.round(seconds) });
    expect(await ledgerOf(app, callId)).toEqual([{ engine: "simulated", agent_id: payloads[0]?.agentId, seconds: Math.round(seconds), input_tokens: 0, output_tokens: 0, cost_cents: cost }]);
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transferred", engine: "simulated", cost_cents: cost, answered_at: expect.any(Date), ended_at: clock.now() });
    // Sem URA, `answered_at` é a hora em que a conversa atendeu, como antes da fatia 1e.
    const answered = await withSystem(app, (q) => q.one<{ at: Date }>("select at from call_events where call_id = $1 and kind = 'call_answered'", [callId]));
    expect((await callOf(app, callId)).answered_at).toEqual(answered?.at);

    const tasks = (await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call");
    expect(tasks).toMatchObject([{ kind: "summarize_call", payload: {}, status: "queued", call_id: callId }]);
    expect(payloads[16]).toEqual({ taskId: tasks[0]?.id, kind: "summarize_call" });
    // O supervisor de regras fixas vai para a fila junto com o resumo, no fim de toda ligação.
    const reviews = (await tasksOf(app, organizationId)).filter((task) => task.kind === "review_call");
    expect(reviews).toMatchObject([{ kind: "review_call", payload: {}, status: "queued", call_id: callId }]);
    expect(payloads[17]).toEqual({ taskId: reviews[0]?.id, kind: "review_call" });

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
    const { ari, callId, channelId, asterisk } = await incomingCall("e2e-noanswer", { script, transferTo: "+5531988887777", transferReturnsToAgent: false });
    await ended(callId);
    await waitFor(() => asterisk.closed, "the AudioSocket to close");
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`continue ${channelId} deskvoice-transfer,s`), "the transfer to start");
    ari.emit({ type: "StasisStart", args: ["transfer-ended", "NOANSWER"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`hangup ${channelId}`), "the hangup");
    expect((await eventsOf(app, callId)).at(-1)).toEqual({ kind: "transfer_completed", payload: { to: "+5531988887777", status: "NOANSWER", answered: false } });
  });

  // As duas sequências abaixo são as que um Asterisk 20 real (a imagem do Compose) emitiu para o canal
  // de quem ligou, com o Dial de `deskvoice-transfer` como está no repositório, sem a opção `g`.
  // Atendida, o canal não volta à Stasis com `transfer-ended`: só morre quando a conversa acaba.
  const transferringCall = async (label: string) => {
    const script: SimulatedScript = [{ toolCall: { name: "transfer_to_human", args: { reason: "Pediu um humano.", summary: "Quer falar com a recepção." } } }];
    const scene = await incomingCall(label, { script, transferTo: "+5531988887777", transferReturnsToAgent: false });
    await ended(scene.callId);
    await waitFor(() => scene.asterisk.closed, "the AudioSocket to close");
    scene.ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: scene.channelId } });
    await waitFor(() => scene.ari.log.includes(`continue ${scene.channelId} deskvoice-transfer,s`), "the transfer to start");
    return scene;
  };
  const transferCompleted = (callId: string) =>
    waitFor(async () => (await eventsOf(app, callId)).find((event) => event.kind === "transfer_completed"), "the transfer outcome");
  const returnCallNotices = async (organizationId: string) => (await notificationsOf(app, organizationId)).filter((notification) => notification.body.includes("retorne a ligação"));

  it("transferência atendida que termina: o canal só morre, e a chamada conta como atendida, sem aviso de retorno", async () => {
    const { ari, organizationId, callId, channelId } = await transferringCall("e2e-transfer-answered");
    ari.emit({ type: "Dial", caller: { id: channelId }, dialstatus: "" });
    ari.emit({ type: "Dial", caller: { id: channelId }, dialstatus: "ANSWER" });
    ari.emit({ type: "ChannelDestroyed", channel: { id: channelId }, cause_txt: "Normal Clearing" });

    expect((await transferCompleted(callId)).payload).toEqual({ to: "+5531988887777", status: "ANSWER", answered: true });
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transferred" });
    expect(await returnCallNotices(organizationId)).toEqual([]);
  });

  it("quem ligou desiste enquanto a transferência toca: o aviso de retorno sai", async () => {
    const { ari, organizationId, callId, channelId } = await transferringCall("e2e-transfer-abandoned");
    ari.emit({ type: "Dial", caller: { id: channelId }, dialstatus: "" });
    ari.emit({ type: "Dial", caller: { id: channelId }, dialstatus: "RINGING" });
    ari.emit({ type: "Dial", caller: { id: channelId }, dialstatus: "CANCEL" });
    ari.emit({ type: "ChannelDestroyed", channel: { id: channelId }, cause_txt: "Normal Clearing" });

    expect((await transferCompleted(callId)).payload).toEqual({ to: "+5531988887777", status: "CALLER_HANGUP", answered: false });
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transferred" });
    expect(await returnCallNotices(organizationId)).toHaveLength(1);
  });

  it("com a volta ligada (o padrão): ninguém atende, o canal volta com outro AudioSocket, o agente fala de novo e a ligação termina uma vez", async () => {
    const script: SimulatedScript = [{ toolCall: { name: "transfer_to_human", args: { reason: "Pediu um humano.", summary: "Quer falar com a recepção." } } }];
    const { ari, organizationId, callId, channelId, asterisk } = await incomingCall("e2e-return", { script, transferTo: "+5531988887777" });
    await waitFor(() => asterisk.closed, "the AudioSocket to close");
    // Enquanto a linha toca, a ligação não terminou.
    expect(await kindsOf(app, callId)).not.toContain("call_ended");
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`continue ${channelId} deskvoice-transfer,s`), "the transfer to start");
    ari.emit({ type: "StasisStart", args: ["transfer-ended", "NOANSWER"], channel: { id: channelId } });

    // O canal ganha outro AUDIOSOCKET_UUID e volta para o mesmo contexto de áudio, sem desligar.
    const set = await waitFor(() => ari.log.filter((line) => line.startsWith(`set ${channelId} AUDIOSOCKET_UUID=`))[1], "the new AUDIOSOCKET_UUID");
    const audioId = set.split("=")[1] ?? "";
    expect(audioId).not.toBe(callId);
    await waitFor(() => ari.log.filter((line) => line === `continue ${channelId} deskvoice-audio,s`).length === 2, "the channel to go back to the audio context");
    expect(ari.log.some((line) => line.startsWith("hangup"))).toBe(false);

    const back = await fakeAsterisk((server as VoiceServer).audioSocketPort);
    back.sendUuid(audioId);
    // O agente fala de novo (a saudação fixa da volta), e a ferramenta de transferir não está mais lá.
    await waitFor(() => back.frames.filter((frame) => frame.type === 0x10).length > 20, "the agent to speak again");
    await waitFor(async () => (await eventsOf(app, callId)).filter((event) => event.kind === "tool_result").length === 2, "the second transfer to be refused");
    // Quem ligou desliga no trecho de volta: o canal deixa de existir, e não há outra discagem.
    back.hangup();
    ari.emit({ type: "ChannelDestroyed", channel: { id: channelId }, cause_txt: "Normal Clearing" });
    expect(ari.log.filter((line) => line.includes("deskvoice-transfer"))).toHaveLength(1);

    await ended(callId);
    const kinds = await kindsOf(app, callId);
    expect(kinds.filter((kind) => kind === "call_ended")).toHaveLength(1);
    expect(kinds.indexOf("transfer_returned")).toBe(kinds.indexOf("transfer_completed") + 1);
    expect(kinds.indexOf("transfer_returned")).toBeLessThan(kinds.indexOf("call_ended"));
    const events = await eventsOf(app, callId);
    expect(events.filter((event) => event.kind === "tool_result").map((event) => event.payload.ok)).toEqual([true, false]);
    expect((await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call")).toHaveLength(1);
    // Sem recado nem pendência no trecho de volta, o aviso para retornar sai uma vez.
    expect((await notificationsOf(app, organizationId)).filter((notice) => notice.body.includes("retorne a ligação"))).toHaveLength(1);
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
      "call_started", "call_answered", "recording_notice", "transcript_agent", "tool_called", "approval_requested", "transcript_agent",
      "approval_decided", "tool_result", "transcript_agent", "tool_called", "tool_result", "call_ended", "task_queued", "task_queued",
    ]);
    // Sem texto do operador, o aviso é o padrão, e vem na frente da saudação.
    expect([events[2]?.payload, events[3]?.payload]).toEqual([{ text: DEFAULT_RECORDING_NOTICE }, { text: `${DEFAULT_RECORDING_NOTICE} ${GREETING}` }]);
    expect(events[7]?.payload).toEqual({ approvalId: approval.id, outcome: "denied", decision: "denied" });
    expect(events[8]?.payload.message).toMatch(/NEGOU/);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "end_call" });

    // Sem transferência pedida, o canal que volta do AudioSocket é desligado.
    await waitFor(() => asterisk.closed, "the AudioSocket to close");
    ari.emit({ type: "StasisStart", args: ["after-audio"], channel: { id: channelId } });
    await waitFor(() => ari.log.includes(`hangup ${channelId}`), "the hangup");
    expect(ari.log.some((line) => line.includes("deskvoice-transfer"))).toBe(false);
  });

  it("aprovação sem resposta: vence no prazo, aplica o padrão e o agente segue", async () => {
    const script: SimulatedScript = [approvalStep(), { say: "Pode seguir com o desconto." }, { toolCall: { name: "end_call", args: { reason: "Concluído." } } }];
    // O que vale sem resposta é escolha do operador, não do modelo.
    const { timers, clock, callId } = await incomingCall("e2e-expired", { script }, { "approvals.default_on_timeout": "approved" });
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
      "call_started", "call_answered", "recording_notice", "transcript_agent", "tool_called", "approval_requested", "transcript_agent", "tool_result", "call_ended", "task_queued", "task_queued",
    ]);
    // A ferramenta em espera foi solta, com o motivo para o operador, antes do fim da chamada.
    expect(events[7]?.payload).toMatchObject({ name: "request_approval", ok: false, error: "The call ended before the tool finished" });
    expect(events[8]?.payload).toMatchObject({ status: "completed", reason: "caller_hangup" });
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    expect((await tasksOf(app, organizationId)).filter((task) => task.kind === "summarize_call")).toHaveLength(1);
    expect(await ledgerOf(app, callId)).toHaveLength(1);

    // O canal morre do lado do Asterisk; nada mais é gravado por causa disso.
    ari.emit({ type: "ChannelDestroyed", channel: { id: channelId }, cause_txt: "Normal Clearing" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await kindsOf(app, callId)).toHaveLength(11);
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
      db: app, clock: fakeClock(), engines: new Map(), tools: new Map(), ari, secretKey, audioSocketPort: 0, internalPort: 0, webPort: 0, internalToken: undefined,
      trunksFile: path.join(scratch, `${organizationId}.conf`), publicIp: null, host: "127.0.0.1", resolveName: async () => ["192.0.2.53"],
    });
    ari.emit({ type: "StasisStart", args: ["inbound"], channel: { id: "canal-x", name: `PJSIP/trunk-${trunkId}-0000000a`, dialplan: { exten: "s" } } });
    const variable = await waitFor(() => ari.log.find((line) => line.startsWith("set canal-x AUDIOSOCKET_UUID=")), "the call to be created");
    const callId = variable.split("=")[1] ?? "";
    ari.emit({ type: "ChannelDestroyed", channel: { id: "canal-x" }, cause_txt: "User busy" });
    await waitFor(async () => (await callOf(app, callId)).status === "failed", "the call to be marked failed");
    expect(await callOf(app, callId)).toMatchObject({ status: "failed", end_reason: "no_answer" });
    // O fim sem áudio não passa por `finish`: a revisão é enfileirada ali mesmo (a religação depende dela).
    expect(await eventsOf(app, callId)).toEqual([
      { kind: "call_ended", payload: { status: "failed", reason: "no_answer", cause: "User busy" } },
      { kind: "task_queued", payload: { kind: "review_call", taskId: expect.any(String) } },
    ]);
  });
});

// A prova de primeira impressão pelo caminho simulado do pipeline (fatia 5b-2): a mesma ligação pelo
// tronco, com o agente que escolheu as peças. A transcrição e a voz são as simuladas da pasta (as que o
// painel só aceita por configuração de teste); o cérebro é a OpenAI de verdade, com o `fetch` num
// servidor falso. O `engine` gravado é o simulado de roteiro: se a ligação caísse no motor direto, o
// extrato teria a linha dele, e não as três das peças.
describe("chamada de ponta a ponta pelo pipeline simulado", { timeout: 120_000 }, () => {
  const MODEL = "gpt-5-nano";
  const PRICE = { centsPerMillionInputTokens: 100, centsPerMillionOutputTokens: 400, source: "teste", checkedOn: "2026-11-24" };
  /** O roteiro de demonstração do transcritor simulado da pasta: o trecho final sai com 1 s de áudio. */
  const CALLER_SAYS = "(fala de quem ligou)";
  const REPLY = "Claro, já deixei anotado. Até logo.";

  it("a saudação, um turno pelo cérebro, o fim pela ferramenta, e uma linha por peça no extrato", async () => {
    fakeBrain = await startFakeBrain();
    fakeBrain.reply([text(REPLY), tool("call_1", "end_call", JSON.stringify({ reason: "A pessoa se despediu." })), usage(150, 20)]);
    const engines = new Map<string, VoiceEngine>([
      ["pipeline", createPipelineEngine({ fetch: fakeBrain.fetch, fixedSpeechCache: new FixedSpeechCache() })],
      ["simulated", pricedSimulatedEngine(60)],
    ]);
    const pipeline = { transcriber: "simulated", brain: "openai", model: MODEL, synthesizer: "simulated", voiceId: "simulated" };
    // A chave do cérebro e a lista de modelos com preço, como a tela grava: sem elas, a ligação é recusada.
    const scene = await incomingCall(
      "e2e-pipeline",
      { engine: "simulated", script: SCRIPT, tools: ["end_call"] },
      { "recording_notice.text": NOTICE, [brainModelsSetting("openai")]: { fetchedAt: "2026-11-24", models: [{ id: MODEL, label: MODEL, price: PRICE }] } },
      { engines, pipeline, secrets: { [brainKeySetting("openai")]: encryptSecret("chave-inventada-do-cerebro", secretKey) }, simulatedPieces: true },
    );
    const { callId } = scene;

    await waitFor(() => scene.asterisk.frames.filter((frame) => frame.type === 0x10).length > 0, "the greeting to be heard");
    scene.asterisk.sendAudio(1200);
    await ended(callId);

    const events = await eventsOf(app, callId);
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain("pipeline_turn_latency");
    expect(kinds).not.toContain("call_refused");
    expect(kinds).not.toContain("engine_failed");
    // Quem atendeu e falou foi o pipeline: a saudação, a fala transcrita, a resposta do cérebro.
    expect(events.find((event) => event.kind === "call_answered")?.payload).toMatchObject({ engine: "pipeline" });
    expect(events.filter((event) => event.kind === "transcript_agent").map((event) => event.payload)).toEqual([{ text: `${NOTICE} ${GREETING}` }, { text: REPLY }]);
    expect(events.filter((event) => event.kind === "transcript_user").map((event) => event.payload)).toEqual([expect.objectContaining({ text: CALLER_SAYS })]);
    expect(events.find((event) => event.kind === "tool_called")?.payload).toMatchObject({ name: "end_call" });
    expect(fakeBrain.requests).toHaveLength(1);
    // Um pedido só saiu: o resultado do `end_call` não reabre o cérebro (fatia 5c).
    expect(fakeBrain.fetched()).toBe(1);
    expect(JSON.stringify(fakeBrain.requests[0]?.messages.filter((message) => message.role === "user").at(-1))).toContain(CALLER_SAYS);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "end_call", engine: "pipeline" });

    // O extrato: as linhas das três peças (a voz tem uma por fala; o cérebro, uma por pedido), e nenhuma
    // do motor do roteiro.
    const ledger = await withSystem(app, (q) =>
      q.many<{ engine: string; model: string | null; input_tokens: number; output_tokens: number; cost_estimated: boolean }>(
        "select engine, model, input_tokens, output_tokens, cost_estimated from usage_ledger where call_id = $1 order by engine, input_tokens",
        [callId],
      ),
    );
    expect(new Set(ledger.map((row) => row.engine))).toEqual(new Set(["brain:openai", "synthesizer:simulated", "transcriber:simulated"]));
    expect(ledger.filter((row) => row.engine === "transcriber:simulated")).toHaveLength(1);
    // A resposta do turno, com os tokens que o cérebro contou, e só ela: depois do `end_call`, o resultado
    // não reabre o cérebro (fatia 5c), e não há o pedido cancelado pelo fim, cobrado como estimado.
    expect(ledger.filter((row) => row.engine === "brain:openai")).toEqual([{ engine: "brain:openai", model: MODEL, input_tokens: 150, output_tokens: 20, cost_estimated: false }]);
  });
});
