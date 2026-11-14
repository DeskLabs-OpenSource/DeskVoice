/**
 * Bancada de voz: mede transcritores com voz sintética, em tempo real, nas duas linhas.
 * Fora do CI e fora do produto. Como rodar, o que instalar e onde: README.md desta pasta.
 *
 *   pnpm exec tsx scripts/bancada-de-voz/medir.ts --teto-usd 0 [--servicos whisper-local] \
 *     [--linhas estreita,larga] [--vocabulario com,sem] [--limite 5] [--decisor laya]
 *
 * O áudio é gerado numa pasta temporária fora do repositório, e o resultado bruto (com o texto
 * transcrito) fica lá. A saída na tela é só a tabela agregada e o gasto.
 */
import { readdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { misturar, paraPcm16, regiaoDaFala } from "./audio";
import { carregarConjunto, vocabularioDoConjunto, type Frase } from "./conjunto";
import { medirLaya } from "./decisores/laya";
import { LINHAS, passarPelaLinha, type Linha } from "./linhas";
import { medirFrase, tabelaEmMarkdown, tabelar, type ResultadoBruto } from "./metricas";
import { REGRA_DE_NORMALIZACAO } from "./normalizacao";
import { Orcamento } from "./orcamento";
import { NIVEIS_DB, TIPOS_DE_RUIDO, musica, obra, sorteio, type TipoDeRuido } from "./ruido";
import { ehServicoMedido, type ServicoMedido } from "./servicos/tipos";
import { enviarEmTempoReal, relogioDoSistema, type Relogio } from "./tempo-real";
import { TAXA_LARGA, VOZES, VOZ_PADRAO, conversaDeFundo, pastaTemporaria, sintetizar, vozPorId } from "./voz";

const ANTES_S = 0.5;
/** Silêncio (ou ruído) depois da fala, enviado em tempo real: é o que deixa o serviço fechar o turno. */
const DEPOIS_S = 3;
/** Depois do último áudio, quanto esperar um final que ainda não veio. */
const ESPERA_FINAL_MS = 8000;
/** Sem final novo por este tempo, depois do fim da fala, a frase está fechada. */
const QUIETO_MS = 1000;

const print = (linha = ""): void => void process.stdout.write(`${linha}\n`);

interface Item {
  frase: Frase;
  voz: string;
  ruido: { tipo: TipoDeRuido; snrDb: number; snrMedidoDb: number } | null;
  pcm16k: Buffer;
  falaInicioMs: number;
  falaFimMs: number;
  duracaoS: number;
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function lista(nome: string, padrao: readonly string[]): string[] {
  const valor = argumento(nome);
  return valor ? valor.split(",").map((s) => s.trim()).filter(Boolean) : [...padrao];
}

async function descobrirServicos(): Promise<ServicoMedido[]> {
  const pasta = fileURLToPath(new URL("./servicos", import.meta.url));
  const arquivos = (await readdir(pasta)).filter((f) => f.endsWith(".ts") && !f.startsWith("_") && f !== "tipos.ts" && !f.endsWith(".test.ts")).sort();
  const servicos: ServicoMedido[] = [];
  for (const arquivo of arquivos) {
    const modulo: { default?: unknown } = await import(pathToFileURL(join(pasta, arquivo)).href);
    if (!ehServicoMedido(modulo.default)) throw new Error(`${arquivo}: o export default não é um ServicoMedido`);
    servicos.push(modulo.default);
  }
  return servicos;
}

/** Gera o áudio de cada caso: a frase na voz, com silêncio ou ruído antes e depois. */
async function montarItens(frases: readonly Frase[], pasta: string): Promise<Item[]> {
  const itens: Item[] = [];
  const antes = Math.round(ANTES_S * TAXA_LARGA);
  const depois = Math.round(DEPOIS_S * TAXA_LARGA);
  let conversa: Float64Array | null = null;
  for (const [n, frase] of frases.entries()) {
    const vozes = frase.casos.includes("sotaque") ? VOZES.map((v) => v.id) : [VOZ_PADRAO];
    for (const voz of vozes) {
      const sintetica = await sintetizar(frase.texto, vozPorId(voz), pasta);
      const total = antes + sintetica.length + depois;
      const limpa = new Float64Array(total);
      limpa.set(sintetica, antes);
      const fala = regiaoDaFala(limpa, TAXA_LARGA);
      const base = { frase, voz, falaInicioMs: (fala.inicio / TAXA_LARGA) * 1000, falaFimMs: (fala.fim / TAXA_LARGA) * 1000, duracaoS: total / TAXA_LARGA };
      itens.push({ ...base, ruido: null, pcm16k: paraPcm16(limpa) });
      if (voz !== VOZ_PADRAO || !frase.casos.includes("ruido")) continue;
      for (const tipo of TIPOS_DE_RUIDO) {
        let ruido: Float64Array;
        if (tipo === "obra") ruido = obra(total, TAXA_LARGA, 100 + n);
        else if (tipo === "musica") ruido = musica(total, TAXA_LARGA, 200 + n);
        else {
          conversa ??= await conversaDeFundo(TAXA_LARGA * 30, pasta);
          const inicio = Math.floor(sorteio(300 + n)() * conversa.length);
          ruido = Float64Array.from({ length: total }, (_, i) => conversa?.[(inicio + i) % (conversa?.length ?? 1)] ?? 0);
        }
        for (const snrDb of NIVEIS_DB) {
          const { mistura, snrMedidoDb } = misturar(limpa, ruido, snrDb, fala);
          itens.push({ ...base, ruido: { tipo, snrDb, snrMedidoDb }, pcm16k: paraPcm16(mistura) });
        }
      }
    }
  }
  return itens;
}

async function medirItem(servico: ServicoMedido, linha: Linha, comVocabulario: boolean, vocabulario: readonly string[], item: Item, relogio: Relogio): Promise<ResultadoBruto> {
  const entrega = servico.entrega(linha);
  if (!entrega) throw new Error("linha não suportada");
  const audio = passarPelaLinha(item.pcm16k, linha, entrega);
  const finais: { texto: string; em: number }[] = [];
  let primeiroParcial: number | null = null;
  let erro: Error | null = null;
  const sessao = await servico.abrir({ idioma: "pt-BR", vocabulario: comVocabulario ? vocabulario : [] }, linha, {
    parcial: (_texto, em) => (primeiroParcial ??= em),
    final: (texto, em) => {
      finais.push({ texto, em });
      primeiroParcial ??= em;
    },
    erro: (e) => (erro = e),
  }, relogio);
  const { inicioMs } = await enviarEmTempoReal(audio, entrega.taxaHz, (p) => sessao.enviar(p), relogio, () => erro !== null);
  const inicioDaFala = inicioMs + item.falaInicioMs;
  const fimDaFala = inicioMs + item.falaFimMs;
  const prazo = relogio.agora() + ESPERA_FINAL_MS;
  for (;;) {
    const ultimo = finais[finais.length - 1];
    if (erro || relogio.agora() >= prazo) break;
    if (ultimo && ultimo.em >= fimDaFala && relogio.agora() - ultimo.em >= QUIETO_MS) break;
    await relogio.esperarAte(relogio.agora() + 50);
  }
  const { custoUsd } = await sessao.fechar();
  const transcricao = finais.map((f) => f.texto).join(" ");
  const ultimoFinal = finais[finais.length - 1];
  return {
    servico: servico.id,
    linha,
    vocabulario: comVocabulario,
    fraseId: item.frase.id,
    casos: item.frase.casos,
    voz: item.voz,
    ruido: item.ruido ? { tipo: item.ruido.tipo, snrDb: item.ruido.snrDb } : null,
    medida: medirFrase(item.frase.texto, transcricao, item.frase.termos, item.frase.numeros),
    latenciaParcialMs: primeiroParcial === null ? null : primeiroParcial - inicioDaFala,
    latenciaFinalMs: ultimoFinal ? ultimoFinal.em - fimDaFala : null,
    custoUsd: custoUsd ?? (item.duracaoS / 60) * servico.preco.usdPorMinuto,
    transcricao,
    erro: erro ? String(erro) : null,
  };
}

async function main(): Promise<void> {
  const tetoTexto = argumento("teto-usd");
  if (tetoTexto === undefined) throw new Error("--teto-usd é obrigatório (0 para medir só o que não custa)");
  const orcamento = new Orcamento(Number(tetoTexto));
  const conjunto = carregarConjunto();
  const limite = Number(argumento("limite") ?? Infinity);
  const casos = argumento("casos")?.split(",");
  const frases = conjunto.frases.filter((f) => !casos || f.casos.some((c) => casos.includes(c))).slice(0, limite);
  const vocabulario = vocabularioDoConjunto(conjunto);
  const linhas = lista("linhas", LINHAS) as Linha[];
  const modos = lista("vocabulario", ["com", "sem"]).map((m) => m === "com");
  const relogio = relogioDoSistema;
  const pasta = await pastaTemporaria();
  const naoMedido: string[] = [];

  print(`# Bancada de voz — ${new Date().toISOString()}`);
  print(`Máquina: ${cpus().length} vCPU (${cpus()[0]?.model ?? "?"}). Regra de normalização: ${REGRA_DE_NORMALIZACAO}. Teto: US$ ${orcamento.tetoUsd}.`);
  print(`Pasta temporária (áudio e resultado bruto, fora do repositório): ${pasta}`);

  const resultados: ResultadoBruto[] = [];
  const pedidos = lista("servicos", []);
  const servicos = (await descobrirServicos()).filter((s) => pedidos.length === 0 || pedidos.includes(s.id));
  if (servicos.length > 0) {
    const itens = await montarItens(frases, pasta);
    print(`Frases: ${frases.length}; casos gerados (frase × voz × ruído): ${itens.length}; vocabulário: ${vocabulario.length} termos.`);
    let parou = false;
    for (const servico of servicos) {
      const motivo = servico.indisponivel();
      if (motivo) {
        naoMedido.push(`${servico.id}: ${motivo}`);
        continue;
      }
      await servico.preparar?.();
      print(`\n${servico.rotulo} — ${servico.modelo}`);
      for (const linha of linhas) {
        if (!servico.entrega(linha)) {
          naoMedido.push(`${servico.id}, linha ${linha}: o serviço, como está escrito, não recebe esta linha`);
          continue;
        }
        for (const comVocabulario of modos) {
          for (const [n, item] of itens.entries()) {
            const estimativa = (item.duracaoS / 60) * servico.preco.usdPorMinuto;
            if (!orcamento.cabe(estimativa)) {
              naoMedido.push(`${servico.id}, linha ${linha}, vocabulário ${comVocabulario ? "com" : "sem"}: parou no teto (US$ ${orcamento.gasto.toFixed(4)} gastos) antes do caso ${n + 1} de ${itens.length}`);
              parou = true;
              break;
            }
            const resultado = await medirItem(servico, linha, comVocabulario, vocabulario, item, relogio);
            orcamento.somar(resultado.custoUsd);
            resultados.push(resultado);
            process.stderr.write(`\r  ${linha} ${comVocabulario ? "com" : "sem"} vocabulário: ${n + 1}/${itens.length}   `);
          }
          process.stderr.write("\n");
          if (parou) break;
        }
        if (parou) break;
      }
      await servico.encerrar?.();
      if (parou) break;
    }
    await writeFile(join(pasta, "resultados.json"), JSON.stringify(resultados, null, 2));
    print("\n## Transcrição\n");
    print(tabelaEmMarkdown(tabelar(resultados)));
    const snr = new Map<string, number[]>();
    for (const i of itens) if (i.ruido) snr.set(`${i.ruido.tipo} ${i.ruido.snrDb} dB`, [...(snr.get(`${i.ruido.tipo} ${i.ruido.snrDb} dB`) ?? []), i.ruido.snrMedidoDb]);
    if (snr.size > 0) {
      print("\nRelação voz/ruído medida sobre o RMS do trecho da fala (pedido: mínimo a máximo medido):");
      const dB = (x: number): string => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
      for (const [k, v] of snr) print(`- ${k}: ${dB(Math.min(...v))} a ${dB(Math.max(...v))} dB`);
    }
  }

  if (argumento("decisor") === "laya") {
    print("\n## Laya (só CPU e latência, perguntas fixas)\n");
    print(await medirLaya(frases, vocabulario));
  }

  print(`\nGasto: US$ ${orcamento.gasto.toFixed(4)} de US$ ${orcamento.tetoUsd}.`);
  if (naoMedido.length > 0) {
    print("\n## Não medido\n");
    for (const linha of naoMedido) print(`- ${linha}`);
  }
}

main().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.stack ?? erro.message : String(erro)}\n`);
  process.exit(1);
});
