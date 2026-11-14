import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  const SETUP_SEM_VOCABULARIO =
    '{"setup":{"model":"models/modelo-x","generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Sulafat"}}}},' +
    '"systemInstruction":{"parts":[{"text":"Você atende a clínica.\\n\\nSpeak only in pt-BR."}]},' +
    '"tools":[{"functionDeclarations":[{"name":"end_call","description":"Encerra a ligação","parametersJsonSchema":{"type":"object","properties":{}}}]}],' +
    '"inputAudioTranscription":{"languageCodes":["pt-BR"]},"outputAudioTranscription":{}}}';

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
    ["503", "unreachable", { status: 503, body: "<html>indisponível</html>" }],
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
