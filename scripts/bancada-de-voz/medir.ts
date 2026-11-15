/**
 * Bancada de voz: mede transcritores com voz sintética, em tempo real, nas duas linhas.
 * Fora do CI e fora do produto. Como rodar, o que instalar e onde: README.md desta pasta.
 *
 *   pnpm exec tsx scripts/bancada-de-voz/medir.ts --teto-usd 0 [--servicos whisper-local] \
 *     [--linhas estreita,larga] [--vocabulario com,sem] [--limite 5] [--decisor laya,jev]
 *
 * O áudio é gerado numa pasta temporária fora do repositório, e o resultado bruto (com o texto
 * transcrito) fica lá. A saída na tela é só a tabela agregada e o gasto.
 *
 * Este arquivo só liga as peças de verdade (serviços, áudio, envio em tempo real) à rodada, que
 * está em `rodada.ts` e tem teste: o teto, o gasto por serviço, o serviço sem chave e a saída sem
 * chave.
 */
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { misturar, paraPcm16, regiaoDaFala } from "./audio";
import type { Frase } from "./conjunto";
import { medirJev } from "./decisores/jev";
import { medirLaya } from "./decisores/laya";
import { passarPelaLinha, type Linha } from "./linhas";
import { medirFrase, type ResultadoBruto } from "./metricas";
import { NIVEIS_DB, TIPOS_DE_RUIDO, musica, obra, sorteio } from "./ruido";
import { rodada, semAsChaves, type Item, type PecasDaRodada } from "./rodada";
import { ehServicoMedido, type ServicoMedido } from "./servicos/tipos";
import { LIMITE_FORA_DO_RITMO_MS, enviarEmTempoReal, relogioDoSistema, type Relogio } from "./tempo-real";
import { TAXA_LARGA, VOZES, VOZ_PADRAO, conversaDeFundo, pastaTemporaria, sintetizar, vozPorId } from "./voz";

const ANTES_S = 0.5;
/** Silêncio (ou ruído) depois da fala, enviado em tempo real: é o que deixa o serviço fechar o turno. */
const DEPOIS_S = 3;
/** Depois do último áudio, quanto esperar um final que ainda não veio. */
const ESPERA_FINAL_MS = 8000;
/** Sem final novo por este tempo, depois do fim da fala, a frase está fechada. */
const QUIETO_MS = 1000;

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
  const envio = await enviarEmTempoReal(audio, entrega.taxaHz, (p) => sessao.enviar(p), relogio, () => erro !== null);
  const { inicioMs } = envio;
  const inicioDaFala = inicioMs + item.falaInicioMs;
  const fimDaFala = inicioMs + item.falaFimMs;
  const prazo = relogio.agora() + ESPERA_FINAL_MS;
  let atrasoMaxEsperaMs = 0;
  for (;;) {
    const ultimo = finais[finais.length - 1];
    if (erro || relogio.agora() >= prazo) break;
    if (ultimo && ultimo.em >= fimDaFala && relogio.agora() - ultimo.em >= QUIETO_MS) break;
    const alvo = relogio.agora() + 50;
    await relogio.esperarAte(alvo);
    atrasoMaxEsperaMs = Math.max(atrasoMaxEsperaMs, relogio.agora() - alvo);
  }
  // Duração do áudio entregue, na taxa da entrega (PCM16 mono: 2 bytes por amostra).
  const duracaoMs = (envio.bytes / 2 / entrega.taxaHz) * 1000;
  const atrasoMs = envio.fimMs - inicioMs - duracaoMs;
  const foraDoRitmo = Math.max(atrasoMs, envio.atrasoMaxMs, atrasoMaxEsperaMs) > LIMITE_FORA_DO_RITMO_MS;
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
    envio: { bytes: envio.bytes, duracaoMs, atrasoMs, atrasoMaxPedacoMs: envio.atrasoMaxMs, atrasoMaxEsperaMs },
    foraDoRitmo,
    transcricao,
    erro: erro ? String(erro) : null,
  };
}

const pecas: PecasDaRodada = {
  descobrirServicos,
  montarItens,
  medirItem: (servico, linha, comVocabulario, vocabulario, item) => medirItem(servico, linha, comVocabulario, vocabulario, item, relogioDoSistema),
  pastaTemporaria,
  escrever: (caminho, conteudo) => writeFile(caminho, conteudo),
  medirLaya: (itens, vocabulario) => medirLaya(itens, vocabulario),
  medirJev: (itens, vocabulario, orcamento) => medirJev(itens, vocabulario, orcamento),
  saida: (linha) => void process.stdout.write(`${linha}\n`),
  progresso: (texto) => void process.stderr.write(texto),
};

rodada(process.argv.slice(2), pecas).catch((erro: unknown) => {
  process.stderr.write(`${semAsChaves(erro instanceof Error ? erro.stack ?? erro.message : String(erro))}\n`);
  process.exit(1);
});
