import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pcm16ToUlaw } from "../resample";
import { nextEvent, startFakeProvider } from "../testing/fake-provider";
import type { VoiceSessionConfig } from "../types";
import engine from "./openai-realtime";

const config: VoiceSessionConfig = {
  instructions: "Você atende a clínica.",
  greeting: "Clínica Bela, bom dia!",
  language: "pt-BR",
  tools: [{ name: "end_call", description: "Encerra a ligação", parameters: { type: "object", properties: {} } }],
};
const ofType = (type: string) => (message: Record<string, unknown>) => message.type === type;

let fake: Awaited<ReturnType<typeof startFakeProvider>>;
beforeEach(async () => {
  fake = await startFakeProvider();
});
afterEach(() => fake.stop());

async function openSession(overrides: Partial<VoiceSessionConfig> = {}) {
  const connecting = engine.connect({ ...config, ...overrides }, "sk-teste", { baseUrl: fake.url, model: "modelo-x" });
  const update = await fake.waitFor(ofType("session.update"));
  fake.send({ type: "session.updated", session: {} });
  return { session: await connecting, update };
}

describe("openai-realtime (contrato com servidor falso)", () => {
  it("abre e configura a sessão: chave, modelo, μ-law, voz, idioma, instruções e ferramentas", async () => {
    const { update } = await openSession({ voiceId: "cedar" });
    expect(fake.request.url).toBe("/?model=modelo-x");
    expect(fake.request.authorization).toBe("Bearer sk-teste");
    expect(update).toMatchObject({
      session: {
        type: "realtime",
        instructions: expect.stringMatching(/^Você atende a clínica\.[\s\S]*pt-BR/),
        output_modalities: ["audio"],
        audio: {
          input: { format: { type: "audio/pcmu" }, transcription: { language: "pt" }, turn_detection: { interrupt_response: true } },
          output: { format: { type: "audio/pcmu" }, voice: "cedar" },
        },
        tools: [{ type: "function", name: "end_call", description: "Encerra a ligação", parameters: { type: "object" } }],
      },
    });
  });

  it("usa o modelo padrão e faz o agente falar primeiro", async () => {
    const connecting = engine.connect(config, "sk", { baseUrl: fake.url });
    await fake.waitFor(ofType("session.update"));
    expect(fake.request.url).toBe("/?model=gpt-realtime-2.1");
    fake.send({ type: "session.updated", session: {} });
    await connecting;
    const greeting = await fake.waitFor(ofType("response.create"));
    expect(greeting).toMatchObject({ response: { instructions: expect.stringContaining("Clínica Bela, bom dia!") } });
  });

  it("envia o áudio de quem ligou em μ-law 8 kHz, sem reamostrar", async () => {
    const { session } = await openSession({ greeting: undefined });
    const pcm = Buffer.from(new Int16Array([0, 1000, -1000, 20000]).buffer);
    session.sendAudio(pcm);
    const append = await fake.waitFor(ofType("input_audio_buffer.append"));
    expect(Buffer.from(append.audio as string, "base64").equals(pcm16ToUlaw(pcm))).toBe(true);
  });

  it("fala recebida em μ-law vira audio PCM16 8 kHz; transcrições e uso são repassados", async () => {
    const { session } = await openSession({ greeting: undefined });
    const transcripts: string[] = [];
    session.on("transcript", (turn) => transcripts.push(`${turn.speaker}: ${turn.text}`));
    const audio = nextEvent(session, "audio");
    const usage = nextEvent(session, "usage");
    fake.send({ type: "conversation.item.input_audio_transcription.completed", transcript: "quero remarcar\n" });
    fake.send({ type: "response.output_audio.delta", delta: Buffer.alloc(160, 0xff).toString("base64") });
    fake.send({ type: "response.output_audio_transcript.done", transcript: "Claro, para quando?" });
    fake.send({ type: "response.done", response: { usage: { input_tokens: 300, output_tokens: 80 } } });
    expect((await audio)[0].equals(Buffer.alloc(320))).toBe(true);
    expect((await usage)[0]).toEqual({ inputTokens: 300, outputTokens: 80 });
    expect(transcripts).toEqual(["user: quero remarcar", "agent: Claro, para quando?"]);
  });

  it("chamada de ferramenta vira toolCall; o resultado é devolvido e a continuação é pedida", async () => {
    const { session } = await openSession({ greeting: undefined });
    const call = nextEvent(session, "toolCall");
    fake.send({ type: "response.function_call_arguments.done", call_id: "call_1", name: "end_call", arguments: '{"reason":"fim"}' });
    expect((await call)[0]).toEqual({ id: "call_1", name: "end_call", args: { reason: "fim" } });
    session.sendToolResult("call_1", { ok: true });
    expect(await fake.waitFor(ofType("conversation.item.create"))).toEqual({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' },
    });
    expect(await fake.waitFor(ofType("response.create"))).toEqual({ type: "response.create", response: {} });
  });

  it("say() durante uma resposta em curso espera o response.done", async () => {
    const { session } = await openSession();
    await fake.waitFor(ofType("response.create")); // saudação
    session.say("Esta ligação é gravada");
    const interrupted = nextEvent(session, "interrupted");
    fake.send({ type: "input_audio_buffer.speech_started" });
    await interrupted; // tudo o que o motor enviaria antes disto já chegou ao servidor falso
    fake.send({ type: "response.done", response: {} });
    const queued = await fake.waitFor(ofType("response.create"));
    expect(queued).toMatchObject({ response: { instructions: expect.stringContaining("Esta ligação é gravada") } });
  });

  it("interrupção do usuário vira interrupted", async () => {
    const { session } = await openSession();
    const interrupted = nextEvent(session, "interrupted");
    fake.send({ type: "input_audio_buffer.speech_started", audio_start_ms: 10, item_id: "item_1" });
    await expect(interrupted).resolves.toEqual([]);
  });

  it("evento error do provedor vira error sem fechar; mensagem fora do formato é ignorada", async () => {
    const { session } = await openSession();
    const error = nextEvent(session, "error");
    let closed = false;
    session.on("closed", () => (closed = true));
    fake.send("isto não é JSON");
    fake.send({ type: "response.output_audio.delta", delta: 42 });
    fake.send({ type: "evento.desconhecido" });
    fake.send({ type: "error", error: { type: "invalid_request_error", message: "algo deu errado" } });
    expect((await error)[0].message).toBe("OpenAI Realtime: algo deu errado");
    expect(closed).toBe(false);
  });

  it("erro antes da sessão confirmada rejeita o connect", async () => {
    const connecting = engine.connect(config, "sk", { baseUrl: fake.url });
    await fake.waitFor(ofType("session.update"));
    fake.send({ type: "error", error: { message: "modelo inexistente" } });
    await expect(connecting).rejects.toThrow("OpenAI Realtime: modelo inexistente");
  });

  it("queda do socket vira error seguido de closed", async () => {
    const { session } = await openSession();
    const order: string[] = [];
    session.on("error", (error) => order.push(`error ${error.message}`));
    const closed = nextEvent(session, "closed");
    session.on("closed", (reason) => order.push(`closed ${reason}`));
    fake.drop();
    await closed;
    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/^error OpenAI Realtime: a conexão caiu/);
    expect(order[1]).toBe("closed socket_closed");
  });

  it("close() é idempotente e não gera erro", async () => {
    const { session } = await openSession();
    const order: string[] = [];
    session.on("error", () => order.push("error"));
    session.on("closed", (reason) => order.push(`closed ${reason}`));
    await Promise.all([session.close(), session.close()]);
    await session.close();
    expect(order).toEqual(["closed client"]);
  });
});
