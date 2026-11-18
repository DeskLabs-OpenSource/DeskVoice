// Chamada pelo navegador, de ponta a ponta: a API interna entrega o token, um cliente WebSocket de
// verdade faz o papel da tela, o motor segue um roteiro e o banco é real.
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordingPath, withSystem } from "@deskvoice/core";
import { loadTools } from "@deskvoice/tools";
import { createSimulatedEngine, type SimulatedScript, type VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { tasksOf } from "../../../packages/tools/test/helpers";
import { DEFAULT_RECORDING_NOTICE } from "./call-session";
import { startVoiceServer, type VoiceServer } from "./server";
import {
  approvalsOf,
  callOf,
  callsOf,
  createAgent,
  createOrganization,
  decideApproval,
  eventsOf,
  fakeAri,
  fakeClock,
  kindsOf,
  ledgerOf,
  manualEngine,
  pricedSimulatedEngine,
  secretKey,
  simulatedSpeechMs,
  testSchedule,
  type AgentOptions,
  type ManualEngine,
} from "./testing/db";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
const USER = "0c000000-0000-4000-8000-0000000000aa";
const TOKEN = "token-interno-de-teste";
let scratch: string;
let server: VoiceServer | undefined;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "deskvoice-web-"));
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server?.close();
  server = undefined;
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  await app.close();
  await owner.close();
});

// O motor simulado de verdade é recusado na chamada pelo navegador (ele não conversa). O roteiro
// dos testes roda no mesmo motor, com outro id, como um motor real que não pede chave.
const scripted: VoiceEngine = { ...pricedSimulatedEngine(60), id: "roteiro", label: "Motor de roteiro" };

interface Scene {
  organizationId: string;
  agentId: string;
  clock: ReturnType<typeof fakeClock>;
  timers: ReturnType<typeof testSchedule>;
  manual: ManualEngine;
  post(body: object, token?: string | null): Promise<{ status: number; body: Record<string, string> }>;
}

async function scene(label: string, agent: AgentOptions): Promise<Scene> {
  const organizationId = await createOrganization(app, label);
  const agentId = await createAgent(app, organizationId, { engine: "roteiro", greeting: "Clínica Bem Viver, bom dia.", tools: ["request_approval", "send_whatsapp", "end_call", "transfer_to_human"], ...agent });
  const clock = fakeClock();
  const timers = testSchedule();
  const manual = manualEngine({ keyless: true });
  const ari = fakeAri();
  ari.failing = true; // sem Asterisk: a chamada pelo navegador não depende dele
  server = await startVoiceServer({
    db: app,
    clock,
    engines: new Map<string, VoiceEngine>([["roteiro", scripted], ["manual", manual.engine], ["simulated", createSimulatedEngine()], ["com-chave", manualEngine({ id: "com-chave" }).engine]]),
    tools: await loadTools(),
    ari,
    secretKey,
    audioSocketPort: 0,
    internalPort: 0,
    webPort: 0,
    internalToken: TOKEN,
    trunksFile: path.join(scratch, `${organizationId}.conf`),
    recordingsDir: path.join(scratch, "recordings"),
    publicIp: null,
    host: "127.0.0.1",
    schedule: timers.schedule,
    resolveName: async () => ["192.0.2.53"],
    now: timers.now,
  });
  const internalPort = server.internalPort;
  const post: Scene["post"] = async (body, token = TOKEN) => {
    const response = await fetch(`http://127.0.0.1:${internalPort}/calls/web`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token !== null && { "x-internal-token": token }) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  };
  return { organizationId, agentId, clock, timers, manual, post };
}

interface Browser {
  socket: WebSocket;
  audioBytes: number;
  messages: Array<Record<string, string>>;
  closed: number | undefined;
  speak(ms: number): void;
}

/** O lado da tela: um cliente WebSocket de verdade. */
function browser(token: string | undefined, route = "/voice-ws"): Browser {
  const socket = new WebSocket(`ws://127.0.0.1:${server?.webPort}${route}${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`, { headers: { origin: "https://painel.exemplo.test" } });
  sockets.push(socket);
  const client: Browser = {
    socket,
    audioBytes: 0,
    messages: [],
    closed: undefined,
    speak(ms) {
      for (let sent = 0; sent < ms; sent += 20) socket.send(Buffer.alloc(320), { binary: true });
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

/**
 * Um pedido de upgrade cru, sem cliente WebSocket: devolve a linha de status da resposta. Com
 * `key: false` o pedido sai sem `Sec-WebSocket-Key`, um handshake que não completa.
 */
function rawUpgrade(route: string, options: { key?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(server?.webPort ?? 0, "127.0.0.1");
    let received = "";
    socket.on("connect", () => {
      // Como um cliente de verdade: 16 bytes ao acaso, em base64.
      const key = options.key === false ? "" : `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n`;
      socket.write(`GET ${route} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n${key}Origin: https://painel.exemplo.test\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("latin1");
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(received.split("\r\n")[0] ?? ""));
    // Se o servidor abrisse o WebSocket, a conexão ficaria de pé: a linha 101 basta para o teste.
    socket.setTimeout(2_000, () => socket.destroy());
  });
}
/**
 * Uma conexão TCP que fica de pé: manda `request` e depois não diz mais nada, nem responde ao
 * fechamento do WebSocket. `closed` resolve quando o servidor derruba a conexão.
 */
function hangingConnection(request: string): Promise<{ received: () => string; closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const socket = connect(server?.webPort ?? 0, "127.0.0.1");
    let received = "";
    const closed = new Promise<void>((done) => socket.on("close", () => done()));
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("latin1");
    });
    socket.on("error", () => undefined);
    socket.on("connect", () => {
      socket.write(request);
      resolve({ received: () => received, closed });
    });
    socket.once("error", reject);
  });
}
const upgradeRequest = (route: string): string =>
  `GET ${route} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n\r\n`;
/** Falha em vez de pendurar o teste quando a promessa não resolve no prazo. */
const within = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([promise, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${what} did not happen in ${ms} ms`)), ms))]);
const tokenRoute = (token: string | undefined, route = "/voice-ws"): string => `${route}${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`;

async function call(made: Scene): Promise<{ callId: string; token: string; client: Browser }> {
  const { status, body } = await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });
  expect(status).toBe(200);
  const client = browser(body.token);
  await waitFor(() => client.messages[0], "the ready message");
  return { callId: body.callId ?? "", token: body.token ?? "", client };
}

const ended = (callId: string) => waitFor(async () => (await kindsOf(app, callId)).filter((kind) => kind === "task_queued").length === 2, "the call to end");
const typesOf = (client: Browser): string[] => client.messages.map((message) => message.type ?? "");

describe("chamada pelo navegador", { timeout: 120_000 }, () => {
  it("de ponta a ponta: token, ready, áudio nos dois sentidos, aprovação decidida por fora, fim com ended, e tudo na linha do tempo", async () => {
    const script: SimulatedScript = [
      { expectUserAudio: 400, text: "Quero um desconto no pacote." },
      { toolCall: { name: "request_approval", args: { question: "Posso dar 10% de desconto?", context: "Cliente quer fechar hoje.", timeout_seconds: 30 } } },
      { say: "Aprovado. Vou mandar os detalhes." },
      { toolCall: { name: "send_whatsapp", args: { text: "Seu desconto de 10% está confirmado." } } },
      { say: "Obrigada, tenha um bom dia." },
      { toolCall: { name: "end_call", args: { reason: "A cliente se despediu." } } },
    ];
    const made = await scene("web-e2e", { script });
    // A gravação vem desligada (registro 0016); esta organização a ligou.
    await withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value, secret) values ($1, 'calls.recording_enabled', 'true', false)", [made.organizationId]));
    const { status, body } = await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });
    expect(status).toBe(200);
    expect(body).toEqual({ callId: expect.any(String), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresInSeconds: 60 });
    const callId = body.callId ?? "";
    // A chamada existe, tocando, sem número de origem nem de destino.
    expect(await callOf(app, callId)).toMatchObject({ status: "ringing", direction: "inbound", channel: "web", from_e164: null, to_e164: null, agent_id: made.agentId, engine: "roteiro" });
    expect(await kindsOf(app, callId)).toEqual([]);

    const client = browser(body.token);
    await waitFor(() => client.messages[0], "the ready message");
    expect(client.messages[0]).toEqual({ type: "ready", callId });

    // A abertura (aviso de gravação e saudação) chega em binário, na cadência, e então a pessoa fala.
    const opening = `${DEFAULT_RECORDING_NOTICE} Clínica Bem Viver, bom dia.`;
    await waitFor(() => client.audioBytes >= (simulatedSpeechMs(opening) / 20) * 320, "the opening speech");
    client.speak(400);

    const approval = await waitFor(async () => (await approvalsOf(app, callId)).find((candidate) => candidate.status === "pending"), "the pending approval");
    await waitFor(async () => (await kindsOf(app, callId)).filter((kind) => kind === "transcript_agent").length === 2, "the agent to say it is checking");
    expect((await callOf(app, callId)).status).toBe("in_progress");
    await decideApproval(app, approval.id, "approved", made.clock.now());

    await ended(callId);
    await waitFor(() => client.closed !== undefined, "the socket to close");
    expect(client.closed).toBe(1000);
    expect(client.messages.at(-1)).toEqual({ type: "ended", status: "completed", reason: "end_call" });
    expect(typesOf(client)).toEqual(["ready", "ended"]);
    // A impressão digital é gravada depois de o arquivo fechar, já com a telefonia solta.
    await waitFor(async () => (await kindsOf(app, callId)).includes("recording_saved"), "the saved recording");

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual([
      "call_started",
      "call_answered",
      "recording_notice",
      "transcript_agent", // abertura
      "transcript_user",
      "tool_called", // request_approval
      "approval_requested",
      "transcript_agent", // "um instante"
      "approval_decided",
      "tool_result",
      "transcript_agent",
      "tool_called", // send_whatsapp
      "tool_result",
      "transcript_agent",
      "tool_called", // end_call
      "tool_result",
      "call_ended",
      "task_queued",
      "task_queued",
      "recording_saved",
    ]);
    expect(events[0]?.payload).toEqual({ direction: "inbound", from: null, to: null, agentId: made.agentId, channel: "web", userId: USER });
    expect(events[2]?.payload).toEqual({ text: DEFAULT_RECORDING_NOTICE });
    expect(events[3]?.payload).toEqual({ text: opening });
    expect(events[8]?.payload).toMatchObject({ outcome: "approved" });
    // Sem número de quem ligou, a ferramenta de WhatsApp recusa com orientação, e a conversa segue.
    expect(events[12]?.payload).toMatchObject({ name: "send_whatsapp", ok: false, message: expect.stringContaining("não tem número identificado") });

    // Custo medido como em qualquer chamada, e a fala inteira do agente chegou ao navegador.
    const spokenMs = [opening, "Um instante, por favor. Vou conferir isso com um responsável.", "Aprovado. Vou mandar os detalhes.", "Obrigada, tenha um bom dia."].map(simulatedSpeechMs).reduce((sum, ms) => sum + ms, 0);
    const cost = Math.ceil((400 + spokenMs) / 1000);
    expect(client.audioBytes).toBe((spokenMs / 20) * 320);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "end_call", cost_cents: cost, ended_at: expect.any(Date) });
    expect((await ledgerOf(app, callId)).map((row) => row.cost_cents)).toEqual([cost]);
    expect(events[16]?.payload).toMatchObject({ status: "completed", reason: "end_call", costCents: cost });
    expect((await tasksOf(app, made.organizationId)).filter((task) => task.kind === "summarize_call" && task.call_id === callId)).toHaveLength(1);

    // A conversa ficou gravada: WAV estéreo 8 kHz, com a fala do agente inteira no canal direito.
    const wav = await waitFor(() => readFile(recordingPath(path.join(scratch, "recordings"), made.organizationId, callId)).catch(() => undefined), "the recording");
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.readUInt32LE(40) / 4).toBeGreaterThanOrEqual((spokenMs / 20) * 160);
    // A impressão digital na linha do tempo é a do arquivo que ficou no disco.
    expect(events[19]?.payload).toEqual({ bytes: wav.length, sha256: createHash("sha256").update(wav).digest("hex") });

    const health = (await (await fetch(`http://127.0.0.1:${server?.internalPort}/health`)).json()) as Record<string, { status: string; detail: string }>;
    expect(health.web).toEqual({ status: "ok", detail: expect.stringContaining(String(server?.webPort)) });
    expect(health.asterisk?.status).toBe("fail");
  });

  it("aceita também o caminho raiz, para a porta publicada direto", async () => {
    const made = await scene("web-root-path", { script: [{ expectUserAudio: 100_000 }] });
    const { body } = await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });
    const client = browser(body.token, "/");
    await waitFor(() => client.messages[0], "the ready message");
    expect(client.messages[0]?.type).toBe("ready");
  });

  it("token ausente, errado, já usado ou em caminho estranho: resposta HTTP 401 ou 404, nunca 101, e a chamada não começa", async () => {
    const made = await scene("web-token", { script: [{ expectUserAudio: 100_000 }] });
    const request = async () => (await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER })).body;

    const first = await request();
    expect(await rawUpgrade(tokenRoute(undefined))).toBe("HTTP/1.1 401 Unauthorized");
    expect(await rawUpgrade(tokenRoute(""))).toBe("HTTP/1.1 401 Unauthorized");
    expect(await rawUpgrade(tokenRoute("token-inventado"))).toBe("HTTP/1.1 401 Unauthorized");
    expect(await rawUpgrade(tokenRoute(`${first.token}x`))).toBe("HTTP/1.1 401 Unauthorized");
    expect(await rawUpgrade(tokenRoute(first.token?.slice(0, -1)))).toBe("HTTP/1.1 401 Unauthorized");
    // O cliente WebSocket de verdade nem chega a abrir.
    const stranger = browser("token-inventado");
    await waitFor(() => stranger.closed !== undefined, "the socket to be refused");
    expect(stranger.closed).toBe(1006);
    expect(stranger.messages).toEqual([]);
    // Nada disso gastou o token nem começou a chamada.
    expect(await kindsOf(app, first.callId ?? "")).toEqual([]);

    // Caminho que não é o da chamada: 404, e o token nem é olhado.
    expect(await rawUpgrade(tokenRoute(first.token, "/outra-coisa"))).toBe("HTTP/1.1 404 Not Found");
    expect((await callOf(app, first.callId ?? "")).status).toBe("ringing");
    // Pedido HTTP comum, sem upgrade: aqui só se fala WebSocket.
    expect((await fetch(`http://127.0.0.1:${server?.webPort}/voice-ws`)).status).toBe(426);

    // O token vale uma vez: a segunda conexão com ele é recusada, e a primeira segue.
    const good = browser(first.token);
    await waitFor(() => good.messages[0], "the ready message");
    expect(await rawUpgrade(tokenRoute(first.token))).toBe("HTTP/1.1 401 Unauthorized");
    expect(good.closed).toBeUndefined();
    await waitFor(async () => (await kindsOf(app, first.callId ?? "")).includes("call_answered"), "the call to be answered");
    expect((await kindsOf(app, first.callId ?? "")).filter((kind) => kind === "call_started")).toHaveLength(1);

    // O token de uma chamada não abre outra: cada conexão cai na chamada do próprio token.
    const second = await request();
    const third = await request();
    const onSecond = browser(second.token);
    await waitFor(() => onSecond.messages[0], "the ready message");
    expect(onSecond.messages[0]).toEqual({ type: "ready", callId: second.callId });
    expect((await callOf(app, third.callId ?? "")).status).toBe("ringing");

    // Vencido, de quem recebeu o convite: abre e fecha com 4401, para a tela dizer que o convite
    // venceu, e a chamada dele é fechada em vez de ficar tocando.
    made.clock.advance(60_000);
    const late = browser(third.token);
    await waitFor(() => late.closed !== undefined, "the socket to be closed");
    expect(late.closed).toBe(4401);
    expect(late.messages).toEqual([]);
    expect(late.audioBytes).toBe(0);
    await waitFor(async () => (await callOf(app, third.callId ?? "")).status === "failed", "the expired call to be closed");
    expect(await callOf(app, third.callId ?? "")).toMatchObject({ status: "failed", end_reason: "web_never_connected" });
  });

  it("convite válido com handshake que não completa: a chamada fecha como nunca conectada e a vaga do teto volta", async () => {
    const made = await scene("web-bad-handshake", { script: [{ expectUserAudio: 100_000 }] });
    const ask = () => made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });
    const first = (await ask()).body;
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(409);

    // Sem `Sec-WebSocket-Key`: o token é gasto e o handshake falha.
    expect(await rawUpgrade(tokenRoute(first.token), { key: false })).toMatch(/^HTTP\/1\.1 400 /);
    await waitFor(async () => (await callOf(app, first.callId ?? "")).status === "failed", "the call to be closed");
    expect(await callOf(app, first.callId ?? "")).toMatchObject({ status: "failed", end_reason: "web_never_connected" });
    expect(await kindsOf(app, first.callId ?? "")).toEqual(["call_ended"]);
    // A vaga voltou sem esperar o prazo do token, e o token não vale mais.
    expect((await ask()).status).toBe(200);
    expect(await rawUpgrade(tokenRoute(first.token))).toBe("HTTP/1.1 401 Unauthorized");
  });

  it("nunca conectou em 60 s: a chamada é fechada como falha, com evento, uma vez só, e a vaga volta", async () => {
    const made = await scene("web-never", { script: [{ expectUserAudio: 100_000 }] });
    const ask = () => made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });
    const { body } = await ask();
    const callId = body.callId ?? "";
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(409);
    expect(made.timers.held()).toContain(60_000);
    made.clock.advance(60_000);
    expect(made.timers.fire(60_000)).toBe(3);
    await waitFor(async () => (await callOf(app, callId)).status === "failed", "the call to be closed");
    expect(await callOf(app, callId)).toMatchObject({ status: "failed", end_reason: "web_never_connected", ended_at: made.clock.now() });
    expect(await eventsOf(app, callId)).toEqual([{ kind: "call_ended", payload: { status: "failed", reason: "web_never_connected", channel: "web" } }]);
    await waitFor(async () => (await ask()).status === 200, "a slot to come back after the token expired");

    // A tela conecta depois do prazo: abre e fecha com 4401, para dizer que o convite venceu.
    const late = browser(body.token);
    await waitFor(() => late.closed !== undefined, "the socket to be closed");
    expect(late.closed).toBe(4401);
    expect(late.messages).toEqual([]);
    expect(await kindsOf(app, callId)).toEqual(["call_ended"]);
    // O convite vencido também vale uma vez só: na segunda, nem abre.
    expect(await rawUpgrade(tokenRoute(body.token))).toBe("HTTP/1.1 401 Unauthorized");
    expect(await kindsOf(app, callId)).toEqual(["call_ended"]);
  });

  it("convite vencido é lembrado por 30 min: depois disso, o upgrade nem abre", async () => {
    const made = await scene("web-forgotten", { script: [{ expectUserAudio: 100_000 }] });
    const { body } = await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });
    made.clock.advance(60_000);
    expect(made.timers.fire(60_000)).toBe(1);
    await waitFor(async () => (await callOf(app, body.callId ?? "")).status === "failed", "the call to be closed");
    expect(made.timers.held()).toContain(30 * 60_000);
    made.clock.advance(30 * 60_000);
    expect(made.timers.fire(30 * 60_000)).toBe(1);
    expect(await rawUpgrade(tokenRoute(body.token))).toBe("HTTP/1.1 401 Unauthorized");
    expect(await kindsOf(app, body.callId ?? "")).toEqual(["call_ended"]);
  });

  it("close() derruba o que estiver aberto: conexão com cabeçalho pela metade e WebSocket que não responde ao fechamento", async () => {
    const made = await scene("web-close", { script: [{ expectUserAudio: 100_000 }] });
    const { body } = await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });
    const half = await hangingConnection("GET /voice-ws HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    const open = await hangingConnection(upgradeRequest(tokenRoute(body.token)));
    await waitFor(() => open.received().startsWith("HTTP/1.1 101 "), "the WebSocket to open");
    await waitFor(async () => (await kindsOf(app, body.callId ?? "")).includes("call_answered"), "the call to be answered");

    await within(server?.close() ?? Promise.resolve(), 5_000, "close()");
    server = undefined;
    await within(Promise.all([half.closed, open.closed]), 2_000, "both connections closing");
  });

  it("navegador fecha o socket no meio de uma espera: a chamada é encerrada uma vez só, como desligamento", async () => {
    const script: SimulatedScript = [{ toolCall: { name: "request_approval", args: { question: "Pode?", context: "Contexto.", timeout_seconds: 30 } } }, { say: "Isto nunca é dito." }];
    const made = await scene("web-drop", { script });
    const { callId, client } = await call(made);
    await waitFor(async () => (await approvalsOf(app, callId)).length === 1, "the approval");
    await waitFor(async () => (await kindsOf(app, callId)).filter((kind) => kind === "transcript_agent").length === 2, "the agent to say it is checking");

    // A aba fecha ao mesmo tempo que o processo é mandado encerrar: dois pedidos de fim.
    client.socket.terminate();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_ended"), "the call to end");
    await server?.close();
    server = undefined;

    const events = await eventsOf(app, callId);
    expect(events.map((event) => event.kind)).toEqual([
      "call_started", "call_answered", "recording_notice", "transcript_agent", "tool_called", "approval_requested", "transcript_agent", "tool_result", "call_ended", "task_queued", "task_queued",
    ]);
    expect(events[8]?.payload).toMatchObject({ status: "completed", reason: "caller_hangup" });
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    expect((await tasksOf(app, made.organizationId)).filter((task) => task.kind === "summarize_call")).toHaveLength(1);
  });

  it("hangup por texto encerra a chamada e o navegador recebe ended", async () => {
    const made = await scene("web-hangup", { script: [{ expectUserAudio: 100_000 }] });
    const { callId, client } = await call(made);
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
    client.socket.send(JSON.stringify({ type: "hangup" }));
    await ended(callId);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
    expect((await kindsOf(app, callId)).filter((kind) => kind === "call_ended")).toHaveLength(1);
    await waitFor(() => client.closed !== undefined, "the socket to close");
  });

  it("interrupção do motor vira clear para a tela, e a fala pendente não é mais entregue", async () => {
    const made = await scene("web-interrupt", { engine: "manual" });
    const { callId, client } = await call(made);
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");
    // A fala e a interrupção chegam no mesmo instante, sem ceder a vez ao agendador. Esperar
    // "algum áudio" antes de interromper era uma corrida: numa máquina rápida a fala inteira já
    // tinha saído, e não sobrava nada pendente para descartar.
    made.manual.emit("audio", Buffer.alloc(320 * 500, 1));
    made.manual.emit("interrupted");
    await waitFor(() => typesOf(client).includes("clear"), "the clear message");
    const delivered = client.audioBytes;
    expect(delivered).toBeLessThan(320 * 500);
    // O que a pessoa fala chega ao motor, e a fala seguinte do agente sai normalmente.
    client.speak(60);
    await waitFor(() => made.manual.audioBytes === 960, "the caller audio at the engine");
    made.manual.emit("audio", Buffer.alloc(320, 2));
    await waitFor(() => client.audioBytes === delivered + 320, "the next speech");
    expect(typesOf(client)).toEqual(["ready", "clear"]);
  });

  it("teto de chamadas pelo navegador ao mesmo tempo, por organização: a que passa do teto é recusada e a vaga volta quando uma termina", async () => {
    const made = await scene("web-cap", { engine: "manual" });
    const otherOrganization = await createOrganization(app, "web-cap-other");
    const otherAgent = await createAgent(app, otherOrganization, { engine: "manual" });
    const ask = () => made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER });

    const first = await call(made);
    const second = await ask();
    const third = await ask();
    expect([second.status, third.status]).toEqual([200, 200]);

    const refused = await ask();
    expect(refused).toEqual({ status: 409, body: { code: "too_many_web_calls", message: expect.stringMatching(/3 .*at the same time/) } });
    // Recusada não cria chamada.
    const rows = await withSystem(app, (q) => q.many("select 1 from calls where organization_id = $1", [made.organizationId]));
    expect(rows).toHaveLength(3);
    // O teto é por organização: a outra não é afetada.
    expect((await made.post({ organizationId: otherOrganization, agentId: otherAgent, userId: USER })).status).toBe(200);

    // Uma chamada termina: a vaga volta.
    first.client.socket.send(JSON.stringify({ type: "hangup" }));
    await ended(first.callId);
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(409);

    // Um pedido que nunca conectou também devolve a vaga quando o prazo vence.
    expect(made.timers.fire(60_000)).toBeGreaterThan(0);
    await waitFor(async () => (await ask()).status === 200, "a slot to come back after the token expired");
  });

  it("transferência: fica registrada como sempre e a tela recebe ended com status transferred", async () => {
    const script: SimulatedScript = [{ say: "Vou transferir você." }, { toolCall: { name: "transfer_to_human", args: { reason: "Pediu um humano.", summary: "Quer falar com a recepção." } } }];
    const made = await scene("web-transfer", { script, transferTo: "+5531988887777" });
    const { callId, client } = await call(made);
    await ended(callId);
    await waitFor(() => client.closed !== undefined, "the socket to close");
    expect(client.messages.at(-1)).toEqual({ type: "ended", status: "transferred", reason: "transferred" });
    expect(await kindsOf(app, callId)).toContain("transfer_started");
    expect(await callOf(app, callId)).toMatchObject({ status: "transferred", end_reason: "transferred" });
  });

  it("POST /calls/web: cada recusa tem o código próprio e não cria chamada; sem o token interno, 401", async () => {
    const made = await scene("web-refusals", {});
    const other = await createOrganization(app, "web-refusals-other");
    const disabled = await createAgent(app, made.organizationId, { engine: "roteiro", enabled: false });
    const simulated = await createAgent(app, made.organizationId, { engine: "simulated" });
    const noKey = await createAgent(app, made.organizationId, { engine: "com-chave" });
    const unknownEngine = await createAgent(app, made.organizationId, { engine: "nao-instalado" });
    const ask = (agentId: string, organizationId = made.organizationId) => made.post({ organizationId, agentId, userId: USER });

    expect(await ask(made.agentId, other)).toEqual({ status: 409, body: { code: "agent_not_found", message: expect.any(String) } });
    expect(await ask(disabled)).toMatchObject({ status: 409, body: { code: "agent_disabled" } });
    expect(await ask(simulated)).toEqual({ status: 409, body: { code: "engine_simulated", message: expect.stringMatching(/simulated engine.*Change the agent's voice engine/) } });
    expect(await ask(noKey)).toMatchObject({ status: 409, body: { code: "engine_not_configured" } });
    expect(await ask(unknownEngine)).toMatchObject({ status: 409, body: { code: "engine_not_installed", message: expect.stringMatching(/not available in this installation.*Choose another voice engine/) } });
    expect((await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER }, null)).status).toBe(401);
    expect((await made.post({ organizationId: made.organizationId, agentId: made.agentId, userId: USER }, "errado")).status).toBe(401);
    expect((await made.post({ organizationId: made.organizationId, agentId: made.agentId })).status).toBe(400);
    expect(await callsOf(app, made.organizationId)).toEqual([]);
    expect(await callsOf(app, other)).toEqual([]);

    // Com a chave cadastrada, o motor que pede chave passa.
    await withSystem(app, (q) => q.exec("insert into settings (organization_id, key, value, secret) values ($1, 'engine.com-chave.api_key', $2, true)", [made.organizationId, JSON.stringify("v1:cifrado")]));
    expect((await ask(noKey)).status).toBe(200);
  });

  it("mensagem acima de 64 KB fecha com 4400, e a chamada termina como desligamento", async () => {
    const made = await scene("web-big", { script: [{ expectUserAudio: 100_000 }] });
    const { callId, client } = await call(made);
    client.socket.send(Buffer.alloc(64 * 1024 + 2), { binary: true });
    await waitFor(() => client.closed !== undefined, "the socket to be closed");
    expect(client.closed).toBe(4400);
    await ended(callId);
    expect(await callOf(app, callId)).toMatchObject({ status: "completed", end_reason: "caller_hangup" });
  });

  it("texto que não é JSON fecha com 4400; tipo desconhecido é ignorado", async () => {
    const made = await scene("web-text", { script: [{ expectUserAudio: 100_000 }] });
    const { client } = await call(made);
    client.socket.send(JSON.stringify({ type: "novidade-da-tela" }));
    client.socket.send(Buffer.alloc(320), { binary: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.closed).toBeUndefined();
    client.socket.send("isto não é JSON");
    await waitFor(() => client.closed !== undefined, "the socket to be closed");
    expect(client.closed).toBe(4400);
  });

  it("enxurrada de áudio muito acima do tempo real fecha com 4400; áudio no tempo real passa", async () => {
    const made = await scene("web-flood", { engine: "manual" });
    const { client } = await call(made);
    // 4 s de áudio de uma vez cabem na folga (rajada de rede).
    for (let i = 0; i < 4; i++) client.socket.send(Buffer.alloc(16_000), { binary: true });
    await waitFor(() => made.manual.audioBytes === 64_000, "the burst to reach the engine");
    expect(client.closed).toBeUndefined();
    // Mais 10 s sem o relógio andar: isso não é microfone.
    for (let i = 0; i < 10; i++) client.socket.send(Buffer.alloc(16_000), { binary: true });
    await waitFor(() => client.closed !== undefined, "the socket to be closed");
    expect(client.closed).toBe(4400);
    expect(made.manual.audioBytes).toBeLessThan(14 * 16_000);
  });
});
