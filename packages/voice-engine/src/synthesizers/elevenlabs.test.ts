import { afterEach, describe, expect, it } from "vitest";
import { startFakeProvider } from "../testing/fake-provider";
import { expireAtOnce, startFakeHttp } from "../testing/fake-http";
import { SynthesizerOpenError, type SpeechUsage } from "../types";
import synthesizer, { voiceOf } from "./elevenlabs";

type Fake = Awaited<ReturnType<typeof startFakeProvider>>;
let fake: Fake | undefined;
let http: Awaited<ReturnType<typeof startFakeHttp>> | undefined;
afterEach(async () => {
  await fake?.stop();
  await http?.stop();
  fake = undefined;
  http = undefined;
});

const text = (value: string) => (message: Record<string, unknown>) => message.text === value;

/** Abre uma fala contra o servidor falso e devolve o que ela emite. */
async function openSpeech(model?: string) {
  fake = await startFakeProvider();
  const speech = await synthesizer.speak({ voiceId: "voz 1", language: "pt-BR", ...(model ? { model } : {}) }, "xi-teste", { baseUrl: fake.url });
  const seen = { audio: [] as Buffer[], usage: [] as SpeechUsage[], spoken: [] as number[], done: 0, errors: [] as Error[] };
  speech.on("audio", (pcm) => seen.audio.push(pcm));
  speech.on("usage", (usage) => seen.usage.push(usage));
  speech.on("spoken", (chars) => seen.spoken.push(chars));
  speech.on("done", () => seen.done++);
  speech.on("error", (error) => seen.errors.push(error));
  await fake.waitFor(text(" "));
  return { speech, seen, fake };
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
};

const totalCost = (usage: SpeechUsage[]): number => usage.reduce((sum, item) => sum + (item.costMicrocents ?? Number.NaN), 0);

describe("elevenlabs (contrato com servidor falso)", () => {
  it("abre com a chave no cabeçalho, o modelo padrão, pcm_8000, o idioma e o espaço inicial", async () => {
    const { fake: server } = await openSpeech();
    const url = new URL(server.request.url, "ws://x");
    expect(url.pathname).toBe("/v1/text-to-speech/voz%201/stream-input");
    expect(Object.fromEntries(url.searchParams)).toEqual({ model_id: "eleven_flash_v2_5", output_format: "pcm_8000", language_code: "pt" });
    expect(server.request.headers["xi-api-key"]).toBe("xi-teste");
    // A chave nunca vai na URL.
    expect(server.request.url).not.toContain("xi-teste");
  });

  it("não manda language_code ao modelo que não o aceita (multilingual_v2)", async () => {
    const { fake: server } = await openSpeech("eleven_multilingual_v2");
    expect(new URL(server.request.url, "ws://x").searchParams.has("language_code")).toBe(false);
  });

  it("manda o texto em pedaços e o flush, e entrega o PCM16 como veio, sem reamostrar", async () => {
    const { speech, seen, fake: server } = await openSpeech();
    speech.push("Olá, ");
    speech.push("tudo bem?", { flush: true });
    expect(await server.waitFor(text("Olá, "))).toEqual({ text: "Olá, " });
    expect(await server.waitFor(text("tudo bem?"))).toEqual({ text: "tudo bem?", flush: true });
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
    server.send({ audio: pcm.toString("base64"), alignment: { chars: ["O", "l", "á"] } });
    await until(() => seen.audio.length === 1);
    expect(seen.audio[0]).toEqual(pcm);
    expect(seen.spoken).toEqual([3]);
  });

  it("não parte uma amostra PCM16 ao meio quando o pedaço vem com número ímpar de bytes", async () => {
    const { seen, fake: server } = await openSpeech();
    server.send({ audio: Buffer.from([1, 2, 3]).toString("base64") });
    server.send({ audio: Buffer.from([4, 5, 6]).toString("base64") });
    await until(() => seen.audio.length === 2);
    expect(seen.audio).toEqual([Buffer.from([1, 2]), Buffer.from([3, 4, 5, 6])]);
  });

  it("end manda text vazio; isFinal termina a fala com done", async () => {
    const { speech, seen, fake: server } = await openSpeech();
    speech.push("Até logo.", { flush: true });
    speech.end();
    await server.waitFor(text(""));
    server.send({ audio: Buffer.from([0, 0]).toString("base64") });
    server.send({ isFinal: true, audio: null });
    await until(() => seen.done === 1);
    expect(seen.errors).toEqual([]);
    // Depois de end, push não manda nada.
    speech.push("mais");
    expect(seen.usage.map((u) => u.characters)).toEqual([9]);
  });

  it("fechamento 1000 depois do end, sem nenhum isFinal, termina em done e não em error", async () => {
    const { speech, seen, fake: server } = await openSpeech();
    speech.push("Até logo.", { flush: true });
    speech.end();
    await server.waitFor(text(""));
    // Áudio sem isFinal; depois o provedor fecha normalmente. Nenhuma mensagem leva isFinal.
    server.send({ audio: Buffer.from([1, 0]).toString("base64") });
    await until(() => seen.audio.length === 1);
    server.refuse(1000, "");
    await until(() => seen.done === 1);
    expect(seen.errors).toEqual([]);
    expect(seen.audio).toEqual([Buffer.from([1, 0])]);
  });

  it("fechamento 1000 sem end antes continua sendo error, sem done", async () => {
    const { speech, seen, fake: server } = await openSpeech();
    speech.push("Oi");
    server.refuse(1000, "");
    await until(() => seen.errors.length === 1);
    expect(seen.errors[0]?.message).toMatch(/caiu antes do fim \(código 1000/);
    expect(seen.done).toBe(0);
  });

  it("custo: caracteres × preço do modelo, sempre estimado; Flash a 4 ¢ e multilingual a 8 ¢ por mil", async () => {
    const flash = await openSpeech();
    flash.speech.push("Bom dia");
    flash.speech.push(", ok", { flush: true });
    expect(flash.seen.usage).toEqual([
      { characters: 7, costMicrocents: 28_000, estimated: true },
      { characters: 4, costMicrocents: 16_000, estimated: true },
    ]);
    await fake?.stop();
    const multi = await openSpeech("eleven_multilingual_v2");
    multi.speech.push("ação");
    expect(multi.seen.usage).toEqual([{ characters: 4, costMicrocents: 32_000, estimated: true }]);
  });

  it("modelo sem preço na tabela sai sem custo conhecido, nunca zero", async () => {
    expect(synthesizer.pricingOf("eleven_desconhecido")).toBeUndefined();
    const { speech, seen } = await openSpeech("eleven_desconhecido");
    speech.push("Oi");
    expect(seen.usage).toEqual([{ characters: 2, estimated: true }]);
    expect(seen.usage[0]).not.toHaveProperty("costMicrocents");
  });

  it("cancel no meio: para de entregar áudio e cobra o que já foi enviado, não zero", async () => {
    const { speech, seen, fake: server } = await openSpeech();
    speech.push("Uma frase bem comprida que vai ser cortada", { flush: true });
    await server.waitFor((m) => typeof m.text === "string" && m.text.startsWith("Uma"));
    server.send({ audio: Buffer.from([1, 0]).toString("base64") });
    await until(() => seen.audio.length === 1);
    speech.cancel();
    server.send({ audio: Buffer.from([2, 0]).toString("base64") });
    server.send({ isFinal: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen.audio).toHaveLength(1);
    expect(seen.done).toBe(0);
    expect(seen.errors).toEqual([]);
    expect(totalCost(seen.usage)).toBe(42 * 4_000);
    expect(totalCost(seen.usage)).toBeGreaterThan(0);
    speech.push("depois do cancel");
    expect(seen.usage).toHaveLength(1);
  });

  it("conexão que cai no meio vira error, sem done", async () => {
    const { speech, seen, fake: server } = await openSpeech();
    speech.push("Oi");
    server.drop();
    await until(() => seen.errors.length === 1);
    expect(seen.errors[0]?.message).toMatch(/caiu antes do fim/);
    expect(seen.done).toBe(0);
  });

  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [402, "no_credit"],
    [429, "rate_limited"],
    [503, "provider_error"],
  ] as const)("recusa %i na abertura vira SynthesizerOpenError(%s)", async (status, reason) => {
    fake = await startFakeProvider({ rejectUpgrade: status });
    const opening = synthesizer.speak({ voiceId: "v", language: "pt-BR" }, "xi-teste", { baseUrl: fake.url });
    await expect(opening).rejects.toBeInstanceOf(SynthesizerOpenError);
    await expect(opening).rejects.toMatchObject({ reason });
  });

  it("prazo de abertura: sem aperto de mão no prazo, recusa como unreachable", async () => {
    fake = await startFakeProvider();
    const opening = synthesizer.speak({ voiceId: "v", language: "pt-BR" }, "xi-teste", { baseUrl: fake.url, readyTimeoutMs: 1, schedule: expireAtOnce });
    await expect(opening).rejects.toMatchObject({ reason: "unreachable", message: expect.stringMatching(/não abriu a fala/) });
  });

  it("sem servidor nenhum, recusa como unreachable", async () => {
    const server = await startFakeProvider();
    const url = server.url;
    await server.stop();
    await expect(synthesizer.speak({ voiceId: "v", language: "pt-BR" }, "xi-teste", { baseUrl: url })).rejects.toMatchObject({ reason: "unreachable" });
  });
});

describe("elevenlabs: preço", () => {
  it("cada preço tem fonte e data; o padrão é eleven_flash_v2_5", () => {
    expect(synthesizer.defaultModel).toBe("eleven_flash_v2_5");
    expect(synthesizer.pricing).toEqual({ centsPerThousandCharacters: 4, source: "https://elevenlabs.io/pricing/api", checkedOn: "2026-11-17" });
    for (const model of ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_flash_v2", "eleven_turbo_v2", "eleven_multilingual_v2", "eleven_v3"]) {
      const price = synthesizer.pricingOf(model);
      expect(price?.source).toMatch(/^https:\/\//);
      expect(price?.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(price?.centsPerThousandCharacters).toBeGreaterThan(0);
    }
    // Herança de objeto não vira modelo com preço.
    expect(synthesizer.pricingOf("toString")).toBeUndefined();
  });
});

describe("elevenlabs: vozes", () => {
  const page = (voices: unknown[], next?: string) => ({ voices, has_more: next !== undefined, next_page_token: next ?? null, total_count: 0 });
  const voice = (id: string, extra: Record<string, unknown> = {}) => ({ voice_id: id, name: `Voz ${id}`, category: "premade", ...extra });

  /** `fetch` falso com uma resposta por página, que guarda os pedidos. */
  const pagedFetch = (pages: Array<{ status: number; body: unknown }>) => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      requests.push({ url, headers: init.headers as Record<string, string> });
      const reply = pages[requests.length - 1] ?? { status: 500, body: {} };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }) as unknown as typeof fetch;
    return { fetchFn, requests };
  };

  it("lê todas as páginas (page_size 100, next_page_token) com a chave no cabeçalho", async () => {
    const { fetchFn, requests } = pagedFetch([
      { status: 200, body: page([voice("a")], "tok-2") },
      { status: 200, body: page([voice("b")]) },
    ]);
    const result = await synthesizer.listVoices("xi-teste", { fetch: fetchFn, baseUrl: "https://falso.test" });
    expect(result).toEqual({ ok: true, voices: [{ id: "a", name: "Voz a", languages: [] }, { id: "b", name: "Voz b", languages: [] }] });
    expect(requests.map((r) => r.url)).toEqual(["https://falso.test/v2/voices?page_size=100", "https://falso.test/v2/voices?page_size=100&next_page_token=tok-2"]);
    expect(requests[0]?.headers["xi-api-key"]).toBe("xi-teste");
  });

  it("idiomas de verified_languages (locale, senão language) e amostra só https", async () => {
    const { fetchFn } = pagedFetch([
      {
        status: 200,
        body: page([
          voice("a", {
            preview_url: "https://cdn.test/a.mp3",
            verified_languages: [{ language: "pt", locale: "pt-BR", model_id: "eleven_flash_v2_5" }, { language: "en" }, { language: "pt", locale: "pt-BR" }, 42],
          }),
          voice("b", { preview_url: "http://cdn.test/b.mp3", verified_languages: null }),
        ]),
      },
    ]);
    const result = await synthesizer.listVoices("xi", { fetch: fetchFn });
    expect(result).toEqual({
      ok: true,
      voices: [
        { id: "a", name: "Voz a", languages: ["pt-BR", "en"], previewUrl: "https://cdn.test/a.mp3" },
        { id: "b", name: "Voz b", languages: [] },
      ],
    });
  });

  it("voz fora da forma é pulada, sem derrubar a lista", async () => {
    expect(voiceOf({ name: "sem id" })).toBeUndefined();
    expect(voiceOf({ voice_id: "", name: "id vazio" })).toBeUndefined();
    const { fetchFn } = pagedFetch([{ status: 200, body: page([{ voice_id: 7 }, "texto", voice("ok")]) }]);
    expect(await synthesizer.listVoices("xi", { fetch: fetchFn })).toEqual({ ok: true, voices: [{ id: "ok", name: "Voz ok", languages: [] }] });
  });

  it("recusa no vocabulário fechado, inclusive na segunda página", async () => {
    for (const [status, failure] of [
      [401, "rejected"],
      [402, "no_credit"],
      [429, "rate_limited"],
      [500, "provider_error"],
      [404, "unexpected_response"],
    ] as const) {
      const { fetchFn } = pagedFetch([{ status: 200, body: page([voice("a")], "t") }, { status, body: { detail: "texto do provedor" } }]);
      expect(await synthesizer.listVoices("xi", { fetch: fetchFn })).toEqual({ ok: false, failure, status });
    }
  });

  it("corpo fora da forma, token repetido e rede caída", async () => {
    const odd = pagedFetch([{ status: 200, body: { vozes: [] } }]);
    expect(await synthesizer.listVoices("xi", { fetch: odd.fetchFn })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
    const loop = pagedFetch([{ status: 200, body: page([], "t") }, { status: 200, body: page([], "t") }]);
    expect(await synthesizer.listVoices("xi", { fetch: loop.fetchFn })).toEqual({ ok: false, failure: "unexpected_response", status: 200 });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await synthesizer.listVoices("xi", { fetch: down })).toEqual({ ok: false, failure: "unreachable", status: null });
  });
});

describe("elevenlabs: teste da chave", () => {
  it("usa GET /v2/voices?page_size=1, sem sintetizar, com a chave no cabeçalho", async () => {
    http = await startFakeHttp();
    http.respond({ status: 200, body: { voices: [], has_more: false } });
    expect(await synthesizer.checkKey("xi-teste", { baseUrl: http.url })).toEqual({ result: "accepted", model: "eleven_flash_v2_5" });
    expect(http.requests).toEqual([expect.objectContaining({ method: "GET", url: "/v2/voices?page_size=1" })]);
    expect(http.requests[0]?.headers["xi-api-key"]).toBe("xi-teste");
  });

  it.each([
    [401, "rejected"],
    [402, "no_credit"],
    [429, "rate_limited"],
    [502, "provider_error"],
    [404, "unexpected_response"],
  ] as const)("status %i vira %s", async (status, result) => {
    http = await startFakeHttp();
    http.respond({ status, body: { detail: { status: "x", message: "texto do provedor" } } });
    expect((await synthesizer.checkKey("xi", { baseUrl: http.url })).result).toBe(result);
  });

  it("prazo vira unreachable", async () => {
    http = await startFakeHttp();
    http.respond({ status: 200, hang: true });
    expect((await synthesizer.checkKey("xi", { baseUrl: http.url, schedule: expireAtOnce })).result).toBe("unreachable");
  });
});

