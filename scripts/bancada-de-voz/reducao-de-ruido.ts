/**
 * Medida da redução de ruído local em 8 kHz (fatia 4 do desenho da DESA-24,
 * docs/specs/2026-11-14-ambiente-barulhento.md, "5. Redução de ruído antes do provedor"). **Só
 * mede**: nenhum candidato entra no caminho do áudio do produto por aqui.
 *
 *   pnpm exec tsx scripts/bancada-de-voz/reducao-de-ruido.ts [--candidatos rnnoise,deepfilternet-fluxo,deepfilternet] [--frases 12]
 *
 * Fatia 4b: além da fatia 4, mede a perda por quadro (o quarto mais fraco dos quadros de 20 ms com
 * fala), a fala baixa debaixo de obra, música e conversa a 15, 5 e 0 dB, e a CPU **em fluxo** (o
 * candidato recebe pedaços de 20 ms um de cada vez, e cada pedaço é cronometrado sozinho, com as
 * conversões de taxa do pedaço). O SpeexDSP saiu da disputa e só roda se pedido.
 *
 * Fora do CI e fora do produto. Os candidatos rodam em `reducao_de_ruido.py`, num venv à parte
 * (BANCADA_REDUCAO_PYTHON), fora do repositório; o que instalar está no README desta pasta.
 * A régua das contas está em `regua-da-reducao.ts`. O áudio e o resultado bruto ficam numa pasta
 * temporária; a tela só mostra as tabelas agregadas. Esta medida não usa chave de provedor.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resample } from "../../packages/voice-engine/src/resample";
import { amostras, misturar, paraPcm16, regiaoDaFala } from "./audio";
import { carregarConjunto } from "./conjunto";
import { TAXA_DA_PONTE, passarPelaLinha } from "./linhas";
import {
  LIMITE_PERDA_DB,
  PARTE_MAIS_FRACA,
  PICOS_DA_FALA_BAIXA_DB,
  QUADRO_COM_FALA_DB,
  QUADRO_MS,
  mediaEP99,
  medirPorQuadro,
  medirSobRuido,
  escalarAoPico,
  quadrosMaisFracos,
  razaoDeEnergiaDb,
  reprovaNaFalaBaixa,
  type Trecho,
} from "./regua-da-reducao";
import { NIVEIS_DB, TIPOS_DE_RUIDO, musica, obra, sorteio, type TipoDeRuido } from "./ruido";
import { TAXA_LARGA, conversaDeFundo, pastaTemporaria, sintetizar, vozPorId, VOZ_PADRAO } from "./voz";

const AJUDANTE = fileURLToPath(new URL("./reducao_de_ruido.py", import.meta.url));
const print = (linha = ""): void => void process.stdout.write(`${linha}\n`);

/** Ruído (ou silêncio) antes da fala: o primeiro segundo é a adaptação do candidato e não entra na conta. */
const ANTES_S = 2.5;
const DEPOIS_S = 1.5;
const ADAPTACAO_S = 1;
/** Folga entre a fala e o trecho só de ruído, para a cauda da fala não contar como ruído. */
const FOLGA_S = 0.15;
/** O maior atraso procurado na correlação. */
const ATRASO_MAXIMO_S = 0.2;

/** Licença e fonte de cada candidato, conferidas no dia (repositório e arquivo de licença). */
const FONTES: Record<string, { licenca: string; fonte: string; conferidoEm: string }> = {
  speexdsp: {
    licenca: "SpeexDSP: BSD de 3 cláusulas (Xiph.Org, COPYING). Binding `speexdsp-ns`: Apache 2.0 no repositório (o PyPI diz BSD)",
    fonte: "https://github.com/xiph/speexdsp · https://github.com/TeaPoly/speexdsp-ns-python",
    conferidoEm: "2026-11-15",
  },
  rnnoise: {
    licenca: "RNNoise: BSD de 3 cláusulas (COPYING, inclui o modelo). Binding `pyrnnoise`: Apache 2.0",
    fonte: "https://github.com/xiph/rnnoise · https://github.com/pengzhendong/pyrnnoise",
    conferidoEm: "2026-11-15",
  },
  deepfilternet: {
    licenca: "MIT ou Apache 2.0, à escolha, para o código e os pesos (README, LICENSE-MIT, LICENSE-APACHE)",
    fonte: "https://github.com/Rikorose/DeepFilterNet",
    conferidoEm: "2026-11-15",
  },
  "deepfilternet-fluxo": {
    licenca: "MIT ou Apache 2.0, à escolha (o plugin LADSPA é do mesmo repositório e traz os pesos do DeepFilterNet3 de baixa latência)",
    fonte: "https://github.com/Rikorose/DeepFilterNet/releases/tag/v0.5.6 · ladspa/",
    conferidoEm: "2026-11-15",
  },
};

const CANDIDATOS = ["speexdsp", "rnnoise", "deepfilternet", "deepfilternet-fluxo"] as const;
const ROTULOS: Record<string, string> = {
  deepfilternet: "deepfilternet (torch, áudio inteiro)",
  "deepfilternet-fluxo": "deepfilternet-fluxo (plugin, em fluxo)",
};
/** O SpeexDSP saiu na fatia 4b (corta a sílaba fraca e tira pouco ruído); só roda se pedido. */
const PADRAO = ["rnnoise", "deepfilternet-fluxo", "deepfilternet"];
/** O pedaço que a ponte manda, e que o candidato em fluxo recebe um de cada vez. */
const PEDACO_S = QUADRO_MS / 1000;

/**
 * O lookahead do `resample` de `packages/voice-engine/src/resample.ts`, se ele rodasse em fluxo:
 * meia largura do núcleo, `ceil(4 / corte)` amostras de entrada, com corte a 45% da menor taxa.
 * Hoje ele reamostra cada pedaço isolado (sem esperar o futuro); em fluxo, cada conversão espera isso.
 */
function lookaheadDaConversaoMs(deHz: number, paraHz: number): number {
  const corte = (0.45 * Math.min(deHz, paraHz)) / deHz;
  return (Math.ceil(4 / corte) / deHz) * 1000;
}

interface Lentidao {
  avisos: number;
  refeitos: number;
  semPassar: number;
}
const SEM_LENTIDAO: Lentidao = { avisos: 0, refeitos: 0, semPassar: 0 };

/** O tempo de um pedaço de 20 ms em fluxo: o candidato e as duas conversões de taxa do pedaço. */
interface TempoDoPedaco {
  relogioS: number;
  cpuS: number;
}

interface Processado {
  saida: Float64Array;
  cpuS: number;
  /** Só em fluxo: um por pedaço de 20 ms do áudio (sem o silêncio entre áudios do plugin). */
  pedacos?: TempoDoPedaco[];
}

interface Filtro {
  id: string;
  rotulo: string;
  versao: string;
  taxaHz: number;
  quadro: number;
  lookahead: number;
  /** Recebe o áudio em pedaços de 20 ms, um de cada vez, com o estado guardado entre eles. */
  fluxo: boolean;
  processar(x8k: Float64Array): Promise<Processado>;
  /**
   * Os avisos de "processamento lento demais" do candidato até aqui. O plugin do DeepFilterNet
   * aumenta o próprio atraso quando avisa; o áudio com aviso é refeito (`refeitos`), e
   * `semPassar` conta os que não passaram sem aviso em nenhuma tentativa.
   */
  lentidoes(): Lentidao;
  encerrar(): void;
}

function cpuDoNodeS(antes: NodeJS.CpuUsage): number {
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1e6;
}

/** Relógio e CPU do Node de uma chamada síncrona. */
function cronometrar<T>(f: () => T): { valor: T; relogioS: number; cpuS: number } {
  const r0 = performance.now();
  const c0 = process.cpuUsage();
  const valor = f();
  return { valor, relogioS: (performance.now() - r0) / 1000, cpuS: cpuDoNodeS(c0) };
}

/**
 * O custo das duas conversões de taxa de cada pedaço de 20 ms, como o produto faria em fluxo: o
 * `resample` do produto, um pedaço por vez (8 kHz → taxa na entrada, taxa → 8 kHz na saída).
 * Só o tempo: o sinal medido usa as conversões do áudio inteiro, como na fatia 4.
 */
function conversoesPorPedaco(x8k: Float64Array, saidaNaTaxa: Buffer, taxaHz: number): TempoDoPedaco[] {
  const n8 = Math.round(TAXA_DA_PONTE * PEDACO_S);
  const nTaxa = Math.round(taxaHz * PEDACO_S);
  const tempos: TempoDoPedaco[] = [];
  for (let i = 0, k = 0; i < x8k.length; i += n8, k++) {
    const pedaco = paraPcm16(x8k.subarray(i, i + n8));
    const subida = cronometrar(() => resample(pedaco, TAXA_DA_PONTE, taxaHz));
    const volta = saidaNaTaxa.subarray(k * nTaxa * 2, (k + 1) * nTaxa * 2);
    const descida = cronometrar(() => (volta.length > 0 ? resample(volta, taxaHz, TAXA_DA_PONTE) : volta));
    tempos.push({ relogioS: subida.relogioS + descida.relogioS, cpuS: subida.cpuS + descida.cpuS });
  }
  return tempos;
}

/** Leva a 8 kHz → taxa do candidato → 8 kHz, com o `resample` do produto. A CPU das conversões entra na conta. */
async function porConversoes(
  x8k: Float64Array,
  taxaHz: number,
  nucleo: (pcm: Buffer) => Promise<{ pcm: Buffer; cpuS: number; pedacos?: TempoDoPedaco[] }>,
): Promise<Processado> {
  let cpu = 0;
  let marca = process.cpuUsage();
  const subida = taxaHz === TAXA_DA_PONTE ? paraPcm16(x8k) : resample(paraPcm16(x8k), TAXA_DA_PONTE, taxaHz);
  cpu += cpuDoNodeS(marca);
  const r = await nucleo(subida);
  cpu += r.cpuS;
  marca = process.cpuUsage();
  const descida = taxaHz === TAXA_DA_PONTE ? r.pcm : resample(r.pcm, taxaHz, TAXA_DA_PONTE);
  cpu += cpuDoNodeS(marca);
  const saida = amostras(descida).subarray(0, x8k.length);
  if (!r.pedacos) return { saida, cpuS: cpu };
  const conversoes = taxaHz === TAXA_DA_PONTE ? null : conversoesPorPedaco(x8k, r.pcm, taxaHz);
  // Um áudio refeito traz os pedaços de cada tentativa em seguida; o pedaço i de cada uma soma as conversões do pedaço i.
  if (conversoes && r.pedacos.length % conversoes.length !== 0) throw new Error(`pedaços desencontrados: ${conversoes.length} conversões, ${r.pedacos.length} do candidato`);
  return {
    saida,
    cpuS: cpu,
    pedacos: r.pedacos.map((p, i) => {
      const c = conversoes?.[i % conversoes.length];
      return { relogioS: p.relogioS + (c?.relogioS ?? 0), cpuS: p.cpuS + (c?.cpuS ?? 0) };
    }),
  };
}

/** Os dois controles: nada, e só as duas conversões de taxa (o que RNNoise e DeepFilterNet carregam junto). */
function controle(id: "nenhum" | "conversoes"): Filtro {
  const taxaHz = id === "nenhum" ? TAXA_DA_PONTE : 48000;
  return {
    id,
    rotulo: id === "nenhum" ? "controle: sem redução" : "controle: só 8→48→8 kHz",
    versao: "—",
    taxaHz,
    quadro: 0,
    lookahead: 0,
    fluxo: id === "conversoes",
    lentidoes: () => SEM_LENTIDAO,
    processar: (x) =>
      porConversoes(x, taxaHz, async (pcm) => {
        if (id === "nenhum") return { pcm, cpuS: 0 };
        const nTaxa = Math.round(taxaHz * PEDACO_S);
        return { pcm, cpuS: 0, pedacos: Array.from({ length: Math.ceil(pcm.length / 2 / nTaxa) }, () => ({ relogioS: 0, cpuS: 0 })) };
      }),
    encerrar: () => {},
  };
}

async function abrirCandidato(id: string, python: string): Promise<Filtro | { naoInstalou: string }> {
  const filho: ChildProcessWithoutNullStreams = spawn(python, ["-I", AJUDANTE, id], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1" } });
  let stderr = "";
  const lentidao: Lentidao = { ...SEM_LENTIDAO };
  filho.stderr.on("data", (d: Buffer) => void (stderr = (stderr + d.toString()).slice(-2000)));
  const linhas: Interface = createInterface({ input: filho.stdout });
  const fila: ((linha: string) => void)[] = [];
  const pendentes: string[] = [];
  linhas.on("line", (l) => {
    const f = fila.shift();
    if (f) f(l);
    else pendentes.push(l);
  });
  const proxima = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const p = pendentes.shift();
      if (p !== undefined) return resolve(p);
      const saiu = (codigo: number | null) => reject(new Error(`reducao_de_ruido.py ${id} saiu com ${codigo}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`));
      filho.once("exit", saiu);
      fila.push((l) => {
        filho.off("exit", saiu);
        resolve(l);
      });
    });
  let primeira: { tipo: string; taxa?: number; quadro?: number; lookahead?: number; versao?: string; motivo?: string; fluxo?: boolean };
  try {
    primeira = JSON.parse(await proxima());
  } catch (erro) {
    return { naoInstalou: (erro as Error).message };
  }
  if (primeira.tipo !== "pronto") {
    filho.stdin.end();
    return { naoInstalou: primeira.motivo ?? "sem motivo" };
  }
  const taxaHz = primeira.taxa ?? 0;
  const fluxo = primeira.fluxo === true;
  const pedaco = Math.round(taxaHz * PEDACO_S);
  let contador = 0;
  return {
    id,
    rotulo: ROTULOS[id] ?? id,
    versao: primeira.versao ?? "?",
    taxaHz,
    quadro: primeira.quadro ?? 0,
    lookahead: primeira.lookahead ?? 0,
    fluxo,
    processar: (x) =>
      porConversoes(x, taxaHz, async (pcm) => {
        const pedido = `i${++contador}`;
        filho.stdin.write(`${JSON.stringify({ id: pedido, b64: pcm.toString("base64"), ...(fluxo ? { pedaco } : {}) })}\n`);
        const resposta = JSON.parse(await proxima()) as {
          id: string;
          b64: string;
          cpu_s: number;
          pedacos?: [number, number][];
          erro?: string;
          lentidoes?: number;
          refeitos?: number;
          sem_aviso?: boolean;
        };
        if (resposta.erro) throw new Error(`reducao_de_ruido.py ${id}: ${resposta.erro}`);
        lentidao.avisos += resposta.lentidoes ?? 0;
        lentidao.refeitos += resposta.refeitos ?? 0;
        if (resposta.sem_aviso === false) lentidao.semPassar++;
        if (resposta.id !== pedido) throw new Error(`resposta fora de ordem: ${resposta.id}`);
        // Com áudio refeito (lentidão), vêm os pedaços de todas as tentativas, um áudio inteiro por tentativa.
        const porTentativa = Math.ceil(pcm.length / 2 / pedaco);
        if (fluxo && !(resposta.pedacos?.length && resposta.pedacos.length % porTentativa === 0)) throw new Error(`${id}: o candidato não devolveu o tempo de cada pedaço`);
        // Em fluxo, a CPU do candidato é a soma dos pedaços (o silêncio entre áudios do plugin fica de fora).
        const pedacos = resposta.pedacos?.map(([relogioS, cpuS]) => ({ relogioS, cpuS }));
        return { pcm: Buffer.from(resposta.b64, "base64"), cpuS: pedacos ? pedacos.reduce((a, p) => a + p.cpuS, 0) : resposta.cpu_s, pedacos };
      }),
    lentidoes: () => ({ ...lentidao }),
    encerrar: () => filho.stdin.end(),
  };
}

interface Item {
  n: number;
  voz8k: Float64Array;
  fala: Trecho;
  /** Por tipo e nível: a mistura e a relação medida. */
  misturas: { tipo: TipoDeRuido; snrDb: number; snrMedidoDb: number; mistura: Float64Array }[];
  /** O ruído de cada tipo, em 8 kHz, para pôr debaixo da fala baixa (fatia 4b). */
  ruidos: Record<TipoDeRuido, Float64Array>;
}

function para8k(x16k: Float64Array): Float64Array {
  return amostras(passarPelaLinha(paraPcm16(x16k), "estreita", { taxaHz: TAXA_DA_PONTE, mulaw: false }));
}

async function montarItens(nFrases: number, pasta: string): Promise<Item[]> {
  const frases = carregarConjunto().frases.slice(0, nFrases);
  const itens: Item[] = [];
  let conversa: Float64Array | null = null;
  for (const [n, frase] of frases.entries()) {
    const sintetica = await sintetizar(frase.texto, vozPorId(VOZ_PADRAO), pasta);
    const total = Math.round(ANTES_S * TAXA_LARGA) + sintetica.length + Math.round(DEPOIS_S * TAXA_LARGA);
    const limpa16k = new Float64Array(total);
    limpa16k.set(sintetica, Math.round(ANTES_S * TAXA_LARGA));
    const voz8k = para8k(limpa16k);
    const fala = regiaoDaFala(voz8k, TAXA_DA_PONTE);
    const misturas: Item["misturas"] = [];
    const ruidos = {} as Item["ruidos"];
    for (const tipo of TIPOS_DE_RUIDO) {
      let ruido16k: Float64Array;
      if (tipo === "obra") ruido16k = obra(total, TAXA_LARGA, 100 + n);
      else if (tipo === "musica") ruido16k = musica(total, TAXA_LARGA, 200 + n);
      else {
        conversa ??= await conversaDeFundo(TAXA_LARGA * 30, pasta);
        const c = conversa;
        const inicio = Math.floor(sorteio(300 + n)() * c.length);
        ruido16k = Float64Array.from({ length: total }, (_, i) => c[(inicio + i) % c.length] ?? 0);
      }
      const ruido8k = para8k(ruido16k);
      ruidos[tipo] = ruido8k;
      for (const snrDb of NIVEIS_DB) {
        const { mistura, snrMedidoDb } = misturar(voz8k, ruido8k, snrDb, fala);
        misturas.push({ tipo, snrDb, snrMedidoDb, mistura });
      }
    }
    itens.push({ n, voz8k, fala, misturas, ruidos });
  }
  return itens;
}

/** Os trechos só de ruído da mistura: depois da adaptação e antes da fala, e depois da fala. */
function trechosDeRuido(item: Item): Trecho[] {
  const taxa = TAXA_DA_PONTE;
  const folga = Math.round(FOLGA_S * taxa);
  const atraso = Math.round(ATRASO_MAXIMO_S * taxa);
  return [
    { inicio: Math.round(ADAPTACAO_S * taxa), fim: item.fala.inicio - folga },
    { inicio: item.fala.fim + folga, fim: item.voz8k.length - atraso },
  ].filter((t) => t.fim - t.inicio > taxa / 10);
}

interface Resultado {
  id: string;
  rotulo: string;
  versao: string;
  naoInstalou?: string;
  quadroMs?: number;
  correlacaoMs?: number;
  lookaheadMs?: number;
  conversoesMs?: number;
  atrasoMs?: number;
  /** CPU de um núcleo por segundo de áudio, somada em todas as chamadas (em fluxo, pedaço a pedaço). */
  cpuPorSegundo?: number;
  /** Por nível da fala baixa: a perda na frase inteira (fatia 4), média e pior frase (dB). */
  falaBaixa?: { picoDb: number; mediaDb: number; piorDb: number }[];
  /** Por nível da fala baixa: a perda por quadro (fatia 4b), média das frases e pior frase (dB), e a fração dos quadros calados. */
  porQuadro?: { picoDb: number; mediaDb: number; piorDb: number; calados: number; semCaladosDb: number }[];
  /** A régua por quadro, sem ruído: média das frases acima de 1 dB em algum nível. */
  reprova?: boolean;
  /** Por nível da fala baixa, tipo e relação: a perda por quadro com o ruído por baixo (dB). */
  sobRuido?: { picoDb: number; tipo: TipoDeRuido; snrDb: number; mediaDb: number; piorDb: number; calados: number; semCaladosDb: number }[];
  /** Algum caso debaixo de ruído com média acima de 1 dB. */
  reprovaSobRuido?: boolean;
  /** Por tipo e nível: redução média (dB) nos trechos só de ruído. */
  reducao?: { tipo: TipoDeRuido; snrDb: number; reducaoDb: number }[];
  /** Em fluxo: pedaços de 20 ms um a um, o tempo de cada (ms) e a CPU de um núcleo por segundo de áudio. */
  fluxo?: { lentidao: Lentidao; pedacos: number; relogioMs: { media: number; p99: number }; cpuMs: { media: number; p99: number }; cpuPorSegundo: number };
}

const media = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const mediana = (v: readonly number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
/** Média do que é número (a frase em que todo quadro calou não tem média dos que falam). */
const mediaDosNumeros = (v: readonly number[]): number => {
  const n = v.filter(Number.isFinite);
  return n.length ? media(n) : Number.NaN;
};
const resumo = (v: readonly number[]): { mediaDb: number; piorDb: number } => ({ mediaDb: media(v), piorDb: Math.max(...v) });

async function medir(filtro: Filtro, itens: readonly Item[]): Promise<Resultado> {
  let cpuS = 0;
  let audioS = 0;
  const pedacos: TempoDoPedaco[] = [];
  const processar = async (x: Float64Array): Promise<Float64Array> => {
    const r = await filtro.processar(x);
    cpuS += r.cpuS;
    audioS += x.length / TAXA_DA_PONTE;
    if (filtro.fluxo) {
      if (!r.pedacos) throw new Error(`${filtro.id}: em fluxo sem o tempo dos pedaços`);
      pedacos.push(...r.pedacos);
    }
    return r.saida;
  };
  const maximo = Math.round(ATRASO_MAXIMO_S * TAXA_DA_PONTE);
  const perdasFrase: number[][] = PICOS_DA_FALA_BAIXA_DB.map(() => []);
  const perdasQuadro: number[][] = PICOS_DA_FALA_BAIXA_DB.map(() => []);
  const caladosQuadro: number[][] = PICOS_DA_FALA_BAIXA_DB.map(() => []);
  const semCaladosQuadro: number[][] = PICOS_DA_FALA_BAIXA_DB.map(() => []);
  const atrasos: number[] = [];
  /** O atraso de cada frase em cada nível, medido sem ruído, para alinhar a mesma frase com ruído. */
  const atrasoDaFrase = new Map<string, number>();
  for (const item of itens) {
    const r = await medirPorQuadro(item.voz8k, item.fala, TAXA_DA_PONTE, processar, maximo);
    r.perdasFraseDb.forEach((p, i) => perdasFrase[i]?.push(p));
    r.perdasDb.forEach((p, i) => perdasQuadro[i]?.push(p));
    r.calados.forEach((c, i) => caladosQuadro[i]?.push(c));
    r.semCaladosDb.forEach((c, i) => semCaladosQuadro[i]?.push(c));
    r.atrasos.forEach((a, i) => atrasoDaFrase.set(`${item.n}:${PICOS_DA_FALA_BAIXA_DB[i]}`, a));
    atrasos.push(...r.atrasos);
  }
  const atraso = mediana(atrasos);
  const reducao: NonNullable<Resultado["reducao"]> = [];
  for (const tipo of TIPOS_DE_RUIDO) {
    for (const snrDb of NIVEIS_DB) {
      const valores: number[] = [];
      for (const item of itens) {
        const m = item.misturas.find((x) => x.tipo === tipo && x.snrDb === snrDb);
        if (!m) continue;
        const saida = await processar(m.mistura);
        valores.push(razaoDeEnergiaDb(m.mistura, saida, trechosDeRuido(item), atraso));
      }
      reducao.push({ tipo, snrDb, reducaoDb: media(valores) });
    }
  }
  const sobRuido: NonNullable<Resultado["sobRuido"]> = [];
  for (const picoDb of PICOS_DA_FALA_BAIXA_DB) {
    for (const tipo of TIPOS_DE_RUIDO) {
      for (const snrDb of NIVEIS_DB) {
        const valores: number[] = [];
        const calados: number[] = [];
        const semCalados: number[] = [];
        for (const item of itens) {
          const vozNoNivel = escalarAoPico(item.voz8k, picoDb);
          const { mistura } = misturar(vozNoNivel, item.ruidos[tipo], snrDb, item.fala);
          // `misturar` baixa voz e ruído juntos se a soma estourar; aí a voz limpa não seria mais a referência.
          if (mistura.some((v) => Math.abs(v) > 30000)) throw new Error(`a mistura estourou (frase ${item.n}, ${tipo}, ${snrDb} dB)`);
          const atrasoDoItem = atrasoDaFrase.get(`${item.n}:${picoDb}`) ?? atraso;
          const r = await medirSobRuido(vozNoNivel, mistura, quadrosMaisFracos(item.voz8k, item.fala, TAXA_DA_PONTE), atrasoDoItem, processar);
          valores.push(r.mediaDb);
          calados.push(r.calados);
          semCalados.push(r.semCaladosDb);
        }
        sobRuido.push({ picoDb, tipo, snrDb, ...resumo(valores), calados: media(calados), semCaladosDb: mediaDosNumeros(semCalados) });
      }
    }
  }
  const quadroMs = filtro.quadro ? (filtro.quadro / filtro.taxaHz) * 1000 : 0;
  const correlacaoMs = (atraso / TAXA_DA_PONTE) * 1000;
  const lookaheadMs = (filtro.lookahead / filtro.taxaHz) * 1000;
  const conversoesMs = filtro.taxaHz === TAXA_DA_PONTE ? 0 : lookaheadDaConversaoMs(TAXA_DA_PONTE, filtro.taxaHz) + lookaheadDaConversaoMs(filtro.taxaHz, TAXA_DA_PONTE);
  const falaBaixa = PICOS_DA_FALA_BAIXA_DB.map((picoDb, i) => ({ picoDb, ...resumo(perdasFrase[i] ?? []) }));
  const porQuadro = PICOS_DA_FALA_BAIXA_DB.map((picoDb, i) => ({
    picoDb,
    ...resumo(perdasQuadro[i] ?? []),
    calados: media(caladosQuadro[i] ?? []),
    semCaladosDb: mediaDosNumeros(semCaladosQuadro[i] ?? []),
  }));
  const fluxo: Resultado["fluxo"] = pedacos.length
    ? {
        lentidao: filtro.lentidoes(),
        pedacos: pedacos.length,
        relogioMs: mediaEP99(pedacos.map((p) => p.relogioS * 1000)),
        cpuMs: mediaEP99(pedacos.map((p) => p.cpuS * 1000)),
        cpuPorSegundo: pedacos.reduce((a, p) => a + p.cpuS, 0) / (pedacos.length * PEDACO_S),
      }
    : undefined;
  return {
    id: filtro.id,
    rotulo: filtro.rotulo,
    versao: filtro.versao,
    quadroMs,
    correlacaoMs,
    lookaheadMs,
    conversoesMs,
    atrasoMs: quadroMs + correlacaoMs + lookaheadMs + conversoesMs,
    cpuPorSegundo: cpuS / audioS,
    falaBaixa,
    porQuadro,
    // A régua da fatia 4b: a média das frases, por quadro, em cada nível.
    reprova: reprovaNaFalaBaixa(porQuadro.map((f) => f.mediaDb)),
    sobRuido,
    reprovaSobRuido: reprovaNaFalaBaixa(sobRuido.map((f) => f.mediaDb)),
    reducao,
    fluxo,
  };
}

/** Uma casa decimal, sem "-0.0". */
const dB = (v: number): string => (Number.isFinite(v) ? (Math.abs(v) < 0.05 ? 0 : v).toFixed(1) : v > 0 ? "∞" : "−∞");
const NOME_DO_RUIDO: Record<TipoDeRuido, string> = { obra: "obra", musica: "música", conversa: "conversa" };

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const python = process.env.BANCADA_REDUCAO_PYTHON;
  if (!python) throw new Error("BANCADA_REDUCAO_PYTHON não definido (veja scripts/bancada-de-voz/README.md)");
  const pedidos = (argumento("candidatos") ?? PADRAO.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of pedidos) if (!(CANDIDATOS as readonly string[]).includes(p)) throw new Error(`candidato desconhecido: ${p}`);
  const nFrases = Number(argumento("frases") ?? "12");
  if (!(nFrases >= 1)) throw new Error("--frases precisa ser 1 ou mais");

  const pasta = await pastaTemporaria();
  const inicio = new Date();
  process.stderr.write(`gerando o áudio em ${pasta}\n`);
  const itens = await montarItens(nFrases, pasta);

  const resultados: Resultado[] = [];
  for (const filtro of [controle("nenhum"), controle("conversoes")]) resultados.push(await medir(filtro, itens));
  for (const id of pedidos) {
    process.stderr.write(`medindo ${id}\n`);
    const aberto = await abrirCandidato(id, python);
    if ("naoInstalou" in aberto) {
      resultados.push({ id, rotulo: id, versao: "—", naoInstalou: aberto.naoInstalou });
      continue;
    }
    try {
      resultados.push(await medir(aberto, itens));
    } finally {
      aberto.encerrar();
    }
  }
  await writeFile(join(pasta, "resultados.json"), JSON.stringify({ inicio: inicio.toISOString(), resultados }, null, 2));

  const snr = (tipo: TipoDeRuido, nivel: number): number => media(itens.flatMap((i) => i.misturas.filter((m) => m.tipo === tipo && m.snrDb === nivel).map((m) => m.snrMedidoDb)));
  const audioS = media(itens.map((i) => i.voz8k.length / TAXA_DA_PONTE));
  print(`## Medida da redução de ruído`);
  print();
  print(`Rodada de ${inicio.toISOString()}, ${cpus().length} vCPU ${cpus()[0]?.model ?? "?"}, só CPU. ${itens.length} frases do conjunto na voz ${VOZ_PADRAO} (Piper), linha estreita (8 kHz), ${audioS.toFixed(1)} s por áudio em média (${ANTES_S} s antes da fala, ${DEPOIS_S} s depois).`);
  print();
  const instalados = resultados.filter((r) => !r.naoInstalou);
  for (const r of resultados) if (r.naoInstalou) print(`- **${r.rotulo} não instalou:** ${r.naoInstalou.replace(/\|/g, "/")}`);
  print();
  /** Média / pior; com quadro calado (média infinita), diz quantos dos quadros fracos calaram. */
  const par = (v?: { mediaDb: number; piorDb: number; calados?: number; semCaladosDb?: number }): string => {
    if (!v) return "—";
    const base = `${dB(v.mediaDb)} / ${dB(v.piorDb)}`;
    if (!v.calados) return base;
    const resto = Number.isFinite(v.semCaladosDb) ? `; ${dB(v.semCaladosDb ?? Number.NaN)} nos outros` : "";
    return `${base} (${(v.calados * 100).toFixed(1)}% calados${resto})`;
  };
  const nivel = (picoDb: number): string => `${picoDb < 0 ? "−" : ""}${Math.abs(picoDb)} dB`;
  print(`### Fala baixa sem ruído: por quadro (fatia 4b) e na frase inteira (fatia 4)`);
  print();
  print(`Por quadro: quadros de ${QUADRO_MS} ms, o ${PARTE_MAIS_FRACA === 0.25 ? "quarto" : PARTE_MAIS_FRACA} mais fraco dos quadros com fala (até ${QUADRO_COM_FALA_DB} dB abaixo do mais forte, na voz limpa), perda média dos quadros. Cada célula é a média das frases / a pior frase (dB). Um quadro que sai mudo dá perda infinita; aí a célula diz a parte dos quadros fracos que calou e a perda média dos outros (médias das frases). **Reprova** se a média das frases passa de ${LIMITE_PERDA_DB} dB em algum nível.`);
  print();
  print(`| Candidato | Versão | Por quadro −20 dB | Por quadro −30 dB | Frase inteira −20 dB | Frase inteira −30 dB | Régua por quadro |`);
  print(`|---|---|--:|--:|--:|--:|---|`);
  for (const r of instalados) {
    const q = (pico: number) => par(r.porQuadro?.find((x) => x.picoDb === pico));
    const f = (pico: number) => par(r.falaBaixa?.find((x) => x.picoDb === pico));
    print(`| ${r.rotulo} | ${r.versao} | ${q(-20)} | ${q(-30)} | ${f(-20)} | ${f(-30)} | ${r.reprova ? "**reprova**" : "passa"} |`);
  }
  print();
  print(`### Fala baixa debaixo de ruído, por quadro (dB, média das frases / pior frase)`);
  print();
  print(`Os mesmos quadros, com o ruído por baixo na relação pedida (calculada sobre a fala baixa), contra a voz limpa e com o atraso medido sem ruído. O ruído que sobra na saída conta como voz: sem redução, a "perda" sai negativa (o controle mostra quanto). Célula acima de ${LIMITE_PERDA_DB} dB na média em **negrito**.`);
  for (const picoDb of PICOS_DA_FALA_BAIXA_DB) {
    print();
    print(`Fala baixa a ${nivel(picoDb)} do pico:`);
    print();
    const colunas = TIPOS_DE_RUIDO.flatMap((t) => NIVEIS_DB.map((n) => ({ t, n })));
    print(`| Candidato | ${colunas.map((c) => `${NOME_DO_RUIDO[c.t]} ${c.n} dB`).join(" | ")} |`);
    print(`|---|${colunas.map(() => "--:").join("|")}|`);
    for (const r of instalados) {
      const celulas = colunas.map((c) => {
        const v = r.sobRuido?.find((x) => x.picoDb === picoDb && x.tipo === c.t && x.snrDb === c.n);
        if (!v) return "—";
        const texto = par(v);
        return v.mediaDb > LIMITE_PERDA_DB || !Number.isFinite(v.mediaDb) ? `**${texto}**` : texto;
      });
      print(`| ${r.rotulo} | ${celulas.join(" | ")} |`);
    }
  }
  print();
  print(`Debaixo de ruído: ${instalados.map((r) => `${r.rotulo} ${r.reprovaSobRuido ? "**reprova**" : "passa"}`).join("; ")}.`);
  print();
  print(`### CPU em fluxo (pedaços de ${QUADRO_MS} ms, um de cada vez)`);
  print();
  print(`Cada pedaço é cronometrado sozinho: as duas conversões de taxa do pedaço (o \`resample\` do produto, um pedaço por vez) e o candidato, com o estado guardado entre os pedaços. Todos os áudios da rodada (sem ruído e com ruído) entram. A CPU é a do processo do candidato inteiro (todas as linhas de execução) mais a do Node nas conversões.`);
  print();
  print(`| Candidato | Pedaços | Relógio por pedaço, média / p99 (ms) | CPU por pedaço, média / p99 (ms) | CPU de um núcleo por s de áudio | Avisos de lentidão (áudios refeitos; sem passar) |`);
  print(`|---|--:|--:|--:|--:|--:|`);
  for (const r of instalados) {
    const f = r.fluxo;
    if (!f) {
      print(`| ${r.rotulo} | — | ${r.id === "nenhum" ? "não faz nada" : "não roda em fluxo"} | — | — | — |`);
      continue;
    }
    print(`| ${r.rotulo} | ${f.pedacos} | ${f.relogioMs.media.toFixed(3)} / ${f.relogioMs.p99.toFixed(3)} | ${f.cpuMs.media.toFixed(3)} / ${f.cpuMs.p99.toFixed(3)} | ${(f.cpuPorSegundo * 100).toFixed(2)}% | ${f.lentidao.avisos} (${f.lentidao.refeitos}; ${f.lentidao.semPassar}) |`);
  }
  print();
  print(`### Atraso (fatia 4)`);
  print();
  print(`| Candidato | Atraso somado (ms) | quadro + correlação + lookahead + conversões | CPU de um núcleo por s de áudio, em todas as chamadas |`);
  print(`|---|--:|---|--:|`);
  for (const r of instalados) {
    const partes = [r.quadroMs, r.correlacaoMs, r.lookaheadMs, r.conversoesMs].map((v) => (v ?? 0).toFixed(1)).join(" + ");
    print(`| ${r.rotulo} | ${(r.atrasoMs ?? 0).toFixed(1)} | ${partes} | ${((r.cpuPorSegundo ?? 0) * 100).toFixed(2)}%${r.fluxo ? " (em fluxo)" : " (áudio inteiro)"} |`);
  }
  print();
  print(`### Quanto tira do ruído (dB, média das frases, nos trechos só de ruído)`);
  print();
  const colunas = TIPOS_DE_RUIDO.flatMap((t) => NIVEIS_DB.map((n) => ({ t, n })));
  print(`| Candidato | ${colunas.map((c) => `${NOME_DO_RUIDO[c.t]} ${c.n} dB`).join(" | ")} |`);
  print(`|---|${colunas.map(() => "--:").join("|")}|`);
  print(`| *relação voz/ruído medida* | ${colunas.map((c) => `*${dB(snr(c.t, c.n))}*`).join(" | ")} |`);
  for (const r of instalados) {
    print(`| ${r.rotulo} | ${colunas.map((c) => dB(r.reducao?.find((x) => x.tipo === c.t && x.snrDb === c.n)?.reducaoDb ?? Number.NaN)).join(" | ")} |`);
  }
  print();
  print(`### Licença e fonte`);
  print();
  print(`| Candidato | Licença | Fonte | Conferido em |`);
  print(`|---|---|---|---|`);
  for (const id of pedidos) {
    const f = FONTES[id];
    if (f) print(`| ${id} | ${f.licenca} | ${f.fonte} | ${f.conferidoEm} |`);
  }
  print();
  print(`Resultado bruto: ${join(pasta, "resultados.json")} (fora do repositório).`);
}

main().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exitCode = 1;
});
