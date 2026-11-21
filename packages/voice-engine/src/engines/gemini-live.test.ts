import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextEvent, startFakeProvider } from "../testing/fake-provider";
import { expireAtOnce, startFakeHttp } from "../testing/fake-http";
import type { ClassifyOptions, KeyCheckOptions, VoiceSessionConfig } from "../types";
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

  // A abertura de hoje, gravada como texto: agente sem termos não pode mandar ao provedor nada além disto.
  // A retomada (fatia 3a) pôs no fim o pedido de handle e a compressão da janela, em toda abertura.
  const SETUP_SEM_VOCABULARIO =
    '{"setup":{"model":"models/modelo-x","generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Sulafat"}}}},' +
    '"systemInstruction":{"parts":[{"text":"Você atende a clínica.\\n\\nSpeak only in pt-BR."}]},' +
    '"tools":[{"functionDeclarations":[{"name":"end_call","description":"Encerra a ligação","parametersJsonSchema":{"type":"object","properties":{}}}]}],' +
    '"inputAudioTranscription":{"languageCodes":["pt-BR"]},"outputAudioTranscription":{},' +
    '"sessionResumption":{},"contextWindowCompression":{"slidingWindow":{}}}}';

  it.each([["ausente", undefined], ["vazio", []]])("vocabulário %s: a abertura é byte a byte a de antes", async (_, vocabulary) => {
    const { setup } = await openSession({ vocabulary });
    expect(JSON.stringify(setup)).toBe(SETUP_SEM_VOCABULARIO);
  });

  it("vocabulário: os termos vão ao customVocabulary da transcrição e à instrução, antes do idioma", async () => {
    const { setup } = await openSession({ vocabulary: ["Melgaço", "DeskVoice"] });
    expect(setup).toMatchObject({
      setup: {
        systemInstruction: {
          parts: [{ text: "Você atende a clínica.\n\nNames and terms that may come up in this call, spelled as written: Melgaço; DeskVoice.\n\nSpeak only in pt-BR." }],
        },
      },
    });
    expect((setup.setup as Record<string, unknown>).inputAudioTranscription).toEqual({ languageCodes: ["pt-BR"], customVocabulary: ["Melgaço", "DeskVoice"] });
  });

  it.each([["ausente", undefined], ["normal", "normal" as const]])("ambiente %s: a abertura é byte a byte a de antes", async (_, listeningEnvironment) => {
    const { setup } = await openSession({ listeningEnvironment });
    expect(JSON.stringify(setup)).toBe(SETUP_SEM_VOCABULARIO);
  });

  it("ambiente barulhento: início de fala pouco sensível, fim sensível e 300 ms, sem tocar na interrupção", async () => {
    const { setup } = await openSession({ listeningEnvironment: "noisy" });
    const { realtimeInputConfig, ...rest } = setup.setup as Record<string, unknown>;
    expect(realtimeInputConfig).toEqual({
      automaticActivityDetection: { startOfSpeechSensitivity: "START_SENSITIVITY_LOW", endOfSpeechSensitivity: "END_SENSITIVITY_HIGH", prefixPaddingMs: 300 },
    });
    // `activityHandling` fica no padrão (a fala de verdade interrompe); o resto é o de sempre.
    expect(JSON.stringify(setup)).not.toContain("activityHandling");
    expect(rest).toEqual((JSON.parse(SETUP_SEM_VOCABULARIO) as { setup: unknown }).setup);
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

  it("toolCallCancellation vira toolCallCancelled com os ids, e o motor não manda nada sozinho", async () => {
    const { session } = await openSession({ greeting: undefined });
    fake.send({ toolCall: { functionCalls: [{ id: "fc-1", name: "call_webhook", args: {} }, { id: "fc-2", name: "create_task", args: {} }] } });
    const cancelled = nextEvent(session, "toolCallCancelled");
    fake.send({ toolCallCancellation: { ids: ["fc-1", "fc-2"] } });
    expect((await cancelled)[0]).toEqual(["fc-1", "fc-2"]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.hasUnread((m) => "toolResponse" in m)).toBe(false);
  });

  it("interrupção do usuário vira interrupted", async () => {
    const { session } = await openSession();
    const interrupted = nextEvent(session, "interrupted");
    fake.send({ serverContent: { interrupted: true } });
    await expect(interrupted).resolves.toEqual([]);
  });

  it("sinal de fala de quem ligou: transcrição interina ou definitiva com texto vira { words: true }, sem entrar no texto da fala", async () => {
    const { session } = await openSession({ greeting: undefined });
    const signals: Array<{ words: boolean }> = [];
    const transcripts: string[] = [];
    session.on("callerActivity", (signal) => signals.push(signal));
    session.on("transcript", (turn) => transcripts.push(`${turn.speaker}: ${turn.text}`));
    fake.send({ serverContent: { interimInputTranscription: { text: "quero" } } });
    fake.send({ serverContent: { interimInputTranscription: { text: " " } } });
    fake.send({ serverContent: { inputTranscription: { text: "quero marcar" } } });
    const done = nextEvent(session, "transcript");
    fake.send({ serverContent: { turnComplete: true } });
    await done;
    expect(signals).toEqual([{ words: true }, { words: true }]);
    // A interina só avisa: o texto da fala é o definitivo.
    expect(transcripts).toEqual(["user: quero marcar"]);
  });

  it("o fim da vez de quem ligou é cada pedaço da transcrição antes do áudio da resposta, com source transcript; o que chega com o agente falando não conta", async () => {
    const { session } = await openSession({ greeting: undefined });
    const marks: string[] = [];
    session.on("callerTurnEnded", (signal) => marks.push(`marco ${signal.source}`));
    session.on("audio", () => marks.push("áudio"));
    const pcm = Buffer.alloc(960).toString("base64");
    fake.send({ serverContent: { interimInputTranscription: { text: "quero" } } });
    fake.send({ serverContent: { inputTranscription: { text: "quero " } } });
    fake.send({ serverContent: { inputTranscription: { text: " " } } });
    fake.send({ serverContent: { inputTranscription: { text: "remarcar" } } });
    fake.send({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm, mimeType: "audio/pcm;rate=24000" } }] } } });
    // Transcrição atrasada da mesma fala, com o agente já falando: não é marco.
    fake.send({ serverContent: { inputTranscription: { text: "amanhã" } } });
    fake.send({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm, mimeType: "audio/pcm;rate=24000" } }] } } });
    fake.send({ serverContent: { turnComplete: true } });
    // Terminada a resposta, a fala nova volta a marcar.
    const next = nextEvent(session, "callerTurnEnded");
    fake.send({ serverContent: { inputTranscription: { text: "obrigado" } } });
    await next;
    // Quem mede fica com o último marco antes do áudio (o de "remarcar"): o de "quero " é substituído.
    expect(marks).toEqual(["marco transcript", "marco transcript", "áudio", "áudio", "marco transcript"]);
  });

  it("closeCallerTurn manda audioStreamEnd", async () => {
    const { session } = await openSession({ greeting: undefined });
    session.closeCallerTurn();
    expect(await fake.waitFor((message) => "realtimeInput" in message)).toEqual({ realtimeInput: { audioStreamEnd: true } });
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

  describe("retomada da sessão (goAway e queda com handle)", () => {
    /** Tudo o que a sessão emite de fechamento, erro e retomada, na ordem. */
    function watch(session: Awaited<ReturnType<typeof openSession>>["session"]) {
      const order: string[] = [];
      const usage = { inputTokens: 0, outputTokens: 0 };
      session.on("error", (error) => order.push(`error ${error.message}`));
      session.on("closed", (reason) => order.push(`closed ${reason}`));
      session.on("resumed", () => order.push("resumed"));
      session.on("usage", (increment) => {
        usage.inputTokens += increment.inputTokens ?? 0;
        usage.outputTokens += increment.outputTokens ?? 0;
      });
      return { order, usage };
    }
    const setupWithHandle = (message: Record<string, unknown>) => "setup" in message && JSON.stringify(message).includes('"sessionResumption":{"handle"');

    it("goAway no meio: reconecta com o último handle retomável, sem closed, e o consumo das duas conexões soma", async () => {
      const { session } = await openSession({ greeting: undefined });
      const { order, usage } = watch(session);
      fake.send({ sessionResumptionUpdate: { newHandle: "h-1", resumable: true } });
      // Não retomável: o handle vem vazio e não substitui o que valia.
      fake.send({ sessionResumptionUpdate: { newHandle: "", resumable: false } });
      fake.send({ usageMetadata: { promptTokenCount: 100, responseTokenCount: 40 } });
      fake.send({ goAway: { timeLeft: "5s" } });

      const setup = await fake.waitFor(setupWithHandle);
      expect(fake.connections()).toBe(2);
      // A segunda abertura é a mesma, só com o handle.
      expect((setup.setup as Record<string, unknown>).sessionResumption).toEqual({ handle: "h-1" });
      expect(setup.setup).toMatchObject({ model: "models/modelo-x", contextWindowCompression: { slidingWindow: {} } });
      const resumed = nextEvent(session, "resumed");
      fake.send({ setupComplete: {} });
      await resumed;
      await vi.waitFor(() => expect(fake.isOpen(0)).toBe(false));

      fake.send({ usageMetadata: { promptTokenCount: 30, responseTokenCount: 7 } });
      await vi.waitFor(() => expect(usage).toEqual({ inputTokens: 130, outputTokens: 47 }));
      // A ligação segue: o áudio vai pela conexão nova, e nada de fala extra.
      session.sendAudio(Buffer.alloc(320, 1));
      const audio = await fake.waitFor((m) => "realtimeInput" in m);
      expect(audio).toMatchObject({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000" } } });
      expect(JSON.stringify(audio)).not.toContain('"text"');
      expect(order).toEqual(["resumed"]);
      await session.close();
      expect(order).toEqual(["resumed", "closed client"]);
    });

    it("o que sai durante a troca espera a conexão nova; do áudio fica o mais recente, até 2 s", async () => {
      const { session } = await openSession({ greeting: undefined });
      fake.send({ sessionResumptionUpdate: { newHandle: "h-1", resumable: true } });
      fake.send({ goAway: {} });
      await fake.waitFor(setupWithHandle);
      // 3 s de quem ligou, em 30 pedaços de 100 ms (1600 bytes a 8 kHz), cada um com o próprio valor.
      for (let i = 1; i <= 30; i++) {
        const chunk = Buffer.alloc(1600);
        for (let at = 0; at < chunk.length; at += 2) chunk.writeInt16LE(i * 100, at);
        session.sendAudio(chunk);
      }
      session.sendToolResult("desconhecida", {}); // não chega a sair: id que o motor não viu
      session.closeCallerTurn();
      fake.send({ setupComplete: {} });
      await nextEvent(session, "resumed");
      const values: number[] = [];
      for (let i = 0; i < 20; i++) {
        const message = (await fake.waitFor((m) => "realtimeInput" in m)) as { realtimeInput: { audio?: { data: string } } };
        values.push(Buffer.from(message.realtimeInput.audio?.data ?? "", "base64").readInt16LE(0));
      }
      expect(values).toEqual(Array.from({ length: 20 }, (_, i) => (i + 11) * 100));
      expect(await fake.waitFor((m) => "realtimeInput" in m)).toEqual({ realtimeInput: { audioStreamEnd: true } });
      await session.close();
    });

    it("queda com um handle guardado: retoma sem error nem closed", async () => {
      const { session } = await openSession({ greeting: undefined });
      const { order } = watch(session);
      fake.send({ sessionResumptionUpdate: { newHandle: "h-9", resumable: true } });
      // O handle precisa ter chegado antes da queda.
      await new Promise((resolve) => setTimeout(resolve, 20));
      fake.drop();
      const setup = await fake.waitFor(setupWithHandle);
      expect((setup.setup as Record<string, unknown>).sessionResumption).toEqual({ handle: "h-9" });
      fake.send({ setupComplete: {} });
      await nextEvent(session, "resumed");
      expect(order).toEqual(["resumed"]);
      // Uma tentativa por conexão: a nova também pode ser retomada quando a vez dela chegar.
      fake.send({ sessionResumptionUpdate: { newHandle: "h-10", resumable: true } });
      fake.send({ goAway: {} });
      const third = await fake.waitFor(setupWithHandle);
      expect((third.setup as Record<string, unknown>).sessionResumption).toEqual({ handle: "h-10" });
      expect(fake.connections()).toBe(3);
      await session.close();
      expect(order).toEqual(["resumed", "closed client"]);
    });

    it("sem handle guardado, o goAway não reconecta e a queda é a de sempre", async () => {
      const { session } = await openSession({ greeting: undefined });
      const { order } = watch(session);
      fake.send({ sessionResumptionUpdate: { newHandle: "", resumable: false } });
      fake.send({ goAway: { timeLeft: "1s" } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const closed = nextEvent(session, "closed");
      fake.drop();
      await closed;
      expect(fake.connections()).toBe(1);
      expect(order).toHaveLength(2);
      expect(order[0]).toMatch(/^error Gemini Live: a conexão caiu/);
      expect(order[1]).toBe("closed socket_closed");
    });

    it("goAway e retomada recusada: a ligação segue pela conexão de antes até o provedor fechá-la", async () => {
      const { session } = await openSession({ greeting: undefined });
      const { order } = watch(session);
      const agentAudio: Buffer[] = [];
      session.on("audio", (pcm) => agentAudio.push(pcm));
      fake.send({ sessionResumptionUpdate: { newHandle: "h-1", resumable: true } });
      fake.send({ goAway: { timeLeft: "10s" } });
      await fake.waitFor(setupWithHandle);
      // Sai durante a troca: espera, e com a recusa vai para a conexão de antes, na ordem.
      for (let i = 1; i <= 3; i++) session.sendAudio(Buffer.alloc(1600, i));
      session.closeCallerTurn();
      fake.refuse(1008, "session not found");
      const held: Record<string, unknown>[] = [];
      for (let i = 0; i < 4; i++) held.push(await fake.waitFor((m) => "realtimeInput" in m));
      expect(held.map((message) => fake.connectionOf(message))).toEqual([0, 0, 0, 0]);
      expect(held.slice(0, 3).map((m) => Buffer.from((m as { realtimeInput: { audio: { data: string } } }).realtimeInput.audio.data, "base64")[0])).toEqual([1, 2, 3]);
      expect(held[3]).toEqual({ realtimeInput: { audioStreamEnd: true } });
      // A sessão não fechou: a conexão de antes segue sendo a atual, nos dois sentidos.
      expect(order).toEqual([]);
      expect(fake.isOpen(0)).toBe(true);
      fake.sendOn(0, { serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(960).toString("base64"), mimeType: "audio/pcm;rate=24000" } }] } } });
      await vi.waitFor(() => expect(agentAudio).toHaveLength(1));
      session.sendAudio(Buffer.alloc(1600, 4));
      expect(fake.connectionOf(await fake.waitFor((m) => "realtimeInput" in m))).toBe(0);
      // O prazo acaba e o provedor fecha a de antes: aí a sessão cai, e ninguém tenta de novo.
      const closed = nextEvent(session, "closed");
      fake.drop(0);
      await closed;
      expect(order).toHaveLength(2);
      expect(order[0]).toMatch(/^error Gemini Live: a conexão caiu/);
      expect(order[1]).toBe("closed socket_closed");
      expect(fake.connections()).toBe(2);
      await session.close();
      expect(order).toHaveLength(2);
    });

    it("queda e retomada recusada: uma tentativa só, e a sessão cai já com error seguido de closed", async () => {
      const { session } = await openSession({ greeting: undefined });
      const { order } = watch(session);
      fake.send({ sessionResumptionUpdate: { newHandle: "h-1", resumable: true } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      fake.drop();
      await fake.waitFor(setupWithHandle);
      const closed = nextEvent(session, "closed");
      fake.refuse(1008, "session not found");
      await closed;
      expect(order).toHaveLength(2);
      expect(order[0]).toMatch(/^error Gemini Live: a conexão ia fechar e a retomada da sessão falhou .*session not found/);
      expect(order[1]).toBe("closed socket_closed");
      expect(fake.connections()).toBe(2);
      await session.close();
      expect(order).toHaveLength(2);
    });

    it("depois que a nova confirma, a fala da conexão que saiu é descartada e o consumo dela ainda conta", async () => {
      const { session } = await openSession({ greeting: undefined });
      const { order, usage } = watch(session);
      const agentAudio: Buffer[] = [];
      const transcripts: string[] = [];
      session.on("audio", (pcm) => agentAudio.push(pcm));
      session.on("transcript", ({ speaker, text }) => transcripts.push(`${speaker}: ${text}`));
      fake.send({ sessionResumptionUpdate: { newHandle: "h-1", resumable: true } });
      fake.send({ goAway: {} });
      await fake.waitFor(setupWithHandle);
      // No instante da confirmação, a de antes ainda está aberta do lado do provedor e manda fala,
      // texto e consumo (a fila do socket mantém a ordem: o consumo chega depois da fala).
      session.on("resumed", () => {
        fake.sendOn(0, {
          serverContent: {
            modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(960).toString("base64"), mimeType: "audio/pcm;rate=24000" } }] },
            outputTranscription: { text: "fala velha" },
            turnComplete: true,
          },
        });
        fake.sendOn(0, { usageMetadata: { promptTokenCount: 11, responseTokenCount: 5 } });
      });
      fake.send({ setupComplete: {} });
      await nextEvent(session, "resumed");
      await vi.waitFor(() => expect(usage).toEqual({ inputTokens: 11, outputTokens: 5 }));
      expect(agentAudio).toHaveLength(0);
      expect(transcripts).toEqual([]);
      // A nova fala normalmente.
      fake.send({ serverContent: { outputTranscription: { text: "fala nova" }, modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(960).toString("base64"), mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true } });
      await vi.waitFor(() => expect(transcripts).toEqual(["agent: fala nova"]));
      expect(agentAudio).toHaveLength(1);
      expect(order).toEqual(["resumed"]);
      await session.close();
    });

    it("close() no meio da troca fecha as duas conexões, com um closed client só", async () => {
      const { session } = await openSession({ greeting: undefined });
      const { order } = watch(session);
      fake.send({ sessionResumptionUpdate: { newHandle: "h-1", resumable: true } });
      fake.send({ goAway: {} });
      await fake.waitFor(setupWithHandle);
      await session.close();
      await session.close();
      await vi.waitFor(() => expect([fake.isOpen(0), fake.isOpen(1)]).toEqual([false, false]));
      expect(order).toEqual(["closed client"]);
    });
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

  it("a recusa antes do setupComplete leva o código e o motivo do provedor", async () => {
    // Forma medida numa instalação em 2026-11-16, com o crédito pré-pago esgotado.
    const connecting = engine.connect(config, "k", { baseUrl: fake.url });
    await fake.waitFor((message) => "setup" in message);
    fake.refuse(1011, "Your prepayment credits are depleted.");
    await expect(connecting).rejects.toThrow("Gemini Live: a conexão fechou antes de confirmar a sessão (código 1011; Your prepayment credits are depleted.)");
  });
});

describe("gemini-live: teste da chave (contrato com servidor HTTP falso)", () => {
  let http: Awaited<ReturnType<typeof startFakeHttp>>;
  beforeEach(async () => {
    http = await startFakeHttp();
  });
  afterEach(() => http.stop());
  const check = (options: KeyCheckOptions = {}) => engine.checkKey("chave-de-teste", { baseUrl: http.url, ...options });

  it("lê o modelo da sessão de voz com a chave no cabeçalho, nunca na URL", async () => {
    http.respond({ status: 200, body: { name: "models/gemini-3.8-live", version: "001" } });
    expect(await check()).toEqual({ result: "accepted", model: "gemini-3.8-live" });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]).toMatchObject({ method: "GET", url: "/models/gemini-3.8-live", headers: { "x-goog-api-key": "chave-de-teste" } });
    expect(http.requests[0]?.url).not.toContain("chave-de-teste");
  });

  it.each([
    ["401", "rejected", { status: 401, body: { error: { code: "authentication", message: "bad key" } } }],
    ["403", "rejected", { status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED" } } }],
    // O código de região é da OpenAI: no Gemini, 403 continua sendo chave recusada.
    ["403 com o código de região da OpenAI", "rejected", { status: 403, body: { error: { code: "unsupported_country_region_territory" } } }],
    ["400 com API_KEY_INVALID (forma antiga)", "rejected", { status: 400, body: { error: { code: 400, details: [{ "@type": "x", reason: "API_KEY_INVALID" }] } } }],
    ["404", "model_unavailable", { status: 404, body: { error: { code: "model_not_found" } } }],
    ["402", "no_credit", { status: 402, body: { error: { code: "payment_required" } } }],
    ["429", "rate_limited", { status: 429, body: { error: { code: "rate_limit_exceeded" } } }],
    ["503", "provider_error", { status: 503, body: "<html>indisponível</html>" }],
    ["400 sem motivo de chave", "unexpected_response", { status: 400, body: { error: { code: "invalid_request" } } }],
    ["200 fora do formato", "unexpected_response", { status: 200, body: { models: [] } }],
    ["200 que não é JSON", "unexpected_response", { status: 200, body: "ok" }],
  ] as const)("%s vira %s", async (_, result, reply) => {
    http.respond(reply);
    expect(await check({ model: "modelo-x" })).toEqual({ result, model: "modelo-x" });
  });

  it("sem resposta no prazo, ou sem servidor, é provedor fora do ar", async () => {
    http.respond({ status: 200, hang: true });
    expect((await check({ schedule: expireAtOnce })).result).toBe("unreachable");
    await http.stop();
    expect((await check()).result).toBe("unreachable");
  });
});

describe("gemini-live: desfecho da ligação (contrato com servidor HTTP falso)", () => {
  let http: Awaited<ReturnType<typeof startFakeHttp>>;
  beforeEach(async () => {
    http = await startFakeHttp();
  });
  afterEach(() => http.stop());
  const classify = (options: ClassifyOptions = {}) => {
    const run = engine.classifyOutcome;
    if (!run) throw new Error("gemini-live classifies the outcome");
    return run("chave-de-teste", { transcript: "Cliente: Pode marcar quinta.", tools: [] }, { baseUrl: http.url, ...options });
  };
  const palpite = { outcome: "booked", confidence: 0.9, evidence: "Pode marcar quinta." };

  it("lê o palpite e cobra o raciocínio como saída, pelo preço do modelo de texto", async () => {
    // 1 milhão de entrada a US$ 0,30 e 100 mil de saída (60 mil de resposta, 40 mil de raciocínio) a US$ 2,50: 55 centavos.
    http.respond({
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: JSON.stringify(palpite) }] } }], usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 60_000, thoughtsTokenCount: 40_000 } },
    });
    expect(await classify()).toEqual({ ok: true, guess: palpite, model: "gemini-3.5-flash-lite", usage: { inputTokens: 1_000_000, outputTokens: 100_000 }, costCents: 55, costMicrocents: 55_000_000 });
    expect(http.requests[0]).toMatchObject({ method: "POST", url: "/models/gemini-3.5-flash-lite:generateContent", headers: { "x-goog-api-key": "chave-de-teste" } });
  });

  it.each([
    ["400 com API_KEY_INVALID", "rejected", { status: 400, body: { error: { code: 400, details: [{ reason: "API_KEY_INVALID" }] } } }],
    ["404", "model_unavailable", { status: 404, body: { error: { code: 404 } } }],
    ["400 sem motivo de chave (schema recusado)", "unexpected_response", { status: 400, body: { error: { code: 400 } } }],
  ] as const)("%s vira %s, sem custo", async (_, failure, reply) => {
    http.respond(reply);
    expect(await classify()).toEqual({ ok: false, failure, status: reply.status, model: "gemini-3.5-flash-lite", usage: {}, costCents: 0, costMicrocents: 0 });
  });

  it("um 200 fora da forma é falha, mas o que foi cobrado vem junto", async () => {
    http.respond({ status: 200, body: { candidates: [{ content: { parts: [{ text: "não é JSON" }] } }], usageMetadata: { promptTokenCount: 1_000_000 } } });
    expect(await classify()).toEqual({ ok: false, failure: "unexpected_response", status: 200, model: "gemini-3.5-flash-lite", usage: { inputTokens: 1_000_000, outputTokens: 0 }, costCents: 30, costMicrocents: 30_000_000 });
  });

  it("sem resposta no prazo é provedor fora do ar", async () => {
    http.respond({ status: 200, hang: true });
    expect(await classify({ schedule: expireAtOnce })).toMatchObject({ ok: false, failure: "unreachable", status: null, costCents: 0 });
  });
});
