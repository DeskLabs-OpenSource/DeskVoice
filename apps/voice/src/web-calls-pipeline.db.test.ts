// A chamada pelo navegador com o pipeline (fatia 5b-2, docs/specs/2026-11-17-motor-de-voz-em-pipeline.md, e
// a decisão 0008): o agente com `agents.pipeline` abre a sessão pelo mesmo caminho do telefone, com a mesma
// abertura, o mesmo teto, o mesmo extrato por peça e a mesma recusa. Um cliente WebSocket de verdade faz o
// papel da tela; a transcrição e a voz são as simuladas da pasta, e o cérebro é a OpenAI de verdade com o
// `fetch` num servidor falso. O motor pipeline entra no mapa de motores do servidor, como o da pasta.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptSecret, withSystem } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { createSimulatedEngine, type VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting } from "../../../packages/tools/test/helpers";
import { createPipelineEngine } from "../../../packages/voice-engine/src/engines/pipeline";
import { FixedSpeechCache } from "../../../packages/voice-engine/src/synthesis";
import { brainKeySetting, brainModelsSetting, DEFAULT_RECORDING_NOTICE, startCallSession, synthesizerKeySetting } from "./call-session";
import { startVoiceServer, type VoiceServer } from "./server";
import { callOf, createAgent, createCall, createOrganization, eventsOf, fakeAri, fakeClock, kindsOf, manualTransport, secretKey, sessionHarness, testSchedule, type AgentOptions } from "./testing/db";
import { startFakeBrain, text, usage, type FakeBrain } from "./testing/fake-brain";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
const USER = "0c000000-0000-4000-8000-0000000000bb";
const TOKEN = "token-interno-de-teste";
let scratch: string;
let server: VoiceServer | undefined;
let fakeBrain: FakeBrain | undefined;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-web-pipeline-"));
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
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

const MODEL = "gpt-5-nano";
/** 100 centavos por milhão de tokens de entrada: um milhão de tokens passa de qualquer teto pequeno. */
const BRAIN_PRICE = { centsPerMillionInputTokens: 100, centsPerMillionOutputTokens: 400, source: "teste", checkedOn: "2026-11-24" };
/** As peças da pasta: a transcrição e a voz simuladas, e o cérebro da OpenAI. */
const PIPELINE = { transcriber: "simulated", brain: "openai", model: MODEL, synthesizer: "simulated", voiceId: "simulated" };
/** O roteiro de demonstração do transcritor simulado da pasta: o trecho final sai com 1 s de áudio. */
const CALLER_SAYS = "(fala de quem ligou)";
/** A despedida do teto de custo, a mesma da ligação pelo telefone. */
const FAREWELL_COST_CEILING = "Preciso encerrar esta ligação agora. Se ainda precisar de algo, é só ligar de novo. Obrigado.";

interface Pieces {
  pipeline?: unknown;
  brainKey?: boolean;
  price?: boolean;
  /** A chave da ElevenLabs salva (sem ela, a voz de fora recusa pela chave, antes da confirmação). */
  elevenLabsKey?: boolean;
  /**
   * O processo de voz com as peças simuladas aceitas, como os testes o montam (padrão). Falso, é o de um
   * servidor instalado: a coluna escrita à mão com a peça simulada recusa a ligação (fatia 5c).
   */
  simulatedPieces?: boolean;
}

/** A organização, o agente com as peças e as configurações delas, como a tela gravaria. */
async function organizationWith(label: string, agent: AgentOptions, pieces: Pieces): Promise<{ organizationId: string; agentId: string }> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, agent);
  await withSystem(app, (q) => q.exec("update agents set pipeline = $2 where id = $1", [agentId, JSON.stringify(pieces.pipeline ?? PIPELINE)]));
  if (pieces.brainKey !== false) await putSetting(app, organizationId, brainKeySetting("openai"), encryptSecret("chave-inventada-do-cerebro", secretKey));
  await putSetting(app, organizationId, brainModelsSetting("openai"), { fetchedAt: "2026-11-24", models: [{ id: MODEL, label: MODEL, ...(pieces.price !== false && { price: BRAIN_PRICE }) }] }, false);
  if (pieces.elevenLabsKey) await putSetting(app, organizationId, synthesizerKeySetting("elevenlabs"), encryptSecret("chave-inventada-da-voz", secretKey));
  return { organizationId, agentId };
}

/** O motor pipeline da pasta, com o `fetch` do cérebro no servidor falso, e o simulado de roteiro ao lado. */
const enginesWith = (brain: FakeBrain): Map<string, VoiceEngine> =>
  new Map<string, VoiceEngine>([
    ["pipeline", createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: new FixedSpeechCache() })],
    ["simulated", createSimulatedEngine()],
  ]);

interface Scene {
  organizationId: string;
  agentId: string;
  brain: FakeBrain;
  timers: ReturnType<typeof testSchedule>;
  post(): Promise<{ status: number; body: Record<string, string> }>;
  /** O processo de voz aceita as peças simuladas: a ligação pelo telefone da comparação também. */
  simulatedPieces: boolean;
}

async function scene(label: string, agent: AgentOptions, pieces: Pieces = {}): Promise<Scene> {
  const { organizationId, agentId } = await organizationWith(label, agent, pieces);
  fakeBrain = await startFakeBrain();
  const brain = fakeBrain;
  const timers = testSchedule();
  const ari = fakeAri();
  ari.failing = true; // sem Asterisk: a chamada pelo navegador não depende dele
  server = await startVoiceServer({
    db: app,
    clock: fakeClock(),
    engines: enginesWith(brain),
    tools: await loadTools(),
    ari,
    secretKey,
    audioSocketPort: 0,
    internalPort: 0,
    webPort: 0,
    internalToken: TOKEN,
    trunksFile: path.join(scratch, `${organizationId}.conf`),
    publicIp: null,
    host: "127.0.0.1",
    schedule: timers.schedule,
    resolveName: async () => ["192.0.2.53"],
    now: timers.now,
    ...(pieces.simulatedPieces !== false && { simulatedPieces: true }),
  });
  const internalPort = server.internalPort;
  const post: Scene["post"] = async () => {
    const response = await fetch(`http://127.0.0.1:${internalPort}/calls/web`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": TOKEN },
      body: JSON.stringify({ organizationId, agentId, userId: USER }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  };
  return { organizationId, agentId, brain, timers, post, simulatedPieces: pieces.simulatedPieces !== false };
}

interface Browser {
  audioBytes: number;
  messages: Array<Record<string, string>>;
  closed: number | undefined;
  speak(ms: number): void;
  hangUp(): void;
}

/** O lado da tela: um cliente WebSocket de verdade. */
function browser(token: string): Browser {
  const socket = new WebSocket(`ws://127.0.0.1:${server?.webPort}/voice-ws?token=${encodeURIComponent(token)}`, { headers: { origin: "https://painel.exemplo.test" } });
  sockets.push(socket);
  const client: Browser = {
    audioBytes: 0,
    messages: [],
    closed: undefined,
    speak(ms) {
      for (let sent = 0; sent < ms; sent += 20) socket.send(Buffer.alloc(320), { binary: true });
    },
    hangUp() {
      socket.send(JSON.stringify({ type: "hangup" }));
    },
  };
  socket.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) client.audioBytes += data.length;
    else client.messages.push(JSON.parse(data.toString()) as Record<string, string>);
  });
  socket.on("error", () => undefined);
  socket.on("close", (code) => {
    client.closed = code;
  });
  return client;
}

async function call(made: Scene): Promise<{ callId: string; client: Browser }> {
  const { status, body } = await made.post();
  expect(status).toBe(200);
  const callId = body.callId ?? "";
  const client = browser(body.token ?? "");
  await waitFor(() => client.messages[0], "the ready message");
  expect(client.messages[0]).toEqual({ type: "ready", callId });
  return { callId, client };
}

const endedMessage = (client: Browser) => waitFor(() => client.messages.find((message) => message.type === "ended"), "the ended message");
const piecesLedger = (callId: string) =>
  withSystem(app, (q) => q.many<{ engine: string; model: string | null; input_tokens: number; output_tokens: number }>("select engine, model, input_tokens, output_tokens from usage_ledger where call_id = $1 order by engine", [callId]));

/** A mesma ligação pelo telefone: a sessão com um transporte manual, numa chamada comum da mesma organização. */
async function phoneRefusal(made: Scene): Promise<unknown> {
  const harness = await sessionHarness(app, [...enginesWith(made.brain).values()]);
  if (made.simulatedPieces) harness.deps.simulatedPieces = true;
  try {
    const callId = await createCall(app, made.organizationId, made.agentId, harness.clock.now());
    await startCallSession(harness.deps, { organizationId: made.organizationId, callId, agentId: made.agentId, transport: manualTransport() }).done;
    return (await eventsOf(app, callId)).find((event) => event.kind === "call_refused")?.payload;
  } finally {
    await harness.approvals.close();
  }
}

describe("chamada pelo navegador com o pipeline", { timeout: 120_000 }, () => {
  it("o pipeline atende: a saudação, um turno pelo cérebro, o fim, e uma linha por peça no extrato; o `engine` do agente fica sem uso", async () => {
    // O `engine` gravado é o simulado, que o navegador recusa sozinho: com a coluna preenchida, ele fica sem uso.
    const made = await scene("web-pipeline", { engine: "simulated", greeting: "Bom dia." });
    made.brain.reply([text("Claro, posso ajudar."), usage(120, 12)]);
    const { callId, client } = await call(made);
    expect(await callOf(app, callId)).toMatchObject({ channel: "web", engine: "pipeline" });

    // A saudação chega em áudio, e então a pessoa fala: o transcritor fecha o trecho com 1 s.
    await waitFor(() => client.audioBytes > 0, "the greeting");
    client.speak(1_200);
    await waitFor(() => made.brain.requests.length === 1, "the brain request");
    await waitFor(async () => (await kindsOf(app, callId)).includes("pipeline_turn_latency"), "the turn to be answered");
    // Quem desliga é a tela: o socket fecha, e a chamada termina como desligamento.
    client.hangUp();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_ended"), "the call to end");
    await waitFor(() => client.closed !== undefined, "the socket to close");

    // Quem falou foi o pipeline: o cérebro recebeu a fala transcrita, e a resposta dele foi a fala do agente.
    const lastUser = made.brain.requests[0]?.messages.filter((message) => message.role === "user").at(-1);
    expect(JSON.stringify(lastUser)).toContain(CALLER_SAYS);
    const events = await eventsOf(app, callId);
    expect(events.find((event) => event.kind === "call_answered")?.payload).toMatchObject({ engine: "pipeline" });
    expect(events.filter((event) => event.kind === "transcript_user").map((event) => event.payload)).toContainEqual(expect.objectContaining({ text: CALLER_SAYS }));
    expect(events.filter((event) => event.kind === "transcript_agent").map((event) => (event.payload as { text: string }).text)).toEqual([`${DEFAULT_RECORDING_NOTICE} Bom dia.`, "Claro, posso ajudar."]);
    expect(events.find((event) => event.kind === "call_started")?.payload).toMatchObject({ channel: "web", userId: USER });
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup", engine: "pipeline", channel: "web" });

    // Uma linha por peça, com o modelo do cérebro e os tokens que ele contou.
    const ledger = await piecesLedger(callId);
    expect(new Set(ledger.map((row) => row.engine))).toEqual(new Set(["transcriber:simulated", "brain:openai", "synthesizer:simulated"]));
    expect(ledger.filter((row) => row.engine === "brain:openai").map((row) => [row.model, row.input_tokens, row.output_tokens])).toEqual([[MODEL, 120, 12]]);
  });

  it("a mesma recusa do telefone: sem chave, sem preço e sem a confirmação da 9.1, nada abre e nada é pedido ao cérebro", async () => {
    const cases: Array<[string, Pieces, Record<string, unknown>]> = [
      ["sem chave do cérebro", { brainKey: false }, { reason: "engine_not_configured", engine: "pipeline", piece: "brain", pieceId: "openai", detail: "rejected" }],
      ["modelo sem preço", { price: false }, { reason: "pipeline_piece_unpriced", engine: "pipeline", piece: "brain", pieceId: "openai", model: MODEL }],
      [
        "a voz de fora sem a confirmação da 9.1",
        { pipeline: { ...PIPELINE, synthesizer: "elevenlabs", voiceId: "voz-qualquer" }, elevenLabsKey: true },
        { reason: "pipeline_piece_unconfirmed", engine: "pipeline", piece: "synthesizer", pieceId: "elevenlabs" },
      ],
      // A coluna escrita à mão no banco com as peças simuladas, num processo de voz montado como o de um
      // servidor instalado: a mesma recusa do 422 do painel (`pipeline_piece_test_only`), pela primeira
      // delas, antes de qualquer chave ser lida ou peça abrir (fatia 5c).
      ["a peça simulada fora da configuração de teste", { simulatedPieces: false }, { reason: "pipeline_piece_test_only", engine: "pipeline", piece: "transcriber", pieceId: "simulated" }],
    ];
    for (const [label, pieces, refusal] of cases) {
      const made = await scene(`web-pipeline-refused ${label}`, { engine: "gemini-live", greeting: "Bom dia." }, pieces);
      const { callId, client } = await call(made);
      expect(await endedMessage(client), label).toEqual({ type: "ended", status: "refused", reason: refusal.reason });
      const events = await eventsOf(app, callId);
      expect(events.find((event) => event.kind === "call_refused")?.payload, label).toEqual(refusal);
      expect(events.map((event) => event.kind), label).not.toContain("call_answered");
      expect(await callOf(app, callId), label).toMatchObject({ status: "refused", end_reason: refusal.reason, engine: "pipeline", channel: "web" });
      // A mesma recusa, com os mesmos códigos, da mesma agente pelo telefone.
      expect(await phoneRefusal(made), label).toEqual(refusal);
      expect(made.brain.requests, label).toHaveLength(0);
      await server?.close();
      server = undefined;
      await made.brain.stop();
      fakeBrain = undefined;
    }
  });

  it("o mesmo teto: a resposta que passa do teto toca a despedida pronta e a chamada termina por ele", async () => {
    // O teto é de 50 centavos: a primeira resposta do cérebro (um milhão de tokens a 100 por milhão) passa dele.
    const made = await scene("web-pipeline-ceiling", { engine: "gemini-live", greeting: "Bom dia.", costCeilingCents: 50 });
    made.brain.reply([text("Vou ver isso para você."), usage(1_000_000, 10)]);
    const { callId, client } = await call(made);
    await waitFor(() => client.audioBytes > 0, "the greeting");
    client.speak(1_200);
    await waitFor(async () => (await kindsOf(app, callId)).includes("cost_ceiling_reached"), "the cost ceiling");
    // A despedida do teto, a pronta da abertura, e o prazo dela (o mesmo da ligação pelo telefone).
    await waitFor(async () => (await eventsOf(app, callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === FAREWELL_COST_CEILING), "the farewell");
    made.timers.fire(6000);
    expect(await endedMessage(client)).toEqual({ type: "ended", status: "completed", reason: "cost_ceiling" });
    expect(made.brain.requests).toHaveLength(1);
    const call_ = await callOf(app, callId);
    expect(call_).toMatchObject({ status: "completed", end_reason: "cost_ceiling", engine: "pipeline" });
    expect(Number(call_.cost_cents)).toBeGreaterThanOrEqual(50);
    expect((await piecesLedger(callId)).filter((row) => row.engine === "brain:openai").map((row) => row.input_tokens)).toEqual([1_000_000]);
  });
  it("o mesmo teto pelo pior caso: o pedido ao cérebro que passaria do que sobra nem sai, e a despedida pronta toca (3b-2, B2 da DESA-443)", async () => {
    // O teto é de 1 centavo, e nada foi gasto (as peças simuladas não custam): o pior caso do pedido
    // (a entrada mais 4 096 tokens de saída a 400 por milhão, 1,6 centavo) passa do que sobra.
    const made = await scene("web-pipeline-worst-case", { engine: "gemini-live", greeting: "Bom dia.", costCeilingCents: 1 });
    made.brain.reply([text("Esta resposta não pode sair."), usage(10, 10)]);
    const { callId, client } = await call(made);
    await waitFor(() => client.audioBytes > 0, "the greeting");
    client.speak(1_200);
    await waitFor(async () => (await kindsOf(app, callId)).includes("cost_ceiling_reached"), "the cost ceiling");
    const reached = (await eventsOf(app, callId)).find((event) => event.kind === "cost_ceiling_reached")?.payload;
    expect(reached).toMatchObject({ ceilingCents: 1, brainWorstCase: true });
    expect(Number((reached as { brainWorstCaseMicrocents?: number }).brainWorstCaseMicrocents)).toBeGreaterThan(4096 * 400);
    await waitFor(async () => (await eventsOf(app, callId)).some((event) => event.kind === "transcript_agent" && event.payload.text === FAREWELL_COST_CEILING), "the farewell");
    made.timers.fire(6000);
    expect(await endedMessage(client)).toEqual({ type: "ended", status: "completed", reason: "cost_ceiling" });
    // O pedido nem saiu: nenhum `fetch` ao cérebro, e nenhuma linha dele no extrato.
    expect(made.brain.fetched()).toBe(0);
    expect(made.brain.requests).toHaveLength(0);
    expect((await piecesLedger(callId)).filter((row) => row.engine === "brain:openai")).toEqual([]);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "cost_ceiling", engine: "pipeline", channel: "web" });
  });
});
