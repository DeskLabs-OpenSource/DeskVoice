/**
 * A rodada com peças falsas: sem chave de verdade, sem áudio e sem rede. Prova o teto dos
 * externos (o pior caso por minuto, antes de abrir a sessão), o gasto por serviço, o serviço sem
 * chave fora da medida e a saída da rodada sem o valor de nenhuma chave.
 */
import { afterEach, describe, expect, it } from "vitest";
import { carregarConjunto, type Frase } from "./conjunto";
import type { Linha } from "./linhas";
import { medirFrase, type ResultadoBruto } from "./metricas";
import { estimativaDoItem, rodada, semAsChaves, type Item, type PecasDaRodada } from "./rodada";
import assemblyai from "./servicos/assemblyai";
import deepgram from "./servicos/deepgram";
import soniox from "./servicos/soniox";
import type { ServicoMedido } from "./servicos/tipos";

const CHAVES = {
  BANCADA_DEEPGRAM_API_KEY: "deepgram-chave-falsa-1111aaaa",
  BANCADA_ASSEMBLYAI_API_KEY: "assemblyai-chave-falsa-2222bbbb",
  BANCADA_SONIOX_API_KEY: "soniox-chave-falsa-3333cccc",
  JEV_API_KEY: "jev-chave-falsa-4444dddd",
};

const anteriores = new Map(Object.keys(CHAVES).map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const [k, v] of anteriores) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const frase = carregarConjunto().frases[0] as Frase;

/** Um serviço falso, que só existe para a rodada decidir se roda, quanto reservar e onde somar. */
function falso(id: string, preco: { usdPorMinuto: number; tetoUsdPorMinuto?: number }, indisponivel: string | null = null): ServicoMedido {
  return {
    id,
    rotulo: `Falso ${id}`,
    modelo: "falso-1",
    preco: { ...preco, fonte: "teste", conferidoEm: "2026-11-15" },
    entrega: () => ({ taxaHz: 16000 }) as never,
    indisponivel: () => indisponivel,
    abrir: () => Promise.reject(new Error("a rodada não abre sessão: o medirItem é falso")),
  };
}

/** Itens de um minuto cada: a estimativa por item é o preço por minuto. */
function itens(n: number): Item[] {
  return Array.from({ length: n }, () => ({ frase, voz: "falsa", ruido: null, pcm16k: Buffer.alloc(0), falaInicioMs: 500, falaFimMs: 2000, duracaoS: 60 }));
}

function resultado(servico: ServicoMedido, linha: Linha, comVocabulario: boolean, custoUsd: number, texto = frase.texto): ResultadoBruto {
  return {
    servico: servico.id,
    linha,
    vocabulario: comVocabulario,
    fraseId: frase.id,
    casos: frase.casos,
    voz: "falsa",
    ruido: null,
    medida: medirFrase(frase.texto, texto, frase.termos, frase.numeros),
    latenciaParcialMs: 100,
    latenciaFinalMs: 300,
    custoUsd,
    envio: { bytes: 0, duracaoMs: 0, atrasoMs: 0, atrasoMaxPedacoMs: 0, atrasoMaxEsperaMs: 0 },
    foraDoRitmo: false,
    transcricao: texto,
    erro: null,
  };
}

interface Montagem {
  pecas: PecasDaRodada;
  saida: string[];
  medidos: string[];
  montou: () => boolean;
}

/** As peças falsas. `custo` diz quanto cada item de cada serviço custou de verdade. */
function montar(servicos: ServicoMedido[], opcoes: { itens?: number; custo?: (s: ServicoMedido) => number; texto?: string; ambiente?: NodeJS.ProcessEnv } = {}): Montagem {
  const saida: string[] = [];
  const medidos: string[] = [];
  let montou = false;
  const pecas: PecasDaRodada = {
    descobrirServicos: async () => servicos,
    montarItens: async () => ((montou = true), itens(opcoes.itens ?? 4)),
    medirItem: async (servico, linha, comVocabulario) => {
      medidos.push(servico.id);
      return resultado(servico, linha, comVocabulario, opcoes.custo?.(servico) ?? servico.preco.usdPorMinuto, opcoes.texto);
    },
    pastaTemporaria: async () => "/tmp/bancada-falsa",
    escrever: async () => {},
    medirLaya: async () => "Laya: falso",
    medirJev: async () => "Jev: falso",
    saida: (linha) => void saida.push(linha),
    progresso: (texto) => void saida.push(texto),
    ambiente: opcoes.ambiente ?? {},
  };
  return { pecas, saida, medidos, montou: () => montou };
}

const UMA_LINHA = ["--linhas", "estreita", "--vocabulario", "com"];

describe("o teto dos externos", () => {
  it("reserva o pior caso por minuto (tetoUsdPorMinuto) antes de cada item, e para antes de passar do teto", async () => {
    // Cobra a sessão: o preço do áudio é 1, mas o pior caso é 3 por minuto, e cada item custa 3.
    const sessao = falso("sessao", { usdPorMinuto: 1, tetoUsdPorMinuto: 3 });
    const m = montar([sessao], { itens: 10, custo: () => 3 });
    const orcamento = await rodada(["--teto-usd", "7", ...UMA_LINHA], m.pecas);
    // 3 + 3 cabem em 7; o terceiro (9) não. Pelo preço do áudio (1), o terceiro teria entrado e passado do teto.
    expect(m.medidos).toHaveLength(2);
    expect(orcamento.gasto).toBe(6);
    expect(orcamento.gasto).toBeLessThanOrEqual(orcamento.tetoUsd);
    expect(m.saida).toContain("- sessao, linha estreita, vocabulário com: parou no teto (US$ 6.0000 gastos) antes do caso 3 de 10");
    expect(m.saida).toContain("\nGasto: US$ 6.0000 de US$ 7.");
  });

  it("a estimativa usa o tetoUsdPorMinuto quando existe, e o usdPorMinuto quando não", () => {
    expect(estimativaDoItem(falso("a", { usdPorMinuto: 1, tetoUsdPorMinuto: 3 }), { duracaoS: 30 })).toBe(1.5);
    expect(estimativaDoItem(falso("b", { usdPorMinuto: 1 }), { duracaoS: 30 })).toBe(0.5);
  });

  it("o teto vale para a rodada inteira: o segundo serviço para no que o primeiro deixou", async () => {
    const a = falso("a", { usdPorMinuto: 2 });
    const b = falso("b", { usdPorMinuto: 2 });
    const m = montar([a, b], { itens: 3 });
    const orcamento = await rodada(["--teto-usd", "9", ...UMA_LINHA], m.pecas);
    expect(m.medidos).toEqual(["a", "a", "a", "b"]);
    expect(orcamento.gasto).toBe(8);
    expect(m.saida).toContain("- b, linha estreita, vocabulário com: parou no teto (US$ 8.0000 gastos) antes do caso 2 de 3");
  });

  it("teto zero: o que custa não roda, o que não custa roda", async () => {
    const pago = falso("pago", { usdPorMinuto: 0.01 });
    const local = falso("local", { usdPorMinuto: 0 });
    const m = montar([local, pago], { itens: 2 });
    await rodada(["--teto-usd", "0", ...UMA_LINHA], m.pecas);
    expect(m.medidos).toEqual(["local", "local"]);
  });
});

describe("o gasto por serviço", () => {
  it("diz quanto cada serviço gastou, separado", async () => {
    const a = falso("deepgram-falso", { usdPorMinuto: 0.25 });
    const b = falso("soniox-falso", { usdPorMinuto: 0.5 });
    const m = montar([a, b], { itens: 2 });
    const orcamento = await rodada(["--teto-usd", "10", ...UMA_LINHA], m.pecas);
    expect(orcamento.porServico()).toEqual([["deepgram-falso", 0.5], ["soniox-falso", 1]]);
    expect(m.saida).toContain("- deepgram-falso: US$ 0.5000");
    expect(m.saida).toContain("- soniox-falso: US$ 1.0000");
    expect(m.saida).toContain("\nGasto: US$ 1.5000 de US$ 10.");
  });
});

describe("o serviço sem chave", () => {
  it("não roda, e o motivo vai para o 'Não medido'", async () => {
    const comChave = falso("com", { usdPorMinuto: 0.1 });
    const semChave = falso("sem", { usdPorMinuto: 0.1 }, "chave não entregue (BANCADA_SEM_API_KEY)");
    const m = montar([comChave, semChave], { itens: 2 });
    await rodada(["--teto-usd", "10", ...UMA_LINHA], m.pecas);
    expect(m.medidos).toEqual(["com", "com"]);
    expect(m.saida).toContain("- sem: chave não entregue (BANCADA_SEM_API_KEY)");
  });

  it("os três externos de verdade, sem as variáveis, não rodam, e nem o áudio é gerado", async () => {
    for (const k of Object.keys(CHAVES)) delete process.env[k];
    const m = montar([deepgram, assemblyai, soniox]);
    await rodada(["--teto-usd", "10", ...UMA_LINHA], m.pecas);
    expect(m.medidos).toEqual([]);
    expect(m.montou()).toBe(false);
    expect(m.saida).toContain("- deepgram: chave não entregue (BANCADA_DEEPGRAM_API_KEY)");
    expect(m.saida).toContain("- assemblyai: chave não entregue (BANCADA_ASSEMBLYAI_API_KEY)");
    expect(m.saida).toContain("- soniox: chave não entregue (BANCADA_SONIOX_API_KEY)");
  });
});

describe("o filtro", () => {
  it("o Jev e o Laya recebem o mesmo conjunto do filtro, inteiro, e a saída diz o que ele tem", async () => {
    const m = montar([]);
    const recebidos: { quem: string; ids: string[]; vocabulario: readonly string[] }[] = [];
    m.pecas.medirLaya = async (itens, vocabulario) => (recebidos.push({ quem: "laya", ids: itens.map((i) => i.id), vocabulario }), "Laya: falso");
    m.pecas.medirJev = async (itens, vocabulario) => (recebidos.push({ quem: "jev", ids: itens.map((i) => i.id), vocabulario }), "Jev: falso");
    await rodada(["--teto-usd", "1", "--decisor", "laya,jev", "--limite", "2"], m.pecas);
    expect(recebidos.map((r) => r.quem)).toEqual(["laya", "jev"]);
    // O --limite é das frases da transcrição: o filtro vai inteiro.
    expect(recebidos[0]?.ids.length).toBeGreaterThan(50);
    expect(recebidos[1]?.ids).toEqual(recebidos[0]?.ids);
    expect(recebidos[1]?.vocabulario).toEqual(recebidos[0]?.vocabulario);
    const tudo = m.saida.join("\n");
    expect(tudo).toMatch(/Conjunto do filtro: \d+ itens \(leitura \d+, dos quais \d+ "nenhum"; fundo \d+; terminou \d+\)/);
    expect(tudo).toMatch(/Termo esperado entre as opções da leitura: (\d+) de \1\./);
  });

  it("o serviço que custou mais que o reservado para a rodada, e o 'Não medido' diz quanto passou", async () => {
    // Pior caso de 0,01 por minuto; o primeiro item custa 1. O teto (10) está longe.
    const a = falso("a", { usdPorMinuto: 0.01 });
    const m = montar([a], { itens: 4, custo: () => 1 });
    const orcamento = await rodada(["--teto-usd", "10", ...UMA_LINHA], m.pecas);
    expect(m.medidos).toEqual(["a"]);
    expect(orcamento.excesso).toBeGreaterThan(0.9);
    expect(m.saida.join("\n")).toContain(`a, linha estreita, vocabulário com: parou porque o custo real passou do pior caso reservado em US$ ${orcamento.excesso.toFixed(6)}`);
  });
});

describe("a saída da rodada não contém chave", () => {
  it("com as quatro chaves no ambiente, nada do que a rodada escreve as contém", async () => {
    Object.assign(process.env, CHAVES);
    // O texto falso traz a chave de propósito: mesmo que um caminho a ponha na saída, ela não sai.
    const vazamento = `transcrição com ${CHAVES.BANCADA_DEEPGRAM_API_KEY}`;
    const indiscreto = { ...falso(`servico-${CHAVES.JEV_API_KEY}`, { usdPorMinuto: 0 }), rotulo: `rótulo ${CHAVES.BANCADA_SONIOX_API_KEY}` };
    const m = montar([deepgram, assemblyai, soniox, indiscreto], { itens: 2, texto: vazamento, ambiente: process.env });
    m.pecas.medirJev = async () => `Jev: erro com ${CHAVES.JEV_API_KEY}`;
    await rodada(["--teto-usd", "10", "--decisor", "jev", ...UMA_LINHA], m.pecas);
    // Os três rodaram (as chaves estavam lá), e a saída tem a tabela e o gasto.
    expect(m.medidos).toContain("deepgram");
    expect(m.medidos).toContain("assemblyai");
    expect(m.medidos).toContain("soniox");
    const tudo = m.saida.join("\n");
    expect(tudo).toContain("## Transcrição");
    expect(tudo).toContain("- deepgram: US$");
    expect(tudo).toContain("Jev: erro com ***");
    expect(tudo).toContain("rótulo ***");
    for (const chave of Object.values(CHAVES)) expect(tudo).not.toContain(chave);
  });

  it("semAsChaves troca o valor de toda variável *_API_KEY, e só dela", () => {
    const ambiente = { BANCADA_X_API_KEY: "valor-da-chave-x", JEV_API_KEY: "valor-da-chave-jev", OUTRA: "valor-que-nao-e-chave", CURTA_API_KEY: "abc" };
    expect(semAsChaves("a valor-da-chave-x b valor-da-chave-jev c valor-que-nao-e-chave abc", ambiente)).toBe("a *** b *** c valor-que-nao-e-chave abc");
  });

  it("a rodada sem --teto-usd não começa", async () => {
    const m = montar([falso("a", { usdPorMinuto: 0 })]);
    await expect(rodada([], m.pecas)).rejects.toThrow("--teto-usd é obrigatório");
    expect(m.medidos).toEqual([]);
  });
});
