import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import openai from "../brains/openai";
import { BRAIN_TIMEOUT_MS, createPipelineEngine, PIPELINE_BRAIN_MAX_TOKENS, PIPELINE_BRAIN_RETRY_SPEECH, PIPELINE_FAILURE_SPEECH, PIPELINE_TRANSFER_SPEECH, TRANSCRIBER_CLOSE_MS } from "./pipeline";
import { FixedSpeechCache } from "../synthesis";
import { createSimulatedSynthesizer, toneFor } from "../synthesizers/simulated";
import { createSimulatedTranscriber, type SimulatedTranscription, type SimulatedTranscriptScript } from "../transcribers/simulated";
import type { Brain, BrainChatEvents } from "../brain";
import {
  KEY_CHECK_RESULTS,
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
} from "../types";

// ---- o cérebro num servidor falso: a OpenAI de verdade (`brains/openai`), com o `fetch` apontado para cá ----

type Step = { data: unknown } | { hold: Promise<void> };
type Reply = { status: number; body: string } | Step[];

/** Servidor HTTP falso, porta 0, que responde SSE em pedaços. `hold` segura o resto até o teste soltar. */
async function startFakeBrain() {
  const replies: Reply[] = [];
  const requests: Array<{ messages: Array<Record<string, unknown>>; tools: unknown[]; maxCompletionTokens: unknown }> = [];
  const open = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    request.on("end", () => {
      const body = JSON.parse(raw) as { messages: Array<Record<string, unknown>>; tools?: unknown[]; max_completion_tokens?: unknown };
      requests.push({ messages: body.messages, tools: body.tools ?? [], maxCompletionTokens: body.max_completion_tokens });
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

describe("motor pipeline (fatia 3b-2): o pior caso antes de cada pedido ao cérebro", () => {
  const FAREWELL = "Preciso encerrar esta ligação agora.";
  /** O pior caso do primeiro pedido: a entrada (instruções e a fala, mais as ferramentas, um token por byte) e os 4 096 de saída, a 5 e 40 ¢/M. */
  const firstWorst = (heard: string): number => {
    const input =
      Buffer.byteLength(JSON.stringify([{ role: "system", content: config.instructions }, { role: "user", content: heard }]), "utf8") +
      Buffer.byteLength(JSON.stringify(config.tools), "utf8");
    return input * 5 + PIPELINE_BRAIN_MAX_TOKENS * 40;
  };
  /** Um teto que quem abre controla: o que sobra, e quem pediu a despedida (que toca por `say`, como o `reachCeiling`). */
  const ceilingOf = (remaining: () => number | undefined, onReached: (worst: number | undefined) => void) => ({ remainingMicrocents: remaining, reached: onReached });

  it("o pedido leva o teto de saída do motor (`max_completion_tokens` = 4 096 na OpenAI)", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Oi."), usage(10, 2)]);
    const { session, log } = await open(piecesOf(countedVoice().synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]));
    speak(session, 20);
    await until(() => log.pieceUsage.some((line) => line.piece === "brain"), "o consumo");
    expect(brain.requests[0]?.maxCompletionTokens).toBe(PIPELINE_BRAIN_MAX_TOKENS);
    await session.close();
  });

  it("pior caso acima do que sobra do teto: o pedido não sai, e a despedida toca pronta, sem síntese nova", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const worst = firstWorst("Oi.");
    const reached: Array<number | undefined> = [];
    // A despedida toca pela própria sessão, como o `reachCeiling` da sessão de ligação faz.
    const holder: { session?: VoiceSession } = {};
    const opened = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]), {
      fixedSpeech: [FAREWELL],
      ceiling: ceilingOf(
        () => worst - 1,
        (value) => {
          reached.push(value);
          holder.session?.say(FAREWELL);
        },
      ),
    });
    const session = opened.session;
    holder.session = session;
    const opensAfterOpening = voice.opens();
    speak(session, 20);
    await until(() => reached.length === 1, "a despedida pedida");
    await until(() => opened.log.audioBytes() === toneFor([...FAREWELL].length).length, "o áudio da despedida");
    expect(reached).toEqual([worst]);
    expect(brain.requests).toHaveLength(0);
    expect(voice.opens()).toBe(opensAfterOpening);
    expect(opened.log.pieceUsage.filter((line) => line.piece === "brain")).toEqual([]);
    expect(opened.log.events).toEqual(["activity", "turn ended (transcript)", "user: Oi.", `agent: ${FAREWELL}`]);
    await session.close();
  });

  it("pior caso igual ao que sobra: o pedido sai", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Oi."), usage(10, 2)]);
    const worst = firstWorst("Oi.");
    const reached: Array<number | undefined> = [];
    const { session, log } = await open(piecesOf(countedVoice().synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]), {
      ceiling: ceilingOf(() => worst, (value) => reached.push(value)),
    });
    speak(session, 20);
    await until(() => log.pieceUsage.some((line) => line.piece === "brain"), "o consumo");
    expect(brain.requests).toHaveLength(1);
    expect(reached).toEqual([]);
    await session.close();
  });

  it("a volta da ferramenta também confere: o teto que acabou no meio não deixa o segundo pedido sair", async () => {
    brain = await startFakeBrain();
    brain.reply([tool("c1", "agendar", '{"dia":"terça"}'), usage(10, 2)]);
    let remaining = Number.MAX_SAFE_INTEGER;
    const reached: Array<number | undefined> = [];
    const { session, log } = await open(piecesOf(countedVoice().synthesizer, [{ afterAudioMs: 20, text: "Quero terça.", final: true }]), {
      ceiling: ceilingOf(() => remaining, (value) => reached.push(value)),
    });
    speak(session, 20);
    await until(() => log.toolCalls.length === 1, "a ferramenta");
    remaining = 0;
    session.sendToolResult("c1", { ok: true });
    await until(() => reached.length === 1, "a recusa do segundo pedido");
    expect(brain.requests).toHaveLength(1);
    expect(reached[0]).toBeGreaterThan(0);
    await session.close();
  });

  it("com teto e sem preço do cérebro, o pior caso não tem conta: o pedido não sai", async () => {
    brain = await startFakeBrain();
    const reached: Array<number | undefined> = [];
    const pieces = piecesOf(countedVoice().synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]);
    const { session } = await open({ ...pieces, brain: { ...pieces.brain, price: undefined } }, { ceiling: ceilingOf(() => Number.MAX_SAFE_INTEGER, (value) => reached.push(value)) });
    speak(session, 20);
    await until(() => reached.length === 1, "a recusa");
    expect(reached).toEqual([undefined]);
    expect(brain.requests).toHaveLength(0);
    await session.close();
  });

  it("sem teto (`remainingMicrocents` indefinido), nada é conferido, e o pedido sai", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Oi."), usage(10, 2)]);
    const reached: Array<number | undefined> = [];
    const { session, log } = await open(piecesOf(countedVoice().synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]), {
      ceiling: ceilingOf(() => undefined, (value) => reached.push(value)),
    });
    speak(session, 20);
    await until(() => log.pieceUsage.some((line) => line.piece === "brain"), "o consumo");
    expect(brain.requests).toHaveLength(1);
    expect(reached).toEqual([]);
    await session.close();
  });

  it("o motivo da peça sem preço (`pipeline_piece_unpriced`) fica fora do vocabulário da chave", () => {
    expect(KEY_CHECK_RESULTS).not.toContain("pipeline_piece_unpriced");
    expect(KEY_CHECK_RESULTS).toHaveLength(10);
  });
});

// ---- 3c-1: a latência por turno e a nota da abertura, pelo relógio de quem abre ----

/** O relógio falso da sessão (convenção 10): só anda quando o teste manda. */
function manualClock(start = Date.UTC(2026, 10, 24, 12, 0, 0)) {
  let now = start;
  return { clock: { now: () => new Date(now) }, advance: (ms: number) => void (now += ms), at: () => now - start };
}

/**
 * As peças com atrasos conhecidos: a voz anda `voiceMs` no relógio antes do primeiro áudio de cada
 * fala armada, e a transcrição é manual (o teste emite o trecho, com ou sem `endMs`).
 */
function timedPieces(clock: ReturnType<typeof manualClock>, options: { voiceMs: number }) {
  const armed = { voice: false };
  const voice = countedVoice(
    createSimulatedSynthesizer((task) =>
      setImmediate(() => {
        if (armed.voice) {
          armed.voice = false;
          clock.advance(options.voiceMs);
        }
        task();
      }),
    ),
  );
  const sessions: SimulatedTranscription[] = [];
  const transcriber = createSimulatedTranscriber({ script: [], onSession: (session) => sessions.push(session) });
  const heard = (piece: { text: string; final: boolean; endMs?: number }): void => {
    const session = sessions[0];
    if (!session) throw new Error("a transcrição não abriu");
    (session as unknown as { emit(event: string, value: unknown): void }).emit("piece", { alternatives: [], ...piece });
  };
  return { voice, transcriber, heard, armVoice: () => void (armed.voice = true) };
}

function latencies(session: VoiceSession) {
  const seen: Array<Record<string, unknown>> = [];
  session.on("pipelineTurnLatency", (latency) => seen.push({ ...latency }));
  return seen;
}

describe("motor pipeline (fatia 3c-1): a latência por turno, no relógio da sessão", () => {
  it("os números exatos com atrasos conhecidos: 300 ms até o trecho final, 500 ms do cérebro, 200 ms da voz", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();
    const pieces = timedPieces(clock, { voiceMs: 200 });
    const thinking = gate();
    // Dois pedaços de texto, dois pedaços de áudio: só o primeiro fecha o turno.
    brain.reply([thinking.hold, text("Bom dia, "), text("pois não."), usage(10, 4)]);
    const { session, log } = await open(piecesOf(pieces.voice.synthesizer, [], { transcriber: { piece: pieces.transcriber, apiKey: "" } }), { clock: clock.clock });
    const seen = latencies(session);
    // O zero do fluxo é o primeiro áudio mandado à transcrição.
    speak(session, 20);
    // A fala acabou aos 100 ms do fluxo; o trecho final chega 300 ms depois.
    clock.advance(400);
    pieces.heard({ text: "Oi, bom dia.", final: true, endMs: 100 });
    await until(() => brain?.requests.length === 1, "o pedido ao cérebro");
    clock.advance(500);
    pieces.armVoice();
    thinking.release();
    await until(() => seen.length === 1, "a latência do turno");
    expect(seen).toEqual([{ endpointMs: 300, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 1000, endFromArrival: false, tool: false }]);
    // Sai uma vez por turno: o resto do áudio da mesma resposta não emite de novo.
    await until(() => log.events.includes("agent: Bom dia, pois não."), "o fim da resposta");
    await until(() => log.audio.length === 2, "os dois pedaços de áudio da resposta");
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toHaveLength(1);
    await session.close();
  });

  it("sem `endMs`, o fim da fala é a chegada do trecho: endpointMs 0 e endFromArrival; com `endMs`, nunca a marca", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();
    const pieces = timedPieces(clock, { voiceMs: 200 });
    brain.reply([text("Pois não."), usage(10, 2)], [text("Claro."), usage(10, 2)]);
    const { session } = await open(piecesOf(pieces.voice.synthesizer, [], { transcriber: { piece: pieces.transcriber, apiKey: "" } }), { clock: clock.clock });
    const seen = latencies(session);
    speak(session, 20);
    clock.advance(400);
    pieces.armVoice();
    pieces.heard({ text: "Oi.", final: true });
    await until(() => seen.length === 1, "a latência do turno 1");
    expect(seen[0]).toEqual({ endpointMs: 0, brainFirstTextMs: 0, voiceFirstAudioMs: 200, totalMs: 200, endFromArrival: true, tool: false });
    clock.advance(1000);
    pieces.armVoice();
    pieces.heard({ text: "Quero marcar.", final: true, endMs: 1300 });
    await until(() => seen.length === 2, "a latência do turno 2");
    // O fluxo começou no zero; o relógio está em 1 600 ms (400 + 200 da voz + 1 000): 1 300 ms do fluxo é 300 ms antes da chegada.
    expect(seen[1]).toEqual({ endpointMs: 300, brainFirstTextMs: 0, voiceFirstAudioMs: 200, totalMs: 500, endFromArrival: false, tool: false });
    await session.close();
  });

  it("o `endMs` que cairia depois da chegada (relógio do serviço adiantado) não dá número negativo: vale a chegada", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();
    const pieces = timedPieces(clock, { voiceMs: 0 });
    brain.reply([text("Pois não."), usage(10, 2)]);
    const { session } = await open(piecesOf(pieces.voice.synthesizer, [], { transcriber: { piece: pieces.transcriber, apiKey: "" } }), { clock: clock.clock });
    const seen = latencies(session);
    speak(session, 20);
    clock.advance(100);
    pieces.heard({ text: "Oi.", final: true, endMs: 900 });
    await until(() => seen.length === 1, "a latência do turno");
    expect(seen[0]).toMatchObject({ endpointMs: 0, endFromArrival: true, totalMs: 0 });
    await session.close();
  });

  it("o turno com ferramenta sai uma vez, com o tempo até o primeiro áudio da resposta, e `tool: true`", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();
    const pieces = timedPieces(clock, { voiceMs: 200 });
    const thinking = gate();
    brain.reply([tool("c1", "agendar", '{"dia":"terça"}'), usage(40, 5)], [thinking.hold, text("Marquei para terça."), usage(60, 7)]);
    const { session, log } = await open(piecesOf(pieces.voice.synthesizer, [], { transcriber: { piece: pieces.transcriber, apiKey: "" } }), { clock: clock.clock });
    const seen = latencies(session);
    speak(session, 20);
    clock.advance(400);
    pieces.heard({ text: "Quero marcar para terça.", final: true, endMs: 100 });
    await until(() => log.toolCalls.length === 1, "a ferramenta");
    // A ferramenta leva 1 000 ms; o segundo pedido, 500 até o primeiro texto; a voz, 200.
    clock.advance(1000);
    session.sendToolResult("c1", { ok: true });
    await until(() => brain?.requests.length === 2, "o pedido depois da ferramenta");
    clock.advance(500);
    pieces.armVoice();
    thinking.release();
    await until(() => seen.length === 1, "a latência do turno");
    expect(seen).toEqual([{ endpointMs: 300, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 2000, endFromArrival: false, tool: true }]);
    await until(() => log.events.includes("agent: Marquei para terça."), "o fim da resposta");
    expect(seen).toHaveLength(1);
    await session.close();
  });

  it("o turno que não toca a resposta não emite: o cérebro que falhou (o pedido de repetir não é resposta), o teto, a resposta vazia e a ligação que acabou", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();
    const pieces = timedPieces(clock, { voiceMs: 200 });
    const never = gate();
    brain.reply({ status: 500, body: "{}" }, [usage(10, 0)], [never.hold, text("Isto não chega a tocar.")]);
    const { session, log } = await open(piecesOf(pieces.voice.synthesizer, [], { transcriber: { piece: pieces.transcriber, apiKey: "" } }), { clock: clock.clock });
    const seen = latencies(session);
    speak(session, 20);
    clock.advance(400);
    pieces.heard({ text: "Oi.", final: true, endMs: 100 });
    await until(() => log.events.includes(`agent: ${PIPELINE_BRAIN_RETRY_SPEECH}`), "o pedido de repetir");
    await until(() => log.audioBytes() === toneFor([...PIPELINE_BRAIN_RETRY_SPEECH].length).length, "o áudio do pedido de repetir");
    // A resposta vazia: o pedido termina sem texto, e nada toca.
    pieces.heard({ text: "Oi?", final: true, endMs: 200 });
    await until(() => log.pieceUsage.filter((line) => line.piece === "brain").length === 2, "a resposta vazia");
    // A ligação que acaba com o cérebro no meio.
    pieces.heard({ text: "Alô?", final: true, endMs: 300 });
    await until(() => brain?.requests.length === 3, "o terceiro pedido");
    await session.close();
    never.release();
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual([]);
  });

  it("o teto que barra o pedido: nenhum número, e a despedida pronta não é resposta", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();
    const pieces = timedPieces(clock, { voiceMs: 200 });
    const holder: { session?: VoiceSession } = {};
    const opened = await open(piecesOf(pieces.voice.synthesizer, [], { transcriber: { piece: pieces.transcriber, apiKey: "" } }), {
      clock: clock.clock,
      fixedSpeech: ["Tchau."],
      ceiling: { remainingMicrocents: () => 0, reached: () => holder.session?.say("Tchau.") },
    });
    holder.session = opened.session;
    const seen = latencies(opened.session);
    speak(opened.session, 20);
    clock.advance(400);
    pieces.heard({ text: "Oi.", final: true, endMs: 100 });
    await until(() => opened.log.audioBytes() === toneFor([..."Tchau."].length).length, "a despedida");
    expect(brain.requests).toHaveLength(0);
    expect(seen).toEqual([]);
    await opened.session.close();
  });

  it("sem relógio, o motor não mede: nenhum evento de latência e nenhuma nota da abertura", async () => {
    brain = await startFakeBrain();
    brain.reply([text("Oi."), usage(10, 2)]);
    const { session, log } = await open(piecesOf(countedVoice().synthesizer, [{ afterAudioMs: 20, text: "Oi.", final: true }]));
    const seen = latencies(session);
    speak(session, 20);
    await until(() => log.events.includes("agent: Oi."), "a resposta");
    await until(() => log.audioBytes() > 0, "o áudio");
    expect(seen).toEqual([]);
    expect(session.opening).toBeUndefined();
    await session.close();
  });
});

describe("motor pipeline (fatia 3c-1): a nota da abertura", () => {
  it("sem cache, a síntese prova a chave da voz (sem conferência à parte); com cache, a conferência roda, e o tempo dela aparece", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();
    const armed = { voice: false };
    const base = createSimulatedSynthesizer((task) =>
      setImmediate(() => {
        if (armed.voice) {
          armed.voice = false;
          clock.advance(100);
        }
        task();
      }),
    );
    const voice = countedVoice({
      ...base,
      async checkKey(apiKey, options) {
        await Promise.resolve();
        clock.advance(70);
        return base.checkKey(apiKey, options);
      },
    });
    // A transcrição abre quando o teste solta, depois de o relógio andar.
    let release = (): void => undefined;
    const ear = createSimulatedTranscriber({ script: [] });
    const transcriber = { ...ear, connect: async (...args: Parameters<typeof ear.connect>) => (await new Promise<void>((resolve) => (release = resolve)), ear.connect(...args)) };
    const cache = new FixedSpeechCache();
    const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: cache });
    const connect = async (transcriberAfterMs: number) => {
      const connecting = engine.connect(config, "", { pieces: piecesOf(voice.synthesizer, [], { transcriber: { piece: transcriber, apiKey: "" } }), organizationId: ORG, fixedSpeech: ["Tchau."], clock: clock.clock });
      // As falas prontas acabam primeiro; a transcrição abre `transcriberAfterMs` depois do começo.
      for (let turn = 0; turn < 30; turn++) await new Promise((resolve) => setImmediate(resolve));
      clock.advance(transcriberAfterMs - clock.at());
      release();
      const session = await connecting;
      await session.close();
      return session.opening;
    };

    armed.voice = true;
    const fresh = await connect(150);
    expect(fresh).toEqual({ transcriberMs: 150, fixedSpeechMs: 100, keyCheckMs: null, fixedSpeech: 2, fromCache: 0, totalMs: 150 });
    expect(voice.keyChecks()).toBe(0);

    const before = clock.at();
    const cached = await connect(before + 100);
    expect(cached).toEqual({ transcriberMs: 100, fixedSpeechMs: 70, keyCheckMs: 70, fixedSpeech: 2, fromCache: 2, totalMs: 100 });
    expect(voice.keyChecks()).toBe(1);
  });
});

// ---- 3c-2: a marca `tool` pela origem do texto, e a fala de transferência pronta ----

describe("motor pipeline (fatia 3c-2): a marca `tool` sai da origem do texto que deu o primeiro áudio", () => {
  it("nas duas ordens, com o relógio falso: a fala antes da ferramenta é `tool: false` mesmo com o áudio depois da rodada; a ferramenta antes da fala é `tool: true`, com a ferramenta no total", async () => {
    brain = await startFakeBrain();
    const clock = manualClock();

    // 1. O cérebro fala e depois pede a ferramenta. O áudio dessa fala fica preso até a ferramenta ter
    // sido pedida (a rodada acabou): a ordem que, antes, virava `tool: true`.
    const held: Array<() => void> = [];
    const gateVoice = { closed: false };
    const voice = countedVoice(createSimulatedSynthesizer((task) => (gateVoice.closed ? held.push(task) : setImmediate(task))));
    const sessions: SimulatedTranscription[] = [];
    const transcriber = createSimulatedTranscriber({ script: [], onSession: (session) => sessions.push(session) });
    const thinking = gate();
    brain.reply([thinking.hold, text("Vou ver a agenda. "), tool("c1", "agendar", '{"dia":"terça"}'), usage(40, 5)], [text("Marquei para terça."), usage(60, 7)]);
    const first = await open(piecesOf(voice.synthesizer, [], { transcriber: { piece: transcriber, apiKey: "" } }), { clock: clock.clock });
    const seenFirst = latencies(first.session);
    speak(first.session, 20);
    clock.advance(400);
    (sessions[0] as unknown as { emit(event: string, value: unknown): void }).emit("piece", { text: "Quero marcar para terça.", final: true, endMs: 100, alternatives: [] });
    await until(() => brain?.requests.length === 1, "o pedido ao cérebro");
    gateVoice.closed = true;
    clock.advance(500);
    thinking.release();
    await until(() => first.log.toolCalls.length === 1, "a ferramenta pedida");
    expect(seenFirst).toEqual([]);
    // O áudio da fala de antes da ferramenta chega 200 ms depois do primeiro texto, e já com a rodada acabada.
    clock.advance(200);
    gateVoice.closed = false;
    for (const task of held.splice(0)) setImmediate(task);
    await until(() => seenFirst.length === 1, "a latência do turno com a fala antes da ferramenta");
    expect(seenFirst).toEqual([{ endpointMs: 300, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 1000, endFromArrival: false, tool: false }]);
    // A resposta depois da ferramenta é o mesmo turno: não emite de novo.
    clock.advance(1000);
    first.session.sendToolResult("c1", { ok: true });
    await until(() => first.log.events.includes("agent: Marquei para terça."), "a resposta depois da ferramenta");
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(seenFirst).toHaveLength(1);
    await first.session.close();

    // 2. A ferramenta antes de qualquer fala: o primeiro áudio vem do pedido que reabriu o cérebro.
    const pieces = timedPieces(clock, { voiceMs: 200 });
    const answering = gate();
    brain.reply([tool("c2", "agendar", '{"dia":"quarta"}'), usage(40, 5)], [answering.hold, text("Marquei para quarta."), usage(60, 7)]);
    const second = await open(piecesOf(pieces.voice.synthesizer, [], { transcriber: { piece: pieces.transcriber, apiKey: "" } }), { clock: clock.clock });
    const seenSecond = latencies(second.session);
    speak(second.session, 20);
    clock.advance(400);
    pieces.heard({ text: "E quarta?", final: true, endMs: 100 });
    await until(() => second.log.toolCalls.length === 1, "a ferramenta");
    clock.advance(1000);
    second.session.sendToolResult("c2", { ok: true });
    await until(() => brain?.requests.length === 4, "o pedido depois da ferramenta");
    clock.advance(500);
    pieces.armVoice();
    answering.release();
    await until(() => seenSecond.length === 1, "a latência do turno com a ferramenta antes da fala");
    // O total vai do fim da fala ao primeiro áudio: 300 + 1 000 da ferramenta + 500 + 200.
    expect(seenSecond).toEqual([{ endpointMs: 300, brainFirstTextMs: 500, voiceFirstAudioMs: 200, totalMs: 2000, endFromArrival: false, tool: true }]);
    await second.session.close();
  });
});

describe("motor pipeline (fatia 3c-2): a fala de transferência pronta", () => {
  it("com `transferOnFailure`, a fala de transferência fica pronta no lugar da de falha e toca na queda; sem, nada muda e ela nunca é sintetizada", async () => {
    brain = await startFakeBrain();
    const run = async (transferOnFailure: boolean | undefined) => {
      const voice = countedVoice();
      const { session, log } = await open(piecesOf(voice.synthesizer, [{ afterAudioMs: 20, fail: "o serviço caiu" }]), transferOnFailure === undefined ? {} : { transferOnFailure });
      await new Promise((resolve) => setImmediate(resolve));
      const pushedAtOpen = voice.log.filter((line) => line.startsWith("push"));
      const opensAtOpen = voice.opens();
      speak(session, 20);
      await until(() => log.events.includes("closed failed"), "o fim");
      // A queda não pede nada à voz: a fala já estava pronta.
      expect(voice.opens()).toBe(opensAtOpen);
      const charged = log.pieceUsage.filter((line) => line.piece === "synthesizer").reduce((sum, line) => sum + (line.characters ?? 0), 0);
      return { events: log.events, audioBytes: log.audioBytes(), pushedAtOpen, opensAtOpen, charged };
    };
    const transfers = await run(true);
    expect(transfers.events).toEqual(["error transcriber unreachable segue", `agent: ${PIPELINE_TRANSFER_SPEECH}`, "error transcriber unreachable fatal", "closed failed"]);
    expect(transfers.audioBytes).toBe(toneFor([...PIPELINE_TRANSFER_SPEECH].length).length);
    expect(transfers.pushedAtOpen).toEqual([`push 1 ${JSON.stringify(PIPELINE_TRANSFER_SPEECH)} flush`]);
    // O custo dela entra no consumo da voz, como o das outras falas prontas.
    expect(transfers.charged).toBe([...PIPELINE_TRANSFER_SPEECH].length);
    for (const without of [await run(false), await run(undefined)]) {
      expect(without.events).toEqual(["error transcriber unreachable segue", `agent: ${PIPELINE_FAILURE_SPEECH}`, "error transcriber unreachable fatal", "closed failed"]);
      expect(without.pushedAtOpen).toEqual([`push 1 ${JSON.stringify(PIPELINE_FAILURE_SPEECH)} flush`]);
      expect(without.opensAtOpen).toBe(1);
      expect(without.charged).toBe([...PIPELINE_FAILURE_SPEECH].length);
    }
  });

  it("o cache da fala de transferência é por organização: a segunda ligação da mesma organização não paga, a de outra paga", async () => {
    brain = await startFakeBrain();
    const voice = countedVoice();
    const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: new FixedSpeechCache() });
    const connect = async (organizationId: string) => {
      const session = await engine.connect(config, "", { pieces: piecesOf(voice.synthesizer, []), organizationId, transferOnFailure: true });
      const log = record(session);
      await new Promise((resolve) => setImmediate(resolve));
      await session.close();
      return log.pieceUsage.filter((line) => line.piece === "synthesizer").reduce((sum, line) => sum + (line.characters ?? 0), 0);
    };
    const paid = [...PIPELINE_TRANSFER_SPEECH].length;
    expect(await connect("org-a")).toBe(paid);
    expect(voice.opens()).toBe(1);
    expect(await connect("org-a")).toBe(0);
    expect(voice.opens()).toBe(1);
    expect(await connect("org-b")).toBe(paid);
    expect(voice.opens()).toBe(2);
    // A fala de falha da mesma organização não vem do cache da de transferência: são textos diferentes.
    const plain = await engine.connect(config, "", { pieces: piecesOf(voice.synthesizer, []), organizationId: "org-a" });
    await plain.close();
    expect(voice.opens()).toBe(3);
  });
});

describe("motor pipeline (fatia 4, ponta 2 da 3c-2): a abertura que ninguém usou também é cobrada", () => {
  it("a sessão fechada antes do primeiro ciclo emite o custo das falas prontas antes do `closed`, uma vez; a que segue na linha o emite no primeiro ciclo, uma vez", async () => {
    brain = await startFakeBrain();
    const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: new FixedSpeechCache() });
    const paid = [...PIPELINE_FAILURE_SPEECH].length;
    // Fechada no mesmo ciclo da abertura (o fim da ligação durante ou logo depois dela): o custo sai no `close`.
    const unused = await engine.connect(config, "", { pieces: piecesOf(countedVoice().synthesizer, []), organizationId: "org-a" });
    const seen: string[] = [];
    unused.on("pieceUsage", (line) => seen.push(`${line.piece} ${line.characters ?? 0}`));
    unused.on("closed", () => seen.push("closed"));
    await unused.close();
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen.filter((entry) => entry.startsWith("synthesizer"))).toEqual([`synthesizer ${paid}`]);
    expect(seen.at(-1)).toBe("closed");
    // Usada: sai no primeiro ciclo, e o `close` depois não cobra de novo.
    const used = await engine.connect(config, "", { pieces: piecesOf(countedVoice().synthesizer, []), organizationId: "org-b" });
    const log = record(used);
    await new Promise((resolve) => setImmediate(resolve));
    await used.close();
    expect(log.pieceUsage.filter((line) => line.piece === "synthesizer").map((line) => line.characters)).toEqual([paid]);
  });

  it("a peça que cai antes do primeiro ciclo: o custo das falas prontas sai na falha, antes do `closed`, uma vez (lacuna da DESA-433)", async () => {
    brain = await startFakeBrain();
    const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: new FixedSpeechCache() });
    const paid = [...PIPELINE_FAILURE_SPEECH].length;
    let heard: SimulatedTranscription | undefined;
    const transcriber = createSimulatedTranscriber({ script: [], onSession: (opened) => (heard = opened) });
    const session = await engine.connect(config, "", { pieces: piecesOf(countedVoice().synthesizer, [], { transcriber: { piece: transcriber, apiKey: "" } }), organizationId: "org-a" });
    const seen: string[] = [];
    session.on("pieceUsage", (line) => seen.push(`${line.piece} ${line.characters ?? 0}`));
    session.on("closed", (reason) => seen.push(`closed ${reason}`));
    // A transcrição cai no mesmo ciclo da abertura: o primeiro ciclo (que cobraria a abertura) nunca roda.
    emitOn(heard, "closed", "failed");
    await new Promise((resolve) => setImmediate(resolve));
    await session.close();
    expect(seen.filter((entry) => entry.startsWith("synthesizer"))).toEqual([`synthesizer ${paid}`]);
    expect(seen.indexOf(`synthesizer ${paid}`)).toBeLessThan(seen.indexOf("closed failed"));
  });
});

// ---- fatia 4: a interrupção ----

/**
 * A voz simulada com o agendador nas mãos do teste: aberta, o áudio sai pelo `setImmediate`; presa
 * (`hold`), cada pedaço de áudio (com o `spoken` dele) e o `done` esperam `step`. `holdOpening` segura a
 * abertura da próxima fala até `releaseOpening`.
 */
function gatedVoice() {
  const tasks: Array<() => void> = [];
  let flowing = true;
  const schedule = (task: () => void): void => {
    if (flowing) setImmediate(task);
    else tasks.push(task);
  };
  const counted = countedVoice(createSimulatedSynthesizer(schedule));
  let openingHeld: Promise<void> | undefined;
  let releaseOpening = (): void => undefined;
  const synthesizer: SpeechSynthesizer = {
    ...counted.synthesizer,
    async speak(...args) {
      if (openingHeld) await openingHeld;
      return counted.synthesizer.speak(...args);
    },
  };
  return {
    ...counted,
    synthesizer,
    hold: () => void (flowing = false),
    step: () => tasks.shift()?.(),
    /** Roda o pedaço `index` da fila, fora da ordem (o áudio de uma fala de trás antes do `done` da da frente). */
    stepAt: (index: number) => tasks.splice(index, 1)[0]?.(),
    pending: () => tasks.length,
    holdOpening: () => void (openingHeld = new Promise<void>((resolve) => (releaseOpening = resolve))),
    releaseOpening: () => releaseOpening(),
  };
}

/** Os eventos da sessão com a interrupção junto, e o consumo da voz somado em caracteres. */
function recordWithInterruption(session: VoiceSession) {
  const log = record(session);
  session.on("interrupted", () => log.events.push("interrupted"));
  const voiceCharacters = () => log.pieceUsage.filter((line) => line.piece === "synthesizer").reduce((sum, line) => sum + (line.characters ?? 0), 0);
  return { ...log, voiceCharacters };
}

async function openRecorded(pieces: PipelinePieces, extra: Partial<PipelineConnectOptions> = {}, sessionConfig: VoiceSessionConfig = config) {
  if (!brain) throw new Error("sem cérebro");
  const engine = createPipelineEngine({ fetch: brain.fetch, fixedSpeechCache: new FixedSpeechCache() });
  const session = await engine.connect(sessionConfig, "", { pieces, organizationId: ORG, ...extra });
  const log = recordWithInterruption(session);
  // O custo da abertura sai no primeiro ciclo: a conta da voz abaixo começa depois dele.
  await new Promise((resolve) => setImmediate(resolve));
  return { session, log, openingCharacters: log.voiceCharacters() };
}

/** As mensagens do pedido `n` ao cérebro, só papel e texto (e as ferramentas do assistente). */
const messagesOf = (n: number) =>
  (brain?.requests[n]?.messages ?? []).map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.tool_calls ? { tools: (message.tool_calls as Array<{ id: string }>).map((call) => call.id) } : {}),
  }));

const FIRST = "Claro, posso ajudar. ";
const SECOND = "Qual é o seu nome completo?";

describe("motor pipeline (fatia 4): a interrupção", () => {
  it("o aceite: quem ligou fala por cima, a voz e o cérebro param, a fala fica cortada no que saiu (transcrição e histórico), e o próximo pedido segue do que a pessoa disse", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    const script: SimulatedTranscriptScript = [
      { afterAudioMs: 100, text: "Oi.", final: true },
      { afterAudioMs: 200, text: "Espera" },
      { afterAudioMs: 300, text: "Espera, quero remarcar.", final: true },
    ];
    // O cérebro manda a primeira frase e segura o resto: o pedido está aberto quando quem ligou interrompe.
    const rest = gate();
    brain.reply([text(FIRST), rest.hold, text(SECOND), usage(30, 12)], [text("Claro, para quando?"), usage(40, 5)]);
    const { session, log, openingCharacters } = await openRecorded(piecesOf(voice.synthesizer, script));
    voice.hold();
    speak(session, 100);
    // A primeira frase foi à voz (enviada e cobrada) e só o áudio dela saiu.
    await until(() => voice.pending() === 1, "a primeira frase gerar");
    voice.step();
    expect(log.audioBytes()).toBe(toneFor([...FIRST].length).length);
    speak(session, 100);
    await until(() => log.events.includes("interrupted"), "a interrupção");
    // A fala do agente vai à transcrição cortada no que saiu, antes da fala nova de quem ligou.
    expect(log.events).toEqual(["activity", "turn ended (transcript)", "user: Oi.", "activity", "interrupted", "agent: Claro, posso ajudar."]);
    expect(voice.log.filter((line) => line.startsWith("cancel"))).toEqual(["cancel 2"]);
    // O resto do cérebro chega depois da interrupção: não vai à voz, não é cobrado da voz, não vira fala.
    rest.release();
    const audioAtInterruption = log.audioBytes();
    while (voice.pending() > 0) voice.step();
    speak(session, 100);
    await until(() => brain?.requests.length === 2, "o próximo pedido");
    expect(log.audioBytes()).toBe(audioAtInterruption);
    expect(voice.log.some((line) => line.includes(SECOND))).toBe(false);
    // O próximo pedido leva a fala cortada, e não a inteira, e depois o que quem ligou disse.
    expect(messagesOf(1).slice(-3)).toEqual([
      { role: "user", content: "Oi." },
      { role: "assistant", content: "Claro, posso ajudar." },
      { role: "user", content: "Espera, quero remarcar." },
    ]);
    // A voz cobrou o que foi enviado a ela (a primeira frase), e o cérebro cancelado emitiu o consumo dele.
    expect(log.voiceCharacters() - openingCharacters).toBe([...FIRST].length);
    await until(() => log.pieceUsage.filter((line) => line.piece === "brain").length >= 1, "o consumo do pedido cancelado");
    expect(log.pieceUsage.find((line) => line.piece === "brain")?.estimated).toBe(true);
    await session.close();
  });

  it("o texto que esperava a voz abrir não foi enviado: não é cobrado, e a fala que abre tarde é cancelada sem receber nada", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    brain.reply([text(FIRST), text(SECOND), usage(30, 12)]);
    const { session, log, openingCharacters } = await openRecorded(piecesOf(voice.synthesizer, [
      { afterAudioMs: 100, text: "Oi.", final: true },
      { afterAudioMs: 200, text: "Espera" },
      { afterAudioMs: 300, text: "Espera, é outra coisa.", final: true },
    ]));
    voice.holdOpening();
    speak(session, 100);
    await until(() => log.events.includes("user: Oi."), "o turno");
    await until(() => brain?.requests.length === 1, "o pedido");
    // A resposta inteira chegou, e a voz ainda não abriu.
    await new Promise((resolve) => setTimeout(resolve, 50));
    speak(session, 100);
    await until(() => log.events.includes("interrupted"), "a interrupção");
    voice.releaseOpening();
    await until(() => voice.log.includes("cancel 2"), "a fala que abriu tarde ser cancelada");
    expect(voice.log.filter((line) => line.startsWith("push 2"))).toEqual([]);
    expect(log.voiceCharacters()).toBe(openingCharacters);
    // Nada saiu: nenhuma fala do agente na transcrição, e nenhuma mensagem do assistente (nem vazia) no histórico.
    expect(log.events.filter((event) => event.startsWith("agent:"))).toEqual([]);
    brain.reply([text("Pois não."), usage(20, 2)]);
    speak(session, 100);
    await until(() => brain?.requests.length === 2, "o próximo pedido");
    expect(messagesOf(1).slice(-2)).toEqual([
      { role: "user", content: "Oi." },
      { role: "user", content: "Espera, é outra coisa." },
    ]);
    await session.close();
  });

  it("com `listeningEnvironment: \"noisy\"`, o trecho sem palavra não interrompe; o trecho com texto interrompe", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    brain.reply([text(FIRST), text(SECOND), usage(30, 12)]);
    const { session, log } = await openRecorded(
      piecesOf(voice.synthesizer, [
        { afterAudioMs: 100, text: "Oi.", final: true },
        { afterAudioMs: 200, text: "" },
        { afterAudioMs: 300, text: "   " },
        { afterAudioMs: 400, text: "Espera" },
      ]),
      {},
      { ...config, listeningEnvironment: "noisy" },
    );
    voice.hold();
    speak(session, 100);
    await until(() => voice.pending() >= 1, "a resposta gerar");
    voice.step();
    // O ruído (trecho sem palavra) não corta o agente.
    speak(session, 200);
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(log.events).not.toContain("interrupted");
    expect(voice.log.some((line) => line.startsWith("cancel"))).toBe(false);
    speak(session, 100);
    await until(() => log.events.includes("interrupted"), "a interrupção pelo texto");
    expect(voice.log.filter((line) => line.startsWith("cancel"))).toEqual(["cancel 2"]);
    await session.close();
  });

  it("durante a ferramenta: a fala de antes dela é cortada, o resultado entra no histórico, e o próximo pedido é o da fala nova, com a fala cortada", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    brain.reply([text("Vou verificar a agenda. "), tool("c1", "agendar", JSON.stringify({ dia: "terça" })), usage(30, 12)], [text("Quarta às dez está livre."), usage(50, 6)]);
    const { session, log } = await openRecorded(
      piecesOf(voice.synthesizer, [
        { afterAudioMs: 100, text: "Quero marcar para terça.", final: true },
        { afterAudioMs: 200, text: "Não, espera" },
        { afterAudioMs: 300, text: "Não, espera, é quarta.", final: true },
      ]),
    );
    voice.hold();
    speak(session, 100);
    await until(() => log.toolCalls.length === 1, "a ferramenta");
    // Nada da fala de antes da ferramenta saiu ainda: quem ligou interrompe e depois termina de falar.
    speak(session, 200);
    await until(() => log.events.includes("user: Não, espera, é quarta."), "a fala nova");
    expect(log.events).toContain("interrupted");
    expect(log.events.filter((event) => event.startsWith("agent:"))).toEqual([]);
    // Com a ferramenta em curso, a fala nova espera o resultado; o resultado não reabre o cérebro sozinho.
    expect(brain.requests).toHaveLength(1);
    session.sendToolResult("c1", { ok: true });
    await until(() => brain?.requests.length === 2, "o pedido com a fala nova");
    expect(messagesOf(1).slice(-4)).toEqual([
      { role: "user", content: "Quero marcar para terça." },
      { role: "assistant", content: null, tools: ["c1"] },
      { role: "tool", content: JSON.stringify({ ok: true }) },
      { role: "user", content: "Não, espera, é quarta." },
    ]);
    await session.close();
  });

  it("a fala pronta e o `say` não se interrompem: a despedida pronta na fila atrás da resposta cortada sai inteira, sem fala nova", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    const farewell = "Preciso encerrar agora. Obrigado.";
    brain.reply([text(FIRST), text(SECOND), usage(30, 12)]);
    const { session, log } = await openRecorded(
      piecesOf(voice.synthesizer, [
        { afterAudioMs: 100, text: "Oi.", final: true },
        { afterAudioMs: 200, text: "Espera" },
        { afterAudioMs: 300, text: "Alô?" },
      ]),
      { fixedSpeech: [farewell] },
    );
    voice.hold();
    speak(session, 100);
    await until(() => voice.pending() >= 1, "a resposta gerar");
    // A despedida pronta entra na fila atrás da resposta que ainda fala.
    session.say(farewell);
    const opens = voice.opens();
    speak(session, 100);
    await until(() => log.events.includes("interrupted"), "a interrupção");
    // A resposta foi cortada (nada dela saiu), e a despedida saiu inteira, pronta, sem abrir a voz.
    expect(log.audioBytes()).toBe(toneFor([...farewell].length).length);
    expect(voice.opens()).toBe(opens);
    expect(log.events.filter((event) => event.startsWith("agent:"))).toEqual([`agent: ${farewell}`]);
    // Com só a fala pronta tocando, quem ligou não interrompe nada.
    speak(session, 100);
    await until(() => log.events.filter((event) => event === "activity").length === 3, "a fala por cima da despedida");
    expect(log.events.filter((event) => event === "interrupted")).toHaveLength(1);
    await session.close();
  });

  it("a resposta que sai inteira vai à transcrição inteira quando acaba de sair, e o histórico fica como o cérebro a disse", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    brain.reply([text(FIRST), text(SECOND), usage(30, 12)], [text("Anotado."), usage(40, 2)]);
    const { session, log } = await openRecorded(
      piecesOf(voice.synthesizer, [
        { afterAudioMs: 100, text: "Oi.", final: true },
        { afterAudioMs: 200, text: "Maria Souza.", final: true },
      ]),
    );
    voice.hold();
    speak(session, 100);
    await until(() => voice.pending() >= 2, "a resposta gerar");
    // Gerada, mas ainda não saiu inteira: nada na transcrição.
    expect(log.events.filter((event) => event.startsWith("agent:"))).toEqual([]);
    while (voice.pending() > 0) voice.step();
    await until(() => log.events.includes(`agent: ${FIRST}${SECOND}`), "a fala inteira na transcrição");
    speak(session, 100);
    await until(() => brain?.requests.length === 2, "o próximo pedido");
    expect(messagesOf(1).slice(-2)).toEqual([
      { role: "assistant", content: `${FIRST}${SECOND}` },
      { role: "user", content: "Maria Souza." },
    ]);
    expect(log.events).not.toContain("interrupted");
    await session.close();
  });

  it("o áudio da resposta que espera atrás de um `say` não foi ouvido: no fim, nada dela vai à transcrição", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    brain.reply([text(FIRST), usage(30, 6)]);
    const { session, log } = await openRecorded(piecesOf(voice.synthesizer, [{ afterAudioMs: 100, text: "Oi.", final: true }]));
    voice.hold();
    session.say("Um momento, por favor.");
    await until(() => voice.pending() === 2, "o say gerar");
    speak(session, 100);
    await until(() => voice.pending() >= 3, "a resposta gerar");
    // O áudio da resposta (e o `spoken` dele) chega com o `say` ainda na frente: ele espera, e não saiu.
    voice.stepAt(2);
    expect(log.audioBytes()).toBe(0);
    await session.close();
    expect(log.events.filter((event) => event.startsWith("agent:"))).toEqual(["agent: Um momento, por favor."]);
  });

  it("a fala cortada que avisa erro depois do `cancel` não derruba a ligação", async () => {
    brain = await startFakeBrain();
    const gated = gatedVoice();
    // A voz que, ao ser cancelada, ainda avisa um erro (o provedor que fecha o socket da fala cortada).
    const synthesizer: SpeechSynthesizer = {
      ...gated.synthesizer,
      async speak(...args) {
        const speech = await gated.synthesizer.speak(...args);
        let onError: ((error: Error) => void) | undefined;
        return {
          ...speech,
          on: (event, handler) => {
            if (event === "error") onError = handler as (error: Error) => void;
            speech.on(event, handler);
          },
          cancel: () => {
            speech.cancel();
            onError?.(new SynthesizerOpenError("unreachable", "o socket da fala cortada fechou"));
          },
        };
      },
    };
    brain.reply([text(FIRST), text(SECOND), usage(30, 12)]);
    const { session, log } = await openRecorded(piecesOf(synthesizer, [
      { afterAudioMs: 100, text: "Oi.", final: true },
      { afterAudioMs: 200, text: "Espera" },
    ]));
    gated.hold();
    speak(session, 100);
    await until(() => gated.pending() >= 1, "a resposta gerar");
    speak(session, 100);
    await until(() => log.events.includes("interrupted"), "a interrupção");
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(log.events.filter((event) => event.startsWith("error") || event.startsWith("closed"))).toEqual([]);
    await session.close();
  });

  it("o fim no meio da resposta: a fala vai à transcrição cortada no que saiu antes do `closed`, e nada sai depois dele", async () => {
    brain = await startFakeBrain();
    const voice = gatedVoice();
    brain.reply([text(FIRST), text(SECOND), usage(30, 12)]);
    const { session, log } = await openRecorded(piecesOf(voice.synthesizer, [{ afterAudioMs: 100, text: "Oi.", final: true }]));
    voice.hold();
    speak(session, 100);
    await until(() => voice.pending() >= 2, "a resposta gerar");
    voice.step();
    await session.close();
    const atClose = [...log.events];
    expect(atClose.slice(-2)).toEqual(["agent: Claro, posso ajudar.", "closed client"]);
    while (voice.pending() > 0) voice.step();
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(log.events).toEqual(atClose);
  });
});
