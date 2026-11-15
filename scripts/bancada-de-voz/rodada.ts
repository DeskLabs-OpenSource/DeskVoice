/**
 * A rodada da bancada: lê os argumentos, mede cada serviço com chave, respeita o teto e escreve a
 * saída (as tabelas, o gasto por serviço e o que não foi medido). O `medir.ts` só liga esta função
 * às peças de verdade (descoberta dos serviços, áudio sintético, envio em tempo real); os testes
 * (`rodada.test.ts`) a ligam a peças falsas, sem chave, sem áudio e sem rede.
 *
 * Toda linha que sai na tela passa por `semAsChaves`: o valor de qualquer variável `*_API_KEY` do
 * ambiente vira "***", seja qual for o caminho que o pôs ali.
 */
import { cpus } from "node:os";
import { join } from "node:path";
import { carregarConjunto, vocabularioDoConjunto, type Frase } from "./conjunto";
import { LINHAS, type Linha } from "./linhas";
import { tabelaEmMarkdown, tabelar, type ResultadoBruto } from "./metricas";
import { REGRA_DE_NORMALIZACAO } from "./normalizacao";
import { Orcamento } from "./orcamento";
import type { TipoDeRuido } from "./ruido";
import type { ServicoMedido } from "./servicos/tipos";
import { LIMITE_FORA_DO_RITMO_MS } from "./tempo-real";

/** Um caso medido: a frase na voz, com silêncio ou ruído antes e depois, já em PCM16 a 16 kHz. */
export interface Item {
  frase: Frase;
  voz: string;
  ruido: { tipo: TipoDeRuido; snrDb: number; snrMedidoDb: number } | null;
  pcm16k: Buffer;
  falaInicioMs: number;
  falaFimMs: number;
  duracaoS: number;
}

export interface PecasDaRodada {
  descobrirServicos(): Promise<ServicoMedido[]>;
  montarItens(frases: readonly Frase[], pasta: string): Promise<Item[]>;
  medirItem(servico: ServicoMedido, linha: Linha, comVocabulario: boolean, vocabulario: readonly string[], item: Item): Promise<ResultadoBruto>;
  pastaTemporaria(): Promise<string>;
  escrever(caminho: string, conteudo: string): Promise<void>;
  medirLaya(frases: readonly Frase[], vocabulario: readonly string[]): Promise<string>;
  medirJev(frases: readonly Frase[], vocabulario: readonly string[], orcamento: Orcamento): Promise<string>;
  /** A saída da rodada (a tela). Recebe cada linha já sem chave. */
  saida(linha: string): void;
  /** O progresso (stderr). Também já sem chave. */
  progresso(texto: string): void;
  /** O ambiente de onde saem as chaves a esconder. Padrão: `process.env`. */
  ambiente?: NodeJS.ProcessEnv;
}

/** Valores mais curtos que isto não são chave: trocá-los estragaria a saída sem esconder nada. */
const MENOR_CHAVE = 8;

/** Troca por "***" o valor de toda variável `*_API_KEY` do ambiente que aparecer no texto. */
export function semAsChaves(texto: string, ambiente: NodeJS.ProcessEnv = process.env): string {
  let limpo = texto;
  for (const [nome, valor] of Object.entries(ambiente)) {
    if (!nome.endsWith("_API_KEY") || !valor || valor.length < MENOR_CHAVE) continue;
    limpo = limpo.split(valor).join("***");
  }
  return limpo;
}

function argumento(argv: readonly string[], nome: string): string | undefined {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function lista(argv: readonly string[], nome: string, padrao: readonly string[]): string[] {
  const valor = argumento(argv, nome);
  return valor ? valor.split(",").map((s) => s.trim()).filter(Boolean) : [...padrao];
}

/** A estimativa de pior caso de um item, para o teto: o `tetoUsdPorMinuto` quando o serviço cobra mais que o áudio. */
export function estimativaDoItem(servico: ServicoMedido, item: Pick<Item, "duracaoS">): number {
  return (item.duracaoS / 60) * (servico.preco.tetoUsdPorMinuto ?? servico.preco.usdPorMinuto);
}

/** Roda a bancada. Devolve o orçamento, para quem chamou saber quanto foi gasto. */
export async function rodada(argv: readonly string[], pecas: PecasDaRodada): Promise<Orcamento> {
  const ambiente = pecas.ambiente ?? process.env;
  const print = (linha = ""): void => pecas.saida(semAsChaves(linha, ambiente));
  const progresso = (texto: string): void => pecas.progresso(semAsChaves(texto, ambiente));

  const tetoTexto = argumento(argv, "teto-usd");
  if (tetoTexto === undefined) throw new Error("--teto-usd é obrigatório (0 para medir só o que não custa)");
  const orcamento = new Orcamento(Number(tetoTexto));
  const conjunto = carregarConjunto();
  const limite = Number(argumento(argv, "limite") ?? Infinity);
  const casos = argumento(argv, "casos")?.split(",");
  const frases = conjunto.frases.filter((f) => !casos || f.casos.some((c) => casos.includes(c))).slice(0, limite);
  const vocabulario = vocabularioDoConjunto(conjunto);
  const linhas = lista(argv, "linhas", LINHAS) as Linha[];
  const modos = lista(argv, "vocabulario", ["com", "sem"]).map((m) => m === "com");
  const pasta = await pecas.pastaTemporaria();
  const naoMedido: string[] = [];

  print(`# Bancada de voz — ${new Date().toISOString()}`);
  print(`Máquina: ${cpus().length} vCPU (${cpus()[0]?.model ?? "?"}). Regra de normalização: ${REGRA_DE_NORMALIZACAO}. Teto: US$ ${orcamento.tetoUsd}.`);
  print(`Pasta temporária (áudio e resultado bruto, fora do repositório): ${pasta}`);

  const resultados: ResultadoBruto[] = [];
  const pedidos = lista(argv, "servicos", []);
  const pedidosOuTodos = (await pecas.descobrirServicos()).filter((s) => pedidos.length === 0 || pedidos.includes(s.id));
  // O serviço sem chave (ou sem binário) não roda, e a tabela diz por quê. Sem nenhum que rode, nem o áudio é gerado.
  const servicos = pedidosOuTodos.filter((s) => {
    const motivo = s.indisponivel();
    if (motivo) naoMedido.push(`${s.id}: ${motivo}`);
    return !motivo;
  });
  if (servicos.length > 0) {
    const itens = await pecas.montarItens(frases, pasta);
    print(`Frases: ${frases.length}; casos gerados (frase × voz × ruído): ${itens.length}; vocabulário: ${vocabulario.length} termos.`);
    let parou = false;
    for (const servico of servicos) {
      await servico.preparar?.();
      print(`\n${servico.rotulo} — ${servico.modelo}`);
      for (const linha of linhas) {
        if (!servico.entrega(linha)) {
          naoMedido.push(`${servico.id}, linha ${linha}: o serviço, como está escrito, não recebe esta linha`);
          continue;
        }
        for (const comVocabulario of modos) {
          for (const [n, item] of itens.entries()) {
            // Reserva o pior caso antes de abrir a sessão; o custo real a substitui no fim.
            const reserva = orcamento.reservar(estimativaDoItem(servico, item), servico.id);
            if (!reserva) {
              naoMedido.push(`${servico.id}, linha ${linha}, vocabulário ${comVocabulario ? "com" : "sem"}: parou no teto (US$ ${orcamento.gasto.toFixed(4)} gastos) antes do caso ${n + 1} de ${itens.length}`);
              parou = true;
              break;
            }
            let resultado: ResultadoBruto;
            try {
              resultado = await pecas.medirItem(servico, linha, comVocabulario, vocabulario, item);
            } catch (erro) {
              // Sem resultado, a bancada conta o pior caso como gasto.
              reserva.fechar(estimativaDoItem(servico, item));
              throw erro;
            }
            reserva.fechar(resultado.custoUsd);
            resultados.push(resultado);
            progresso(`\r  ${servico.id} ${linha} ${comVocabulario ? "com" : "sem"} vocabulário: ${n + 1}/${itens.length}   `);
          }
          progresso("\n");
          if (parou) break;
        }
        if (parou) break;
      }
      await servico.encerrar?.();
      if (parou) break;
    }
    await pecas.escrever(join(pasta, "resultados.json"), JSON.stringify(resultados, null, 2));
    print("\n## Transcrição\n");
    print(tabelaEmMarkdown(tabelar(resultados)));
    const fora = resultados.filter((r) => r.foraDoRitmo);
    const pior = (f: (r: ResultadoBruto) => number): number => Math.round(Math.max(0, ...resultados.map(f)));
    print(
      `\nRitmo do envio (limite ${LIMITE_FORA_DO_RITMO_MS} ms): ${fora.length} de ${resultados.length} itens fora do ritmo, tirados das latências. ` +
        `Pior atraso: envio inteiro ${pior((r) => r.envio.atrasoMs)} ms, um pedaço ${pior((r) => r.envio.atrasoMaxPedacoMs)} ms, espera do final ${pior((r) => r.envio.atrasoMaxEsperaMs)} ms.`,
    );
    for (const r of fora) print(`- ${r.servico} ${r.linha} ${r.vocabulario ? "com" : "sem"} vocabulário, ${r.fraseId}, voz ${r.voz}${r.ruido ? `, ${r.ruido.tipo} ${r.ruido.snrDb} dB` : ""}: envio ${Math.round(r.envio.atrasoMs)} ms, pedaço ${Math.round(r.envio.atrasoMaxPedacoMs)} ms, espera ${Math.round(r.envio.atrasoMaxEsperaMs)} ms (áudio entregue ${Math.round(r.envio.duracaoMs)} ms).`);
    const snr = new Map<string, number[]>();
    for (const i of itens) if (i.ruido) snr.set(`${i.ruido.tipo} ${i.ruido.snrDb} dB`, [...(snr.get(`${i.ruido.tipo} ${i.ruido.snrDb} dB`) ?? []), i.ruido.snrMedidoDb]);
    if (snr.size > 0) {
      print("\nRelação voz/ruído medida sobre o RMS do trecho da fala (pedido: mínimo a máximo medido):");
      const dB = (x: number): string => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
      for (const [k, v] of snr) print(`- ${k}: ${dB(Math.min(...v))} a ${dB(Math.max(...v))} dB`);
    }
  }

  const decisores = lista(argv, "decisor", []);
  if (decisores.includes("laya")) {
    print("\n## Laya (só CPU e latência, perguntas fixas)\n");
    print(await pecas.medirLaya(frases, vocabulario));
  }
  if (decisores.includes("jev")) {
    print("\n## Jev (acerto da leitura e latência, as mesmas perguntas do Laya)\n");
    print(await pecas.medirJev(frases, vocabulario, orcamento));
  }

  print(`\nGasto: US$ ${orcamento.gasto.toFixed(4)} de US$ ${orcamento.tetoUsd}.`);
  for (const [servico, gasto] of orcamento.porServico()) print(`- ${servico}: US$ ${gasto.toFixed(4)}`);
  if (naoMedido.length > 0) {
    print("\n## Não medido\n");
    for (const linha of naoMedido) print(`- ${linha}`);
  }
  return orcamento;
}
