import { afterEach, describe, expect, it } from "vitest";
import { expireAtOnce, startFakeHttp } from "../testing/fake-http";
import { startFakeProvider } from "../testing/fake-provider";
import { pcm16ToUlaw } from "../resample";
import { TranscriberOpenError, type StreamingTranscription, type TranscriptPiece, type Usage } from "../types";
import transcriber from "./openai";

type Fake = Awaited<ReturnType<typeof startFakeProvider>>;
let fake: Fake | undefined;
afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

const CONFIG = { language: "pt-BR", vocabulary: ["Dra. Lívia", "Clínica Sorriso"] };

/** Abre a transcrição no servidor falso e confirma a sessão, como o servidor faz. */
async function open(config = CONFIG) {
  fake = await startFakeProvider();
  const opening = transcriber.connect(config, "chave-inventada", { baseUrl: fake.url });
  const update = await fake.waitFor((message) => message.type === "session.update");
  fake.send({ type: "session.updated", session: {} });
  const session = await opening;
  return { session, update, log: record(session) };
}

function record(session: StreamingTranscription) {
  const pieces: TranscriptPiece[] = [];
  const usage: Usage[] = [];
  const errors: Error[] = [];
  const closed: string[] = [];
  session.on("piece", (piece) => pieces.push(piece));
  session.on("usage", (line) => usage.push(line));
  session.on("error", (error) => errors.push(error));
  session.on("closed", (reason) => closed.push(reason));
  return { pieces, usage, errors, closed };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 2000; turn++) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`não aconteceu: ${what}`);
}

/** A sequência do servidor para uma vez de quem ligou: início, fim, item fechado. */
function turn(id: string, startMs: number, endMs: number): void {
  fake?.send({ type: "input_audio_buffer.speech_started", audio_start_ms: startMs, item_id: id });
  fake?.send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: endMs, item_id: id });
  fake?.send({ type: "input_audio_buffer.committed", item_id: id, previous_item_id: null });
}
const delta = (id: string, text: string) => fake?.send({ type: "conversation.item.input_audio_transcription.delta", item_id: id, content_index: 0, delta: text });
const completed = (id: string, transcript: string, usage?: unknown) =>
  fake?.send({ type: "conversation.item.input_audio_transcription.completed", item_id: id, content_index: 0, transcript, ...(usage === undefined ? {} : { usage }) });

describe("transcrição da OpenAI em streaming (fatia 6, peça provisória)", () => {
  it("a peça: fora do servidor, com preço por minuto e a chave do motor OpenAI Realtime", () => {
    expect(transcriber.id).toBe("openai");
    expect(transcriber.processingLocation).toEqual({ kind: "undeclared" });
    expect(transcriber.keyless).toBeUndefined();
    expect(transcriber.keySetting).toBe("engine.openai-realtime.api_key");
    expect(transcriber.pricing.centsPerMinute).toBe(0.3);
    expect(transcriber.pricing.source).toMatch(/^https:\/\/developers\.openai\.com\//);
  });

  it("abre a sessão de transcrição: chave no cabeçalho, μ-law a 8 kHz, o modelo, o idioma e o vocabulário", async () => {
    const { session, update } = await open();
    expect(fake?.request.authorization).toBe("Bearer chave-inventada");
    expect(update).toEqual({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: { model: "gpt-4o-mini-transcribe", language: "pt", prompt: "Names and terms that may appear: Dra. Lívia, Clínica Sorriso." },
            turn_detection: { type: "server_vad", silence_duration_ms: 500 },
          },
        },
      },
    });
    await session.close();
  });

  it("sem vocabulário, a sessão vai sem `prompt`", async () => {
    const { session, update } = await open({ language: "es-MX", vocabulary: [] });
    expect((update.session as { audio: { input: { transcription: unknown } } }).audio.input.transcription).toEqual({ model: "gpt-4o-mini-transcribe", language: "es" });
    await session.close();
  });

  it("o áudio de quem ligou vai inteiro, em μ-law e base64", async () => {
    const { session } = await open();
    const pcm = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) pcm.writeInt16LE((i * 97) % 2000 - 1000, i * 2);
    session.sendAudio(pcm);
    const append = await fake!.waitFor((message) => message.type === "input_audio_buffer.append");
    expect(Buffer.from(append.audio as string, "base64")).toEqual(pcm16ToUlaw(pcm));
    await session.close();
  });

  it("o parcial acumula os `delta`, e o final traz o texto, o início e o fim da fala sem o silêncio que o servidor esperou", async () => {
    const { session, log } = await open();
    turn("i1", 300, 2100);
    delta("i1", "Quero");
    delta("i1", " marcar");
    completed("i1", "Quero marcar.", { type: "tokens", input_tokens: 40, output_tokens: 6, total_tokens: 46 });
    await until(() => log.pieces.some((piece) => piece.final), "o final");
    expect(log.pieces).toEqual([
      { text: "Quero", final: false, alternatives: [], startMs: 300, endMs: 1600 },
      { text: "Quero marcar", final: false, alternatives: [], startMs: 300, endMs: 1600 },
      { text: "Quero marcar.", final: true, alternatives: [], startMs: 300, endMs: 1600 },
    ]);
    expect(log.usage).toEqual([{ inputTokens: 40, outputTokens: 6 }]);
    await session.close();
  });

  it("o custo: em tokens quando o servidor diz; em segundos quando diz duração; sem `usage`, os segundos de fala do item", async () => {
    const { session, log } = await open();
    turn("i1", 0, 1500);
    completed("i1", "Um.", { type: "duration", seconds: 1.5 });
    turn("i2", 2000, 4500);
    completed("i2", "Dois.");
    await until(() => log.usage.length === 2, "os dois consumos");
    expect(log.usage).toEqual([{ seconds: 1.5 }, { seconds: 2.5 }]);
    await session.close();
  });

  it("os itens saem na ordem: o parcial do segundo espera o final do primeiro", async () => {
    const { session, log } = await open();
    turn("i1", 0, 1000);
    turn("i2", 1200, 2400);
    delta("i2", "Terça");
    delta("i1", "Oi");
    completed("i2", "Terça.");
    // O segundo terminou antes, e nada dele saiu: o primeiro ainda não tem final.
    await until(() => log.pieces.length === 1, "o parcial do primeiro");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log.pieces.map((piece) => `${piece.final ? "final" : "parcial"} ${piece.text}`)).toEqual(["parcial Oi"]);
    completed("i1", "Oi.");
    await until(() => log.pieces.length === 3, "os dois finais");
    expect(log.pieces.map((piece) => `${piece.final ? "final" : "parcial"} ${piece.text}`)).toEqual(["parcial Oi", "final Oi.", "final Terça."]);
    await session.close();
  });

  it("o item que falha é `error` não fatal, e sai como final vazio", async () => {
    const { session, log } = await open();
    turn("i1", 0, 1000);
    delta("i1", "Ah");
    fake?.send({ type: "conversation.item.input_audio_transcription.failed", item_id: "i1", content_index: 0, error: { message: "boom" } });
    await until(() => log.pieces.some((piece) => piece.final), "o final vazio");
    expect(log.pieces.at(-1)).toMatchObject({ text: "", final: true });
    expect(log.errors).toHaveLength(1);
    expect(log.closed).toEqual([]);
    await session.close();
  });

  it("o erro do servidor com a sessão aberta não fecha nada; a queda é `error` e `closed`", async () => {
    const { log } = await open();
    fake?.send({ type: "error", error: { type: "invalid_request_error", code: "x", message: "y" } });
    await until(() => log.errors.length === 1, "o erro");
    expect(log.closed).toEqual([]);
    fake?.drop();
    await until(() => log.closed.length === 1, "a queda");
    expect(log.closed).toEqual(["socket_closed"]);
    expect(log.errors).toHaveLength(2);
  });

  it("fechar pelo cliente é `closed(\"client\")`, sem erro, uma vez só", async () => {
    const { session, log } = await open();
    await session.close();
    await session.close();
    await until(() => log.closed.length === 1, "o fechamento");
    expect(log.closed).toEqual(["client"]);
    expect(log.errors).toEqual([]);
  });

  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ] as const)("o aperto de mão recusado com %i é recusa de abertura tipada (%s)", async (status, result) => {
    fake = await startFakeProvider({ rejectUpgrade: status });
    const error = await transcriber.connect(CONFIG, "chave", { baseUrl: fake.url }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TranscriberOpenError);
    expect((error as TranscriberOpenError).result).toBe(result);
  });

  it.each([
    ["invalid_api_key", "invalid_request_error", "rejected"],
    ["insufficient_quota", "insufficient_quota", "no_credit"],
    ["unsupported_country_region_territory", "invalid_request_error", "region_unavailable"],
  ] as const)("o erro antes da sessão confirmada é recusa (%s → %s)", async (code, type, result) => {
    fake = await startFakeProvider();
    const opening = transcriber.connect(CONFIG, "chave", { baseUrl: fake.url });
    await fake.waitFor((message) => message.type === "session.update");
    fake.send({ type: "error", error: { code, type, message: "recusado" } });
    const error = await opening.catch((caught: unknown) => caught);
    expect((error as TranscriberOpenError).result).toBe(result);
  });

  it("o servidor que aceita a conexão e não confirma a sessão cai pelo prazo, sem relógio de verdade", async () => {
    fake = await startFakeProvider();
    const error = await transcriber.connect(CONFIG, "chave", { baseUrl: fake.url, schedule: expireAtOnce }).catch((caught: unknown) => caught);
    expect((error as TranscriberOpenError).result).toBe("unreachable");
  });

  it("o servidor fora do ar é `unreachable`", async () => {
    fake = await startFakeProvider();
    const url = fake.url;
    await fake.stop();
    fake = undefined;
    const error = await transcriber.connect(CONFIG, "chave", { baseUrl: url }).catch((caught: unknown) => caught);
    expect((error as TranscriberOpenError).result).toBe("unreachable");
  });

  it("o teste da chave lê o modelo, sem gerar nada", async () => {
    const http = await startFakeHttp();
    try {
      http.respond({ status: 200, body: { id: "gpt-4o-mini-transcribe", object: "model", created: 1, owned_by: "system" } });
      expect(await transcriber.checkKey?.("chave", { baseUrl: http.url })).toEqual({ result: "accepted", model: "gpt-4o-mini-transcribe" });
      expect(http.requests[0]).toMatchObject({ method: "GET", url: "/models/gpt-4o-mini-transcribe" });
      expect(http.requests[0]?.headers.authorization).toBe("Bearer chave");
      http.respond({ status: 429, body: { error: { code: "insufficient_quota", type: "insufficient_quota" } } });
      expect((await transcriber.checkKey?.("chave", { baseUrl: http.url }))?.result).toBe("no_credit");
    } finally {
      await http.stop();
    }
  });
});
