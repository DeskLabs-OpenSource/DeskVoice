// A peça de transcrição em streaming ligada à conversa (R12, fatia 2, docs/specs/2026-11-14-transcricao-pura.md):
// desligada, a chamada é a de sempre; ligada, o áudio vai aos dois, os trechos alimentam a guarda
// contra o silêncio, o consumo entra no custo e a falha da peça não derruba a chamada.
import { encryptSecret } from "@deskvoice/core";
import type { SimulatedScript, StreamingTranscriber, StreamingTranscription } from "@deskvoice/voice-engine";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting } from "../../../packages/tools/test/helpers";
import { createSimulatedTranscriber, type SimulatedTranscriberOptions, type SimulatedTranscription, type SimulatedTranscriptScript } from "../../../packages/voice-engine/src/transcribers/simulated";
import { startCallSession, transcriberKeySetting, type CallSession } from "./call-session";
import {
  callOf,
  createAgent,
  createCall,
  createOrganization,
  eventsOf,
  kindsOf,
  ledgerOf,
  manualEngine,
  manualTransport,
  pricedSimulatedEngine,
  secretKey,
  sessionHarness,
  type AgentOptions,
  type ManualEngine,
  type ManualTransport,
  type SessionHarness,
} from "./testing/db";
import { waitFor } from "./testing/helpers";
import { AFTER_WORDS_MS } from "./silence-guard";

const { app, owner } = openTestDbs();
let harness: SessionHarness | undefined;

afterEach(async () => {
  await harness?.approvals.close();
  harness = undefined;
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

interface Scene {
  organizationId: string;
  callId: string;
  transport: ManualTransport;
  harness: SessionHarness;
  start(transcriberId?: string): CallSession;
}

async function scene(label: string, agent: AgentOptions, options: { manual?: ManualEngine; transcribers?: StreamingTranscriber[] } = {}): Promise<Scene> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, agent);
  await harness?.approvals.close();
  const made = await sessionHarness(app, options.manual ? [options.manual.engine] : [pricedSimulatedEngine(60)]);
  harness = made;
  if (options.transcribers) made.deps.transcribers = new Map(options.transcribers.map((piece) => [piece.id, piece]));
  const callId = await createCall(app, organizationId, agentId, made.clock.now());
  const transport = manualTransport();
  const start = (transcriberId?: string): CallSession => startCallSession(made.deps, { organizationId, callId, agentId, transport, ...(transcriberId !== undefined && { transcriberId }) });
  return { organizationId, callId, transport, harness: made, start };
}

/** O transcritor simulado, com o que o teste precisa ver: as sessões abertas e, por pedaço, quanto o motor já tinha recebido. */
function watchedTranscriber(options: SimulatedTranscriberOptions & { centsPerMinute?: number; id?: string; keyless?: boolean } = {}) {
  const sessions: SimulatedTranscription[] = [];
  const base = createSimulatedTranscriber({ ...options, onSession: (session) => sessions.push(session) });
  const connects: Array<{ config: { language: string; vocabulary: readonly string[] }; apiKey: string }> = [];
  const transcriber: StreamingTranscriber = {
    ...base,
    id: options.id ?? base.id,
    keyless: options.keyless ?? base.keyless,
    pricing: options.centsPerMinute === undefined ? base.pricing : { centsPerMinute: options.centsPerMinute, checkedOn: "2030-05-10", source: "teste" },
    async connect(config, apiKey) {
      connects.push({ config, apiKey });
      return base.connect(config, apiKey);
    },
  };
  return { transcriber, sessions, connects };
}

/** Peça de transcrição nas mãos do teste: ele emite os eventos dela. */
function manualTranscriber(centsPerMinute: number) {
  const handlers = new Map<string, Array<(...args: never[]) => void>>();
  const emit = (event: string, ...args: unknown[]): void => {
    for (const handler of handlers.get(event) ?? []) (handler as (...values: unknown[]) => void)(...args);
  };
  let opened = 0;
  const transcriber: StreamingTranscriber = {
    ...createSimulatedTranscriber(),
    pricing: { centsPerMinute, checkedOn: "2030-05-10", source: "teste" },
    async connect() {
      opened++;
      return {
        on: (event, handler) => void handlers.set(event, [...(handlers.get(event) ?? []), handler as (...args: never[]) => void]),
        sendAudio: () => undefined,
        close: async () => undefined,
      };
    },
  };
  return { transcriber, emit, opened: () => opened };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const answered = async (callId: string): Promise<void> => void (await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered"));
/** A peça abre depois do motor, sem que ele espere: o teste espera ela abrir antes de mandar áudio. */
async function opened(sessions: SimulatedTranscription[]): Promise<SimulatedTranscription> {
  await waitFor(() => sessions.length === 1, "the transcriber to open");
  await tick();
  const session = sessions[0];
  if (!session) throw new Error("no transcriber session");
  return session;
}

describe("sem transcritor escolhido, a chamada é a de sempre", { timeout: 120_000 }, () => {
  // Saudação, fala de quem ligou com texto, resposta, e o fim do roteiro: o caminho inteiro de uma chamada.
  const script: SimulatedScript = [{ expectUserAudio: 200, text: "Quero marcar uma consulta." }, { say: "Claro, para quando?" }, { end: true }];

  async function run(label: string, transcribers?: StreamingTranscriber[]) {
    const made = await scene(label, { script, greeting: "Bom dia." }, { transcribers });
    const session = made.start();
    await answered(made.callId);
    made.transport.callerAudio(200);
    const outcome = await session.done;
    const events = (await eventsOf(app, made.callId)).map(({ kind, payload }) => ({ kind, payload: kind === "call_started" ? { ...payload, agentId: "<agent>" } : kind === "task_queued" ? { ...payload, taskId: "<task>" } : payload }));
    // O que muda de uma cena para outra são só os ids: a chamada, o agente, a tarefa.
    const call = { ...(await callOf(app, made.callId)), agent_id: "<agent>" };
    const logs = made.harness.logs.map(({ fields, ...entry }) => ({ ...entry, fields: { ...fields, callId: "<call>" } }));
    return { outcome, events, ledger: await ledgerOf(app, made.callId), call, sentBytes: made.transport.sentBytes, logs };
  }

  it("com peças instaladas e nenhuma pedida: mesmos eventos, mesma ordem, mesmo custo, mesmo áudio e nenhuma peça aberta", async () => {
    const before = await run("transcriber-off-none");
    const { transcriber, connects } = watchedTranscriber({ centsPerMinute: 100 });
    const after = await run("transcriber-off-installed", [transcriber]);

    expect(connects).toEqual([]);
    expect(after.outcome).toEqual(before.outcome);
    expect(after.events).toEqual(before.events);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.call).toEqual(before.call);
    expect(after.sentBytes).toBe(before.sentBytes);
    expect(after.logs).toEqual(before.logs);
    expect(before.events.map((event) => event.kind)).not.toContain("transcriber_failed");
    expect(after.logs.filter((entry) => JSON.stringify(entry).includes("transcriber"))).toEqual([]);
    expect(before.ledger.map((row) => row.engine)).toEqual(["simulated"]);
  });
});

describe("com o transcritor simulado", { timeout: 120_000 }, () => {
  it("cada pedaço de áudio de quem ligou chega aos dois, primeiro ao motor e depois à peça, com o idioma e o vocabulário do agente", async () => {
    const manual = manualEngine({ keyless: true });
    const { transcriber, sessions, connects } = watchedTranscriber({ script: [], keyless: true });
    const { callId, transport, start } = await scene("transcriber-both", { engine: "manual", vocabulary: ["Ana Ribeiro", "DeskVoice"] }, { manual, transcribers: [transcriber] });
    const session = start("simulated");
    await answered(callId);
    const stream = await opened(sessions);
    expect(connects).toEqual([{ config: { language: "pt-BR", vocabulary: ["Ana Ribeiro", "DeskVoice"] }, apiKey: "" }]);

    // A cada pedaço que a peça recebe, o motor já recebeu o mesmo pedaço: ele nunca espera a peça.
    const engineBytesAtPiece: number[] = [];
    const send = stream.sendAudio.bind(stream);
    stream.sendAudio = (pcm) => {
      engineBytesAtPiece.push(manual.audioBytes);
      send(pcm);
    };
    transport.callerAudio(100);
    expect(manual.audioBytes).toBe(5 * 320);
    expect(stream.audioBytes).toBe(5 * 320);
    expect(engineBytesAtPiece).toEqual([320, 640, 960, 1280, 1600]);

    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
    // A peça fecha junto com a chamada, e ninguém fica com o fluxo aberto.
    transport.callerAudio(20);
    expect(stream.audioBytes).toBe(5 * 320);
  });

  it("o motor não espera a peça abrir: com a peça muda, a chamada atende e o áudio vai ao motor do mesmo jeito", async () => {
    const manual = manualEngine({ keyless: true });
    const hanging: StreamingTranscriber = { ...createSimulatedTranscriber(), connect: () => new Promise<StreamingTranscription>(() => undefined) };
    const { callId, transport, start } = await scene("transcriber-hangs", { engine: "manual" }, { manual, transcribers: [hanging] });
    const session = start("simulated");
    await answered(callId);
    expect(await kindsOf(app, callId)).toEqual(["call_started", "call_answered", "recording_notice"]);
    transport.callerAudio(100);
    expect(manual.audioBytes).toBe(5 * 320);

    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
  });

  it("cada trecho parcial com texto novo é sinal de fala para a guarda contra o silêncio, mesmo com o motor calado", async () => {
    const manual = manualEngine({ keyless: true });
    const script: SimulatedTranscriptScript = [
      { afterAudioMs: 20, text: "quero" },
      { afterAudioMs: 40, text: "quero marcar" },
      // Mesmo texto: não é fala nova, e o prazo não recomeça.
      { afterAudioMs: 60, text: "quero marcar" },
    ];
    const { transcriber, sessions } = watchedTranscriber({ script });
    const { callId, transport, start, harness } = await scene("transcriber-words", { engine: "manual" }, { manual, transcribers: [transcriber] });
    const session = start("simulated");
    await answered(callId);
    await opened(sessions);

    // O motor de teste nunca emite `callerActivity`: o sinal só pode vir da peça.
    transport.callerAudio(20);
    await waitFor(() => harness.timers.held().includes(AFTER_WORDS_MS), "the guard to arm on the first piece");
    harness.clock.advance(1000);
    transport.callerAudio(20);
    await tick();
    await tick();
    harness.clock.advance(700);
    transport.callerAudio(20);
    await tick();
    await tick();
    expect(harness.timers.held().filter((delay) => delay === AFTER_WORDS_MS)).toHaveLength(1);
    harness.clock.advance(AFTER_WORDS_MS);
    expect(harness.timers.fire(AFTER_WORDS_MS)).toBe(1);
    expect(manual.callerTurnsClosed).toBe(1);

    // O prazo contou do segundo trecho (texto novo), e não do primeiro nem do terceiro (repetido).
    await waitFor(async () => (await kindsOf(app, callId)).includes("caller_unanswered"), "the guard to act");
    const acted = (await eventsOf(app, callId)).filter((event) => event.kind === "caller_unanswered");
    expect(acted.map((event) => event.payload)).toEqual([{ action: "turn_closed", waitedMs: 700 + AFTER_WORDS_MS, words: true }]);

    transport.callerHangup();
    await session.done;
  });

  it("o consumo da peça entra no custo da chamada, com linha própria no extrato, e conta para o teto", async () => {
    const manual = manualEngine({ keyless: true, centsPerMinute: 100 });
    const piece = manualTranscriber(60);
    const { callId, start, harness } = await scene("transcriber-cost", { engine: "manual", costCeilingCents: 150 }, { manual, transcribers: [piece.transcriber] });
    const session = start("simulated");
    await answered(callId);
    await waitFor(() => piece.opened() === 1, "the transcriber to open");
    await tick();

    // 60 s de motor a 100 centavos por minuto: 100 centavos, abaixo do teto.
    manual.emit("usage", { seconds: 60 });
    await waitFor(async () => (await callOf(app, callId)).cost_cents === 100, "the engine cost");
    expect(manual.said).toEqual([]);
    // 60 s na peça, a 60 centavos por minuto: somam ao motor e passam o teto.
    piece.emit("usage", { seconds: 60 });
    await waitFor(async () => (await kindsOf(app, callId)).includes("cost_ceiling_reached"), "the ceiling event");
    expect(manual.said).toEqual([expect.stringContaining("encerrar esta ligação")]);
    expect(harness.timers.fire(6000)).toBe(1);

    expect(await session.done).toEqual({ status: "completed", endReason: "cost_ceiling", costCents: 160 });
    expect((await eventsOf(app, callId)).find((event) => event.kind === "cost_ceiling_reached")?.payload).toEqual({ costCents: 160, ceilingCents: 150 });
    expect(await ledgerOf(app, callId)).toEqual([
      { engine: "transcriber:simulated", seconds: 60, input_tokens: 0, output_tokens: 0, cost_cents: 60 },
      { engine: "manual", seconds: 60, input_tokens: 0, output_tokens: 0, cost_cents: 100 },
    ]);
    expect((await callOf(app, callId)).cost_cents).toBe(160);
    // A duração da chamada é a do motor: o áudio da peça é o mesmo, e não soma tempo.
    expect((await eventsOf(app, callId)).find((event) => event.kind === "call_ended")?.payload).toMatchObject({ costCents: 160, seconds: 60 });
  });
});

describe("falha da peça de transcrição", { timeout: 120_000 }, () => {
  it("a peça recusa abrir: transcriber_failed com o código, sem o texto do provedor, e a chamada segue sem ela", async () => {
    const manual = manualEngine({ keyless: true });
    const { transcriber } = watchedTranscriber({ refuse: "rejected" });
    const { callId, transport, start, harness } = await scene("transcriber-refused", { engine: "manual" }, { manual, transcribers: [transcriber] });
    const session = start("simulated");
    await waitFor(async () => (await kindsOf(app, callId)).includes("transcriber_failed"), "the failure to be recorded");

    const failed = (await eventsOf(app, callId)).filter((event) => event.kind === "transcriber_failed");
    expect(failed.map((event) => event.payload)).toEqual([{ transcriber: "simulated", reason: "rejected" }]);
    // O texto do provedor fica só no log de quem opera.
    expect(harness.logs).toContainEqual(expect.objectContaining({ level: "error", fields: expect.objectContaining({ transcriber: "simulated", reason: "rejected", error: expect.stringContaining("refused to open") }) }));

    expect((await callOf(app, callId)).status).toBe("in_progress");
    transport.callerAudio(100);
    expect(manual.audioBytes).toBe(5 * 320);
    manual.emit("transcript", { speaker: "agent", text: "Sigo aqui." });
    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
    expect(await kindsOf(app, callId)).toEqual(["call_started", "call_answered", "recording_notice", "transcriber_failed", "transcript_agent", "call_ended", "task_queued"]);
  });

  it("a peça não responde no prazo: transcriber_failed com `unreachable`, e a chamada segue", async () => {
    const manual = manualEngine({ keyless: true });
    const hanging: StreamingTranscriber = { ...createSimulatedTranscriber(), connect: () => new Promise<StreamingTranscription>(() => undefined) };
    const { callId, transport, start, harness } = await scene("transcriber-timeout", { engine: "manual" }, { manual, transcribers: [hanging] });
    const session = start("simulated");
    await answered(callId);
    await waitFor(() => harness.timers.held().includes(15_000), "the transcriber deadline");
    expect(harness.timers.fire(15_000)).toBe(1);
    await waitFor(async () => (await kindsOf(app, callId)).includes("transcriber_failed"), "the failure to be recorded");
    expect((await eventsOf(app, callId)).find((event) => event.kind === "transcriber_failed")?.payload).toEqual({ transcriber: "simulated", reason: "unreachable" });
    expect((await callOf(app, callId)).status).toBe("in_progress");
    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
  });

  it("peça com chave e sem chave cadastrada: não abre, grava `rejected`; com a chave cifrada, a peça recebe a chave aberta", async () => {
    const manual = manualEngine({ keyless: true });
    const { transcriber, connects } = watchedTranscriber({ script: [], keyless: false, id: "keyed" });
    const first = await scene("transcriber-no-key", { engine: "manual" }, { manual, transcribers: [transcriber] });
    const without = first.start("keyed");
    await waitFor(async () => (await kindsOf(app, first.callId)).includes("transcriber_failed"), "the failure to be recorded");
    expect((await eventsOf(app, first.callId)).find((event) => event.kind === "transcriber_failed")?.payload).toEqual({ transcriber: "keyed", reason: "rejected" });
    expect(connects).toEqual([]);
    first.transport.callerHangup();
    await without.done;

    const second = await scene("transcriber-key", { engine: "manual" }, { manual: manualEngine({ keyless: true }), transcribers: [transcriber] });
    await putSetting(app, second.organizationId, transcriberKeySetting("keyed"), encryptSecret("chave-da-peca-inventada", secretKey));
    const withKey = second.start("keyed");
    await waitFor(() => connects.length === 1, "the transcriber to open");
    expect(connects[0]?.apiKey).toBe("chave-da-peca-inventada");
    second.transport.callerHangup();
    await withKey.done;
    expect(await kindsOf(app, second.callId)).not.toContain("transcriber_failed");
  });

  it("a peça cai no meio: transcriber_failed com `closed`, o áudio deixa de ir a ela, e a chamada segue com o motor", async () => {
    const manual = manualEngine({ keyless: true });
    const { transcriber, sessions } = watchedTranscriber({ script: [{ afterAudioMs: 40, fail: "o serviço caiu (código 1006)" }] });
    const { callId, transport, start } = await scene("transcriber-drops", { engine: "manual" }, { manual, transcribers: [transcriber] });
    const session = start("simulated");
    await answered(callId);
    const stream = await opened(sessions);
    let sends = 0;
    const send = stream.sendAudio.bind(stream);
    stream.sendAudio = (pcm) => {
      sends++;
      send(pcm);
    };
    transport.callerAudio(40);
    await waitFor(async () => (await kindsOf(app, callId)).includes("transcriber_failed"), "the failure to be recorded");
    const events = await eventsOf(app, callId);
    expect(events.find((event) => event.kind === "transcriber_failed")?.payload).toEqual({ transcriber: "simulated", reason: "closed" });
    expect(JSON.stringify(events)).not.toContain("1006");

    transport.callerAudio(100);
    expect(manual.audioBytes).toBe(7 * 320);
    expect(stream.audioBytes).toBe(2 * 320);
    // Depois da queda, a conversa nem tenta mais mandar áudio à peça.
    expect(sends).toBe(2);
    expect((await callOf(app, callId)).status).toBe("in_progress");
    transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
  });
});
