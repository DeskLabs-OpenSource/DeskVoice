// O idioma do "ainda está aí?" (Vapi · fatia 9, acompanhamento DESA-392). Os textos da guarda são
// fixos em pt-BR (`caller-idle.ts`), e o comentário de lá diz que o motor fala no idioma do agente. Este
// teste olha o que de fato sai para o provedor, com os motores de verdade contra o servidor falso: o
// texto em pt-BR vai embrulhado no pedido de dizê-lo no idioma do agente, e não como fala literal.
// Se o modelo de fato traduz é coisa do provedor, e não cabe aqui.
import { encryptSecret } from "@deskvoice/core";
import type { VoiceEngine } from "@deskvoice/voice-engine";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDbs } from "../../../packages/core/test/helpers";
import { putSetting } from "../../../packages/tools/test/helpers";
import geminiLive from "../../../packages/voice-engine/src/engines/gemini-live";
import openaiRealtime from "../../../packages/voice-engine/src/engines/openai-realtime";
import { startFakeProvider } from "../../../packages/voice-engine/src/testing/fake-provider";
import { IDLE_ASK, IDLE_FIRST_MS } from "./caller-idle";
import { startCallSession } from "./call-session";
import { engineKeySetting } from "./session-config";
import { createAgent, createCall, createOrganization, kindsOf, manualTransport, secretKey, sessionHarness, type SessionHarness } from "./testing/db";
import { waitFor } from "./testing/helpers";

const { app, owner } = openTestDbs();
let harness: SessionHarness | undefined;
let fake: Awaited<ReturnType<typeof startFakeProvider>>;

beforeEach(async () => {
  fake = await startFakeProvider();
});
afterEach(async () => {
  await harness?.approvals.close();
  harness = undefined;
  await fake.stop();
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

type Message = Record<string, unknown>;
/** O pedido de fala literal dos dois motores, com o idioma da sessão. */
const literal = (language: string, text: string): string => `Say exactly the following to the caller, in ${language}, without adding anything: "${text}"`;

interface Provider {
  engine: VoiceEngine;
  /** A abertura da sessão, do lado do servidor falso. */
  open(): Promise<void>;
  /** 20 ms de fala do agente, como o provedor manda. */
  speak(): void;
  /** O texto que o motor mandou ao provedor para fazer o agente falar, se a mensagem é uma dessas. */
  spoken(message: Message): string | undefined;
}

const providers: Record<"openai-realtime" | "gemini-live", () => Provider> = {
  "openai-realtime": () => ({
    engine: { ...openaiRealtime, connect: (config, apiKey) => openaiRealtime.connect(config, apiKey, { baseUrl: fake.url, model: "modelo-x" }) },
    async open() {
      await fake.waitFor((message) => message.type === "session.update");
      fake.send({ type: "session.updated", session: {} });
    },
    speak() {
      // 160 bytes de μ-law a 8 kHz: 20 ms. A resposta acaba logo, e a fila de falas anda.
      fake.send({ type: "response.output_audio.delta", delta: Buffer.alloc(160, 0xff).toString("base64") });
      for (let done = 0; done < 3; done++) fake.send({ type: "response.done", response: {} });
    },
    spoken: (message) => (message.type === "response.create" ? ((message.response as { instructions?: string } | undefined)?.instructions ?? undefined) : undefined),
  }),
  "gemini-live": () => ({
    engine: { ...geminiLive, connect: (config, apiKey) => geminiLive.connect(config, apiKey, { baseUrl: fake.url, model: "modelo-x" }) },
    async open() {
      await fake.waitFor((message) => "setup" in message);
      fake.send({ setupComplete: {} });
    },
    speak() {
      // 960 bytes de PCM a 24 kHz: 20 ms.
      fake.send({ serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(960).toString("base64"), mimeType: "audio/pcm;rate=24000" } }] } } });
      fake.send({ serverContent: { turnComplete: true } });
    },
    spoken: (message) => (message.realtimeInput as { text?: string } | undefined)?.text,
  }),
};

describe("o \"ainda está aí?\" com o agente em outro idioma", { timeout: 120_000 }, () => {
  it.each([
    ["openai-realtime", "en"],
    ["openai-realtime", "es"],
    ["gemini-live", "en"],
    ["gemini-live", "es"],
  ] as const)("%s, agente em %s: o texto em pt-BR vai ao provedor embrulhado no pedido de dizê-lo no idioma do agente", async (engineId, language) => {
    const provider = providers[engineId]();
    const organizationId = await createOrganization(app, `caller-idle-${engineId}-${language}`);
    const agentId = await createAgent(app, organizationId, { engine: engineId, language, greeting: language === "en" ? "Good morning." : "Buenos días." });
    await putSetting(app, organizationId, engineKeySetting(engineId), encryptSecret("sk-teste", secretKey));
    await harness?.approvals.close();
    harness = await sessionHarness(app, [provider.engine]);
    const callId = await createCall(app, organizationId, agentId, harness.clock.now());
    const transport = manualTransport();
    const session = startCallSession(harness.deps, { organizationId, callId, agentId, transport });
    await provider.open();
    await waitFor(async () => (await kindsOf(app, callId)).includes("call_answered"), "the call to be answered");

    // O que o motor mandou ao provedor para o agente falar, do começo da ligação até aqui.
    const asked: string[] = [];
    const ask = fake.waitFor((message) => {
      const text = provider.spoken(message);
      if (text !== undefined) asked.push(text);
      return text?.includes(IDLE_ASK) ?? false;
    });
    // O agente fala 20 ms, e quem ligou fica calado.
    provider.speak();
    await waitFor(() => harness?.timers.held().includes(20 + IDLE_FIRST_MS) ?? false, "the caller idle guard to arm");
    harness.clock.advance(20 + IDLE_FIRST_MS);
    expect(harness.timers.fire(20 + IDLE_FIRST_MS)).toBe(1);
    await ask;
    await waitFor(async () => (await kindsOf(app, callId)).includes("caller_idle"), "the caller_idle event");

    // O que vai ao provedor: o pedido de dizer a frase no idioma do agente, e nunca a frase sozinha.
    expect(asked.filter((text) => text.includes(IDLE_ASK))).toEqual([literal(language, IDLE_ASK)]);
    expect(asked).not.toContain(IDLE_ASK);

    transport.callerHangup();
    expect(await session.done).toMatchObject({ endReason: "caller_hangup" });
  });
});
