import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import openai from "./brains/openai";
import { BRAIN_TIMEOUT_MS, createPipelineEngine, PIPELINE_BRAIN_RETRY_SPEECH, PIPELINE_FAILURE_SPEECH, TRANSCRIBER_CLOSE_MS } from "./pipeline-engine";
import { FixedSpeechCache } from "./synthesis";
import { createSimulatedSynthesizer, toneFor } from "./synthesizers/simulated";
import { createSimulatedTranscriber, type SimulatedTranscription, type SimulatedTranscriptScript } from "./transcribers/simulated";
import type { Brain, BrainChatEvents } from "./brain";
import {
  PipelineOpenError,
  PipelinePieceError,
  SynthesizerOpenError,
  TranscriberOpenError,
  type PieceUsageLine,
  type PipelineConnectOptions,
  type PipelinePieces,
  type Speech,
  type SpeechSynthesizer,
  type VoiceSession,
  type VoiceSessionConfig,
} from "./types";

// ---- o cérebro num servidor falso: a OpenAI de verdade (`brains/openai`), com o `fetch` apontado para cá ----

type Step = { data: unknown } | { hold: Promise<void> };
type Reply = { status: number; body: string } | Step[];

/** Servidor HTTP falso, porta 0, que responde SSE em pedaços. `hold` segura o resto até o teste soltar. */
async function startFakeBrain() {
  const replies: Reply[] = [];
  const requests: Array<{ messages: Array<Record<string, unknown>>; tools: unknown[] }> = [];
  const open = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    request.on("end", () => {
      const body = JSON.parse(raw) as { messages: Array<Record<string, unknown>>; tools?: unknown[] };
      requests.push({ messages: body.messages, tools: body.tools ?? [] });
      const reply = replies.shift() ?? [{ data: { choices: [{ index: 0, delta: { content: "(sem roteiro)" } }] } }];
      if (!Array.isArray(reply)) {
        response.writeHead(reply.status, { "content-type": "application/json" }).end(reply.body);
        return;
      }
      open.add(response);
      response.writeHead(200, { "content-type": "text/event-stream" });
      void (async () => {
        for (const step of reply) {
          if ("hold" in step) await step.hold;
          else response.write(`data: ${JSON.stringify(step.data)}\n\n`);
        }
        response.end("data: [DONE]\n\n");
        open.delete(response);
      })();
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
const gate = () => {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => (release = resolve));
  return { hold: { hold }, release };
};

// ---- a voz: a simulada, contada ----

/** A voz simulada, com o registro do que a sessão pediu: cada `speak`, cada texto e cada `end`. */
function countedVoice(base: SpeechSynthesizer = createSimulatedSynthesizer()) {
  const log: string[] = [];
  const speeches: Speech[] = [];
  let keyChecks = 0;
  const synthesizer: SpeechSynthesizer = {
    ...base,
    async checkKey(apiKey, options) {
      keyChecks += 1;
      return base.checkKey(apiKey, options);
    },
    async speak(config, apiKey, options) {
      const speech = await base.speak(config, apiKey, options);
      const n = speeches.push(speech);
      log.push(`open ${n}`);
      return {
        on: (event, handler) => speech.on(event, handler),
        push: (value, opts) => {
          log.push(`push ${n} ${JSON.stringify(value)}${opts?.flush ? " flush" : ""}`);
          speech.push(value, opts);
        },
        end: () => {
          log.push(`end ${n}`);
          speech.end();
        },
        cancel: () => {
          log.push(`cancel ${n}`);
          speech.cancel();
        },
      };
    },
  };
  return { synthesizer, log, opens: () => speeches.length, keyChecks: () => keyChecks };
}

// ---- a sessão ----

const ORG = "org-a";
const FRAME = Buffer.alloc(320); // 20 ms de PCM16 a 8 kHz
const config: VoiceSessionConfig = {
  instructions: "Você é a recepção da clínica.",
  language: "pt-BR",
  tools: [{ name: "agendar", description: "Marca um horário.", parameters: { type: "object", properties: { dia: { type: "string" } } } }],
};

/** Espera o que vem pela rede e pelo `setImmediate`, sem relógio: no máximo 2000 voltas do laço. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 2000; turn++) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`não aconteceu: ${what}`);
}

function record(session: VoiceSession) {
  const events: string[] = [];
  const pieceUsage: PieceUsageLine[] = [];
  const errors: Error[] = [];
  const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
  let audioBytes = 0;
  const audio: Buffer[] = [];
  session.on("transcript", (turn) => events.push(`${turn.speaker}: ${turn.text}`));
  session.on("audio", (pcm) => {
    audioBytes += pcm.length;
    audio.push(pcm);
  });
  session.on("callerActivity", () => events.push("activity"));
  session.on("callerTurnEnded", ({ source }) => events.push(`turn ended (${source})`));
  session.on("toolCall", (call) => {
    toolCalls.push(call);
    events.push(`tool ${call.name} ${JSON.stringify(call.args)}`);
  });
  session.on("pieceUsage", (line) => pieceUsage.push(line));
  session.on("error", (error) => {
    errors.push(error);
    events.push(`error ${error instanceof PipelinePieceError ? `${error.piece} ${error.reason} ${error.fatal ? "fatal" : "segue"}` : error.message}`);
  });
  session.on("closed", (reason) => events.push(`closed ${reason}`));
  return { events, pieceUsage, errors, toolCalls, audio, audioBytes: () => audioBytes };
}

/** Faz a transcrição simulada emitir um evento fora do roteiro (o `error` sozinho, o `closed` sozinho). */
function emitOn(session: SimulatedTranscription | undefined, event: "error" | "closed", value: unknown): void {
  if (!session) throw new Error("a transcrição não abriu");
  (session as unknown as { emit(event: string, value: unknown): void }).emit(event, value);
}

/** Manda `ms` de áudio de quem ligou, em quadros de 20 ms. */
function speak(session: VoiceSession, ms: number): void {
  for (let sent = 0; sent < ms; sent += 20) session.sendAudio(FRAME);
}

let brain: Awaited<ReturnType<typeof startFakeBrain>> | undefined;
afterEach(async () => {
  await brain?.stop();
  brain = undefined;
});

function piecesOf(voice: SpeechSynthesizer, script: SimulatedTranscriptScript, overrides: Partial<PipelinePieces> = {}): PipelinePieces {
  return {
    transcriber: { piece: createSimulatedTranscriber({ script }), apiKey: "" },
    brain: { piece: openai, apiKey: "chave-inventada-do-teste", model: "gpt-5-nano", price: { centsPerMillionInputTokens: 5, centsPerMillionOutputTokens: 40, source: "teste", checkedOn: "2026-11-23" } },
    synthesizer: { piece: voice, apiKey: "", voiceId: "simulated" },
    ...overrides,
  };
}

async function open(pieces: PipelinePieces, extra: Partial<PipelineConnectOptions> = {}, cache = new FixedSpeechCache()) {
  if (!brain) throw new Error("sem cérebro");
  const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: cache });
  const session = await engine.connect(config, "", { pieces, organizationId: ORG, ...extra });
  return { session, log: record(session) };
}

const THREE_TURNS: SimulatedTranscriptScript = [
  { afterAudioMs: 100, text: "Oi, bom" },
  { afterAudioMs: 200, text: "Oi, bom dia.", final: true },
  { afterAudioMs: 400, text: "Quero marcar para terça.", final: true },
  { afterAudioMs: 600, text: "Obrigado, tchau.", final: true },
];

describe("motor pipeline (fatia 3a): o aceite", () => {
  it("três turnos com uma ferramenta no meio: cada texto do cérebro vira áudio antes de a resposta chegar inteira, e cada peça emite o seu pieceUsage", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const first = gate();
    const afterTool = gate();
    const last = gate();
    brain.reply(
      [text("Bom dia! "), first.hold, text("Como posso ajudar?"), usage(30, 6)],
      [tool("c1", "agendar", '{"dia":"terça"}'), usage(40, 5)],
      [text("Marquei para terça. "), afterTool.hold, text("Mais alguma coisa?"), usage(60, 7)],
      [text("Até logo! "), last.hold, text("Obrigado pela ligação."), usage(70, 5)],
    );
    const { session, log } = await open(piecesOf(voice.synthesizer, THREE_TURNS));
    const fixedOpens = voice.opens(); // a fala de falha, preparada no connect

    // Turno 1: o parcial é atividade; o final vai ao cérebro.
    speak(session, 200);
    await until(() => voice.opens() > fixedOpens, "a voz abrir no primeiro texto do cérebro");
    await until(() => log.audioBytes() > 0, "o primeiro áudio");
    // O cérebro ainda está preso no meio da resposta, e o áudio da primeira frase já saiu.
    expect(log.audioBytes()).toBe(toneFor([..."Bom dia! "].length).length);
    expect(log.events).not.toContain("agent: Bom dia! Como posso ajudar?");
    first.release();
    await until(() => log.events.includes("agent: Bom dia! Como posso ajudar?"), "o fim da resposta 1");

    // Turno 2: o cérebro pede a ferramenta; o resultado reabre o cérebro.
    speak(session, 200);
    await until(() => log.toolCalls.length === 1, "a ferramenta");
    expect(log.toolCalls[0]).toEqual({ id: "c1", name: "agendar", args: { dia: "terça" } });
    const beforeTool = log.audioBytes();
    session.sendToolResult("c1", { ok: true, quando: "terça 10h" });
    await until(() => log.audioBytes() > beforeTool, "o áudio depois da ferramenta");
    expect(log.events).not.toContain("agent: Marquei para terça. Mais alguma coisa?");
    afterTool.release();
    await until(() => log.events.includes("agent: Marquei para terça. Mais alguma coisa?"), "o fim da resposta 2");

    // Turno 3.
    const beforeLast = log.audioBytes();
    speak(session, 200);
    await until(() => log.audioBytes() > beforeLast, "o áudio do turno 3");
    expect(log.events).not.toContain("agent: Até logo! Obrigado pela ligação.");
    last.release();
    await until(() => log.events.includes("agent: Até logo! Obrigado pela ligação."), "o fim da resposta 3");
    await until(() => log.pieceUsage.filter((line) => line.piece === "brain").length === 4, "o consumo dos 4 pedidos");
    // Cada pedaço com flush vira o tom dele; a ligação só desliga depois de a última fala tocar inteira.
    const chunks = ["Bom dia! ", "Como posso ajudar?", "Marquei para terça. ", "Mais alguma coisa?", "Até logo! ", "Obrigado pela ligação."];
    const allAudio = chunks.reduce((sum, chunk) => sum + toneFor([...chunk].length).length, 0);
    await until(() => log.audioBytes() === allAudio, "o áudio inteiro das três respostas");
    await until(() => voice.log.includes("end 4"), "o fim da última fala");
    await session.close();

    expect(log.events.filter((event) => !event.startsWith("activity"))).toEqual([
      "turn ended (transcript)",
      "user: Oi, bom dia.",
      "agent: Bom dia! Como posso ajudar?",
      "turn ended (transcript)",
      "user: Quero marcar para terça.",
      'tool agendar {"dia":"terça"}',
      "agent: Marquei para terça. Mais alguma coisa?",
      "turn ended (transcript)",
      "user: Obrigado, tchau.",
      "agent: Até logo! Obrigado pela ligação.",
      "closed client",
    ]);
    expect(log.errors).toEqual([]);

    // O histórico que o cérebro recebeu: instruções, falas, a ferramenta pedida e o resultado dela.
    expect(brain.requests).toHaveLength(4);
    expect(brain.requests[3]?.messages).toEqual([
      { role: "system", content: config.instructions },
      { role: "user", content: "Oi, bom dia." },
      { role: "assistant", content: "Bom dia! Como posso ajudar?" },
      { role: "user", content: "Quero marcar para terça." },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "agendar", arguments: '{"dia":"terça"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '{"ok":true,"quando":"terça 10h"}' },
      { role: "assistant", content: "Marquei para terça. Mais alguma coisa?" },
      { role: "user", content: "Obrigado, tchau." },
    ]);
    expect(brain.requests[0]?.tools).toHaveLength(1);

    // Cada peça emitiu o seu consumo, com o preço dela.
    const brainLines = log.pieceUsage.filter((line) => line.piece === "brain");
    expect(brainLines[0]).toEqual({ piece: "brain", id: "openai", model: "gpt-5-nano", usage: { inputTokens: 30, cachedInputTokens: 0, outputTokens: 6 }, costMicrocents: 390, estimated: false });
    const voiceLines = log.pieceUsage.filter((line) => line.piece === "synthesizer");
    expect(voiceLines[0]).toMatchObject({ piece: "synthesizer", id: "simulated", model: "simulated", characters: [...PIPELINE_FAILURE_SPEECH].length, estimated: true });
    const spoken = ["Bom dia! Como posso ajudar?", "Marquei para terça. Mais alguma coisa?", "Até logo! Obrigado pela ligação."].join("");
    expect(voiceLines.slice(1).reduce((sum, line) => sum + (line.characters ?? 0), 0)).toBe([...spoken].length);
    expect(log.pieceUsage.filter((line) => line.piece === "transcriber")).toEqual([{ piece: "transcriber", id: "simulated", usage: { seconds: 0.6 }, costMicrocents: 0, estimated: false }]);

    // A voz recebeu cada pedaço na hora, com flush no fim de frase, e cada resposta abriu e fechou a fala dela.
    expect(voice.log.filter((line) => !line.startsWith("push 1") && !line.startsWith("open 1") && !line.startsWith("end 1"))).toEqual([
      "open 2",
      'push 2 "Bom dia! " flush',
      'push 2 "Como posso ajudar?" flush',
      "end 2",
      "open 3",
      'push 3 "Marquei para terça. " flush',
      'push 3 "Mais alguma coisa?" flush',
      "end 3",
      "open 4",
      'push 4 "Até logo! " flush',
      'push 4 "Obrigado pela ligação." flush',
      "end 4",
    ]);
  });
});

describe("motor pipeline: a fala aberta e parada (inactivity_timeout)", () => {
  it("a fala só abre no primeiro texto do cérebro, fecha no fim dele, e nunca fica aberta na ferramenta", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const slow = gate();
    brain.reply([slow.hold, text("Pronto."), usage(10, 2)], [tool("c9", "agendar", "{}"), usage(10, 2)]);
    const { session, log } = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }, { afterAudioMs: 40, text: "Marca.", final: true }]));
    const fixedOpens = voice.opens();
    speak(session, 20);
    await until(() => brain?.requests.length === 1, "o pedido ao cérebro");
    // O cérebro está pensando: nenhuma fala aberta esperando por ele.
    for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(voice.opens()).toBe(fixedOpens);
    slow.release();
    await until(() => voice.log.includes(`end ${fixedOpens + 1}`), "a fala fechar no fim da resposta");
    expect(voice.opens()).toBe(fixedOpens + 1);

    // Uma volta só de ferramenta não abre fala nenhuma, e a ferramenta roda sem fala aberta.
    speak(session, 20);
    await until(() => log.toolCalls.length === 1, "a ferramenta");
    expect(voice.opens()).toBe(fixedOpens + 1);
    // O prazo do cérebro cai antes dos 20 s de inatividade da ElevenLabs.
    expect(BRAIN_TIMEOUT_MS).toBeLessThan(20_000);
    await session.close();
  });
});

describe("motor pipeline: say, guide e o fim do turno pela guarda", () => {
  it("`say` vai direto à voz, sem pedir ao cérebro; a fala fixa toca sem abrir a voz", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const farewell = "Preciso encerrar esta ligação agora.";
    const { session, log } = await open(piecesOf(voice.synthesizer, []), { fixedSpeech: [farewell] });
    const fixedOpens = voice.opens();
    expect(fixedOpens).toBe(2);
    session.say("Esta ligação é gravada.");
    await until(() => voice.log.includes(`end ${fixedOpens + 1}`), "a fala do say");
    await until(() => log.audioBytes() === toneFor([..."Esta ligação é gravada."].length).length, "o áudio do say");
    expect(brain.requests).toHaveLength(0);

    const before = log.audioBytes();
    session.say(farewell);
    await until(() => log.audioBytes() > before, "a despedida pronta");
    expect(log.audioBytes() - before).toBe(toneFor([...farewell].length).length);
    expect(voice.opens()).toBe(fixedOpens + 1);
    expect(log.events).toEqual(["agent: Esta ligação é gravada.", `agent: ${farewell}`]);
    await session.close();
  });

  it("`guide` entra como mensagem system no próximo pedido, e não vira fala", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    brain.reply([text("Certo."), usage(10, 2)]);
    const { session, log } = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]));
    session.guide?.("Quem ligou já é cliente.");
    expect(log.events).toEqual([]);
    speak(session, 20);
    await until(() => brain?.requests.length === 1, "o pedido");
    expect(brain.requests[0]?.messages).toEqual([
      { role: "system", content: config.instructions },
      { role: "user", content: "Oi." },
      { role: "system", content: "Quem ligou já é cliente." },
    ]);
    await until(() => log.events.includes("agent: Certo."), "a resposta");
    await session.close();
  });

  it("`closeCallerTurn` usa o último parcial quando a peça não manda o final, e o final atrasado igual a ele não vira outro turno", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    brain.reply([text("Pois não."), usage(10, 2)]);
    const { session, log } = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Quero falar com" }, { afterAudioMs: 40, text: "Quero falar com", final: true }]));
    expect(session.closeCallerTurn()).toBe(false);
    speak(session, 20);
    await until(() => log.events.includes("activity"), "o parcial");
    expect(session.closeCallerTurn()).toBe(true);
    await until(() => log.events.includes("agent: Pois não."), "a resposta ao parcial");
    speak(session, 20);
    for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(brain.requests).toHaveLength(1);
    expect(log.events.filter((event) => event.startsWith("user:"))).toEqual(["user: Quero falar com"]);
    await session.close();
  });

  it("o final atrasado que estende o parcial que `closeCallerTurn` usou: só o resto vira turno, e nada se perde", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    brain.reply([text("Pois não."), usage(10, 2)], [text("Vou chamar a Ana."), usage(12, 3)]);
    const { session, log } = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Quero falar com" }, { afterAudioMs: 40, text: "Quero falar com a Ana.", final: true }]));
    speak(session, 20);
    await until(() => log.events.includes("activity"), "o parcial");
    expect(session.closeCallerTurn()).toBe(true);
    speak(session, 20);
    await until(() => log.events.includes("agent: Vou chamar a Ana."), "a resposta ao resto");
    expect(log.events.filter((event) => event.startsWith("user:"))).toEqual(["user: Quero falar com", "user: a Ana."]);
    expect(brain.requests).toHaveLength(2);
    expect(brain.requests[1]?.messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual(["Quero falar com", "a Ana."]);
    await session.close();
  });
});

describe("motor pipeline: o cache das falas fixas não atravessa organizações", () => {
  it("duas organizações com o mesmo voiceId sintetizam cada uma a sua, e cada uma paga; a segunda ligação da mesma organização não paga", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const cache = new FixedSpeechCache();
    const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: cache });
    const connect = async (organizationId: string) => {
      const session = await engine.connect(config, "", { pieces: piecesOf(voice.synthesizer, []), organizationId, fixedSpeech: ["Tchau."] });
      const log = record(session);
      await new Promise((resolve) => setImmediate(resolve));
      await session.close();
      return log.pieceUsage.filter((line) => line.piece === "synthesizer").reduce((sum, line) => sum + (line.characters ?? 0), 0);
    };
    const paid = [...PIPELINE_FAILURE_SPEECH].length + [..."Tchau."].length;
    expect(await connect("org-a")).toBe(paid);
    expect(voice.opens()).toBe(2);
    expect(await connect("org-b")).toBe(paid);
    expect(voice.opens()).toBe(4);
    // A mesma organização de novo: do cache, sem fala nova e sem custo, mas com a chave conferida.
    expect(await connect("org-a")).toBe(0);
    expect(voice.opens()).toBe(4);
    expect(voice.keyChecks()).toBe(1);
  });

  it("a fala de uma organização nunca toca na outra: o áudio que cada uma ouve é o da voz dela", async () => {
    brain = await startFakeBrain();
    const cache = new FixedSpeechCache();
    // A mesma voz (`voiceId`) nas duas contas, mas cada conta devolve um áudio diferente.
    const voiceOf = (fill: number): SpeechSynthesizer => {
      const base = createSimulatedSynthesizer();
      return {
        ...base,
        async speak(c, k, o) {
          const speech = await base.speak(c, k, o);
          return {
            ...speech,
            on: (event, handler) => (event === "audio" ? speech.on("audio", (pcm) => (handler as (b: Buffer) => void)(Buffer.alloc(pcm.length, fill))) : speech.on(event, handler)),
            push: (t, f) => speech.push(t, f),
            end: () => speech.end(),
            cancel: () => speech.cancel(),
          };
        },
      };
    };
    const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: cache });
    const heard: Buffer[] = [];
    for (const [organizationId, fill] of [["org-a", 1], ["org-b", 2]] as const) {
      const session = await engine.connect(config, "", { pieces: piecesOf(voiceOf(fill), []), organizationId, fixedSpeech: ["Tchau."] });
      session.on("audio", (pcm) => heard.push(pcm));
      session.say("Tchau.");
      await until(() => heard.length === (organizationId === "org-a" ? 1 : 2), "a despedida");
      await session.close();
    }
    expect(heard[0]?.every((byte) => byte === 1)).toBe(true);
    expect(heard[1]?.every((byte) => byte === 2)).toBe(true);
  });
});

describe("motor pipeline: a falha (3.4) nunca deixa a sessão muda", () => {
  it("a transcrição que cai no meio (error e closed) toca a fala de falha pronta e vira error com a peça", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const { session, log } = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, fail: "o serviço caiu" }]));
    speak(session, 20);
    await until(() => log.events.includes("closed failed"), "o fim");
    // O `error` sozinho é aviso; o `closed` logo depois é que derruba, com o motivo dele.
    expect(log.events).toEqual(["error transcriber unreachable segue", `agent: ${PIPELINE_FAILURE_SPEECH}`, "error transcriber unreachable fatal", "closed failed"]);
    expect(log.audioBytes()).toBe(toneFor([...PIPELINE_FAILURE_SPEECH].length).length);
    expect(log.errors[1]).toMatchObject({ piece: "transcriber", pieceId: "simulated", fatal: true });
  });

  it("o error da transcrição sem closed não derruba a ligação: vira aviso, e a conversa segue", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Pois não."), usage(10, 2)]);
    const voice = countedVoice();
    let heard: SimulatedTranscription | undefined;
    const transcriber = createSimulatedTranscriber({ script: [{ afterAudioMs: 40, text: "Quero marcar.", final: true }], onSession: (opened) => (heard = opened) });
    const { session, log } = await open(piecesOf(voice.synthesizer, [], { transcriber: { piece: transcriber, apiKey: "" } }));
    emitOn(heard, "error", new TranscriberOpenError("rate_limited", "deepgram: 429 Too Many Requests"));
    speak(session, 40);
    await until(() => log.events.includes("agent: Pois não."), "a resposta depois do aviso");
    expect(log.events.filter((event) => event !== "activity")).toEqual(["error transcriber rate_limited segue", "turn ended (transcript)", "user: Quero marcar.", "agent: Pois não."]);
    expect(log.events).not.toContain("closed failed");
    expect(log.errors[0]).toMatchObject({ piece: "transcriber", reason: "rate_limited", fatal: false });
    await session.close();
  });

  it("o motivo tipado do error (TranscriberOpenError) no meio da ligação é o motivo do closed que vem depois", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    let heard: SimulatedTranscription | undefined;
    const transcriber = createSimulatedTranscriber({ script: [], onSession: (opened) => (heard = opened) });
    const { log } = await open(piecesOf(voice.synthesizer, [], { transcriber: { piece: transcriber, apiKey: "" } }));
    emitOn(heard, "error", new TranscriberOpenError("no_credit", "deepgram: quota exceeded for this project"));
    emitOn(heard, "closed", "failed");
    await until(() => log.events.includes("closed failed"), "o fim");
    expect(log.events).toEqual(["error transcriber no_credit segue", `agent: ${PIPELINE_FAILURE_SPEECH}`, "error transcriber no_credit fatal", "closed failed"]);
    // O texto do provedor fica só na mensagem, para o log.
    expect(log.errors[1]?.message).toContain("quota exceeded");
  });

  it("o closed sem error antes é fatal, com o motivo unreachable", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    let heard: SimulatedTranscription | undefined;
    const transcriber = createSimulatedTranscriber({ script: [], onSession: (opened) => (heard = opened) });
    const { log } = await open(piecesOf(voice.synthesizer, [], { transcriber: { piece: transcriber, apiKey: "" } }));
    emitOn(heard, "closed", "failed");
    await until(() => log.events.includes("closed failed"), "o fim");
    expect(log.events).toEqual([`agent: ${PIPELINE_FAILURE_SPEECH}`, "error transcriber unreachable fatal", "closed failed"]);
  });

  it("a voz que cai no meio da fala toca a fala de falha pronta, que não depende dela", async () => {
    brain = await startFakeBrain();
    // O cérebro fica preso no meio da resposta: a voz cai enquanto ele ainda fala.
    const stuck = gate();
    brain.reply([text("Vou ver isso. "), stuck.hold, text("Um instante."), usage(10, 4)]);
    const base = createSimulatedSynthesizer();
    let opened = 0;
    const breaking: SpeechSynthesizer = {
      ...base,
      async speak(c, k, o) {
        const speech = await base.speak(c, k, o);
        opened += 1;
        if (opened === 1) return speech; // a fala de falha, preparada no connect
        const handlers: Array<(error: Error) => void> = [];
        return {
          on: (event, handler) => (event === "error" ? handlers.push(handler as (error: Error) => void) : speech.on(event, handler)),
          push: () => queueMicrotask(() => handlers.forEach((handler) => handler(new SynthesizerOpenError("no_credit", "elevenlabs: quota_exceeded")))),
          end: () => undefined,
          cancel: () => speech.cancel(),
        };
      },
    };
    const { session, log } = await open(piecesOf(breaking, [{ afterAudioMs: 20, text: "Oi.", final: true }]));
    speak(session, 20);
    await until(() => log.events.includes("closed failed"), "o fim");
    expect(log.events.filter((event) => event !== "activity")).toEqual(["turn ended (transcript)", "user: Oi.", `agent: ${PIPELINE_FAILURE_SPEECH}`, "error synthesizer no_credit fatal", "closed failed"]);
    expect(log.audioBytes()).toBe(toneFor([...PIPELINE_FAILURE_SPEECH].length).length);
    expect(log.errors[0]?.message).not.toContain("chave");
  });

  it("a voz que cai: o consumo da transcrição sai antes do `closed`, mesmo quando o close() da peça só entrega depois", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Oi!"), usage(10, 1)]);
    const base = createSimulatedSynthesizer();
    let opened = 0;
    const breaking: SpeechSynthesizer = {
      ...base,
      async speak(c, k, o) {
        opened += 1;
        if (opened === 1) return base.speak(c, k, o); // a fala de falha, preparada no connect
        throw new SynthesizerOpenError("no_credit", "elevenlabs: quota_exceeded");
      },
    };
    // A peça de verdade fecha pela rede: o último consumo chega depois de o close() ser chamado.
    const transcriber = createSimulatedTranscriber({
      script: [{ afterAudioMs: 20, text: "Oi.", final: true }],
      onSession: (session) => {
        const close = session.close.bind(session);
        session.close = async () => {
          await new Promise((resolve) => setImmediate(resolve));
          await close();
        };
      },
    });
    const { session, log } = await open(piecesOf(breaking, [], { transcriber: { piece: transcriber, apiKey: "" } }));
    const order: string[] = [];
    session.on("pieceUsage", (line) => order.push(`usage ${line.piece}`));
    session.on("closed", (reason) => order.push(`closed ${reason}`));
    speak(session, 20);
    await until(() => log.events.includes("closed failed"), "o fim");
    expect(order.filter((step) => step === "usage transcriber" || step.startsWith("closed"))).toEqual(["usage transcriber", "closed failed"]);
    expect(log.pieceUsage.find((line) => line.piece === "transcriber")?.usage.seconds).toBeCloseTo(0.02);
  });

  it("a voz que cai e a transcrição que não fecha: o `closed` sai no prazo, e a sessão não fica presa", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Oi!"), usage(10, 1)]);
    const base = createSimulatedSynthesizer();
    let opened = 0;
    const breaking: SpeechSynthesizer = {
      ...base,
      async speak(c, k, o) {
        opened += 1;
        if (opened === 1) return base.speak(c, k, o);
        throw new SynthesizerOpenError("no_credit", "elevenlabs: quota_exceeded");
      },
    };
    const transcriber = createSimulatedTranscriber({
      script: [{ afterAudioMs: 20, text: "Oi.", final: true }],
      onSession: (session) => void (session.close = () => new Promise<void>(() => undefined)),
    });
    const { session, log } = await open(piecesOf(breaking, [], { transcriber: { piece: transcriber, apiKey: "" } }));
    speak(session, 20);
    await until(() => log.events.includes("error synthesizer no_credit fatal"), "a falha");
    // O `closed` espera a transcrição fechar, e ela não fecha: só o prazo solta.
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(log.events).not.toContain("closed failed");
    await new Promise((resolve) => setTimeout(resolve, TRANSCRIBER_CLOSE_MS + 200));
    expect(log.events).toContain("closed failed");
  });

  it("a voz que não abre no meio da ligação também toca a fala de falha", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Oi!"), usage(10, 1)]);
    const base = createSimulatedSynthesizer();
    let opened = 0;
    const refusing: SpeechSynthesizer = {
      ...base,
      async speak(c, k, o) {
        opened += 1;
        if (opened > 1) throw new SynthesizerOpenError("rate_limited", "elevenlabs: 429");
        return base.speak(c, k, o);
      },
    };
    const { session, log } = await open(piecesOf(refusing, [{ afterAudioMs: 20, text: "Oi.", final: true }]));
    speak(session, 20);
    await until(() => log.events.includes("closed failed"), "o fim");
    expect(log.events.slice(-3)).toEqual([`agent: ${PIPELINE_FAILURE_SPEECH}`, "error synthesizer rate_limited fatal", "closed failed"]);
    expect(log.audioBytes()).toBe(toneFor([...PIPELINE_FAILURE_SPEECH].length).length);
  });

  it("o cérebro que falha uma vez pede para repetir e a conversa segue; duas vezes seguidas, a fala de falha", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    brain.reply({ status: 500, body: "{}" }, { status: 503, body: "{}" });
    const { session, log } = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }, { afterAudioMs: 40, text: "Oi?", final: true }]));
    speak(session, 20);
    await until(() => log.events.includes(`agent: ${PIPELINE_BRAIN_RETRY_SPEECH}`), "o pedido de repetir");
    await until(() => log.audioBytes() === toneFor([...PIPELINE_BRAIN_RETRY_SPEECH].length).length, "o áudio do pedido de repetir");
    expect(log.events).toContain("error brain provider_error segue");
    expect(log.events).not.toContain("closed failed");
    speak(session, 20);
    await until(() => log.events.includes("closed failed"), "o fim");
    expect(log.events.slice(-3)).toEqual([`agent: ${PIPELINE_FAILURE_SPEECH}`, "error brain provider_error fatal", "closed failed"]);
    // A recusa HTTP não foi cobrada: o zero dela é medido.
    expect(log.pieceUsage.filter((line) => line.piece === "brain")).toEqual([
      { piece: "brain", id: "openai", model: "gpt-5-nano", usage: {}, costMicrocents: 0, estimated: false },
      { piece: "brain", id: "openai", model: "gpt-5-nano", usage: {}, costMicrocents: 0, estimated: false },
    ]);
  });

  it("um sucesso entre duas falhas do cérebro zera a conta: só falhas seguidas encerram", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    brain.reply({ status: 500, body: "{}" }, [text("Agora sim."), usage(10, 2)], { status: 500, body: "{}" });
    const script: SimulatedTranscriptScript = [1, 2, 3].map((n) => ({ afterAudioMs: n * 20, text: `Fala ${n}.`, final: true }));
    const { session, log } = await open(piecesOf(voice.synthesizer, script));
    for (const expected of [1, 2, 3]) {
      speak(session, 20);
      await until(() => brain?.requests.length === expected && log.events.filter((event) => event.startsWith("agent:")).length === expected, `a resposta ${expected}`);
    }
    expect(log.events).not.toContain("closed failed");
    expect(log.events.filter((event) => event.startsWith("error"))).toEqual(["error brain provider_error segue", "error brain provider_error segue"]);
    await session.close();
  });

  it("cérebro sem preço conhecido: a linha sai sem custo, nunca zero", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    brain.reply([text("Oi."), usage(10, 2)]);
    const pieces = piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]);
    const { session, log } = await open({ ...pieces, brain: { ...pieces.brain, price: undefined } });
    speak(session, 20);
    await until(() => log.pieceUsage.some((line) => line.piece === "brain"), "o consumo");
    const line = log.pieceUsage.find((each) => each.piece === "brain");
    expect(line).toEqual({ piece: "brain", id: "openai", model: "gpt-5-nano", usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 }, estimated: false });
    expect(line && "costMicrocents" in line).toBe(false);
    await session.close();
  });

  it("consumo não declarado ({}) num pedido que terminou, com preço conhecido: a linha sai estimada pelos bytes, nunca zero", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    // Um cérebro que termina sem declarar consumo, como a Anthropic com escrita em cache.
    const silent: Brain = {
      ...openai,
      chat() {
        const handlers: Partial<{ [K in keyof BrainChatEvents]: BrainChatEvents[K] }> = {};
        setImmediate(() => {
          handlers.text?.("Olá!");
          handlers.usage?.({}, false);
          handlers.done?.();
        });
        return { on: (event, handler) => void Object.assign(handlers, { [event]: handler }), cancel: () => undefined };
      },
    };
    const pieces = piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]);
    const { session, log } = await open({ ...pieces, brain: { ...pieces.brain, piece: silent } });
    speak(session, 20);
    await until(() => log.pieceUsage.some((line) => line.piece === "brain"), "o consumo");
    const line = log.pieceUsage.find((each) => each.piece === "brain");
    expect(line?.estimated).toBe(true);
    expect(line?.usage.inputTokens).toBeGreaterThan(0);
    expect(line?.usage.outputTokens).toBe(Buffer.byteLength("Olá!", "utf8"));
    expect(line?.costMicrocents).toBeGreaterThan(0);
    await session.close();
  });
});

describe("motor pipeline: a abertura", () => {
  it("sem as peças, recusa abrir: o pipeline não tem peça padrão", async () => {
    const engine = createPipelineEngine();
    await expect(engine.connect(config, "")).rejects.toThrow(/PipelineConnectOptions/);
    expect(engine.id).toBe("pipeline");
    expect(await engine.checkKey("")).toEqual({ result: "not_needed" });
  });

  it("a voz que recusa abrir na abertura é recusa de abertura, e a transcrição já aberta é fechada", async () => {
    brain = await startFakeBrain();
    const base = createSimulatedSynthesizer();
    const refusing: SpeechSynthesizer = { ...base, speak: async () => Promise.reject(new SynthesizerOpenError("rejected", "elevenlabs: 401")) };
    const closed: string[] = [];
    const transcriber = createSimulatedTranscriber({ script: [], onSession: (s) => s.on("closed", (reason) => closed.push(reason)) });
    const pieces = piecesOf(refusing, [], { transcriber: { piece: transcriber, apiKey: "" } });
    const refused = open(pieces);
    await expect(refused).rejects.toBeInstanceOf(PipelineOpenError);
    await expect(refused).rejects.toMatchObject({ piece: "synthesizer", pieceId: "simulated", reason: "rejected", spent: [] });
    expect(closed).toEqual(["client"]);
  });

  it("a transcrição que recusa abrir é recusa de abertura, e o custo das falas fixas já sintetizadas vai junto", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const pieces = piecesOf(voice.synthesizer, [], { transcriber: { piece: createSimulatedTranscriber({ refuse: "no_credit" }), apiKey: "" } });
    const refused = open(pieces, { fixedSpeech: ["Tchau."] });
    await expect(refused).rejects.toMatchObject({ piece: "transcriber", reason: "no_credit" });
    const error = (await refused.catch((caught: unknown) => caught)) as PipelineOpenError;
    const characters = [...PIPELINE_FAILURE_SPEECH].length + [..."Tchau."].length;
    expect(error.spent).toEqual([{ piece: "synthesizer", id: "simulated", model: voice.synthesizer.defaultModel, usage: {}, characters, costMicrocents: expect.any(Number), estimated: true }]);
    expect(error.message).not.toContain("chave");
  });

  it("a saudação sai pela voz, sem pedir ao cérebro", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: new FixedSpeechCache() });
    const session = await engine.connect({ ...config, greeting: "Clínica Boa Vista, bom dia." }, "", { pieces: piecesOf(voice.synthesizer, []), organizationId: ORG });
    const log = record(session);
    await until(() => log.audioBytes() === toneFor([..."Clínica Boa Vista, bom dia."].length).length, "a saudação");
    expect(log.events).toEqual(["agent: Clínica Boa Vista, bom dia."]);
    expect(brain.requests).toHaveLength(0);
    await session.close();
  });
});
