/**
 * Os três serviços externos contra um servidor WebSocket falso, em porta 0, sem chave de verdade.
 * Prova o que cada um manda (endereço, cabeçalho, configuração, áudio, fechamento), como lê cada
 * resposta (parcial, final, custo, erro, fora do esquema) e que o valor da chave não sai.
 */
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ws, type WebSocket } from "../dependencias";
import type { Linha } from "../linhas";
import type { Relogio } from "../tempo-real";
import { criarAssemblyAI } from "./assemblyai";
import { criarDeepgram } from "./deepgram";
import { criarSoniox } from "./soniox";
import type { EventosDaSessao, ServicoMedido } from "./tipos";

const CHAVE = "chave-falsa-0123456789abcdef";
const VOCABULARIO = ["Melgaço", "DeskVoice"];

interface ServidorFalso {
  url: string;
  pedido: { url: string; autorizacao: string };
  textos: string[];
  binarios: number;
  mandar(mensagem: unknown): void;
  fechar(codigo?: number): void;
  parar(): Promise<void>;
}

const servidores: ServidorFalso[] = [];
afterEach(async () => {
  await Promise.all(servidores.splice(0).map((s) => s.parar()));
  vi.restoreAllMocks();
});

/** `aoTexto` responde a cada mensagem de texto do cliente. `recusar` devolve HTTP na abertura. */
async function servidorFalso(opcoes: { aoTexto?: (texto: string, s: ServidorFalso) => void; recusar?: number } = {}): Promise<ServidorFalso> {
  const servidor = new ws.WebSocketServer({
    port: 0,
    host: "127.0.0.1",
    ...(opcoes.recusar ? { verifyClient: (_info: unknown, pronto: (ok: boolean, codigo?: number) => void) => pronto(false, opcoes.recusar) } : {}),
  });
  await once(servidor, "listening");
  let cliente: WebSocket | undefined;
  const falso: ServidorFalso = {
    url: `ws://127.0.0.1:${(servidor.address() as AddressInfo).port}/caminho`,
    pedido: { url: "", autorizacao: "" },
    textos: [],
    binarios: 0,
    mandar: (m) => cliente?.send(typeof m === "string" ? m : JSON.stringify(m)),
    fechar: (codigo = 1000) => cliente?.close(codigo),
    parar: async () => {
      for (const s of servidor.clients) s.terminate();
      await new Promise((resolve) => servidor.close(resolve));
    },
  };
  servidor.on("connection", (socket, pedido) => {
    cliente = socket;
    falso.pedido.url = pedido.url ?? "";
    falso.pedido.autorizacao = pedido.headers.authorization ?? "";
    socket.on("message", (dado, binario) => {
      if (binario) falso.binarios++;
      else {
        falso.textos.push(dado.toString());
        opcoes.aoTexto?.(dado.toString(), falso);
      }
    });
  });
  servidores.push(falso);
  return falso;
}

/** Espera uma condição que depende da rede local, sem relógio da máquina: no máximo 400 voltas de 5 ms. */
async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condicao(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(condicao()).toBe(true);
}

function relogioFalso(): Relogio {
  let agora = 0;
  return { agora: () => (agora += 10), esperarAte: async () => {} };
}

function coletor(): EventosDaSessao & { parciais: string[]; finais: string[]; erros: Error[] } {
  const c = { parciais: [] as string[], finais: [] as string[], erros: [] as Error[] };
  return { ...c, parcial: (t) => c.parciais.push(t), final: (t) => c.finais.push(t), erro: (e) => c.erros.push(e) };
}

async function abrir(servico: ServicoMedido, linha: Linha = "estreita", vocabulario: readonly string[] = VOCABULARIO) {
  const eventos = coletor();
  const sessao = await servico.abrir({ idioma: "pt-BR", vocabulario }, linha, eventos, relogioFalso());
  return { eventos, sessao };
}

describe("deepgram", () => {
  const resultado = (texto: string, final: boolean) => ({ type: "Results", is_final: final, speech_final: final, channel: { alternatives: [{ transcript: texto, confidence: 0.9 }] } });

  it("abre com modelo, idioma, áudio, parcial e vocabulário na URL, e a chave só no cabeçalho", async () => {
    const s = await servidorFalso({ aoTexto: (t, srv) => JSON.parse(t).type === "CloseStream" && (srv.mandar({ type: "Metadata", duration: 1 }), srv.fechar()) });
    const { eventos, sessao } = await abrir(criarDeepgram({ url: s.url, chave: () => CHAVE }));
    const url = new URL(s.pedido.url, "ws://x");
    expect(Object.fromEntries([...url.searchParams].filter(([k]) => k !== "keyterm"))).toMatchObject({ model: "nova-3", language: "pt-BR", encoding: "linear16", sample_rate: "8000", channels: "1", interim_results: "true" });
    expect(url.searchParams.getAll("keyterm")).toEqual(VOCABULARIO);
    expect(s.pedido.autorizacao).toBe(`Token ${CHAVE}`);
    expect(s.pedido.url).not.toContain(CHAVE);

    for (let i = 0; i < 3; i++) sessao.enviar(Buffer.alloc(320));
    await ate(() => s.binarios === 3);
    s.mandar(resultado("Rafael Mel", false));
    s.mandar(resultado("", false));
    s.mandar(resultado("Rafael Melgaço.", true));
    await ate(() => eventos.finais.length === 1);
    expect(eventos.parciais).toEqual(["Rafael Mel"]);
    expect(eventos.finais).toEqual(["Rafael Melgaço."]);

    expect(await sessao.fechar()).toEqual({ custoUsd: null });
    expect(JSON.parse(s.textos.at(-1) ?? "{}")).toEqual({ type: "CloseStream" });
    expect(eventos.erros).toEqual([]);
  });

  it("na linha larga pede 16 kHz, e sem vocabulário não manda keyterm", async () => {
    const s = await servidorFalso({ aoTexto: (_t, srv) => srv.fechar() });
    const { sessao } = await abrir(criarDeepgram({ url: s.url, chave: () => CHAVE }), "larga", []);
    const url = new URL(s.pedido.url, "ws://x");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.getAll("keyterm")).toEqual([]);
    await sessao.fechar();
  });

  it("resposta fora do esquema vira erro, sem o conteúdo; o erro do serviço chega sem a chave", async () => {
    const s = await servidorFalso({ aoTexto: (_t, srv) => srv.fechar() });
    const { eventos, sessao } = await abrir(criarDeepgram({ url: s.url, chave: () => CHAVE }));
    s.mandar({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: 42 }] } });
    s.mandar({ type: "Desconhecido", texto: "fala secreta" });
    s.mandar({ type: "Error", variant: "Auth", description: `chave ${CHAVE} recusada` });
    await ate(() => eventos.erros.length === 3);
    expect(eventos.erros[0]?.message).toMatch(/fora do esquema \(.*channel\.alternatives\.0\.transcript/);
    expect(eventos.erros[1]?.message).not.toContain("fala secreta");
    expect(eventos.erros[2]?.message).toBe("deepgram: Auth: chave *** recusada");
    expect(eventos.finais).toEqual([]);
    await sessao.fechar();
  });

  it("conexão recusada diz o HTTP, e o serviço sem chave não roda", async () => {
    const s = await servidorFalso({ recusar: 401 });
    await expect(criarDeepgram({ url: s.url, chave: () => CHAVE }).abrir({ idioma: "pt-BR", vocabulario: [] }, "estreita", coletor(), relogioFalso())).rejects.toThrow("deepgram: recusou a conexão (HTTP 401)");
    expect(criarDeepgram({ chave: () => undefined }).indisponivel()).toBe("chave não entregue (BANCADA_DEEPGRAM_API_KEY)");
    expect(criarDeepgram({ chave: () => CHAVE }).indisponivel()).toBeNull();
  });

  it("queda no meio da sessão vira erro", async () => {
    const s = await servidorFalso();
    const { eventos, sessao } = await abrir(criarDeepgram({ url: s.url, chave: () => CHAVE }));
    s.fechar(1011);
    await ate(() => eventos.erros.length === 1);
    expect(eventos.erros[0]?.message).toBe("deepgram: fechou a conexão no meio (código 1011)");
    await sessao.fechar();
  });
});

describe("assemblyai", () => {
  const turno = (transcript: string, fim: boolean, formatado: boolean, words: { text: string }[] = []) => ({ type: "Turn", turn_order: 0, transcript, end_of_turn: fim, turn_is_formatted: formatado, end_of_turn_confidence: 0.5, words, utterance: "" });

  it("abre com o modelo multilíngue, a taxa, o formato e o vocabulário em keyterms_prompt; a chave pura no cabeçalho", async () => {
    const s = await servidorFalso({
      aoTexto: (t, srv) => {
        if (JSON.parse(t).type !== "Terminate") return;
        srv.mandar({ type: "Termination", audio_duration_seconds: 30, session_duration_seconds: 36 });
        srv.fechar();
      },
    });
    const { eventos, sessao } = await abrir(criarAssemblyAI({ url: s.url, chave: () => CHAVE }));
    const url = new URL(s.pedido.url, "ws://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({ speech_model: "universal-streaming-multilingual", sample_rate: "8000", encoding: "pcm_s16le", format_turns: "true", keyterms_prompt: JSON.stringify(VOCABULARIO) });
    expect(s.pedido.autorizacao).toBe(CHAVE);

    s.mandar({ type: "Begin", id: "x", expires_at: 1, configuration: { model: "universal-streaming-multilingual" } });
    sessao.enviar(Buffer.alloc(320));
    await ate(() => s.binarios === 1);
    s.mandar(turno("", false, false, [{ text: "rafael" }]));
    s.mandar(turno("rafael melgaço", true, false));
    s.mandar(turno("Rafael Melgaço.", true, true));
    await ate(() => eventos.finais.length === 1);
    expect(eventos.parciais).toEqual(["rafael"]);
    expect(eventos.finais).toEqual(["Rafael Melgaço."]);

    const { custoUsd } = await sessao.fechar();
    expect(custoUsd).toBeCloseTo((36 / 3600) * 0.15, 10);
    expect(JSON.parse(s.textos.at(-1) ?? "{}")).toEqual({ type: "Terminate" });
    expect(eventos.erros).toEqual([]);
  });

  it("o serviço que ignora o modelo pedido vira erro; o erro dele chega sem a chave; sem Termination, o custo fica para a bancada estimar", async () => {
    const s = await servidorFalso({ aoTexto: (_t, srv) => srv.fechar() });
    const { eventos, sessao } = await abrir(criarAssemblyAI({ url: s.url, chave: () => CHAVE }), "larga", []);
    expect(new URL(s.pedido.url, "ws://x").searchParams.has("keyterms_prompt")).toBe(false);
    expect(new URL(s.pedido.url, "ws://x").searchParams.get("sample_rate")).toBe("16000");
    s.mandar({ type: "Begin", id: "x", configuration: { model: "universal-streaming-english" } });
    s.mandar({ error: `Invalid API key ${CHAVE}` });
    s.mandar({ type: "Turn", transcript: "sem os outros campos" });
    await ate(() => eventos.erros.length === 3);
    expect(eventos.erros.map((e) => e.message)).toEqual([
      'assemblyai: o serviço aplicou o modelo "universal-streaming-english", e não o pedido',
      "assemblyai: Invalid API key ***",
      expect.stringMatching(/^assemblyai: resposta fora do esquema/),
    ]);
    expect(await sessao.fechar()).toEqual({ custoUsd: null });
  });

  it("sem chave não roda; o teto conta o triplo do preço, porque cobra a sessão", () => {
    const servico = criarAssemblyAI({ chave: () => undefined });
    expect(servico.indisponivel()).toBe("chave não entregue (BANCADA_ASSEMBLYAI_API_KEY)");
    expect(servico.preco.tetoUsdPorMinuto).toBeCloseTo(3 * servico.preco.usdPorMinuto, 12);
  });
});

describe("soniox", () => {
  it("a chave vai no cabeçalho e nunca na configuração; a configuração vem antes do áudio", async () => {
    const s = await servidorFalso({
      aoTexto: (t, srv) => {
        if (t !== "") return;
        srv.mandar({ tokens: [], final_audio_proc_ms: 900, total_audio_proc_ms: 900, finished: true });
        srv.fechar();
      },
    });
    const { eventos, sessao } = await abrir(criarSoniox({ url: s.url, chave: () => CHAVE }));
    expect(s.pedido.autorizacao).toBe(`Bearer ${CHAVE}`);
    await ate(() => s.textos.length === 1);
    const config = JSON.parse(s.textos[0] ?? "{}") as Record<string, unknown>;
    expect(config).toEqual({ model: "stt-rt-v6", audio_format: "pcm_s16le", sample_rate: 8000, num_channels: 1, language_hints: ["pt"], enable_endpoint_detection: true, context: { terms: VOCABULARIO } });
    expect(s.textos[0]).not.toContain(CHAVE);

    sessao.enviar(Buffer.alloc(320));
    await ate(() => s.binarios === 1);
    s.mandar({ tokens: [{ text: "Ra", is_final: false }], final_audio_proc_ms: 0, total_audio_proc_ms: 100 });
    s.mandar({ tokens: [{ text: "Rafael", is_final: true }, { text: " Mel", is_final: false }] });
    s.mandar({ tokens: [{ text: " Mel", is_final: true }, { text: "gaço", is_final: true }, { text: "<end>", is_final: true }] });
    s.mandar({ tokens: [{ text: " tudo", is_final: true }] });
    await ate(() => eventos.finais.length === 1 && eventos.parciais.length === 3);
    // O final sai inteiro no <end>: a palavra partida em dois tokens não vira duas.
    expect(eventos.finais).toEqual(["Rafael Melgaço"]);
    expect(eventos.parciais).toEqual(["Ra", "Rafael Mel", "tudo"]);

    expect(await sessao.fechar()).toEqual({ custoUsd: null });
    // O quadro de texto vazio fecha; o que estava final e sem <end> sai no fim da sessão.
    expect(s.textos.at(-1)).toBe("");
    expect(eventos.finais).toEqual(["Rafael Melgaço", "tudo"]);
    expect(eventos.erros).toEqual([]);
  });

  it("sem vocabulário não manda contexto; erro do serviço e resposta fora do esquema viram erro", async () => {
    const s = await servidorFalso({ aoTexto: (t, srv) => t === "" && srv.fechar() });
    const { eventos, sessao } = await abrir(criarSoniox({ url: s.url, chave: () => CHAVE }), "larga", []);
    await ate(() => s.textos.length === 1);
    const config = JSON.parse(s.textos[0] ?? "{}") as Record<string, unknown>;
    expect(config.sample_rate).toBe(16000);
    expect("context" in config).toBe(false);
    s.mandar({ error_code: 401, error_type: "unauthenticated", error_message: `bad key ${CHAVE}` });
    s.mandar({ tokens: [{ text: 1 }] });
    await ate(() => eventos.erros.length === 2);
    expect(eventos.erros[0]?.message).toBe("soniox: unauthenticated: bad key ***");
    expect(eventos.erros[1]?.message).toMatch(/^soniox: resposta fora do esquema \(tokens\.0/);
    await sessao.fechar();
  });
});

describe("a chave não sai", () => {
  it("nada do que os três escrevem na tela, nos eventos ou nos erros contém a chave", async () => {
    const escrito: string[] = [];
    const guardar = (pedaco: string | Uint8Array): boolean => (escrito.push(String(pedaco)), true);
    vi.spyOn(process.stdout, "write").mockImplementation(guardar);
    vi.spyOn(process.stderr, "write").mockImplementation(guardar);
    const visto: string[] = [];
    for (const criar of [criarDeepgram, criarAssemblyAI, criarSoniox]) {
      const s = await servidorFalso({ aoTexto: (_t, srv) => srv.fechar(4001) });
      const servico = criar({ url: s.url, chave: () => CHAVE });
      const { eventos, sessao } = await abrir(servico);
      s.mandar({ type: "Error", error: CHAVE, error_code: 1, error_message: CHAVE, description: CHAVE });
      s.mandar(`texto que não é JSON ${CHAVE}`);
      await ate(() => eventos.erros.length >= 2);
      await sessao.fechar();
      visto.push(servico.rotulo, servico.modelo, servico.preco.fonte, s.pedido.url, ...eventos.parciais, ...eventos.finais, ...eventos.erros.map((e) => `${e.message} ${e.stack ?? ""}`));
      const recusa = await servidorFalso({ recusar: 403 });
      const falha = await criar({ url: recusa.url, chave: () => CHAVE }).abrir({ idioma: "pt-BR", vocabulario: [] }, "estreita", coletor(), relogioFalso()).catch((e: Error) => e);
      visto.push(String(falha), (falha as Error).stack ?? "");
    }
    vi.restoreAllMocks();
    expect(visto.length).toBeGreaterThan(10);
    for (const texto of [...visto, ...escrito]) expect(texto).not.toContain(CHAVE);
  });

  it("a conexão que nem abre (porta fechada) cai pelo caminho de erro, com o prefixo do serviço e sem a chave", async () => {
    // Uma porta que acabou de fechar: a conexão é recusada no TCP, antes de qualquer HTTP.
    const livre = new ws.WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(livre, "listening");
    const porta = (livre.address() as AddressInfo).port;
    await new Promise((resolve) => livre.close(resolve));
    const escrito: string[] = [];
    const guardar = (pedaco: string | Uint8Array): boolean => (escrito.push(String(pedaco)), true);
    vi.spyOn(process.stdout, "write").mockImplementation(guardar);
    vi.spyOn(process.stderr, "write").mockImplementation(guardar);
    const visto: string[] = [];
    for (const [id, criar] of [["deepgram", criarDeepgram], ["assemblyai", criarAssemblyAI], ["soniox", criarSoniox]] as const) {
      // A chave também vai no endereço, para que um erro que repita o endereço a mostre.
      const falha = await criar({ url: `ws://127.0.0.1:${porta}/${CHAVE}`, chave: () => CHAVE }).abrir({ idioma: "pt-BR", vocabulario: [] }, "estreita", coletor(), relogioFalso()).catch((e: Error) => e);
      expect(falha).toBeInstanceOf(Error);
      expect((falha as Error).message).toMatch(new RegExp(`^${id}: erro ao abrir \\(`));
      visto.push(String(falha), (falha as Error).stack ?? "");
    }
    vi.restoreAllMocks();
    for (const texto of [...visto, ...escrito]) expect(texto).not.toContain(CHAVE);
  });
});
