// O motor pipeline numa ligação (R5, fatia 3b-1, docs/specs/2026-11-17-motor-de-voz-em-pipeline.md):
// com `agents.pipeline` nula, a chamada é a de sempre; preenchida, a sessão monta as três peças pela
// pasta (aqui, injetadas), cada peça vira uma linha no extrato com o preço dela, o teto toca a
// despedida pronta sem síntese nova, e a falha de uma peça chega ao painel só com os códigos.
import { encryptSecret, withSystem, type Clock } from "@deskvoice/core";
import { synthesizerConsentSetting, type PipelineEngine, type Brain, type PipelineTurnLatency, type SimulatedScript, type SpeechSynthesizer, type StreamingTranscriber } from "@deskvoice/voice-engine";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { notificationsOf, putSetting } from "../../../packages/tools/test/helpers";
import openai from "../../../packages/voice-engine/src/brains/openai";
import { createPipelineEngine, PIPELINE_FAILURE_SPEECH, PIPELINE_TRANSFER_SPEECH } from "../../../packages/voice-engine/src/engines/pipeline";
import { FixedSpeechCache, speechUsageOf } from "../../../packages/voice-engine/src/synthesis";
import { createSimulatedSynthesizer } from "../../../packages/voice-engine/src/synthesizers/simulated";
import { createSimulatedTranscriber, type SimulatedTranscription, type SimulatedTranscriptScript } from "../../../packages/voice-engine/src/transcribers/simulated";
import { brainKeySetting, brainModelsSetting, startCallSession, synthesizerKeySetting, type CallSession } from "./call-session";
import type { TransferOptions, TransferOutcome } from "./transport";
import { callOf, createAgent, createCall, createOrganization, eventsOf, kindsOf, ledgerOf, manualTransport, pricedSimulatedEngine, secretKey, sessionHarness, type AgentOptions, type ManualTransport, type SessionHarness } from "./testing/db";
import { startFakeBrain, text, tool, usage } from "./testing/fake-brain";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
let harness: SessionHarness | undefined;
let fakeBrain: Awaited<ReturnType<typeof startFakeBrain>> | undefined;

afterEach(async () => {
  await harness?.approvals.close();
  harness = undefined;
  await fakeBrain?.stop();
  fakeBrain = undefined;
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

// ---- as peças: simuladas, com preço ----

const MODEL = "gpt-5-nano";
/** 100 centavos por milhão: um milhão de tokens de entrada é um dólar. */
const BRAIN_PRICE = { centsPerMillionInputTokens: 100, centsPerMillionOutputTokens: 400, source: "teste", checkedOn: "2026-11-24" };
const VOICE_PRICE = { centsPerThousandCharacters: 30, checkedOn: "2026-11-24", source: "teste" };
const PIPELINE = { transcriber: "simulated", brain: "openai", model: MODEL, synthesizer: "simulated", voiceId: "simulated" };

/** A voz simulada com preço e com cada `speak` contado: a despedida pronta não pode abrir fala nova. */
function pricedVoice(options: { failAfter?: number; schedule?: (task: () => void) => void } = {}) {
  const base = createSimulatedSynthesizer(options.schedule);
  let speaks = 0;
  /** Ligado por `breakNow`: daqui em diante, toda fala nova cai ao abrir. */
  let broken = false;
  /** O texto mandado a cada fala, e as falas abertas que não terminaram nem foram canceladas. */
  const texts: string[] = [];
  const live = new Set<number>();
  const synthesizer: SpeechSynthesizer = {
    ...base,
    pricing: VOICE_PRICE,
    pricingOf: () => VOICE_PRICE,
    async speak(config, apiKey, connect) {
      speaks += 1;
      if (broken || (options.failAfter !== undefined && speaks > options.failAfter)) {
        const { SynthesizerOpenError } = await import("@deskvoice/voice-engine");
        throw new SynthesizerOpenError("no_credit", "elevenlabs: quota_exceeded (texto do provedor)");
      }
      const speech = await base.speak(config, apiKey, connect);
      const n = speaks;
      live.add(n);
      speech.on("done", () => live.delete(n));
      return {
        ...speech,
        on: (event, handler) =>
          event === "usage"
            ? speech.on("usage", (spent) => (handler as (value: typeof spent) => void)(speechUsageOf(VOICE_PRICE, spent.characters)))
            : speech.on(event, handler),
        push: (value, opts) => {
          texts.push(value);
          speech.push(value, opts);
        },
        end: () => speech.end(),
        cancel: () => {
          live.delete(n);
          speech.cancel();
        },
      };
    },
  };
  return { synthesizer, speaks: () => speaks, texts, live: () => live.size, breakNow: () => void (broken = true) };
}

function pricedTranscriber(script: SimulatedTranscriptScript, options: { refuse?: "no_credit" } = {}) {
  const sessions: SimulatedTranscription[] = [];
  const base = createSimulatedTranscriber({ script, ...options, onSession: (session) => sessions.push(session) });
  const transcriber: StreamingTranscriber = { ...base, pricing: { centsPerMinute: 60, checkedOn: "2026-11-24", source: "teste" } };
  return { transcriber, sessions };
}

interface Scene {
  organizationId: string;
  agentId: string;
  callId: string;
  transport: ManualTransport;
  harness: SessionHarness;
  start(): CallSession;
}

async function scene(
  label: string,
  agent: AgentOptions,
  options: { pipeline?: unknown; transcriber?: StreamingTranscriber; synthesizer?: SpeechSynthesizer; brain?: Brain; brainKey?: boolean; price?: boolean; pieces?: boolean; transport?: ManualTransport; simulatedPieces?: boolean } = {},
): Promise<Scene> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, agent);
  if (options.pipeline !== undefined) await withSystem(app, (q) => q.exec("update agents set pipeline = $2 where id = $1", [agentId, JSON.stringify(options.pipeline)]));
  if (options.brainKey !== false) await putSetting(app, organizationId, brainKeySetting("openai"), encryptSecret("chave-inventada-do-cerebro", secretKey));
  await putSetting(app, organizationId, brainModelsSetting("openai"), { fetchedAt: "2026-11-24", models: [{ id: MODEL, label: MODEL, ...(options.price !== false && { price: BRAIN_PRICE }) }] }, false);
  await harness?.approvals.close();
  const made = await sessionHarness(app, [pricedSimulatedEngine(60)]);
  harness = made;
  if (options.pieces !== false) {
    fakeBrain ??= await startFakeBrain();
    // As peças daqui se chamam `simulated`: só abrem com a configuração de teste (fatia 5c).
    if (options.simulatedPieces !== false) made.deps.simulatedPieces = true;
    const transcriber = options.transcriber ?? pricedTranscriber([]).transcriber;
    made.deps.transcribers = new Map([[transcriber.id, transcriber]]);
    made.deps.brains = new Map([["openai", options.brain ?? openai]]);
    made.deps.synthesizers = new Map([["simulated", options.synthesizer ?? pricedVoice().synthesizer]]);
    made.deps.pipelineEngine = createPipelineEngine({ fetch: fakeBrain.fetch, fixedSpeechCache: new FixedSpeechCache() });
  }
  const callId = await createCall(app, organizationId, agentId, made.clock.now());
  const transport = options.transport ?? manualTransport();
  return { organizationId, agentId, callId, transport, harness: made, start: () => startCallSession(made.deps, { organizationId, callId, agentId, transport }) };
}

const answered = async (callId: string): Promise<void> => void (await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered"));
const piecesLedger = (callId: string) =>
  withSystem(app, (q) =>
    q.many<{ engine: string; model: string | null; cost_microcents: string; cost_estimated: boolean; cost_measured: boolean; input_tokens: number; output_tokens: number }>(
      "select engine, model, cost_microcents, cost_estimated, cost_measured, input_tokens, output_tokens from usage_ledger where call_id = $1 order by engine, input_tokens",
      [callId],
    ),
  );

describe("com agents.pipeline nula, a chamada é a de sempre", { timeout: 120_000 }, () => {
  const script: SimulatedScript = [{ expectUserAudio: 200, text: "Quero marcar uma consulta." }, { say: "Claro, para quando?" }, { end: true }];

  async function run(label: string, pieces: boolean) {
    const made = await scene(label, { script, greeting: "Bom dia." }, { pieces });
    let opens = 0;
    if (made.harness.deps.pipelineEngine) {
      const engine = made.harness.deps.pipelineEngine;
      made.harness.deps.pipelineEngine = { ...engine, connect: (...args) => (opens++, engine.connect(...args)) };
    }
    const session = made.start();
    await answered(made.callId);
    made.transport.callerAudio(200);
    const outcome = await session.done;
    const events = (await eventsOf(app, made.callId)).map(({ kind, payload }) => ({ kind, payload: kind === "call_started" ? { ...payload, agentId: "<agent>" } : kind === "task_queued" ? { ...payload, taskId: "<task>" } : payload }));
    const call = { ...(await callOf(app, made.callId)), agent_id: "<agent>" };
    const logs = made.harness.logs.map(({ fields, ...entry }) => ({ ...entry, fields: { ...fields, callId: "<call>" } }));
    return { outcome, events, ledger: (await ledgerOf(app, made.callId)).map((row) => ({ ...row, agent_id: "<agent>" })), call, sentBytes: made.transport.sentBytes, logs, opens };
  }

  it("com as peças instaladas e a coluna nula: mesmos eventos, mesmo extrato, mesma fala, mesmo log, e o pipeline nunca abre", async () => {
    const before = await run("pipeline-off-none", false);
    const after = await run("pipeline-off-installed", true);
    expect(after.opens).toBe(0);
    expect(after.outcome).toEqual(before.outcome);
    expect(after.events).toEqual(before.events);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.call).toEqual(before.call);
    expect(after.sentBytes).toBe(before.sentBytes);
    expect(after.logs).toEqual(before.logs);
    expect(before.ledger.map((row) => row.engine)).toEqual(["simulated"]);
    expect(after.events.find((event) => event.kind === "call_answered")?.payload).toEqual({ engine: "simulated" });
    // Nenhum evento novo da 3c-1: nem a latência por turno do pipeline, nem a nota da abertura.
    expect(after.events.some((event) => event.kind === "pipeline_turn_latency")).toBe(false);
  });
});

describe("com agents.pipeline preenchida", { timeout: 120_000 }, () => {
  it("o aceite: uma ferramenta no meio, uma linha por peça com o preço dela, e o teto toca a despedida pronta, sem síntese nova", async () => {
    const voice = pricedVoice();
    const ear = pricedTranscriber([
      { afterAudioMs: 100, text: "Quero deixar um recado", final: false },
      { afterAudioMs: 200, text: "Quero deixar um recado para o doutor.", final: true },
    ]);
    // O teto é de 50 centavos: a segunda resposta do cérebro (um milhão de tokens a 100 por milhão) passa dele.
    const made = await scene("pipeline-accept", { engine: "openai-realtime", greeting: "Bom dia.", tools: ["create_task"], costCeilingCents: 50 }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    fakeBrain?.reply(
      [text("Vou anotar. "), tool("call_1", "create_task", JSON.stringify({ title: "Recado para o doutor", details: "Quem ligou quer falar com o doutor." })), usage(200, 30)],
      [text("Pronto, ficou anotado."), usage(1_000_000, 10)],
    );
    const session = made.start();
    await answered(made.callId);
    // As falas fixas (a de falha e a despedida do teto; sem transferência, a que a promete não) ficaram prontas na abertura.
    const fixedSpeaks = 2;
    await waitFor(() => voice.speaks() >= fixedSpeaks + 1, "the greeting to open");
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(200);
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("cost_ceiling_reached"), "the cost ceiling");
    const speaksAtCeiling = voice.speaks();
    await waitFor(async () => (await eventsOf(app, made.callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado."), "the farewell");
    made.harness.timers.fire(6000);
    const outcome = await session.done;
    expect(outcome).toMatchObject({ status: "completed", endReason: "cost_ceiling" });
    // A despedida tocou pronta: nenhuma fala nova foi aberta depois do teto.
    expect(voice.speaks()).toBe(speaksAtCeiling);
    expect(fakeBrain?.requests).toHaveLength(2);

    const kinds = await kindsOf(app, made.callId);
    expect(kinds).toContain("tool_called");
    expect(kinds).toContain("tool_result");
    expect(kinds).not.toContain("engine_failed");
    const answeredEvent = (await eventsOf(app, made.callId)).find((event) => event.kind === "call_answered");
    // A nota da abertura (3c-1): o relógio falso não andou na abertura, e nenhuma fala veio do cache.
    expect(answeredEvent?.payload).toEqual({ engine: "pipeline", opening: { transcriberMs: 0, fixedSpeechMs: 0, keyCheckMs: null, fixedSpeech: 2, fromCache: 0, totalMs: 0 } });
    expect((await callOf(app, made.callId)).engine).toBe("pipeline");

    const ledger = await piecesLedger(made.callId);
    const engines = new Set(ledger.map((row) => row.engine));
    expect(engines).toEqual(new Set(["transcriber:simulated", "brain:openai", "synthesizer:simulated"]));
    // Cada peça com o preço dela, medido (nenhuma linha sem custo, nenhuma com zero).
    for (const engine of engines) expect(ledger.filter((row) => row.engine === engine).reduce((sum, row) => sum + Number(row.cost_microcents), 0)).toBeGreaterThan(0);
    expect(ledger.every((row) => row.cost_measured)).toBe(true);
    expect(ledger.filter((row) => row.engine === "brain:openai").map((row) => [row.model, row.input_tokens, row.output_tokens, row.cost_estimated])).toEqual([
      [MODEL, 200, 30, false],
      [MODEL, 1_000_000, 10, false],
    ]);
    expect(ledger.filter((row) => row.engine === "synthesizer:simulated").every((row) => row.cost_estimated && row.model === "simulated")).toBe(true);
    // O custo da ligação é a soma do extrato, e passou do teto.
    const total = ledger.reduce((sum, row) => sum + Number(row.cost_microcents), 0);
    expect(outcome.costCents).toBe(Math.round(total / 1_000_000));
    expect(outcome.costCents).toBeGreaterThanOrEqual(50);
  });

  it("a peça que recusa abrir: call_refused com a peça e o código, e o custo das falas fixas fica no extrato da tentativa", async () => {
    const voice = pricedVoice();
    const ear = pricedTranscriber([], { refuse: "no_credit" });
    const made = await scene("pipeline-refused", { engine: "openai-realtime" }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    const outcome = await made.start().done;
    expect(outcome).toMatchObject({ status: "refused", endReason: "engine_refused" });
    const events = await eventsOf(app, made.callId);
    expect(events.find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "engine_refused", engine: "pipeline", piece: "transcriber", pieceId: "simulated", detail: "no_credit" });
    // O texto do provedor fica no log: nem a linha do tempo nem o aviso do painel o levam.
    expect(JSON.stringify(events)).not.toContain("refused to open (no_credit)");
    expect(JSON.stringify(events)).not.toContain("simulated transcriber");
    const ledger = await piecesLedger(made.callId);
    expect(ledger.map((row) => row.engine)).toEqual(["synthesizer:simulated"]);
    expect(Number(ledger[0]?.cost_microcents)).toBeGreaterThan(0);
    expect(made.harness.logs.some((entry) => entry.message === "a pipeline piece refused to open" && entry.fields?.reason === "no_credit")).toBe(true);
  });

  it("a peça que não está instalada e a chave que falta: call_refused com a peça, sem abrir nada", async () => {
    const missing = await scene("pipeline-missing", { engine: "openai-realtime" }, { pipeline: { ...PIPELINE, synthesizer: "elevenlabs" } });
    expect(await missing.start().done).toMatchObject({ status: "refused", endReason: "engine_not_configured" });
    expect((await eventsOf(app, missing.callId)).find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "engine_not_configured", engine: "pipeline", piece: "synthesizer", pieceId: "elevenlabs" });

    const keyless = await scene("pipeline-no-key", { engine: "openai-realtime" }, { pipeline: PIPELINE, brainKey: false });
    expect(await keyless.start().done).toMatchObject({ status: "refused", endReason: "engine_not_configured" });
    expect((await eventsOf(app, keyless.callId)).find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "engine_not_configured", engine: "pipeline", piece: "brain", pieceId: "openai", detail: "rejected" });
    expect(fakeBrain?.requests).toHaveLength(0);
  });

  it("o cérebro que falha um pedido vira pipeline_turn_failed e a ligação segue; a voz que cai vira engine_failed com a peça, sem o texto do provedor", async () => {
    // A voz abre as duas falas fixas e a saudação; a próxima fala (a resposta) cai.
    const voice = pricedVoice({ failAfter: 3 });
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    const made = await scene("pipeline-fails", { engine: "openai-realtime", greeting: "Bom dia." }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    // O pedido falha (500): a conversa segue, e o "pode repetir?" vai à voz, que cai ao abrir essa fala.
    fakeBrain?.reply({ status: 500, body: "{}" });
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(100);
    const outcome = await session.done;
    expect(outcome).toMatchObject({ status: "failed", endReason: "engine_failed" });
    const events = await eventsOf(app, made.callId);
    expect(events.find((event) => event.kind === "pipeline_turn_failed")?.payload).toEqual({ piece: "brain", pieceId: "openai", detail: "provider_error" });
    expect(events.find((event) => event.kind === "engine_failed")?.payload).toEqual({ engine: "pipeline", piece: "synthesizer", pieceId: "simulated", detail: "no_credit" });
    expect(JSON.stringify(events)).not.toContain("quota_exceeded");
    // A fala de falha tocou antes do fim: quem ligou não ficou mudo.
    expect(events.some((event) => event.kind === "transcript_agent" && event.payload.text === PIPELINE_FAILURE_SPEECH)).toBe(true);
    // A recusa HTTP do cérebro é zero medido; a linha existe, e nenhuma linha sai sem medida.
    const ledger = await piecesLedger(made.callId);
    expect(ledger.filter((row) => row.engine === "brain:openai").map((row) => [Number(row.cost_microcents), row.cost_measured])[0]).toEqual([0, true]);
  });

  it("o error da transcrição sem closed vai ao painel como pipeline_turn_failed, e a ligação segue", async () => {
    const ear = pricedTranscriber([]);
    const made = await scene("pipeline-ear-warning", { engine: "openai-realtime" }, { pipeline: PIPELINE, transcriber: ear.transcriber });
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    const { TranscriberOpenError } = await import("@deskvoice/voice-engine");
    (ear.sessions[0] as unknown as { emit(event: string, value: unknown): void }).emit("error", new TranscriberOpenError("rate_limited", "deepgram: 429 (texto do provedor)"));
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("pipeline_turn_failed"), "the warning");
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "pipeline_turn_failed")?.payload).toEqual({ piece: "transcriber", pieceId: "simulated", detail: "rate_limited" });
    expect(await kindsOf(app, made.callId)).not.toContain("engine_failed");
    made.transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
  });

  it("modelo do cérebro sem preço, com ou sem teto: call_refused com a peça e pipeline_piece_unpriced, e nada abre nem é pedido", async () => {
    for (const [label, ceiling] of [["pipeline-unpriced-no-ceiling", 0], ["pipeline-unpriced-ceiling", 50]] as const) {
      const voice = pricedVoice();
      const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
      const made = await scene(label, { engine: "openai-realtime", costCeilingCents: ceiling }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer, price: false });
      expect(await made.start().done, label).toMatchObject({ status: "refused", endReason: "pipeline_piece_unpriced" });
      const events = await eventsOf(app, made.callId);
      expect(events.find((event) => event.kind === "call_refused")?.payload, label).toEqual({ reason: "pipeline_piece_unpriced", engine: "pipeline", piece: "brain", pieceId: "openai", model: MODEL });
      expect(voice.speaks(), label).toBe(0);
      expect(ear.sessions, label).toHaveLength(0);
      expect(fakeBrain?.requests, label).toHaveLength(0);
      expect(await piecesLedger(made.callId), label).toEqual([]);
    }
  });

  it("a voz sem preço para o modelo dela: call_refused com a peça synthesizer e o modelo", async () => {
    const base = pricedVoice();
    const unpriced: SpeechSynthesizer = { ...base.synthesizer, pricingOf: () => undefined };
    const made = await scene("pipeline-voice-unpriced", { engine: "openai-realtime", costCeilingCents: 50 }, { pipeline: PIPELINE, synthesizer: unpriced });
    expect(await made.start().done).toMatchObject({ status: "refused", endReason: "pipeline_piece_unpriced" });
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "call_refused")?.payload).toEqual({
      reason: "pipeline_piece_unpriced",
      engine: "pipeline",
      piece: "synthesizer",
      pieceId: "simulated",
      model: unpriced.defaultModel,
    });
    expect(base.speaks()).toBe(0);
    expect(await piecesLedger(made.callId)).toEqual([]);
  });

  it("a voz de fora com a chave e sem a confirmação da 9.1: call_refused com pipeline_piece_unconfirmed, e nada abre nem sai (5b-1)", async () => {
    const outside = (voice: ReturnType<typeof pricedVoice>): SpeechSynthesizer => ({ ...voice.synthesizer, keyless: false, processingLocation: { kind: "undeclared" } });
    const voice = pricedVoice();
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    const made = await scene("pipeline-voice-unconfirmed", { engine: "openai-realtime", costCeilingCents: 50 }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: outside(voice) });
    // A chave está lá: o que falta é só a confirmação. Fora da forma, também não vale.
    await putSetting(app, made.organizationId, synthesizerKeySetting("simulated"), encryptSecret("chave-inventada-da-voz", secretKey));
    await putSetting(app, made.organizationId, synthesizerConsentSetting("simulated"), { userId: "alguém" }, false);
    expect(await made.start().done).toMatchObject({ status: "refused", endReason: "pipeline_piece_unconfirmed" });
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "pipeline_piece_unconfirmed", engine: "pipeline", piece: "synthesizer", pieceId: "simulated" });
    expect(voice.speaks()).toBe(0);
    expect(ear.sessions).toHaveLength(0);
    expect(fakeBrain?.requests).toHaveLength(0);
    expect(await piecesLedger(made.callId)).toEqual([]);
    const notice = (await notificationsOf(app, made.organizationId)).map((entry) => entry.body).join(" ");
    expect(notice).toContain("a voz (simulated)");
    expect(notice).toContain("ninguém confirmou");
    expect(notice).toContain("Configurações → Voz");

    // Com a confirmação gravada, a mesma escolha abre.
    const confirmedVoice = pricedVoice();
    const confirmed = await scene("pipeline-voice-confirmed", { engine: "openai-realtime", costCeilingCents: 50 }, { pipeline: PIPELINE, synthesizer: outside(confirmedVoice) });
    await putSetting(app, confirmed.organizationId, synthesizerKeySetting("simulated"), encryptSecret("chave-inventada-da-voz", secretKey));
    await putSetting(app, confirmed.organizationId, synthesizerConsentSetting("simulated"), { userId: "alguém", confirmedAt: "2026-11-24T12:00:00.000Z" }, false);
    const session = confirmed.start();
    await answered(confirmed.callId);
    expect(confirmedVoice.speaks()).toBeGreaterThan(0);
    confirmed.transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
  });

  it("o motor vem da pasta (`engines/pipeline.ts`), e o pipeline gravado à mão como `engine` recusa sem abrir (5b-1)", async () => {
    // Sem o motor injetado: a sessão acha o da pasta em `deps.engines`, como os outros motores.
    const voice = pricedVoice();
    const made = await scene("pipeline-from-folder", { engine: "openai-realtime", greeting: "Bom dia." }, { pipeline: PIPELINE, synthesizer: voice.synthesizer });
    const folder = made.harness.deps.pipelineEngine;
    expect(folder).toBeDefined();
    made.harness.deps.pipelineEngine = undefined;
    if (folder) made.harness.deps.engines.set("pipeline", folder);
    const session = made.start();
    await answered(made.callId);
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "call_answered")?.payload).toMatchObject({ engine: "pipeline" });
    made.transport.callerHangup();
    expect(await session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });

    // Sem ele na pasta e sem o injetado, recusa com o motivo, e nenhuma peça abre.
    const lost = pricedVoice();
    const missing = await scene("pipeline-not-in-folder", { engine: "openai-realtime" }, { pipeline: PIPELINE, synthesizer: lost.synthesizer });
    missing.harness.deps.pipelineEngine = undefined;
    expect(await missing.start().done).toMatchObject({ status: "refused", endReason: "engine_not_configured" });
    expect(lost.speaks()).toBe(0);

    // `engine = 'pipeline'` com a coluna nula (só à mão: a API recusa): o motor não abre sem peças.
    const hand = pricedVoice();
    const manual = await scene("pipeline-as-engine", { engine: "pipeline" }, { synthesizer: hand.synthesizer });
    const engine = manual.harness.deps.pipelineEngine;
    let opens = 0;
    if (engine) {
      const counted: PipelineEngine = { ...engine, connect: (config, apiKey, options) => (opens++, engine.connect(config, apiKey, options)) };
      manual.harness.deps.engines.set("pipeline", counted);
    }
    expect(await manual.start().done).toMatchObject({ status: "refused", endReason: "engine_not_configured" });
    expect((await eventsOf(app, manual.callId)).find((event) => event.kind === "call_refused")?.payload).toEqual({
      reason: "engine_not_configured",
      engine: "pipeline",
      detail: "the pipeline engine opens only from the pieces chosen in agents.pipeline",
    });
    expect(opens).toBe(0);
    expect(hand.speaks()).toBe(0);
  });

  it("o pior caso do pedido ao cérebro passa do que sobra do teto: o pedido não sai, e a despedida toca pronta, sem síntese nova", async () => {
    const voice = pricedVoice();
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    // As duas falas fixas (206 caracteres; sem transferência, a despedida que a promete não é sintetizada) e o
    // aviso de gravação (80) custam 8,58 centavos, a 30 por mil caracteres. Com teto de 10 (o total arredondado de
    // 8,58 é 9, abaixo dele), sobra 1,42; o pior caso do pedido passa disso só pela saída:
    // 4 096 tokens a 400 por milhão são 1,64 centavo.
    const made = await scene("pipeline-worst-case", { engine: "openai-realtime", costCeilingCents: 10 }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    fakeBrain?.reply([text("Isto não pode sair."), usage(10, 2)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    // As duas falas fixas e o aviso de gravação, já no extrato, sem bater no teto.
    await waitFor(async () => (await piecesLedger(made.callId)).filter((row) => row.engine === "synthesizer:simulated").length === 2, "the opening speech lines");
    const speaksAtOpening = voice.speaks();
    expect(speaksAtOpening).toBe(3);
    expect(await kindsOf(app, made.callId)).not.toContain("cost_ceiling_reached");
    made.transport.callerAudio(100);
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("cost_ceiling_reached"), "the cost ceiling");
    await waitFor(async () => (await eventsOf(app, made.callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado."), "the farewell");
    made.harness.timers.fire(6000);
    const outcome = await session.done;
    expect(outcome).toMatchObject({ status: "completed", endReason: "cost_ceiling" });
    expect(fakeBrain?.requests).toHaveLength(0);
    expect(voice.speaks()).toBe(speaksAtOpening);
    const reached = (await eventsOf(app, made.callId)).find((event) => event.kind === "cost_ceiling_reached")?.payload;
    expect(reached).toMatchObject({ ceilingCents: 10, brainWorstCase: true });
    expect(Number((reached as { brainWorstCaseMicrocents?: number }).brainWorstCaseMicrocents)).toBeGreaterThan(4096 * 400);
    const ledger = await piecesLedger(made.callId);
    expect(ledger.some((row) => row.engine === "brain:openai")).toBe(false);
    // O gasto ficou abaixo do teto: a despedida veio antes, e não depois.
    expect(outcome.costCents).toBeLessThan(10);
  });
});

// ---- 3c-1: a latência por turno, a nota da abertura e as ressalvas da 3b ----

/**
 * As três peças com atrasos conhecidos no relógio falso da sessão: o trecho final chega `endpointMs`
 * depois do `endMs` dele, o cérebro dá o primeiro texto `brainMs` depois do pedido, e a voz entrega o
 * primeiro áudio da resposta `voiceMs` depois do primeiro texto. Nada usa o relógio de parede.
 */
function timedPieces(clock: Clock & { advance(ms: number): void }, script: SimulatedTranscriptScript, delays: { endpointMs: number; brainMs: number; voiceMs: number; toolMs?: number }) {
  const ear = pricedTranscriber(script);
  let origin: number | undefined;
  let armed = false;
  const transcriber: StreamingTranscriber = {
    ...ear.transcriber,
    async connect(...args) {
      const session = await ear.transcriber.connect(...args);
      return {
        on: (event, handler) =>
          event === "piece"
            ? session.on("piece", (piece) => {
                // O trecho final chega `endpointMs` depois do fim da fala, no relógio do pipeline.
                if (piece.final && piece.endMs !== undefined && origin !== undefined) {
                  clock.advance(origin + piece.endMs + delays.endpointMs - clock.now().getTime());
                  armed = true;
                }
                (handler as (value: typeof piece) => void)(piece);
              })
            : session.on(event, handler),
        sendAudio: (pcm) => {
          origin ??= clock.now().getTime();
          session.sendAudio(pcm);
        },
        close: () => session.close(),
      };
    },
  };
  const brain: Brain = {
    ...openai,
    chat(apiKey, request, options) {
      const chat = openai.chat?.(apiKey, request, options);
      if (!chat) throw new Error("sem chat");
      let first = true;
      return {
        on: (event, handler) =>
          event === "text"
            ? chat.on("text", (delta) => {
                if (first) clock.advance(delays.brainMs);
                first = false;
                (handler as (value: string) => void)(delta);
              })
            : event === "toolCall"
              ? chat.on("toolCall", (call) => {
                  // O relógio anda entre os dois pedidos: a ferramenta leva `toolMs`.
                  clock.advance(delays.toolMs ?? 0);
                  (handler as (value: typeof call) => void)(call);
                })
              : chat.on(event, handler),
        cancel: () => chat.cancel(),
      };
    },
  };
  const voice = pricedVoice();
  const synthesizer: SpeechSynthesizer = {
    ...voice.synthesizer,
    async speak(config, apiKey, connect) {
      const delayed = armed;
      armed = false;
      const speech = await voice.synthesizer.speak(config, apiKey, connect);
      let first = delayed;
      return {
        ...speech,
        on: (event, handler) =>
          event === "audio"
            ? speech.on("audio", (pcm) => {
                if (first) clock.advance(delays.voiceMs);
                first = false;
                (handler as (value: Buffer) => void)(pcm);
              })
            : speech.on(event, handler),
        push: (value, opts) => speech.push(value, opts),
        end: () => speech.end(),
        cancel: () => speech.cancel(),
      };
    },
  };
  return { transcriber, brain, synthesizer, ear };
}

const latenciesOf = async (callId: string) => (await eventsOf(app, callId)).filter((event) => event.kind === "pipeline_turn_latency").map((event) => event.payload);

/** A transferência que fica pendente até o teste dizer que voltou, como o Asterisk faria. */
function returningTransport() {
  const base = manualTransport();
  let pending: ((outcome: TransferOutcome) => void) | undefined;
  const transfers: string[] = [];
  const transport = Object.assign(base, {
    canReturnFromTransfer: true,
    async transfer(to: string, options?: TransferOptions): Promise<TransferOutcome | void> {
      transport.transferredTo = to;
      transfers.push(to);
      if (!options?.returnIfUnanswered) return;
      return new Promise<TransferOutcome>((resolve) => (pending = resolve));
    },
    endTransfer(outcome: TransferOutcome) {
      pending?.(outcome);
      pending = undefined;
    },
  });
  return { transport, transfers };
}

describe("o pipeline numa ligação (fatia 3c-1): a latência por turno e a nota da abertura", { timeout: 120_000 }, () => {
  it("de ponta a ponta, com o relógio falso: 300 ms até o trecho final, 500 do cérebro e 200 da voz viram os números exatos do evento", async () => {
    const holder: { clock?: Clock & { advance(ms: number): void } } = {};
    const clockProxy = { now: () => holder.clock?.now() ?? new Date(0), advance: (ms: number) => holder.clock?.advance(ms) };
    const timed = timedPieces(clockProxy, [{ afterAudioMs: 200, text: "Quero marcar uma consulta.", final: true }], { endpointMs: 300, brainMs: 500, voiceMs: 200 });
    const made = await scene("pipeline-latency", { engine: "openai-realtime", greeting: "Bom dia." }, { pipeline: PIPELINE, transcriber: timed.transcriber, brain: timed.brain, synthesizer: timed.synthesizer });
    holder.clock = made.harness.clock;
    fakeBrain?.reply([text("Claro, para quando?"), usage(20, 5)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => timed.ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(200);
    await waitFor(async () => (await latenciesOf(made.callId)).length === 1, "the turn latency");
    await waitFor(async () => (await eventsOf(app, made.callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === "Claro, para quando?"), "the answer");
    made.transport.callerHangup();
    await session.done;
    // Um evento só, com os números exatos, e só números: nada do provedor.
    expect(await latenciesOf(made.callId)).toEqual([{ endpointMs: 300, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 1000, endFromArrival: false, tool: false }]);
  });

  it("o turno com ferramenta: um evento, com o tempo até o primeiro áudio da resposta, e `tool: true`; o `brainFirstTextMs` é o do pedido reaberto", async () => {
    const holder: { clock?: Clock & { advance(ms: number): void } } = {};
    const clockProxy = { now: () => holder.clock?.now() ?? new Date(0), advance: (ms: number) => holder.clock?.advance(ms) };
    // O relógio anda 700 ms entre os dois pedidos (ressalva da DESA-428): o `brainFirstTextMs` do pedido
    // reaberto é 500, e não 1 200 (o que sairia contando do primeiro pedido).
    const timed = timedPieces(clockProxy, [{ afterAudioMs: 200, text: "Quero deixar um recado para o doutor.", final: true }], { endpointMs: 300, brainMs: 500, voiceMs: 200, toolMs: 700 });
    const made = await scene("pipeline-latency-tool", { engine: "openai-realtime", tools: ["create_task"] }, { pipeline: PIPELINE, transcriber: timed.transcriber, brain: timed.brain, synthesizer: timed.synthesizer });
    holder.clock = made.harness.clock;
    fakeBrain?.reply([tool("call_1", "create_task", JSON.stringify({ title: "Recado para o doutor", details: "Quem ligou quer falar com o doutor." })), usage(200, 30)], [text("Pronto, ficou anotado."), usage(300, 10)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => timed.ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(200);
    await waitFor(async () => (await latenciesOf(made.callId)).length === 1, "the turn latency");
    made.transport.callerHangup();
    await session.done;
    expect(await kindsOf(app, made.callId)).toContain("tool_result");
    expect(await latenciesOf(made.callId)).toEqual([{ endpointMs: 300, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 1700, endFromArrival: false, tool: true }]);
  });

  it("o turno que não toca a resposta (o cérebro falhou: o pedido de repetir não é resposta) não grava latência", async () => {
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    const made = await scene("pipeline-latency-none", { engine: "openai-realtime" }, { pipeline: PIPELINE, transcriber: ear.transcriber });
    fakeBrain?.reply({ status: 500, body: "{}" });
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(100);
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("pipeline_turn_failed"), "the failed turn");
    await waitFor(async () => (await eventsOf(app, made.callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === "Desculpe, não consegui responder agora. Pode repetir, por favor?"), "the retry speech");
    made.transport.callerHangup();
    await session.done;
    expect(await latenciesOf(made.callId)).toEqual([]);
  });

  it("a nota da abertura, com e sem cache: a segunda ligação da organização tira as falas do cache e confere a chave da voz", async () => {
    const made = await scene("pipeline-opening", { engine: "openai-realtime" }, { pipeline: PIPELINE });
    const first = made.start();
    await answered(made.callId);
    made.transport.callerHangup();
    await first.done;
    // A segunda ligação: a mesma organização, o mesmo agente e o mesmo motor (o mesmo cache).
    const secondCall = await createCall(app, made.organizationId, made.agentId, made.harness.clock.now());
    const transport = manualTransport();
    const second = startCallSession(made.harness.deps, { organizationId: made.organizationId, callId: secondCall, agentId: made.agentId, transport });
    await answered(secondCall);
    transport.callerHangup();
    await second.done;
    const openingOf = async (callId: string) => (await eventsOf(app, callId)).find((event) => event.kind === "call_answered")?.payload;
    expect(await openingOf(made.callId)).toEqual({ engine: "pipeline", opening: { transcriberMs: 0, fixedSpeechMs: 0, keyCheckMs: null, fixedSpeech: 2, fromCache: 0, totalMs: 0 } });
    // Com cache, a conferência da chave rodou (o relógio falso não andou: zero medido, e não ausente).
    expect(await openingOf(secondCall)).toEqual({ engine: "pipeline", opening: { transcriberMs: 0, fixedSpeechMs: 0, keyCheckMs: 0, fixedSpeech: 2, fromCache: 2, totalMs: 0 } });
  });
});

describe("as ressalvas da 3b (L1 da DESA-421 e as duas da DESA-426)", { timeout: 120_000 }, () => {
  it("L1: o cérebro que falha duas vezes seguidas grava um pipeline_turn_failed só (o da primeira), e um engine_failed", async () => {
    const ear = pricedTranscriber([
      { afterAudioMs: 100, text: "Oi.", final: true },
      { afterAudioMs: 200, text: "Oi?", final: true },
    ]);
    const made = await scene("pipeline-l1", { engine: "openai-realtime" }, { pipeline: PIPELINE, transcriber: ear.transcriber });
    fakeBrain?.reply({ status: 500, body: "{}" }, { status: 503, body: "{}" });
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(100);
    await waitFor(async () => (await kindsOf(app, made.callId)).includes("pipeline_turn_failed"), "the first failure");
    made.transport.callerAudio(100);
    expect(await session.done).toMatchObject({ status: "failed", endReason: "engine_failed" });
    const kinds = await kindsOf(app, made.callId);
    expect(kinds.filter((kind) => kind === "pipeline_turn_failed")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "engine_failed")).toHaveLength(1);
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "engine_failed")?.payload).toEqual({ engine: "pipeline", piece: "brain", pieceId: "openai", detail: "provider_error" });
  });

  it("L1: a transcrição que avisa e depois cai grava um pipeline_turn_failed só (o do aviso), e um engine_failed", async () => {
    const ear = pricedTranscriber([]);
    const made = await scene("pipeline-l1-ear", { engine: "openai-realtime" }, { pipeline: PIPELINE, transcriber: ear.transcriber });
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    const { TranscriberOpenError } = await import("@deskvoice/voice-engine");
    const emit = (event: string, value: unknown) => (ear.sessions[0] as unknown as { emit(event: string, value: unknown): void }).emit(event, value);
    emit("error", new TranscriberOpenError("rate_limited", "deepgram: 429 (texto do provedor)"));
    emit("closed", "remote");
    expect(await session.done).toMatchObject({ status: "failed", endReason: "engine_failed" });
    const kinds = await kindsOf(app, made.callId);
    expect(kinds.filter((kind) => kind === "pipeline_turn_failed")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "engine_failed")).toHaveLength(1);
  });

  it("426, ressalva 1: o texto inteiro do aviso do painel na recusa da peça sem preço, sem o texto de diagnóstico", async () => {
    const made = await scene("pipeline-unpriced-notice", { name: "Recepção", engine: "openai-realtime" }, { pipeline: PIPELINE, price: false });
    expect(await made.start().done).toMatchObject({ status: "refused", endReason: "pipeline_piece_unpriced" });
    const bodies = (await notificationsOf(app, made.organizationId)).map((notice) => notice.body);
    expect(bodies).toEqual([
      `Uma ligação do agente Recepção foi recusada porque o preço de ${MODEL}, em o cérebro (openai), não é conhecido. Sem preço, o custo da ligação não pode ser medido, e a ligação não começou. Quem ligou ouviu o sinal de falha. Escolha um modelo com preço e faça uma chamada de teste.`,
    ]);
    // O `problem` (o texto de diagnóstico, em inglês) fica no log, e nunca no aviso.
    expect(bodies.join(" ")).not.toContain("has no known price");
  });

  it("426, ressalva 2: o trecho de volta da transferência com a peça sem preço grava engine_failed com o motivo e o modelo, pela sessão", async () => {
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Quero falar com o financeiro.", final: true }]);
    const { transport, transfers } = returningTransport();
    const made = await scene(
      "pipeline-return-unpriced",
      { engine: "openai-realtime", transferTo: "+5531988887777", tools: ["transfer_to_human"], transferReturnsToAgent: true },
      { pipeline: PIPELINE, transcriber: ear.transcriber, transport },
    );
    fakeBrain?.reply([tool("t1", "transfer_to_human", JSON.stringify({ reason: "financeiro", summary: "Segunda via." })), usage(20, 5)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(100);
    await waitFor(() => transfers.length === 1, "the transfer to be dialed");
    // Enquanto a linha chama, o preço do modelo sai da lista: o trecho de volta não pode abrir.
    await withSystem(app, (q) =>
      q.exec("update settings set value = $3 where organization_id = $1 and key = $2", [made.organizationId, brainModelsSetting("openai"), JSON.stringify({ fetchedAt: "2026-11-24", models: [{ id: MODEL, label: MODEL }] })]),
    );
    transport.endTransfer({ returned: true, status: "NOANSWER" });
    expect(await session.done).toMatchObject({ status: "failed", endReason: "engine_failed" });
    const failed = (await eventsOf(app, made.callId)).filter((event) => event.kind === "engine_failed").map((event) => event.payload);
    expect(failed).toEqual([{ engine: "pipeline", piece: "brain", pieceId: "openai", reason: "pipeline_piece_unpriced", model: MODEL }]);
  });
});

const CEILING_FAREWELL = "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado.";
const CEILING_TRANSFER_FAREWELL = "Vou passar você para uma pessoa da equipe continuar o atendimento. Um instante, por favor.";

// ---- 3c-2: a fala de transferência pronta, a corrida do fim de chamada na volta e as ressalvas da DESA-428 ----

/** Deixa correr o que ficou agendado (aberturas atrasadas, consumos no fechamento), sem relógio. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
}

describe("a fala de transferência pronta (fatia 3c-2)", { timeout: 120_000 }, () => {
  it("a voz que cai num agente com transfer_to_e164: quem ligou ouve a fala de transferência pronta, e não a de falha, e é transferido; o custo dela vai ao extrato, e a segunda ligação a tira do cache", async () => {
    const TO = "+5531988887777";
    // Com transferência, as falas prontas são a de transferência e as duas despedidas; depois, a saudação. A próxima fala cai.
    const voice = pricedVoice({ failAfter: 4 });
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    const made = await scene("pipeline-transfer-speech", { name: "Recepção", engine: "openai-realtime", greeting: "Bom dia.", transferTo: TO }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    fakeBrain?.reply([text("Pois não."), usage(20, 5)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    // A fala de transferência foi sintetizada na abertura, antes de qualquer falha.
    expect(voice.texts.slice(0, 3)).toEqual([PIPELINE_TRANSFER_SPEECH, "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado.", "Vou passar você para uma pessoa da equipe continuar o atendimento. Um instante, por favor."]);
    made.transport.callerAudio(100);
    const outcome = await session.done;
    expect(outcome).toMatchObject({ status: "transferred", endReason: "engine_failed" });
    expect(made.transport.transferredTo).toBe(TO);
    // A queda não pediu a fala à voz: ela já estava pronta.
    expect(voice.texts.filter((said) => said === PIPELINE_TRANSFER_SPEECH)).toHaveLength(1);
    expect(voice.texts).not.toContain(PIPELINE_FAILURE_SPEECH);
    const events = await eventsOf(app, made.callId);
    const agentSaid = events.filter((event) => event.kind === "transcript_agent").map((event) => event.payload.text);
    expect(agentSaid).toContain(PIPELINE_TRANSFER_SPEECH);
    expect(agentSaid).not.toContain(PIPELINE_FAILURE_SPEECH);
    expect(events.find((event) => event.kind === "engine_failed")?.payload).toEqual({ engine: "pipeline", piece: "synthesizer", pieceId: "simulated", detail: "no_credit" });
    expect(events.find((event) => event.kind === "transfer_started")?.payload).toEqual({ to: TO, reason: "engine_failed" });
    const notice = (await notificationsOf(app, made.organizationId)).map((entry) => entry.body).join(" ");
    expect(notice).toContain("Quem ligou ouviu o aviso de que seria transferido.");
    expect(notice).toContain(`A ligação foi transferida para ${TO}.`);
    // O custo das falas prontas, a de transferência inclusive, entra no extrato da ligação, pelo preço da voz.
    const fixedCharacters = [PIPELINE_TRANSFER_SPEECH, "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado.", "Vou passar você para uma pessoa da equipe continuar o atendimento. Um instante, por favor."].reduce((sum, said) => sum + [...said].length, 0);
    const voiceLines = (await piecesLedger(made.callId)).filter((row) => row.engine === "synthesizer:simulated");
    expect(voiceLines.map((row) => Number(row.cost_microcents))).toContain(Math.round((fixedCharacters * VOICE_PRICE.centsPerThousandCharacters * 1_000_000) / 1000));

    // A segunda ligação da mesma organização: as três falas prontas vêm do cache, sem síntese nova.
    const speaksBefore = voice.speaks();
    const secondCall = await createCall(app, made.organizationId, made.agentId, made.harness.clock.now());
    const transport = manualTransport();
    const second = startCallSession(made.harness.deps, { organizationId: made.organizationId, callId: secondCall, agentId: made.agentId, transport });
    await answered(secondCall);
    expect((await eventsOf(app, secondCall)).find((event) => event.kind === "call_answered")?.payload).toMatchObject({ opening: { fixedSpeech: 3, fromCache: 3 } });
    transport.callerHangup();
    await second.done;
    expect(voice.texts.slice(speaksBefore).filter((said) => said === PIPELINE_TRANSFER_SPEECH)).toHaveLength(0);
  });

  it("sem transfer_to_e164: nem a fala de transferência nem a despedida que promete transferência são sintetizadas, e as falas prontas não crescem", async () => {
    const voice = pricedVoice();
    const made = await scene("pipeline-no-transfer-speech", { engine: "openai-realtime" }, { pipeline: PIPELINE, synthesizer: voice.synthesizer });
    const session = made.start();
    await answered(made.callId);
    made.transport.callerHangup();
    await session.done;
    // A fala de falha e a despedida do teto que não promete transferência, e depois só a saudação (ponta 3 da 3c-2).
    expect(voice.texts.slice(0, 2)).toEqual([PIPELINE_FAILURE_SPEECH, "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado."]);
    expect(voice.texts).not.toContain(PIPELINE_TRANSFER_SPEECH);
    expect(voice.texts).not.toContain(CEILING_TRANSFER_FAREWELL);
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "call_answered")?.payload).toMatchObject({ opening: { fixedSpeech: 2 } });
    const fixedCharacters = voice.texts.slice(0, 2).reduce((sum, said) => sum + [...said].length, 0);
    const voiceLines = (await piecesLedger(made.callId)).filter((row) => row.engine === "synthesizer:simulated");
    expect(voiceLines.map((row) => Number(row.cost_microcents))).toContain(Math.round((fixedCharacters * VOICE_PRICE.centsPerThousandCharacters * 1_000_000) / 1000));
  });
});

describe("as guardas da fala de transferência (pontas da 3c-2, DESA-431)", { timeout: 120_000 }, () => {
  it("a voz que cai no trecho de volta de um agente com transfer_to_e164: quem ligou ouve a fala de falha, e não a de transferência, e a ligação não transfere de novo", async () => {
    const run = await returnScene("pipeline-return-voice-fails");
    run.transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(async () => (await eventsOf(app, run.made.callId)).some((event) => event.kind === "transcript_agent" && String(event.payload.text).startsWith("Ninguém da equipe")), "the return greeting");
    await waitFor(() => run.opened.count === 2, "the return transcriber");
    // O trecho de volta não transfere: a abertura dele preparou a fala de falha, e não a de transferência nem a despedida que a promete.
    const speaksAfterReturn = run.voice.texts.length;
    expect(run.voice.texts.filter((said) => said === PIPELINE_TRANSFER_SPEECH)).toHaveLength(1);
    expect(run.voice.texts.filter((said) => said === PIPELINE_FAILURE_SPEECH)).toHaveLength(1);
    run.voice.breakNow();
    fakeBrain?.reply([text("Posso anotar um recado."), usage(20, 5)]);
    run.transport.callerAudio(100);
    expect(await run.session.done).toMatchObject({ status: "failed", endReason: "engine_failed" });
    const events = await eventsOf(app, run.made.callId);
    const said = events.filter((event) => event.kind === "transcript_agent").map((event) => event.payload.text);
    expect(said.at(-1)).toBe(PIPELINE_FAILURE_SPEECH);
    expect(said.filter((text) => text === PIPELINE_TRANSFER_SPEECH)).toHaveLength(0);
    expect(events.filter((event) => event.kind === "transfer_started")).toHaveLength(1);
    expect(run.voice.texts.length).toBe(speaksAfterReturn);
    const notice = (await notificationsOf(app, run.made.organizationId)).map((entry) => entry.body).join(" ");
    expect(notice).toContain("Quem ligou ouviu o aviso de falha.");
  });

  it("a voz que cai num canal que não transfere, com transfer_to_e164: quem ligou ouve a fala de falha, e não 'vou transferir'", async () => {
    const voice = pricedVoice();
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    const transport = Object.assign(manualTransport(), { canTransfer: false });
    const made = await scene("pipeline-no-transfer-channel", { engine: "openai-realtime", transferTo: "+5531988887777" }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer, transport });
    fakeBrain?.reply([text("Pois não."), usage(20, 5)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    // O canal não transfere: as falas prontas são as de quem não transfere.
    expect(voice.texts.slice(0, 2)).toEqual([PIPELINE_FAILURE_SPEECH, CEILING_FAREWELL]);
    expect(voice.texts).not.toContain(PIPELINE_TRANSFER_SPEECH);
    expect(voice.texts).not.toContain(CEILING_TRANSFER_FAREWELL);
    voice.breakNow();
    made.transport.callerAudio(100);
    expect(await session.done).toMatchObject({ status: "failed", endReason: "engine_failed" });
    expect(made.transport.transferredTo).toBeNull();
    const said = (await eventsOf(app, made.callId)).filter((event) => event.kind === "transcript_agent").map((event) => event.payload.text);
    expect(said.at(-1)).toBe(PIPELINE_FAILURE_SPEECH);
    expect(said).not.toContain(PIPELINE_TRANSFER_SPEECH);
    const notice = (await notificationsOf(app, made.organizationId)).map((entry) => entry.body).join(" ");
    expect(notice).toContain("Quem ligou ouviu o aviso de falha.");
    expect(notice).toContain("este canal não tem como transferir");
  });
});

/**
 * A ligação de pipeline com transferência que volta, com cada peça contada: a transcrição (abertas e
 * fechadas, e a abertura do trecho de volta presa quando o teste pede), a voz (as falas vivas) e o
 * motor (as aberturas). O cérebro pede a transferência no primeiro turno.
 */
async function returnScene(label: string, options: { holdReturnOpening?: boolean; hangUpWhenReturnOpens?: boolean } = {}) {
  const { transport, transfers } = returningTransport();
  const voice = pricedVoice();
  const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Quero falar com o financeiro.", final: true }]);
  const opened = { count: 0, closed: 0 };
  let releaseOpening: () => void = () => undefined;
  const openingHeld = new Promise<void>((resolve) => (releaseOpening = resolve));
  const transcriber: StreamingTranscriber = {
    ...ear.transcriber,
    async connect(...args) {
      const n = ++opened.count;
      const session = await ear.transcriber.connect(...args);
      session.on("closed", () => void (opened.closed += 1));
      // A abertura da transcrição do trecho de volta fica presa até o teste soltar.
      if (n === 2 && options.holdReturnOpening) await openingHeld;
      return session;
    },
  };
  const made = await scene(
    label,
    { engine: "openai-realtime", transferTo: "+5531988887777", tools: ["transfer_to_human"], transferReturnsToAgent: true },
    { pipeline: PIPELINE, transcriber, synthesizer: voice.synthesizer, transport },
  );
  const engine = made.harness.deps.pipelineEngine;
  if (!engine) throw new Error("sem motor pipeline");
  const connects: Array<Promise<unknown>> = [];
  /** O handler de `pipelineTurnLatency` que a ligação pôs em cada sessão, na ordem das aberturas. */
  const latencyHandlers: Array<((turn: PipelineTurnLatency) => void) | undefined> = [];
  made.harness.deps.pipelineEngine = {
    ...engine,
    connect: (...args) => {
      const index = connects.length;
      latencyHandlers.push(undefined);
      const connecting = engine.connect(...args).then(
        (opened) =>
          new Proxy(opened, {
            get(target, key) {
              if (key === "on")
                return (event: string, handler: unknown) => {
                  if (event === "pipelineTurnLatency") latencyHandlers[index] = handler as (turn: PipelineTurnLatency) => void;
                  (target.on as (event: string, handler: unknown) => void)(event, handler);
                };
              const value: unknown = Reflect.get(target, key, target);
              return typeof value === "function" ? (value as (...values: unknown[]) => unknown).bind(target) : value;
            },
          }),
      );
      connects.push(connecting);
      // Quem ligou desliga na volta do laço em que a abertura do trecho de volta termina: depois de quem
      // abriu ver a sessão aberta, e antes de ele continuar (a reação fica atrás da de quem abriu).
      if (index === 1 && options.hangUpWhenReturnOpens) queueMicrotask(() => void connecting.then(() => transport.callerHangup()));
      return connecting;
    },
  };
  fakeBrain?.reply([tool("t1", "transfer_to_human", JSON.stringify({ reason: "financeiro", summary: "Segunda via." })), usage(20, 5)]);
  const session = made.start();
  await answered(made.callId);
  await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
  made.transport.callerAudio(100);
  await waitFor(() => transfers.length === 1, "the transfer to be dialed");
  return { made, session, transport, voice, opened, connects, releaseOpening, latencyHandlers };
}

/**
 * O custo da voz no extrato é o dos caracteres mandados a ela, nem mais nem menos: nenhuma linha além
 * do que foi realmente sintetizado, e nenhum caractere sintetizado sem linha (ponta 2 da 3c-2).
 */
async function expectVoiceLedgerMatchesSynthesis(callId: string, voice: ReturnType<typeof pricedVoice>): Promise<void> {
  const synthesized = voice.texts.reduce((sum, said) => sum + [...said].length, 0);
  const charged = (await piecesLedger(callId)).filter((row) => row.engine === "synthesizer:simulated").reduce((sum, row) => sum + Number(row.cost_microcents), 0);
  expect(charged).toBe(Math.round((synthesized * VOICE_PRICE.centsPerThousandCharacters * 1_000_000) / 1000));
}

/**
 * Depois do fim: nada vivo, e nenhum evento depois do `call_ended` (só as tarefas que o próprio fim
 * enfileira). O extrato pode ganhar linha depois do fim só pelo custo que já saiu do provedor (a fala
 * sintetizada pela abertura que terminou tarde), e nunca além do que foi realmente sintetizado.
 */
async function expectNothingAfterEnd(scene: Awaited<ReturnType<typeof returnScene>>) {
  const { made, voice, opened } = scene;
  const eventsAtEnd = await eventsOf(app, made.callId);
  const ledgerAtEnd = await piecesLedger(made.callId);
  const speaksAtEnd = voice.speaks();
  const requestsAtEnd = fakeBrain?.requests.length;
  scene.releaseOpening();
  await settle();
  // Nenhuma peça viva: toda transcrição que abriu fechou, e nenhuma fala ficou aberta.
  expect(opened.closed).toBe(opened.count);
  expect(voice.live()).toBe(0);
  // Nenhuma síntese nova e nenhum pedido ao cérebro depois do fim.
  expect(voice.speaks()).toBe(speaksAtEnd);
  expect(fakeBrain?.requests.length).toBe(requestsAtEnd);
  // Nenhum evento gravado depois do fim.
  const events = await eventsOf(app, made.callId);
  expect(events).toEqual(eventsAtEnd);
  const kinds = events.map((event) => event.kind);
  expect(kinds.filter((kind) => kind === "call_ended")).toHaveLength(1);
  expect(kinds.slice(kinds.indexOf("call_ended") + 1).every((kind) => kind === "task_queued")).toBe(true);
  // O extrato: o que havia no fim continua, e o que entrou depois é só da voz, pelo que ela sintetizou.
  const ledger = await piecesLedger(made.callId);
  for (const row of ledgerAtEnd) expect(ledger).toContainEqual(row);
  const late = [...ledger];
  for (const row of ledgerAtEnd) late.splice(late.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(row)), 1);
  expect(late.every((row) => row.engine === "synthesizer:simulated")).toBe(true);
  await expectVoiceLedgerMatchesSynthesis(made.callId, voice);
  // O custo da ligação é o do extrato inteiro, com o que chegou depois do fim.
  const total = ledger.reduce((sum, row) => sum + Number(row.cost_microcents), 0);
  expect((await callOf(app, made.callId)).cost_cents).toBe(Math.round(total / 1_000_000));
  return { kinds, late };
}

describe("a corrida do fim de chamada na transferência com volta (fatia 3c-2)", { timeout: 120_000 }, () => {
  it("quem desliga com a linha da equipe chamando: o trecho de volta nunca abre, e nada é gravado depois do fim", async () => {
    const run = await returnScene("pipeline-race-transferring");
    run.transport.callerHangup();
    await run.session.done;
    const connectsAtEnd = run.connects.length;
    // A volta que chega depois do fim não abre nada.
    run.transport.endTransfer({ returned: true, status: "NOANSWER" });
    await expectNothingAfterEnd(run);
    expect(run.connects.length).toBe(connectsAtEnd);
    expect(run.opened.count).toBe(1);
  });

  it("o fim antes de a abertura do trecho de volta terminar: a peça que abre tarde fecha, e nada é gravado depois do fim", async () => {
    const run = await returnScene("pipeline-race-opening", { holdReturnOpening: true });
    run.transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(() => run.opened.count === 2, "the return leg to start opening");
    run.transport.callerHangup();
    expect(await run.session.done).toMatchObject({ status: "completed", endReason: "caller_hangup" });
    const { kinds, late } = await expectNothingAfterEnd(run);
    // O trecho de volta não chegou a atender: nenhuma fala dele e nenhuma latência.
    expect(kinds).not.toContain("pipeline_turn_latency");
    expect(run.opened.count).toBe(2);
    // A fala de falha que a abertura da volta sintetizou (a primeira perna tinha a de transferência) entra no extrato.
    expect(late.map((row) => Number(row.cost_microcents))).toEqual([[...PIPELINE_FAILURE_SPEECH].length * VOICE_PRICE.centsPerThousandCharacters * 1000]);
  });

  it("o fim logo depois de a abertura do trecho de volta terminar, antes de o trecho entrar na linha: a sessão nova fecha, e nada é gravado depois do fim", async () => {
    const run = await returnScene("pipeline-race-opened", { hangUpWhenReturnOpens: true });
    run.transport.endTransfer({ returned: true, status: "NOANSWER" });
    await run.session.done;
    expect(run.connects).toHaveLength(2);
    await expectNothingAfterEnd(run);
    expect(run.opened.count).toBe(2);
    // A fala de falha que a abertura da volta sintetizou entra no extrato, antes ou depois do fim.
    const voiceLines = (await piecesLedger(run.made.callId)).filter((row) => row.engine === "synthesizer:simulated");
    expect(voiceLines.map((row) => Number(row.cost_microcents))).toContain([...PIPELINE_FAILURE_SPEECH].length * VOICE_PRICE.centsPerThousandCharacters * 1000);
  });

  it("o fim com o trecho de volta já na linha, a saudação tocando: as peças fecham, a fala aberta é cancelada, e nada é gravado depois do fim", async () => {
    const run = await returnScene("pipeline-race-greeting");
    run.transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(async () => (await eventsOf(app, run.made.callId)).some((event) => event.kind === "transcript_agent" && String(event.payload.text).startsWith("Ninguém da equipe")), "the return greeting");
    run.transport.callerHangup();
    await run.session.done;
    await expectNothingAfterEnd(run);
    expect(run.opened.count).toBe(2);
  });
});

describe("a guarda do evento de latência na sessão (ressalva da DESA-428)", { timeout: 120_000 }, () => {
  it("a sessão substituída na volta e a ligação encerrando não gravam pipeline_turn_latency; a sessão atual grava", async () => {
    const run = await returnScene("pipeline-latency-guard");
    run.transport.endTransfer({ returned: true, status: "NOANSWER" });
    await waitFor(async () => (await eventsOf(app, run.made.callId)).some((event) => event.kind === "transcript_agent" && String(event.payload.text).startsWith("Ninguém da equipe")), "the return greeting");
    const [replaced, current] = run.latencyHandlers;
    if (!replaced || !current) throw new Error("a ligação não pôs o handler da latência nas duas sessões");
    const turn = (totalMs: number): PipelineTurnLatency => ({ endpointMs: 1, brainFirstTextMs: 2, voiceFirstAudioMs: 3, totalMs, endFromArrival: false, tool: false });
    // A sessão do primeiro trecho já foi substituída: o que ela ainda emitir não vai para a linha do tempo.
    replaced(turn(111));
    // A sessão atual grava: o controle de que o handler é o da ligação.
    current(turn(222));
    await waitFor(async () => (await latenciesOf(run.made.callId)).length === 1, "the current session's latency");
    // A ligação encerrando: o fim já começou, e nada mais entra.
    run.transport.callerHangup();
    current(turn(333));
    await run.session.done;
    await settle();
    expect((await latenciesOf(run.made.callId)).map((payload) => payload.totalMs)).toEqual([222]);
  });
});

// ---- fatia 4: a interrupção numa ligação ----

/** A voz com preço e com o agendador nas mãos do teste: presa (`hold`), cada pedaço de áudio espera `step`. */
function gatedPricedVoice() {
  const tasks: Array<() => void> = [];
  let flowing = true;
  const voice = pricedVoice({
    schedule: (task) => {
      if (flowing) setImmediate(task);
      else tasks.push(task);
    },
  });
  return { ...voice, hold: () => void (flowing = false), step: () => tasks.shift()?.(), pending: () => tasks.length };
}

describe("a interrupção numa ligação (fatia 4)", { timeout: 120_000 }, () => {
  const GREETING = "Esta ligação é atendida por uma assistente virtual e a conversa fica registrada. Bom dia.";
  it("o aceite: quem ligou fala por cima, o agente para, o painel mostra a fala só até onde saiu, a próxima resposta segue do que a pessoa disse, e o extrato cobra o enviado", async () => {
    const FIRST = "Claro, posso ajudar. ";
    const SECOND = "Qual é o seu nome completo?";
    const voice = gatedPricedVoice();
    const ear = pricedTranscriber([
      { afterAudioMs: 100, text: "Oi.", final: true },
      { afterAudioMs: 200, text: "Espera" },
      { afterAudioMs: 300, text: "Espera, quero remarcar.", final: true },
    ]);
    const made = await scene("pipeline-interruption", { engine: "openai-realtime", greeting: "Bom dia.", costCeilingCents: 500 }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    fakeBrain?.reply([text(FIRST), text(SECOND), usage(30, 12)], [text("Claro, para quando?"), usage(40, 5)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    await waitFor(async () => (await eventsOf(app, made.callId)).some((event) => event.kind === "transcript_agent" && String(event.payload.text).endsWith("Bom dia.")), "the greeting");
    await waitFor(() => voice.live() === 0, "the greeting to finish");
    voice.hold();
    made.transport.callerAudio(100);
    await waitFor(() => voice.pending() >= 2, "the answer to be generated");
    // Só a primeira frase sai para a linha; quem ligou fala por cima.
    voice.step();
    const clearedBefore = made.transport.cleared;
    made.transport.callerAudio(100);
    await waitFor(() => made.transport.cleared > clearedBefore, "the interruption to clear the line");
    made.transport.callerAudio(100);
    await waitFor(() => fakeBrain?.requests.length === 2, "the next brain request");
    // O cérebro recebe a fala cortada, e não a inteira.
    const next = fakeBrain?.requests[1]?.messages.map((message) => ({ role: message.role, content: message.content })) ?? [];
    expect(next.slice(-3)).toEqual([
      { role: "user", content: "Oi." },
      { role: "assistant", content: "Claro, posso ajudar." },
      { role: "user", content: "Espera, quero remarcar." },
    ]);
    while (voice.pending() > 0) voice.step();
    await waitFor(async () => (await eventsOf(app, made.callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === "Claro, para quando?"), "the next answer");
    made.transport.callerHangup();
    await session.done;
    await settle();
    // O painel: a fala do agente só até onde saiu, antes da fala nova de quem ligou.
    const events = await eventsOf(app, made.callId);
    const lines = events.filter((event) => event.kind === "transcript_agent" || event.kind === "transcript_user").map((event) => `${event.kind === "transcript_user" ? "user" : "agent"}: ${String(event.payload.text)}`);
    expect(lines).toEqual([`agent: ${GREETING}`, "user: Oi.", "agent: Claro, posso ajudar.", "user: Espera, quero remarcar.", "agent: Claro, para quando?"]);
    // A voz cobrou o que foi enviado a ela (as duas frases da resposta cortada inclusive), nem mais nem menos.
    expect(voice.texts).toContain(SECOND);
    await expectVoiceLedgerMatchesSynthesis(made.callId, voice);
    const ledger = await piecesLedger(made.callId);
    // O pedido cortado e o seguinte, os dois no extrato, e o total da ligação (o que o teto confere) é o do extrato.
    expect(ledger.filter((row) => row.engine === "brain:openai")).toHaveLength(2);
    const total = ledger.reduce((sum, row) => sum + Number(row.cost_microcents), 0);
    expect((await callOf(app, made.callId)).cost_cents).toBe(Math.round(total / 1_000_000));
    // Nada aberto: nenhuma fala viva, e nenhum evento depois do fim.
    expect(voice.live()).toBe(0);
    const kinds = events.map((event) => event.kind);
    expect(kinds.slice(kinds.indexOf("call_ended") + 1).every((kind) => kind === "task_queued")).toBe(true);
  });
});

describe("a coluna fora da forma e a confirmação que sai com a chave (fatia 5a, L2 da DESA-421)", { timeout: 120_000 }, () => {
  // O agente abre o motor simulado, que atenderia: cair calado no motor direto seria uma ligação atendida.
  const script: SimulatedScript = [{ say: "Bom dia." }, { end: true }];

  it("L2: agents.pipeline gravada à mão fora da forma recusa a ligação com o motivo, e o motor direto nunca abre", async () => {
    for (const [n, wrong] of [{ transcriber: "simulated", brain: "openai" }, { ...PIPELINE, voiceId: 7 }, { ...PIPELINE, model: "" }, "simulated", [PIPELINE], 42].entries()) {
      const made = await scene(`pipeline-shape-${n}`, { name: "Recepção", script }, { pipeline: wrong });
      expect(await made.start().done).toMatchObject({ status: "refused", endReason: "engine_not_configured" });
      const events = await eventsOf(app, made.callId);
      expect(events.map((event) => event.kind)).not.toContain("call_answered");
      expect(events.find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "engine_not_configured", engine: "simulated", detail: "agents.pipeline is not in the expected shape" });
      expect(await ledgerOf(app, made.callId)).toEqual([]);
      expect((await notificationsOf(app, made.organizationId)).map((notice) => notice.body)).toEqual([
        "Uma ligação do agente Recepção foi recusada porque as peças do pipeline não abriram: a escolha das peças gravada no agente está fora da forma. Quem ligou ouviu o sinal de falha. Confira a chave e a conta do fornecedor dessa peça em Configurações → Inteligência artificial e faça uma chamada de teste.",
      ]);
    }
  });

  it("a voz de fora gravada no agente e a chave (com a confirmação) apagada depois: a abertura recusa pela chave, sem abrir nada", async () => {
    const voice = pricedVoice();
    const made = await scene("pipeline-voice-key-gone", { engine: "openai-realtime" }, { pipeline: PIPELINE, synthesizer: { ...voice.synthesizer, keyless: false } });
    expect(await made.start().done).toMatchObject({ status: "refused", endReason: "engine_not_configured" });
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "engine_not_configured", engine: "pipeline", piece: "synthesizer", pieceId: "simulated", detail: "rejected" });
    expect(voice.speaks()).toBe(0);
    expect(fakeBrain?.requests).toHaveLength(0);
  });
});

// ---- 5c: as notas da 5b-2 (parecer da DESA-443) ----

describe("as notas da 5b-2 (fatia 5c)", { timeout: 120_000 }, () => {
  it("a voz simulada escrita à mão na coluna, fora da configuração de teste: call_refused com pipeline_piece_test_only, sem chave lida nem peça aberta", async () => {
    // A transcrição é outra (não a simulada): a recusa sai pela voz, a segunda peça que o painel confere.
    const voice = pricedVoice();
    const ear = pricedTranscriber([]);
    const real = { ...ear.transcriber, id: "fala-de-verdade" };
    const made = await scene(
      "pipeline-test-only",
      { name: "Recepção", engine: "openai-realtime" },
      { pipeline: { ...PIPELINE, transcriber: "fala-de-verdade" }, transcriber: real, synthesizer: voice.synthesizer, simulatedPieces: false },
    );
    expect(await made.start().done).toMatchObject({ status: "refused", endReason: "pipeline_piece_test_only" });
    const events = await eventsOf(app, made.callId);
    expect(events.find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "pipeline_piece_test_only", engine: "pipeline", piece: "synthesizer", pieceId: "simulated" });
    expect(events.map((event) => event.kind)).not.toContain("call_answered");
    // Nada abriu: nem a transcrição, nem a voz (nem as falas prontas), nem o cérebro.
    expect(ear.sessions).toHaveLength(0);
    expect(voice.speaks()).toBe(0);
    expect(fakeBrain?.fetched()).toBe(0);
    expect(await piecesLedger(made.callId)).toEqual([]);
    expect((await notificationsOf(app, made.organizationId)).map((notice) => notice.body)).toEqual([
      "Uma ligação do agente Recepção foi recusada porque a voz (simulated) é a peça simulada, que só serve aos testes. A ligação não começou. Quem ligou ouviu o sinal de falha. Escolha uma peça de verdade no bloco Pipeline do agente e faça uma chamada de teste.",
    ]);
  });

  it("a transcrição simulada fora da configuração de teste recusa por ela, a primeira peça conferida", async () => {
    const ear = pricedTranscriber([]);
    const made = await scene("pipeline-test-only-ear", { engine: "openai-realtime" }, { pipeline: PIPELINE, transcriber: ear.transcriber, simulatedPieces: false });
    expect(await made.start().done).toMatchObject({ status: "refused", endReason: "pipeline_piece_test_only" });
    expect((await eventsOf(app, made.callId)).find((event) => event.kind === "call_refused")?.payload).toEqual({ reason: "pipeline_piece_test_only", engine: "pipeline", piece: "transcriber", pieceId: "simulated" });
    expect(ear.sessions).toHaveLength(0);
  });

  it("o end_call com despedida: a voz fala a despedida, sem pedido novo ao cérebro, e o extrato tem um pedido só, medido", async () => {
    const voice = pricedVoice();
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Era só isso, obrigado.", final: true }]);
    const made = await scene("pipeline-end-call-farewell", { engine: "openai-realtime", greeting: "Bom dia.", tools: ["end_call"] }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    const FAREWELL = "Foi um prazer! Tenha um ótimo dia.";
    fakeBrain?.reply([text("Por nada. "), tool("call_1", "end_call", JSON.stringify({ reason: "A pessoa se despediu.", farewell: FAREWELL })), usage(150, 20)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(100);
    await waitFor(async () => (await eventsOf(app, made.callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === FAREWELL), "the farewell");
    made.harness.timers.fire(6000);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "end_call" });
    await settle();
    expect(fakeBrain?.fetched()).toBe(1);
    // A despedida foi dita uma vez, pela voz, e não por um pedido ao cérebro.
    expect(voice.texts.filter((spoken) => spoken === FAREWELL)).toHaveLength(1);
    const agentLines = (await eventsOf(app, made.callId)).filter((event) => event.kind === "transcript_agent").map((event) => event.payload.text);
    expect(agentLines.filter((line) => line === FAREWELL)).toHaveLength(1);
    expect((await piecesLedger(made.callId)).filter((row) => row.engine === "brain:openai").map((row) => [row.input_tokens, row.output_tokens, row.cost_estimated])).toEqual([[150, 20, false]]);
  });

  it("o end_call sem despedida: nenhum pedido ao cérebro depois do fim pedido por ferramenta", async () => {
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Pode desligar.", final: true }]);
    const made = await scene("pipeline-end-call", { engine: "openai-realtime", tools: ["end_call"] }, { pipeline: PIPELINE, transcriber: ear.transcriber });
    fakeBrain?.reply([tool("call_1", "end_call", JSON.stringify({ reason: "A pessoa pediu para desligar." })), usage(150, 20)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(100);
    expect(await session.done).toMatchObject({ status: "completed", endReason: "end_call" });
    await settle();
    expect(fakeBrain?.fetched()).toBe(1);
    expect((await piecesLedger(made.callId)).filter((row) => row.engine === "brain:openai").map((row) => row.cost_estimated)).toEqual([false]);
  });

  it("a transferência pedida por ferramenta: nenhum pedido ao cérebro depois dela", async () => {
    const ear2 = pricedTranscriber([{ afterAudioMs: 100, text: "Quero falar com o financeiro.", final: true }]);
    const transferred = await scene("pipeline-transfer-no-ask", { engine: "openai-realtime", transferTo: "+5531988887777", tools: ["transfer_to_human"] }, { pipeline: PIPELINE, transcriber: ear2.transcriber });
    fakeBrain?.reply([tool("t1", "transfer_to_human", JSON.stringify({ reason: "financeiro", summary: "Segunda via." })), usage(20, 5)]);
    const second = transferred.start();
    await answered(transferred.callId);
    await waitFor(() => ear2.sessions.length === 1, "the transcriber to open");
    transferred.transport.callerAudio(100);
    expect(await second.done).toMatchObject({ status: "transferred" });
    await settle();
    expect(fakeBrain?.fetched()).toBe(1);
  });
});
