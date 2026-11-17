import { describe, expect, it } from "vitest";
import { FixedSpeechCache, countCharacters, prepareFixedSpeech, speechCostMicrocents } from "./synthesis";
import { createSimulatedSynthesizer } from "./synthesizers/simulated";
import { expireAtOnce } from "./testing/fake-http";
import { SynthesizerOpenError, type Speech, type SpeechEvents, type SpeechSynthesizer, type SynthesizerPricing } from "./types";

const PRICE: SynthesizerPricing = { centsPerThousandCharacters: 4, source: "https://exemplo.test/preco", checkedOn: "2026-11-17" };
const FAREWELL = ["Estou com um problema técnico.", "O limite de custo chegou. Até logo."];

/** Um sintetizador de teste que conta os `speak` e pode falhar ou nunca terminar. */
function counting(behavior: "ok" | "fail-open" | "fail-mid" | "silent" | "hang" = "ok", id = "contador") {
  const calls: Array<{ voiceId: string; model?: string }> = [];
  const synth: SpeechSynthesizer = {
    ...createSimulatedSynthesizer(),
    id,
    defaultModel: "m1",
    pricing: PRICE,
    pricingOf: (model) => (model === "m1" ? PRICE : undefined),
    async speak(config) {
      calls.push({ voiceId: config.voiceId, ...(config.model ? { model: config.model } : {}) });
      if (behavior === "fail-open") throw new SynthesizerOpenError("no_credit", "sem crédito");
      const handlers: { [K in keyof SpeechEvents]?: Array<(...args: never[]) => void> } = {};
      const emit = (event: keyof SpeechEvents, ...args: unknown[]) => (handlers[event] ?? []).forEach((h) => (h as (...a: unknown[]) => void)(...args));
      let text = "";
      const speech: Speech = {
        on: (event, handler) => void (handlers[event] ??= []).push(handler as never),
        push: (chunk) => {
          text += chunk;
          emit("usage", { characters: countCharacters(chunk), costMicrocents: speechCostMicrocents(PRICE, countCharacters(chunk)), estimated: true });
        },
        end: () =>
          setImmediate(() => {
            if (behavior === "hang") return;
            if (behavior === "fail-mid") return emit("error", new Error("caiu"));
            if (behavior !== "silent") emit("audio", Buffer.alloc(text.length * 2, 1));
            emit("done");
          }),
        cancel: () => undefined,
      };
      return speech;
    },
  };
  return { synth, calls };
}

describe("custo da voz", () => {
  it("caracteres × preço por mil, em micro-centavos; sem preço, undefined e nunca zero", () => {
    expect(speechCostMicrocents(PRICE, 1000)).toBe(4_000_000);
    expect(speechCostMicrocents(PRICE, 1)).toBe(4_000);
    expect(speechCostMicrocents({ ...PRICE, centsPerThousandCharacters: 8 }, 3)).toBe(24_000);
    expect(speechCostMicrocents(undefined, 50)).toBeUndefined();
    expect(countCharacters("ação 👋")).toBe(6);
  });
});

describe("prepareFixedSpeech", () => {
  it("sintetiza as falas fixas na abertura e devolve o áudio de cada uma, com o custo estimado", async () => {
    const { synth, calls } = counting();
    const cache = new FixedSpeechCache();
    const result = await prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache });
    expect([...result.audio.keys()]).toEqual(FAREWELL);
    expect(result.audio.get(FAREWELL[0] as string)?.length).toBeGreaterThan(0);
    const characters = FAREWELL.reduce((sum, t) => sum + countCharacters(t), 0);
    expect(result.usage).toEqual({ characters, costMicrocents: characters * 4_000, estimated: true });
    expect(calls).toEqual([
      { voiceId: "v1", model: "m1" },
      { voiceId: "v1", model: "m1" },
    ]);
  });

  it("a segunda ligação com a mesma voz não pede de novo e não paga de novo", async () => {
    const { synth, calls } = counting();
    const cache = new FixedSpeechCache();
    const first = await prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache });
    const second = await prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR", model: "m1" }, FAREWELL, "k", { cache });
    expect(calls).toHaveLength(2);
    expect(second.audio).toEqual(first.audio);
    expect(second.usage).toEqual({ characters: 0, costMicrocents: 0, estimated: true });
  });

  it("duas aberturas ao mesmo tempo pagam uma vez só", async () => {
    const { synth, calls } = counting();
    const cache = new FixedSpeechCache();
    const [a, b] = await Promise.all([
      prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache }),
      prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache }),
    ]);
    expect(calls).toHaveLength(2);
    expect((a.usage.characters ?? 0) + (b.usage.characters ?? 0)).toBe(FAREWELL.reduce((sum, t) => sum + countCharacters(t), 0));
  });

  it("voz diferente, modelo diferente ou sintetizador diferente pedem de novo", async () => {
    const { synth, calls } = counting();
    const cache = new FixedSpeechCache();
    await prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache });
    await prepareFixedSpeech(synth, { voiceId: "v2", language: "pt-BR" }, FAREWELL, "k", { cache });
    await prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR", model: "m2" }, FAREWELL, "k", { cache });
    const other = counting("ok", "outro");
    await prepareFixedSpeech(other.synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache });
    expect(calls).toHaveLength(6);
    expect(other.calls).toHaveLength(2);
    expect(cache.size).toBe(8);
  });

  it("modelo sem preço: custo ausente, nunca zero", async () => {
    const { synth } = counting();
    // O sintetizador de teste cobra pelo PRICE, mas um envio sem custo derruba o total para "sem preço".
    const unpriced: SpeechSynthesizer = {
      ...synth,
      async speak(config, key, options) {
        const speech = await synth.speak(config, key, options);
        return {
          ...speech,
          on: (event, handler) =>
            event === "usage"
              ? speech.on("usage", (usage) => (handler as SpeechEvents["usage"])({ characters: usage.characters, estimated: true }))
              : speech.on(event, handler),
        };
      },
    };
    const result = await prepareFixedSpeech(unpriced, { voiceId: "v1", language: "pt-BR", model: "m9" }, ["Oi"], "k", { cache: new FixedSpeechCache() });
    expect(result.usage).toEqual({ characters: 2, estimated: true });
  });

  it.each(["fail-open", "fail-mid", "silent"] as const)("falha ao preparar (%s) é recusa de abertura, e não fica no cache", async (behavior) => {
    const { synth, calls } = counting(behavior);
    const cache = new FixedSpeechCache();
    const opening = prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache });
    await expect(opening).rejects.toBeInstanceOf(SynthesizerOpenError);
    expect(cache.size).toBe(0);
    await expect(prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, FAREWELL, "k", { cache })).rejects.toBeInstanceOf(SynthesizerOpenError);
    expect(calls.length).toBe(4);
  });

  it("fala que não termina no prazo é recusa de abertura (unreachable)", async () => {
    const { synth } = counting("hang");
    await expect(
      prepareFixedSpeech(synth, { voiceId: "v1", language: "pt-BR" }, ["Oi"], "k", { cache: new FixedSpeechCache(), schedule: expireAtOnce }),
    ).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("funciona de ponta a ponta com a voz simulada", async () => {
    const result = await prepareFixedSpeech(createSimulatedSynthesizer(), { voiceId: "simulated", language: "pt-BR" }, ["Até logo."], "", { cache: new FixedSpeechCache() });
    expect(result.audio.get("Até logo.")).toHaveLength(9 * 160);
    expect(result.usage).toEqual({ characters: 9, costMicrocents: 0, estimated: true });
  });
});
