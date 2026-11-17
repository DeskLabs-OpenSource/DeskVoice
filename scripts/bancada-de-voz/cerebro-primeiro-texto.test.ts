import { describe, expect, it } from "vitest";
import { PEDIDOS, medirUm, resumir, rodar, type MedidaDoCerebro } from "./cerebro-primeiro-texto";
import anthropic from "../../packages/voice-engine/src/brains/anthropic";
import gemini from "../../packages/voice-engine/src/brains/gemini";
import openai from "../../packages/voice-engine/src/brains/openai";

// Inventada: o teste procura por ela onde não pode aparecer.
const CHAVE = "openai-chave-falsa-7777gggg";

const medida = (primeiroTextoMs: number | null, estimado = true): MedidaDoCerebro => ({
  primeiroTextoMs,
  usage: primeiroTextoMs === null ? null : { inputTokens: 100, outputTokens: 5 },
  estimado,
});

/** Relógio que anda só quando o teste manda. */
const relogioFalso = () => {
  let t = 1_000;
  return { agora: () => t, andar: (ms: number) => (t += ms) };
};

/** `fetch` falso: um pedaço de texto no SSE e o servidor fica aberto, como o provedor antes do cancel. */
function fetchQueFala(antes: () => void) {
  const pedidos: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    pedidos.push(url);
    antes();
    const corpo = new ReadableStream<Uint8Array>({
      start(controle) {
        controle.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Claro!" } }] })}\n\n`));
        init.signal?.addEventListener("abort", () => controle.error(new DOMException("abortado", "AbortError")));
      },
    });
    return new Response(corpo, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, pedidos };
}

describe("bancada do cérebro: pedido → primeiro texto", () => {
  it("tem 30 pedidos curtos e sintéticos", () => {
    expect(PEDIDOS).toHaveLength(30);
    for (const pedido of PEDIDOS) expect(pedido.length).toBeLessThanOrEqual(60);
  });

  it("resume p50/p95 só com os pedidos que tiveram texto, e soma o consumo", () => {
    const r = resumir([medida(100), medida(200), medida(300), medida(null), { ...medida(400, false), erro: "x" }]);
    expect(r).toMatchObject({ pedidos: 5, comTexto: 4, primeiroTextoP50Ms: 200, primeiroTextoP95Ms: 400, tokensDeEntrada: 400, tokensDeSaida: 20, consumosEstimados: 3, erros: ["x"] });
  });

  it("mede do chat ao primeiro texto, cancela e fica com o consumo estimado", async () => {
    const relogio = relogioFalso();
    const { fetch, pedidos } = fetchQueFala(() => relogio.andar(420));
    const m = await medirUm(openai, CHAVE, "gpt-4.1-mini", "Oi", { relogio, fetch });
    expect(pedidos).toEqual(["https://api.openai.com/v1/chat/completions"]);
    expect(m.primeiroTextoMs).toBe(420);
    expect(m.estimado).toBe(true);
    expect(m.usage?.inputTokens).toBeGreaterThan(0);
  });

  it("mede a Anthropic no formato dela: o primeiro text_delta para o relógio", async () => {
    const relogio = relogioFalso();
    const pedidos: string[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      pedidos.push(url);
      relogio.andar(250);
      const eventos = [
        { type: "message_start", message: { content: [], usage: { input_tokens: 30, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Claro!" } },
      ];
      const corpo = new ReadableStream<Uint8Array>({
        start(controle) {
          for (const evento of eventos) controle.enqueue(new TextEncoder().encode(`event: ${evento.type}\ndata: ${JSON.stringify(evento)}\n\n`));
          init.signal?.addEventListener("abort", () => controle.error(new DOMException("abortado", "AbortError")));
        },
      });
      return new Response(corpo, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const m = await medirUm(anthropic, CHAVE, "claude-haiku-4-5-20251001", "Oi", { relogio, fetch });
    expect(pedidos).toEqual(["https://api.anthropic.com/v1/messages"]);
    expect(m.primeiroTextoMs).toBe(250);
    expect(m.estimado).toBe(true);
    expect(m.usage?.inputTokens).toBeGreaterThan(0);
  });

  it("mede o Gemini no formato dele: o primeiro pedaço com texto para o relógio, e a chave fica no cabeçalho", async () => {
    const relogio = relogioFalso();
    const pedidos: string[] = [];
    const cabecalhos: Record<string, string>[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      pedidos.push(url);
      cabecalhos.push(init.headers as Record<string, string>);
      relogio.andar(180);
      const pedacos = [
        { candidates: [{ content: { role: "model", parts: [{ text: "", thoughtSignature: "assinatura" }] } }] },
        { candidates: [{ content: { role: "model", parts: [{ text: "Claro!" }] } }] },
      ];
      const corpo = new ReadableStream<Uint8Array>({
        start(controle) {
          for (const pedaco of pedacos) controle.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(pedaco)}\r\n\r\n`));
          init.signal?.addEventListener("abort", () => controle.error(new DOMException("abortado", "AbortError")));
        },
      });
      return new Response(corpo, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const m = await medirUm(gemini, CHAVE, "gemini-2.5-flash-lite", "Oi", { relogio, fetch });
    expect(pedidos).toEqual(["https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent?alt=sse"]);
    expect(pedidos[0]).not.toContain(CHAVE);
    expect(cabecalhos[0]?.["x-goog-api-key"]).toBe(CHAVE);
    expect(m.primeiroTextoMs).toBe(180);
    expect(m.estimado).toBe(true);
    expect(m.usage?.inputTokens).toBeGreaterThan(0);
  });

  it("sem a chave do Gemini, a linha dele diz não medido", async () => {
    const texto = await rodar({});
    expect(texto).toContain("- gemini (gemini-2.5-flash-lite): não medido (chave não entregue: BANCADA_GEMINI_API_KEY)");
  });

  it("sem chave nenhuma, diz não medido em cada cérebro e não chama nada", async () => {
    const texto = await rodar({});
    expect(texto).toContain("- openai (gpt-4.1-mini): não medido (chave não entregue: BANCADA_OPENAI_API_KEY)");
    expect(texto).toContain("não medido (chave não entregue: BANCADA_OPENROUTER_API_KEY)");
    expect(texto).toContain("não medido (chave não entregue: BANCADA_DEEPSEEK_API_KEY)");
    expect(texto).toContain("- anthropic (claude-haiku-4-5-20251001): não medido (chave não entregue: BANCADA_ANTHROPIC_API_KEY)");
  });

  it("com chave, mede e nunca escreve a chave", async () => {
    const relogio = relogioFalso();
    const { fetch } = fetchQueFala(() => relogio.andar(300));
    const texto = await rodar({ BANCADA_OPENAI_API_KEY: CHAVE }, { relogio, fetch, limite: 3 });
    expect(texto).toContain("- openai (gpt-4.1-mini): pedido → primeiro texto p50 300 ms, p95 300 ms (3/3 com texto;");
    expect(texto).not.toContain(CHAVE);
  });
});
