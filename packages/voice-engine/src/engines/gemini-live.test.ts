import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextEvent, startFakeProvider } from "../testing/fake-provider";
import type { VoiceSessionConfig } from "../types";
import engine from "./gemini-live";

const config: VoiceSessionConfig = {
  instructions: "Você atende a clínica.",
  greeting: "Clínica Bela, bom dia!",
  language: "pt-BR",
  tools: [{ name: "end_call", description: "Encerra a ligação", parameters: { type: "object", properties: {} } }],
};

let fake: Awaited<ReturnType<typeof startFakeProvider>>;
beforeEach(async () => {
  fake = await startFakeProvider();
});
afterEach(() => fake.stop());

async function openSession(overrides: Partial<VoiceSessionConfig> = {}) {
  const connecting = engine.connect({ ...config, ...overrides }, "chave secreta", { baseUrl: fake.url, model: "modelo-x" });
  const setup = await fake.waitFor((message) => "setup" in message);
  fake.send({ setupComplete: {} });
  return { session: await connecting, setup };
}

describe("gemini-live (contrato com servidor falso)", () => {
  it("abre e configura a sessão: chave, modelo, voz, instruções e ferramentas", async () => {
    const { setup } = await openSession({ voiceId: "Kore" });
    expect(fake.request.url).toBe("/?key=chave%20secreta");
    expect(setup).toMatchObject({
      setup: {
        model: "models/modelo-x",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
        },
        systemInstruction: { parts: [{ text: expect.stringMatching(/^Você atende a clínica\.[\s\S]*pt-BR/) }] },
        tools: [{ functionDeclarations: [{ name: "end_call", description: "Encerra a ligação", parametersJsonSchema: { type: "object" } }] }],
        inputAudioTranscription: { languageCodes: ["pt-BR"] },
        outputAudioTranscription: {},
      },
    });
  });

  it("só devolve a sessão depois do setupComplete e faz o agente falar primeiro", async () => {
    let connected = false;
    const connecting = engine.connect(config, "k", { baseUrl: fake.url }).then((session) => {
      connected = true;
      return session;
    });
    const setup = await fake.waitFor((message) => "setup" in message);
    expect(setup).toMatchObject({ setup: { model: "models/gemini-3.8-live" } });
    expect(connected).toBe(false);
    fake.send({ setupComplete: {} });
    await connecting;
    const greeting = await fake.waitFor((message) => "realtimeInput" in message);
    expect(greeting).toMatchObject({ realtimeInput: { text: expect.stringContaining("Clínica Bela, bom dia!") } });
  });

  it("envia o áudio de quem ligou em PCM16 16 kHz", async () => {
    const { session } = await openSession({ greeting: undefined });
    session.sendAudio(Buffer.alloc(320, 1));
    const message = (await fake.waitFor((m) => "realtimeInput" in m)) as { realtimeInput: { audio: { data: string; mimeType: string } } };
    expect(message.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    expect(Buffer.from(message.realtimeInput.audio.data, "base64").length).toBe(640);
  });

  it("fala recebida em 24 kHz vira audio em 8 kHz; transcrições saem por turno", async () => {
    const { session } = await openSession();
    const transcripts: string[] = [];
    session.on("transcript", (turn) => transcripts.push(`${turn.speaker}: ${turn.text}`));
    const audio = nextEvent(session, "audio");
    const usage = nextEvent(session, "usage");
    fake.send({ serverContent: { inputTranscription: { text: "quero " } } });
    fake.send({ serverContent: { inputTranscription: { text: "remarcar" } } });
    fake.send({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(960).toString("base64"), mimeType: "audio/pcm;rate=24000" } }] },
      },
    });
    fake.send({ serverContent: { outputTranscription: { text: "Claro, " } } });
    fake.send({ serverContent: { outputTranscription: { text: "para quando?" } } });
    fake.send({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 120, responseTokenCount: 45 } });
    expect((await audio)[0].length).toBe(320);
    expect((await usage)[0]).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(transcripts).toEqual(["user: quero remarcar", "agent: Claro, para quando?"]);
  });

  it("chamada de ferramenta vira toolCall e o resultado volta com id e nome", async () => {
    const { session } = await openSession({ greeting: undefined });
    const call = nextEvent(session, "toolCall");
    fake.send({ toolCall: { functionCalls: [{ id: "fc-1", name: "end_call", args: { reason: "fim" } }] } });
    expect((await call)[0]).toEqual({ id: "fc-1", name: "end_call", args: { reason: "fim" } });
    session.sendToolResult("fc-1", { ok: true });
    expect(await fake.waitFor((m) => "toolResponse" in m)).toEqual({
      toolResponse: { functionResponses: [{ id: "fc-1", name: "end_call", response: { result: { ok: true } } }] },
    });
  });

  it("interrupção do usuário vira interrupted", async () => {
    const { session } = await openSession();
    const interrupted = nextEvent(session, "interrupted");
    fake.send({ serverContent: { interrupted: true } });
    await expect(interrupted).resolves.toEqual([]);
  });

  it("mensagem fora do formato é ignorada sem derrubar a sessão", async () => {
    const { session } = await openSession();
    const errors: Error[] = [];
    session.on("error", (error) => errors.push(error));
    const interrupted = nextEvent(session, "interrupted");
    fake.send("isto não é JSON");
    fake.send({ serverContent: 5 });
    fake.send({ toolCall: { functionCalls: "nada" } });
    fake.send({ serverContent: { interrupted: true } });
    await interrupted;
    expect(errors).toEqual([]);
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
    expect(order[0]).toMatch(/^error Gemini Live: a conexão caiu/);
    expect(order[1]).toBe("closed socket_closed");
    await session.close();
    expect(order).toHaveLength(2);
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

  it("conexão recusada ou fechada antes do setupComplete rejeita o connect", async () => {
    const connecting = engine.connect(config, "k", { baseUrl: fake.url });
    await fake.waitFor((message) => "setup" in message);
    fake.drop();
    await expect(connecting).rejects.toThrow(/antes de confirmar a sessão/);
    await fake.stop();
    await expect(engine.connect(config, "k", { baseUrl: fake.url })).rejects.toThrow(/não foi possível conectar/);
  });
});
