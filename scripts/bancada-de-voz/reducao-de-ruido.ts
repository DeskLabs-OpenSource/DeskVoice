/**
 * Medida da redução de ruído local em 8 kHz (fatia 4 do desenho da DESA-24,
 * docs/specs/2026-11-14-ambiente-barulhento.md, "5. Redução de ruído antes do provedor"). **Só
 * mede**: nenhum candidato entra no caminho do áudio do produto por aqui.
 *
 *   pnpm exec tsx scripts/bancada-de-voz/reducao-de-ruido.ts [--candidatos speexdsp,rnnoise,deepfilternet] [--frases 12]
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
import { LIMITE_PERDA_DB, PICOS_DA_FALA_BAIXA_DB, medirFalaBaixa, razaoDeEnergiaDb, type Trecho } from "./regua-da-reducao";
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
};

const CANDIDATOS = ["speexdsp", "rnnoise", "deepfilternet"] as const;

/**
 * O lookahead do `resample` de `packages/voice-engine/src/resample.ts`, se ele rodasse em fluxo:
 * meia largura do núcleo, `ceil(4 / corte)` amostras de entrada, com corte a 45% da menor taxa.
 * Hoje ele reamostra cada pedaço isolado (sem esperar o futuro); em fluxo, cada conversão espera isso.
 */
function lookaheadDaConversaoMs(deHz: number, paraHz: number): number {
  const corte = (0.45 * Math.min(deHz, paraHz)) / deHz;
  return (Math.ceil(4 / corte) / deHz) * 1000;
}

interface Filtro {
  id: string;
  rotulo: string;
  versao: string;
  taxaHz: number;
  quadro: number;
  lookahead: number;
  processar(x8k: Float64Array): Promise<{ saida: Float64Array; cpuS: number }>;
  encerrar(): void;
}

function cpuDoNodeS(antes: NodeJS.CpuUsage): number {
  const d = process.cpuUsage(antes);
  return (d.user + d.system) / 1e6;
}

/** Leva a 8 kHz → taxa do candidato → 8 kHz, com o `resample` do produto. A CPU das conversões entra na conta. */
async function porConversoes(x8k: Float64Array, taxaHz: number, nucleo: (pcm: Buffer) => Promise<{ pcm: Buffer; cpuS: number }>): Promise<{ saida: Float64Array; cpuS: number }> {
  let cpu = 0;
  let marca = process.cpuUsage();
  const subida = taxaHz === TAXA_DA_PONTE ? paraPcm16(x8k) : resample(paraPcm16(x8k), TAXA_DA_PONTE, taxaHz);
  cpu += cpuDoNodeS(marca);
  const r = await nucleo(subida);
  cpu += r.cpuS;
  marca = process.cpuUsage();
  const descida = taxaHz === TAXA_DA_PONTE ? r.pcm : resample(r.pcm, taxaHz, TAXA_DA_PONTE);
  cpu += cpuDoNodeS(marca);
  return { saida: amostras(descida).subarray(0, x8k.length), cpuS: cpu };
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
    processar: (x) => porConversoes(x, taxaHz, async (pcm) => ({ pcm, cpuS: 0 })),
    encerrar: () => {},
  };
}

async function abrirCandidato(id: string, python: string): Promise<Filtro | { naoInstalou: string }> {
  const filho: ChildProcessWithoutNullStreams = spawn(python, ["-I", AJUDANTE, id], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1" } });
  let stderr = "";
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
  let primeira: { tipo: string; taxa?: number; quadro?: number; lookahead?: number; versao?: string; motivo?: string };
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
  let contador = 0;
  return {
    id,
    rotulo: id,
    versao: primeira.versao ?? "?",
    taxaHz,
    quadro: primeira.quadro ?? 0,
    lookahead: primeira.lookahead ?? 0,
    processar: (x) =>
      porConversoes(x, taxaHz, async (pcm) => {
        const pedido = `i${++contador}`;
        filho.stdin.write(`${JSON.stringify({ id: pedido, b64: pcm.toString("base64") })}\n`);
        const resposta = JSON.parse(await proxima()) as { id: string; b64: string; cpu_s: number };
        if (resposta.id !== pedido) throw new Error(`resposta fora de ordem: ${resposta.id}`);
        return { pcm: Buffer.from(resposta.b64, "base64"), cpuS: resposta.cpu_s };
      }),
    encerrar: () => filho.stdin.end(),
  };
}

interface Item {
  n: number;
  voz8k: Float64Array;
  fala: Trecho;
  /** Por tipo e nível: a mistura e a relação medida. */
  misturas: { tipo: TipoDeRuido; snrDb: number; snrMedidoDb: number; mistura: Float64Array }[];
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
      for (const snrDb of NIVEIS_DB) {
        const { mistura, snrMedidoDb } = misturar(voz8k, ruido8k, snrDb, fala);
        misturas.push({ tipo, snrDb, snrMedidoDb, mistura });
      }
    }
    itens.push({ n, voz8k, fala, misturas });
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
  cpuPorSegundo?: number;
  /** Por nível da fala baixa: a média e a pior frase (dB). */
  falaBaixa?: { picoDb: number; mediaDb: number; piorDb: number }[];
  reprova?: boolean;
  /** Por tipo e nível: redução média (dB) nos trechos só de ruído. */
  reducao?: { tipo: TipoDeRuido; snrDb: number; reducaoDb: number }[];
}

const media = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const mediana = (v: readonly number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

async function medir(filtro: Filtro, itens: readonly Item[]): Promise<Resultado> {
  let cpuS = 0;
  let audioS = 0;
  const processar = async (x: Float64Array): Promise<Float64Array> => {
    const r = await filtro.processar(x);
    cpuS += r.cpuS;
    audioS += x.length / TAXA_DA_PONTE;
    return r.saida;
  };
  const maximo = Math.round(ATRASO_MAXIMO_S * TAXA_DA_PONTE);
  const perdas: number[][] = PICOS_DA_FALA_BAIXA_DB.map(() => []);
  const atrasos: number[] = [];
  for (const item of itens) {
    const r = await medirFalaBaixa(item.voz8k, item.fala, processar, maximo);
    r.perdasDb.forEach((p, i) => perdas[i]?.push(p));
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
  const quadroMs = filtro.quadro ? (filtro.quadro / filtro.taxaHz) * 1000 : 0;
  const correlacaoMs = (atraso / TAXA_DA_PONTE) * 1000;
  const lookaheadMs = (filtro.lookahead / filtro.taxaHz) * 1000;
  const conversoesMs = filtro.taxaHz === TAXA_DA_PONTE ? 0 : lookaheadDaConversaoMs(TAXA_DA_PONTE, filtro.taxaHz) + lookaheadDaConversaoMs(filtro.taxaHz, TAXA_DA_PONTE);
  const falaBaixa = PICOS_DA_FALA_BAIXA_DB.map((picoDb, i) => ({ picoDb, mediaDb: media(perdas[i] ?? []), piorDb: Math.max(...(perdas[i] ?? [])) }));
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
    reprova: falaBaixa.some((f) => !(f.piorDb <= LIMITE_PERDA_DB)),
    reducao,
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
  const pedidos = (argumento("candidatos") ?? CANDIDATOS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
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
  print(`### Atraso, CPU e fala baixa`);
  print();
  print(`| Candidato | Versão | Atraso somado (ms) | quadro + correlação + lookahead + conversões | CPU de um núcleo por s de áudio | Perda na fala baixa −20 dB (média / pior) | −30 dB (média / pior) | Fala baixa (limite ${LIMITE_PERDA_DB} dB) |`);
  print(`|---|---|--:|---|--:|--:|--:|---|`);
  for (const r of resultados) {
    if (r.naoInstalou) {
      print(`| ${r.rotulo} | não instalou | — | ${r.naoInstalou.replace(/\|/g, "/")} | — | — | — | — |`);
      continue;
    }
    const fb = (pico: number): string => {
      const f = r.falaBaixa?.find((x) => x.picoDb === pico);
      return f ? `${dB(f.mediaDb)} / ${dB(f.piorDb)}` : "—";
    };
    const partes = [r.quadroMs, r.correlacaoMs, r.lookaheadMs, r.conversoesMs].map((v) => (v ?? 0).toFixed(1)).join(" + ");
    print(`| ${r.rotulo} | ${r.versao} | ${(r.atrasoMs ?? 0).toFixed(1)} | ${partes} | ${(r.cpuPorSegundo ?? 0).toFixed(4)} s | ${fb(-20)} | ${fb(-30)} | ${r.reprova ? "**reprova**" : "passa"} |`);
  }
  print();
  print(`### Quanto tira do ruído (dB, média das frases, nos trechos só de ruído)`);
  print();
  const colunas = TIPOS_DE_RUIDO.flatMap((t) => NIVEIS_DB.map((n) => ({ t, n })));
  print(`| Candidato | ${colunas.map((c) => `${NOME_DO_RUIDO[c.t]} ${c.n} dB`).join(" | ")} |`);
  print(`|---|${colunas.map(() => "--:").join("|")}|`);
  print(`| *relação voz/ruído medida* | ${colunas.map((c) => `*${dB(snr(c.t, c.n))}*`).join(" | ")} |`);
  for (const r of resultados) {
    if (r.naoInstalou) continue;
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
