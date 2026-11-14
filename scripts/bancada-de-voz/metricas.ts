/**
 * As métricas da bancada: erro de palavra (WER), acerto exato em nomes, latências e custo.
 * A regra de normalização mora em `normalizacao.ts`, e só lá.
 */
import { normalizar, numeroPresente, termoExato } from "./normalizacao";

/** Edições (troca, inserção, remoção) para levar `referencia` a `hipotese`, palavra a palavra. */
export function distanciaDePalavras(referencia: readonly string[], hipotese: readonly string[]): number {
  let anterior = Array.from({ length: hipotese.length + 1 }, (_, j) => j);
  for (let i = 1; i <= referencia.length; i++) {
    const atual = [i];
    for (let j = 1; j <= hipotese.length; j++) {
      const troca = (anterior[j - 1] ?? 0) + (referencia[i - 1] === hipotese[j - 1] ? 0 : 1);
      atual.push(Math.min(troca, (anterior[j] ?? 0) + 1, (atual[j - 1] ?? 0) + 1));
    }
    anterior = atual;
  }
  return anterior[hipotese.length] ?? 0;
}

export interface MedidaDaFrase {
  /** Palavras da referência e edições, depois da normalização. WER do grupo = soma das edições / soma das palavras. */
  palavras: number;
  edicoes: number;
  /** Nulo quando a frase não tem termo marcado (nem nome, nem número). */
  termosCertos: boolean | null;
}

export function medirFrase(referencia: string, transcricao: string, termos: readonly string[], numeros: readonly string[]): MedidaDaFrase {
  const ref = normalizar(referencia);
  const temTermo = termos.length + numeros.length > 0;
  return {
    palavras: ref.length,
    edicoes: distanciaDePalavras(ref, normalizar(transcricao)),
    termosCertos: temTermo ? termos.every((t) => termoExato(transcricao, t)) && numeros.every((n) => numeroPresente(transcricao, n)) : null,
  };
}

/** Percentil pelo método do vizinho mais próximo (sem interpolar). Nulo para lista vazia. */
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  return ordenados[indice] ?? null;
}

/** Uma medida de uma frase num serviço, numa linha. Fica na pasta temporária, nunca no repositório. */
export interface ResultadoBruto {
  servico: string;
  linha: "estreita" | "larga";
  vocabulario: boolean;
  fraseId: string;
  casos: readonly string[];
  voz: string;
  ruido: { tipo: string; snrDb: number } | null;
  medida: MedidaDaFrase;
  /** Do início da fala ao primeiro parcial; nulo se não houve parcial. */
  latenciaParcialMs: number | null;
  /** Do fim da fala ao texto final; nulo se o final não chegou no prazo. */
  latenciaFinalMs: number | null;
  custoUsd: number;
  /**
   * Como o áudio saiu. `atrasoMs` é o tempo real do envio menos a duração do áudio entregue;
   * `atrasoMaxPedacoMs`, o pior pedaço contra o seu horário; `atrasoMaxEsperaMs`, o pior atraso do
   * relógio da bancada na espera do final. Acima de `LIMITE_FORA_DO_RITMO_MS`, `foraDoRitmo`.
   */
  envio: { bytes: number; duracaoMs: number; atrasoMs: number; atrasoMaxPedacoMs: number; atrasoMaxEsperaMs: number };
  /** O item não foi medido em tempo real: o WER conta, as latências e o "sem final" não. */
  foraDoRitmo: boolean;
  /** Só no arquivo bruto da pasta temporária: o texto transcrito e o erro do serviço. Nunca na tabela. */
  transcricao?: string;
  erro?: string | null;
}

export interface LinhaDaTabela {
  servico: string;
  linha: string;
  vocabulario: boolean;
  caso: string;
  frases: number;
  wer: number | null;
  acertoEmNomes: number | null;
  frasesComTermo: number;
  parcialP50: number | null;
  parcialP95: number | null;
  finalP50: number | null;
  finalP95: number | null;
  semFinal: number;
  foraDoRitmo: number;
  custoUsd: number;
}

function agregar(resultados: readonly ResultadoBruto[], base: Omit<LinhaDaTabela, "frases" | "wer" | "acertoEmNomes" | "frasesComTermo" | "parcialP50" | "parcialP95" | "finalP50" | "finalP95" | "semFinal" | "foraDoRitmo" | "custoUsd">): LinhaDaTabela {
  const palavras = resultados.reduce((s, r) => s + r.medida.palavras, 0);
  const edicoes = resultados.reduce((s, r) => s + r.medida.edicoes, 0);
  const comTermo = resultados.filter((r) => r.medida.termosCertos !== null);
  // A latência só vale do que foi enviado no ritmo do relógio; o resto é contado à parte.
  const noRitmo = resultados.filter((r) => !r.foraDoRitmo);
  const parciais = noRitmo.flatMap((r) => (r.latenciaParcialMs === null ? [] : [r.latenciaParcialMs]));
  const finais = noRitmo.flatMap((r) => (r.latenciaFinalMs === null ? [] : [r.latenciaFinalMs]));
  return {
    ...base,
    frases: resultados.length,
    wer: palavras > 0 ? edicoes / palavras : null,
    acertoEmNomes: comTermo.length > 0 ? comTermo.filter((r) => r.medida.termosCertos).length / comTermo.length : null,
    frasesComTermo: comTermo.length,
    parcialP50: percentil(parciais, 50),
    parcialP95: percentil(parciais, 95),
    finalP50: percentil(finais, 50),
    finalP95: percentil(finais, 95),
    semFinal: noRitmo.length - finais.length,
    foraDoRitmo: resultados.length - noRitmo.length,
    custoUsd: resultados.reduce((s, r) => s + r.custoUsd, 0),
  };
}

/** Rótulo do caso na tabela. O ruído vira um caso por tipo e nível, e a voz um caso por voz. */
function casosDoResultado(r: ResultadoBruto): string[] {
  const casos = r.casos.filter((c) => c !== "ruido" && c !== "sotaque");
  if (r.ruido) return [`ruído ${r.ruido.tipo} ${r.ruido.snrDb} dB`];
  if (r.casos.includes("sotaque")) casos.push(`voz ${r.voz}`);
  return casos;
}

/** A tabela da medida: por serviço, linha, vocabulário e caso, mais a linha "todos" de cada grupo. */
export function tabelar(resultados: readonly ResultadoBruto[]): LinhaDaTabela[] {
  const grupos = new Map<string, ResultadoBruto[]>();
  for (const r of resultados) {
    const chave = JSON.stringify([r.servico, r.linha, r.vocabulario]);
    grupos.set(chave, [...(grupos.get(chave) ?? []), r]);
  }
  const linhas: LinhaDaTabela[] = [];
  for (const doGrupo of grupos.values()) {
    const primeiro = doGrupo[0];
    if (!primeiro) continue;
    const base = { servico: primeiro.servico, linha: primeiro.linha, vocabulario: primeiro.vocabulario };
    linhas.push(agregar(doGrupo, { ...base, caso: "todos" }));
    const porCaso = new Map<string, ResultadoBruto[]>();
    for (const r of doGrupo) for (const caso of casosDoResultado(r)) porCaso.set(caso, [...(porCaso.get(caso) ?? []), r]);
    for (const [caso, doCaso] of [...porCaso.entries()].sort(([a], [b]) => a.localeCompare(b))) linhas.push(agregar(doCaso, { ...base, caso }));
  }
  return linhas;
}

const pct = (v: number | null): string => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);
const ms = (v: number | null): string => (v === null ? "—" : `${Math.round(v)}`);

/** A tabela em Markdown, pronta para a seção "Medida". Só números agregados: nenhum texto de voz. */
export function tabelaEmMarkdown(linhas: readonly LinhaDaTabela[]): string {
  const cabecalho = "| Serviço | Linha | Vocab. | Caso | Frases | WER | Acerto em nomes (frases) | Parcial p50/p95 (ms) | Final p50/p95 (ms) | Sem final | Fora do ritmo | Custo (US$) |";
  const separador = "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|";
  const corpo = linhas.map(
    (l) =>
      `| ${l.servico} | ${l.linha} | ${l.vocabulario ? "com" : "sem"} | ${l.caso} | ${l.frases} | ${pct(l.wer)} | ${pct(l.acertoEmNomes)} (${l.frasesComTermo}) | ${ms(l.parcialP50)} / ${ms(l.parcialP95)} | ${ms(l.finalP50)} / ${ms(l.finalP95)} | ${l.semFinal} | ${l.foraDoRitmo} | ${l.custoUsd.toFixed(4)} |`,
  );
  return [cabecalho, separador, ...corpo].join("\n");
}
