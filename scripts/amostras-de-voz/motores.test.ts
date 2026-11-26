/**
 * Os dois motores de verdade, contra o provedor falso de `packages/voice-engine` (WebSocket local,
 * sem rede e sem chave): a amostra sai do modelo padrão do motor (o da ligação), com a voz pedida e
 * o pedido de fala literal do `say`, e o texto falado e o custo vêm do que o provedor devolve.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeProvider } from "../../packages/voice-engine/src/testing/fake-provider";
import { FRASES, IDIOMAS, gerarAmostras, type Manifesto, type MotorDasAmostras } from "./amostras";
import { MOTORES } from "./motores";

const CHAVE = "chave-falsa-das-amostras-123456";
type Fake = Awaited<ReturnType<typeof startFakeProvider>>;
type Mensagem = Record<string, unknown>;

let fake: Fake;
let saida: string;
beforeEach(async () => {
  fake = await startFakeProvider();
  saida = await mkdtemp(join(tmpdir(), "amostras-motores-"));
});
afterEach(async () => {
  await fake.stop();
  await rm(saida, { recursive: true, force: true });
});

const motor = (id: string): MotorDasAmostras => {
  const real = MOTORES.find((m) => m.id === id);
  if (!real) throw new Error(id);
  return { ...real, baseUrl: fake.url };
};

async function gerar(m: MotorDasAmostras, voz: string): Promise<{ manifesto: Manifesto; linhas: string[] }> {
  const linhas: string[] = [];
  const codigo = await gerarAmostras(["--teto-usd", "2", "--vozes", voz], {
    motores: [m],
    codificar: async () => undefined,
    conferirCodificador: async () => null,
    esperar: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5_000))),
    agora: () => new Date("2026-11-23T12:00:00Z"),
    saida: (linha) => linhas.push(linha),
    ambiente: { [m.variavelDaChave]: CHAVE },
    saidaPadrao: saida,
  });
  expect(codigo).toBe(0);
  return { manifesto: JSON.parse(await readFile(join(saida, "manifesto.json"), "utf8")) as Manifesto, linhas };
}

/** A frase que o motor mandou dizer, de dentro do pedido de fala literal. */
const fraseDoPedido = (texto: string): string => /"(.*)"$/.exec(texto)?.[1] ?? "";

describe("gemini-live", () => {
  it("abre o modelo padrão com a voz pedida, pede a frase e guarda o texto falado e o custo", async () => {
    const setups: Mensagem[] = [];
    const roteiro = (async () => {
      for (const _ of IDIOMAS) {
        setups.push(await fake.waitFor((m) => "setup" in m));
        fake.send({ setupComplete: {} });
        const pedido = (await fake.waitFor((m) => "realtimeInput" in m)) as { realtimeInput: { text: string } };
        const frase = fraseDoPedido(pedido.realtimeInput.text);
        fake.send({ serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(4800).toString("base64"), mimeType: "audio/pcm;rate=24000" } }] } } });
        fake.send({ serverContent: { outputTranscription: { text: frase } } });
        fake.send({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 100, responseTokenCount: 200 } });
      }
    })();
    const { manifesto } = await gerar(motor("gemini-live"), "Kore");
    await roteiro;
    expect(setups.map((s) => (s as { setup: { model: string } }).setup.model)).toEqual(["models/gemini-3.8-live", "models/gemini-3.8-live", "models/gemini-3.8-live"]);
    expect(JSON.stringify(setups[0])).toContain('"voiceName":"Kore"');
    expect(manifesto.amostras.map((a) => [a.arquivo, a.situacao, a.falado])).toEqual(IDIOMAS.map((i) => [`gemini-live/Kore.${i}.mp3`, "ok", FRASES[i]]));
    // 100 × US$ 3/M + 200 × US$ 12/M, pelo preço do motor.
    expect(manifesto.amostras[0]?.custoUsd).toBeCloseTo(0.0027, 10);
    expect(manifesto.amostras[0]?.custoEstimado).toBe(false);
  });
});

describe("openai-realtime", () => {
  it("abre o modelo padrão com a voz pedida, pede a frase e guarda o texto falado e o custo", async () => {
    const urls: string[] = [];
    const updates: Mensagem[] = [];
    const roteiro = (async () => {
      for (const _ of IDIOMAS) {
        updates.push(await fake.waitFor((m) => m.type === "session.update"));
        urls.push(fake.request.url);
        fake.send({ type: "session.updated", session: {} });
        const pedido = (await fake.waitFor((m) => m.type === "response.create")) as { response: { instructions: string } };
        const frase = fraseDoPedido(pedido.response.instructions);
        fake.send({ type: "response.output_audio.delta", item_id: "i1", delta: Buffer.alloc(800, 0xff).toString("base64") });
        fake.send({ type: "response.output_audio_transcript.done", transcript: `${frase} ` });
        fake.send({ type: "response.done", response: { usage: { input_tokens: 100, output_tokens: 300, input_token_details: { text_tokens: 100 }, output_token_details: { audio_tokens: 200, text_tokens: 100 } } } });
      }
    })();
    const { manifesto } = await gerar(motor("openai-realtime"), "cedar");
    await roteiro;
    expect(urls).toEqual(["/?model=gpt-realtime-2.1", "/?model=gpt-realtime-2.1", "/?model=gpt-realtime-2.1"]);
    expect(JSON.stringify(updates[0])).toContain('"voice":"cedar"');
    expect(manifesto.amostras.map((a) => [a.arquivo, a.situacao])).toEqual(IDIOMAS.map((i) => [`openai-realtime/cedar.${i}.mp3`, "ok"]));
    expect(manifesto.amostras.every((a) => a.custoUsd > 0 && !a.custoEstimado)).toBe(true);
  });
});
