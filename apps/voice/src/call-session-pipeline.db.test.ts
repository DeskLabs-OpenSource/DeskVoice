// O motor pipeline numa ligação (R5, fatia 3b-1, docs/specs/2026-11-17-motor-de-voz-em-pipeline.md):
// com `agents.pipeline` nula, a chamada é a de sempre; preenchida, a sessão monta as três peças pela
// pasta (aqui, injetadas), cada peça vira uma linha no extrato com o preço dela, o teto toca a
// despedida pronta sem síntese nova, e a falha de uma peça chega ao painel só com os códigos.
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { encryptSecret, withSystem } from "@deskvoice/core";
import { createPipelineEngine, PIPELINE_FAILURE_SPEECH, type Brain, type SimulatedScript, type SpeechSynthesizer, type StreamingTranscriber } from "@deskvoice/voice-engine";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting } from "../../../packages/tools/test/helpers";
import openai from "../../../packages/voice-engine/src/brains/openai";
import { FixedSpeechCache, speechUsageOf } from "../../../packages/voice-engine/src/synthesis";
import { createSimulatedSynthesizer, toneFor } from "../../../packages/voice-engine/src/synthesizers/simulated";
import { createSimulatedTranscriber, type SimulatedTranscription, type SimulatedTranscriptScript } from "../../../packages/voice-engine/src/transcribers/simulated";
import { brainKeySetting, brainModelsSetting, startCallSession, type CallSession } from "./call-session";
import { callOf, createAgent, createCall, createOrganization, eventsOf, kindsOf, ledgerOf, manualTransport, pricedSimulatedEngine, secretKey, sessionHarness, type AgentOptions, type ManualTransport, type SessionHarness } from "./testing/db";
import { waitFor } from "./testing/helpers";
import { failureTone } from "./transport";

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

// ---- o cérebro num servidor falso: a OpenAI de verdade (`brains/openai`), com o `fetch` apontado para cá ----

type Reply = { status: number; body: string } | Array<{ data: unknown }>;

async function startFakeBrain() {
  const replies: Reply[] = [];
  const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
  const open = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    request.on("end", () => {
      requests.push(JSON.parse(raw) as { messages: Array<Record<string, unknown>> });
      const reply = replies.shift() ?? [{ data: { choices: [{ index: 0, delta: { content: "(sem roteiro)" } }] } }];
      if (!Array.isArray(reply)) return void response.writeHead(reply.status, { "content-type": "application/json" }).end(reply.body);
      open.add(response);
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const step of reply) response.write(`data: ${JSON.stringify(step.data)}\n\n`);
      response.end("data: [DONE]\n\n");
      open.delete(response);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetch = ((url: string, init: RequestInit) => globalThis.fetch(url.replace("https://api.openai.com", base), init)) as typeof globalThis.fetch;
  return {
    fetch,
    requests,
    reply: (...next: Reply[]) => void replies.push(...next),
    async stop() {
      for (const response of open) response.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const text = (content: string) => ({ data: { choices: [{ index: 0, delta: { content } }] } });
const usage = (prompt: number, completion: number) => ({ data: { choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion } } });
const tool = (id: string, name: string, args: string) => ({
  data: { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }] }, finish_reason: "tool_calls" }] },
});

// ---- as peças: simuladas, com preço ----

const MODEL = "gpt-5-nano";
/** 100 centavos por milhão: um milhão de tokens de entrada é um dólar. */
const BRAIN_PRICE = { centsPerMillionInputTokens: 100, centsPerMillionOutputTokens: 400, source: "teste", checkedOn: "2026-11-24" };
const VOICE_PRICE = { centsPerThousandCharacters: 30, checkedOn: "2026-11-24", source: "teste" };
const PIPELINE = { transcriber: "simulated", brain: "openai", model: MODEL, synthesizer: "simulated", voiceId: "simulated" };

/** A voz simulada com preço e com cada `speak` contado: a despedida pronta não pode abrir fala nova. */
function pricedVoice(options: { failAfter?: number } = {}) {
  const base = createSimulatedSynthesizer();
  let speaks = 0;
  const synthesizer: SpeechSynthesizer = {
    ...base,
    pricing: VOICE_PRICE,
    pricingOf: () => VOICE_PRICE,
    async speak(config, apiKey, connect) {
      speaks += 1;
      if (options.failAfter !== undefined && speaks > options.failAfter) {
        const { SynthesizerOpenError } = await import("@deskvoice/voice-engine");
        throw new SynthesizerOpenError("no_credit", "elevenlabs: quota_exceeded (texto do provedor)");
      }
      const speech = await base.speak(config, apiKey, connect);
      return {
        ...speech,
        on: (event, handler) =>
          event === "usage"
            ? speech.on("usage", (spent) => (handler as (value: typeof spent) => void)(speechUsageOf(VOICE_PRICE, spent.characters)))
            : speech.on(event, handler),
        push: (value, opts) => speech.push(value, opts),
        end: () => speech.end(),
        cancel: () => speech.cancel(),
      };
    },
  };
  return { synthesizer, speaks: () => speaks };
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
  options: { pipeline?: unknown; transcriber?: StreamingTranscriber; synthesizer?: SpeechSynthesizer; brain?: Brain; brainKey?: boolean; price?: boolean; pieces?: boolean } = {},
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
    made.deps.transcribers = new Map([["simulated", options.transcriber ?? pricedTranscriber([]).transcriber]]);
    made.deps.brains = new Map([["openai", options.brain ?? openai]]);
    made.deps.synthesizers = new Map([["simulated", options.synthesizer ?? pricedVoice().synthesizer]]);
    made.deps.pipelineEngine = createPipelineEngine({ fetch: fakeBrain.fetch, fixedSpeechCache: new FixedSpeechCache() });
  }
  const callId = await createCall(app, organizationId, agentId, made.clock.now());
  const transport = manualTransport();
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
    // As falas fixas (a de falha e as duas despedidas do teto) ficaram prontas na abertura.
    const fixedSpeaks = 3;
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
    expect(answeredEvent?.payload).toEqual({ engine: "pipeline" });
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
    // A voz abre as três falas fixas e a saudação; a próxima fala (a resposta) cai.
    const voice = pricedVoice({ failAfter: 4 });
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

  it("a peça que cai: a fala de falha chega inteira ao transporte antes do sinal e do desligar, e o consumo da transcrição entra no fim", async () => {
    const voice = pricedVoice({ failAfter: 4 });
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    const made = await scene("pipeline-fails-plays", { engine: "openai-realtime", greeting: "Bom dia." }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    fakeBrain?.reply({ status: 500, body: "{}" });
    // A ordem do que o transporte recebe: cada pedaço de áudio e o desligar, que espera a fila tocar.
    const sent: Array<number | "hangup"> = [];
    const { sendAudio, hangup } = made.transport;
    made.transport.sendAudio = (pcm) => {
      sent.push(pcm.length);
      sendAudio(pcm);
    };
    made.transport.hangup = async () => {
      sent.push("hangup");
      await hangup();
    };
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    made.transport.callerAudio(100);
    expect(await session.done).toMatchObject({ status: "failed", endReason: "engine_failed" });
    const failure = toneFor([...PIPELINE_FAILURE_SPEECH].length).length;
    const at = sent.indexOf(failure);
    expect(at).toBeGreaterThanOrEqual(0);
    // Depois da fala de falha, só o sinal de falha e o desligar: nada a corta, e ela sai antes de a ligação cair.
    expect(sent.slice(at + 1)).toEqual([failureTone().length, "hangup"]);
    expect(made.transport.cleared).toBe(0);
    // O consumo da transcrição, que a peça entrega ao fechar, está no extrato, com o preço dela.
    const heard = (await piecesLedger(made.callId)).filter((row) => row.engine === "transcriber:simulated");
    expect(heard.map((row) => Number(row.cost_microcents) > 0)).toEqual([true]);
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

  it("o pior caso do pedido ao cérebro passa do que sobra do teto: o pedido não sai, e a despedida toca pronta, sem síntese nova", async () => {
    const voice = pricedVoice();
    const ear = pricedTranscriber([{ afterAudioMs: 100, text: "Oi.", final: true }]);
    // As três falas fixas (296 caracteres) e o aviso de gravação (80) custam 11,28 centavos, a 30 por mil
    // caracteres. Com teto de 12, sobra menos de 0,72; o pior caso do pedido passa disso só pela saída:
    // 4 096 tokens a 400 por milhão são 1,64 centavo.
    const made = await scene("pipeline-worst-case", { engine: "openai-realtime", costCeilingCents: 12 }, { pipeline: PIPELINE, transcriber: ear.transcriber, synthesizer: voice.synthesizer });
    fakeBrain?.reply([text("Isto não pode sair."), usage(10, 2)]);
    const session = made.start();
    await answered(made.callId);
    await waitFor(() => ear.sessions.length === 1, "the transcriber to open");
    // As três falas fixas e o aviso de gravação, já no extrato, sem bater no teto.
    await waitFor(async () => (await piecesLedger(made.callId)).filter((row) => row.engine === "synthesizer:simulated").length === 2, "the opening speech lines");
    const speaksAtOpening = voice.speaks();
    expect(speaksAtOpening).toBe(4);
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
    expect(reached).toMatchObject({ ceilingCents: 12, brainWorstCase: true });
    expect(Number((reached as { brainWorstCaseMicrocents?: number }).brainWorstCaseMicrocents)).toBeGreaterThan(4096 * 400);
    const ledger = await piecesLedger(made.callId);
    expect(ledger.some((row) => row.engine === "brain:openai")).toBe(false);
    // O gasto ficou abaixo do teto: a despedida veio antes, e não depois.
    expect(outcome.costCents).toBeLessThan(12);
  });
});
