/**
 * As amostras com um motor falso: sem rede, sem chave de verdade e sem `ffmpeg`. Prova o teto (para
 * antes de passar, no pedido que não cabe), o provedor sem chave (sai 0, "não gerado"), a chave fora
 * de toda saída e do manifesto, o divergente fora do mapa de `sample`, e o modelo do manifesto igual
 * ao padrão do motor.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EnginePricing, VoiceEngine, VoiceSession, VoiceSessionEvents } from "../../packages/voice-engine/src/types";
import { custoEmDolares } from "../bancada-de-voz/servicos/_motor-de-hoje";
import { FRASES, falouAFrase, gerarAmostras, lerTeto, MAXIMO_DE_FALA_S, PIOR_CASO_POR_PEDIDO, trechoDeSample, type Manifesto, type MotorDasAmostras, type Pecas } from "./amostras";
import { MOTORES } from "./motores";

const CHAVE = "sk-amostra-falsa-0123456789abcdef";
/** Preço do motor falso: o pior caso de um pedido dá US$ 0,10 redondos. */
const PRECO: EnginePricing = { centsPerMillionOutputTokens: 5000, centsPerMillionInputTokens: 0, centsPerMillionTextOutputTokens: 0, checkedOn: "2026-11-23", source: "teste" };
const PIOR = custoEmDolares(PRECO, PIOR_CASO_POR_PEDIDO);

/** O que cada voz do motor falso faz quando recebe `say`. */
type Comportamento = "fala" | "outra coisa" | "vaza a chave" | "sem usage" | "não para";

interface Registro {
  conexoes: string[];
}

function motorFalso(vozes: Record<string, Comportamento>, registro: Registro): VoiceEngine {
  return {
    id: "falso",
    label: "Falso",
    provider: "none",
    processingLocation: { kind: "undeclared" },
    pricing: PRECO,
    voices: Object.keys(vozes).map((id) => ({ id })),
    checkKey: async () => ({ result: "not_needed" }),
    async connect(config, apiKey) {
      registro.conexoes.push(`${config.voiceId}/${config.language}`);
      if (apiKey !== CHAVE) throw new Error("chave errada");
      const ouvintes: Partial<{ [K in keyof VoiceSessionEvents]: VoiceSessionEvents[K][] }> = {};
      const emitir = <K extends keyof VoiceSessionEvents>(nome: K, ...args: Parameters<VoiceSessionEvents[K]>): void => {
        for (const ouvinte of ouvintes[nome] ?? []) (ouvinte as (...a: unknown[]) => void)(...args);
      };
      const comportamento = vozes[config.voiceId ?? ""] ?? "fala";
      const sessao: VoiceSession = {
        on(nome, ouvinte) {
          (ouvintes[nome] ??= []).push(ouvinte as never);
        },
        sendAudio() {},
        sendToolResult() {},
        closeCallerTurn: () => true,
        say(texto) {
          if (comportamento === "vaza a chave") {
            emitir("error", new Error(`401: chave ${apiKey} recusada`));
            emitir("closed", "socket_closed");
            return;
          }
          if (comportamento === "não para") {
            emitir("audio", Buffer.alloc((MAXIMO_DE_FALA_S + 1) * 16000));
            return;
          }
          emitir("audio", Buffer.alloc(16000 * 4));
          emitir("transcript", { speaker: "agent", text: comportamento === "outra coisa" ? "Claro! Posso ajudar com isso." : texto.toUpperCase() });
          // Custo real pequeno: 800 tokens de saída a US$ 50/M = US$ 0,04.
          if (comportamento !== "sem usage") emitir("usage", { outputTokens: 800 });
        },
        async close() {},
      };
      return sessao;
    },
  };
}

const pastas: string[] = [];
afterEach(async () => {
  for (const pasta of pastas.splice(0)) await rm(pasta, { recursive: true, force: true });
});

async function rodar(
  argv: string[],
  vozes: Record<string, Comportamento>,
  ambiente: NodeJS.ProcessEnv = { AMOSTRAS_FALSO_API_KEY: CHAVE },
  codificar?: Pecas["codificar"],
) {
  const saida = await mkdtemp(join(tmpdir(), "amostras-teste-"));
  pastas.push(saida);
  const registro: Registro = { conexoes: [] };
  const linhas: string[] = [];
  const motor: MotorDasAmostras = { id: "falso", modelo: "falso-1", variavelDaChave: "AMOSTRAS_FALSO_API_KEY", carregar: async () => motorFalso(vozes, registro) };
  const pecas: Pecas = {
    motores: [motor],
    // O "MP3" do teste é o próprio PCM: nada aqui depende de ffmpeg.
    codificar:
      codificar ??
      (async (pcm, destino) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(destino, pcm);
      }),
    conferirCodificador: async () => null,
    esperar: () => Promise.resolve(),
    agora: () => new Date("2026-11-23T12:00:00Z"),
    saida: (linha) => linhas.push(linha),
    ambiente,
    saidaPadrao: saida,
  };
  const codigo = await gerarAmostras(argv, pecas);
  const texto = linhas.join("\n");
  const manifesto = async (): Promise<Manifesto> => JSON.parse(await readFile(join(saida, "manifesto.json"), "utf8")) as Manifesto;
  return { codigo, texto, registro, saida, manifesto };
}

describe("o teto", () => {
  it("é obrigatório e vai de 0 a 2", () => {
    expect(lerTeto([])).toMatch(/obrigatório/);
    expect(lerTeto(["--teto-usd", "2.01"])).toMatch(/de 0 a 2/);
    expect(lerTeto(["--teto-usd", "-1"])).toMatch(/de 0 a 2/);
    expect(lerTeto(["--teto-usd", "abc"])).toMatch(/de 0 a 2/);
    expect(lerTeto(["--teto-usd", "2"])).toBe(2);
  });

  it("sem teto, ou acima de 2, nada é pedido", async () => {
    for (const argv of [[], ["--teto-usd", "3"]]) {
      const { codigo, registro } = await rodar(argv, { Ana: "fala" });
      expect(codigo).not.toBe(0);
      expect(registro.conexoes).toEqual([]);
    }
  });

  it("para antes de passar: o pedido cujo pior caso não cabe não sai, e os seguintes também não", async () => {
    // Pior caso US$ 0,10 e custo real US$ 0,04: com teto de US$ 0,15, cabe o 1º (0 + 0,10), o 2º
    // (0,04 + 0,10 = 0,14) e não o 3º (0,08 + 0,10 = 0,18).
    expect(PIOR).toBeCloseTo(0.1, 10);
    const { codigo, registro, texto } = await rodar(["--teto-usd", "0.15"], { Ana: "fala", Bia: "fala" });
    expect(codigo).toBe(0);
    expect(registro.conexoes).toEqual(["Ana/pt-BR", "Ana/en-US"]);
    expect(texto).toContain("falso/Ana.es: parou no teto (US$ 0.0800 gastos), antes de pedir");
    expect(texto).toContain("Fora do teto (4, não pedidos): falso/Ana.es, falso/Bia.pt-BR, falso/Bia.en, falso/Bia.es");
    expect(texto).toContain("Gasto total: US$ 0.0800 de US$ 0.15");
    expect(texto).toContain("  falso: US$ 0.0800");
  });

  it("teto 0: nada é pedido, e o gasto é zero", async () => {
    const { registro, texto } = await rodar(["--teto-usd", "0"], { Ana: "fala" });
    expect(registro.conexoes).toEqual([]);
    expect(texto).toContain("Gasto total: US$ 0.0000");
  });

  it("sem `usage`, o custo é o pior caso reservado, marcado como estimado", async () => {
    const { manifesto, texto } = await rodar(["--teto-usd", "2", "--vozes", "Ana"], { Ana: "sem usage" });
    const lido = await manifesto();
    expect(lido.amostras.every((a) => a.custoUsd === PIOR && a.custoEstimado)).toBe(true);
    expect(texto).toContain(`Gasto total: US$ ${(3 * PIOR).toFixed(4)}`);
  });
});

describe("a chave", () => {
  it("provedor sem chave: sai 0 com 'não gerado: chave não entregue', sem abrir sessão nem gravar", async () => {
    const { codigo, registro, texto, saida } = await rodar(["--teto-usd", "2"], { Ana: "fala" }, {});
    expect(codigo).toBe(0);
    expect(registro.conexoes).toEqual([]);
    expect(texto).toContain("falso: não gerado: chave não entregue (AMOSTRAS_FALSO_API_KEY)");
    expect(await readdir(saida)).toEqual([]);
  });

  it("não sai em erro, na tela nem no manifesto", async () => {
    const { texto, saida, manifesto } = await rodar(["--teto-usd", "2"], { Ana: "vaza a chave" });
    expect(texto).toContain("401: chave *** recusada");
    expect(texto).not.toContain(CHAVE);
    expect(JSON.stringify(await manifesto())).toContain("***");
    expect(await readFile(join(saida, "manifesto.json"), "utf8")).not.toContain(CHAVE);
    expect((await manifesto()).amostras.every((a) => a.situacao === "falhou")).toBe(true);
  });

  it("o MP3 que não grava: o item sai como falhou, sem arquivo e sem a chave, e a rodada segue", async () => {
    const { codigo, texto, manifesto, registro } = await rodar(["--teto-usd", "2"], { Ana: "fala", Bia: "fala" }, undefined, async (_, destino) => {
      if (destino.includes("Ana")) throw new Error(`ffmpeg recusou (chave ${CHAVE})`);
    });
    expect(codigo).toBe(0);
    expect(registro.conexoes).toHaveLength(6);
    const lido = await manifesto();
    expect(lido.amostras.filter((a) => a.voz === "Ana").map((a) => [a.situacao, a.arquivo, a.erro])).toEqual(
      ["pt-BR", "en", "es"].map(() => ["falhou", undefined, "MP3 não gravado: ffmpeg recusou (chave ***)"]),
    );
    expect(texto).not.toContain(CHAVE);
    expect(trechoDeSample(lido).join("\n")).not.toContain("Ana");
    expect(trechoDeSample(lido).join("\n")).toContain('id: "Bia"');
  });
});

describe("o divergente", () => {
  it("o arquivo em que o motor falou outra coisa é marcado divergente, vai com outro nome e fica fora do mapa", async () => {
    const { manifesto, saida, texto } = await rodar(["--teto-usd", "2"], { Ana: "fala", Bia: "outra coisa" });
    const lido = await manifesto();
    const bia = lido.amostras.filter((a) => a.voz === "Bia");
    expect(bia.map((a) => a.situacao)).toEqual(["divergente", "divergente", "divergente"]);
    expect(bia[0]).toMatchObject({ arquivo: "falso/Bia.pt-BR.divergente.mp3", falado: "Claro! Posso ajudar com isso.", frase: FRASES["pt-BR"], modelo: "falso-1", data: "2026-11-23T12:00:00.000Z" });
    expect((await readdir(join(saida, "falso"))).sort()).toEqual(
      ["Ana.en.mp3", "Ana.es.mp3", "Ana.pt-BR.mp3", "Bia.en.divergente.mp3", "Bia.es.divergente.mp3", "Bia.pt-BR.divergente.mp3"].sort(),
    );
    const trecho = trechoDeSample(lido).join("\n");
    expect(trecho).toContain('{ id: "Ana", sample: { "pt-BR": "voice-samples/falso/Ana.pt-BR.mp3", en: "voice-samples/falso/Ana.en.mp3", es: "voice-samples/falso/Ana.es.mp3" } },');
    expect(trecho).not.toContain("Bia");
    expect(texto).toContain(trecho);
  });

  it("o motor que não para de falar é cortado e também fica fora", async () => {
    const { manifesto } = await rodar(["--teto-usd", "2"], { Ana: "não para" });
    const lido = await manifesto();
    expect(lido.amostras.map((a) => a.situacao)).toEqual(["cortado", "cortado", "cortado"]);
    expect(trechoDeSample(lido).join("\n")).not.toContain("Ana");
  });

  it("maiúscula, acento e pontuação não contam; palavra a mais conta", () => {
    expect(falouAFrase("ola aqui e a assistente da sua empresa como posso ajudar", FRASES["pt-BR"])).toBe(true);
    expect(falouAFrase("Hola, soy la asistente de tu empresa. En qué puedo ayudarte", FRASES.es)).toBe(true);
    expect(falouAFrase("Olá, aqui é a assistente da sua empresa. Como posso ajudar hoje?", FRASES["pt-BR"])).toBe(false);
  });
});

describe("repetir uma parte", () => {
  it("--vozes refaz só aquela voz e o manifesto guarda as outras", async () => {
    const primeira = await rodar(["--teto-usd", "2"], { Ana: "outra coisa", Bia: "fala" });
    const registro: Registro = { conexoes: [] };
    const linhas: string[] = [];
    const codigo = await gerarAmostras(["--teto-usd", "2", "--vozes", "Ana", "--saida", primeira.saida], {
      motores: [{ id: "falso", modelo: "falso-1", variavelDaChave: "K_API_KEY", carregar: async () => motorFalso({ Ana: "fala", Bia: "fala" }, registro) }],
      codificar: async () => undefined,
      conferirCodificador: async () => null,
      esperar: () => Promise.resolve(),
      agora: () => new Date("2026-11-23T13:00:00Z"),
      saida: (linha) => linhas.push(linha),
      ambiente: { K_API_KEY: CHAVE },
      saidaPadrao: "/nao/usada",
    });
    expect(codigo).toBe(0);
    expect(registro.conexoes.every((c) => c.startsWith("Ana/"))).toBe(true);
    const lido = await primeira.manifesto();
    expect(lido.amostras).toHaveLength(6);
    expect(lido.amostras.filter((a) => a.voz === "Ana").map((a) => a.situacao)).toEqual(["ok", "ok", "ok"]);
  });

  it("motor desconhecido em --motores não pede nada", async () => {
    const { codigo, registro, texto } = await rodar(["--teto-usd", "2", "--motores", "falso,outro"], { Ana: "fala" });
    expect(codigo).not.toBe(0);
    expect(texto).toContain("motor desconhecido: outro");
    expect(registro.conexoes).toEqual([]);
  });
});

describe("os motores de verdade", () => {
  it("o modelo do manifesto é o padrão do motor, o mesmo da ligação", () => {
    for (const motor of MOTORES) {
      const fonte = readFileSync(new URL(`../../packages/voice-engine/src/engines/${motor.id}.ts`, import.meta.url), "utf8");
      expect(/const DEFAULT_MODEL = "([^"]+)"/.exec(fonte)?.[1]).toBe(motor.modelo);
    }
  });

  it("a chave de cada motor é a própria das amostras", () => {
    expect(MOTORES.map((m) => m.variavelDaChave).sort()).toEqual(["AMOSTRAS_GEMINI_API_KEY", "AMOSTRAS_OPENAI_API_KEY"]);
  });
});
