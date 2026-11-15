/**
 * A régua da medida de redução de ruído (fatia 4 do desenho da DESA-24,
 * docs/specs/2026-11-14-ambiente-barulhento.md, "5. Redução de ruído antes do provedor"). Só
 * contas, sem candidato e sem processo: é o que `regua-da-reducao.test.ts` prova no `pnpm verify`.
 *
 * - **Perda na fala baixa:** a voz sintética sem ruído, com o pico a −20 dB e a −30 dB do fundo de
 *   escala, entra no candidato. A perda é a energia da fala que entrou sobre a que saiu, no trecho
 *   da fala, com a saída alinhada pelo atraso medido. **Acima de 1 dB, o candidato reprova.**
 * - **Redução do ruído:** a mesma razão de energia, nos trechos só de ruído da mistura (antes e
 *   depois da fala), já com o ruído no nível da relação voz/ruído pedida.
 * - **Atraso:** o deslocamento que maximiza a correlação entre a entrada e a saída.
 */

/** Perda na fala baixa acima disto reprova o candidato (dB). */
export const LIMITE_PERDA_DB = 1;
/** Os níveis da fala baixa, em dB abaixo do fundo de escala, medidos no pico. */
export const PICOS_DA_FALA_BAIXA_DB = [-20, -30] as const;

export interface Trecho {
  inicio: number;
  fim: number;
}

function energia(valores: ArrayLike<number>, inicio: number, fim: number): number {
  let soma = 0;
  for (let i = Math.max(0, inicio); i < Math.min(valores.length, fim); i++) soma += (valores[i] ?? 0) ** 2;
  return soma;
}

/** A voz com o pico em `picoDb` abaixo do fundo de escala do PCM16. */
export function escalarAoPico(voz: ArrayLike<number>, picoDb: number): Float64Array {
  let pico = 0;
  for (let i = 0; i < voz.length; i++) pico = Math.max(pico, Math.abs(voz[i] ?? 0));
  if (pico === 0) throw new Error("voz sem energia");
  const ganho = (32767 * 10 ** (picoDb / 20)) / pico;
  return Float64Array.from({ length: voz.length }, (_, i) => (voz[i] ?? 0) * ganho);
}

/**
 * O atraso (amostras, 0 a `maximo`) em que a saída mais se parece com a entrada, pela correlação
 * normalizada no trecho dado. Sem correlação positiva (saída muda), devolve 0.
 */
export function atrasoPorCorrelacao(entrada: ArrayLike<number>, saida: ArrayLike<number>, trecho: Trecho, maximo: number): number {
  let melhor = 0;
  let melhorValor = 0;
  const eEntrada = energia(entrada, trecho.inicio, trecho.fim);
  for (let d = 0; d <= maximo; d++) {
    let soma = 0;
    for (let i = trecho.inicio; i < trecho.fim && i + d < saida.length; i++) soma += (entrada[i] ?? 0) * (saida[i + d] ?? 0);
    const eSaida = energia(saida, trecho.inicio + d, trecho.fim + d);
    const valor = eEntrada > 0 && eSaida > 0 ? soma / Math.sqrt(eEntrada * eSaida) : 0;
    if (valor > melhorValor) {
      melhorValor = valor;
      melhor = d;
    }
  }
  return melhor;
}

/** Razão (dB) entre a energia da entrada nos trechos e a da saída nos mesmos trechos, deslocados pelo atraso. */
export function razaoDeEnergiaDb(entrada: ArrayLike<number>, saida: ArrayLike<number>, trechos: readonly Trecho[], atraso: number): number {
  let eEntrada = 0;
  let eSaida = 0;
  for (const t of trechos) {
    eEntrada += energia(entrada, t.inicio, t.fim);
    eSaida += energia(saida, t.inicio + atraso, t.fim + atraso);
  }
  if (eEntrada === 0) throw new Error("trecho sem energia na entrada");
  return eSaida === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(eEntrada / eSaida);
}

/** Quanto da fala sumiu (dB). Negativo é a saída mais alta que a entrada. */
export function perdaNaFalaDb(entrada: ArrayLike<number>, saida: ArrayLike<number>, fala: Trecho, atraso: number): number {
  return razaoDeEnergiaDb(entrada, saida, [fala], atraso);
}

/** Reprova se qualquer nível da fala baixa perde mais que o limite. */
export function reprovaNaFalaBaixa(perdasDb: readonly number[]): boolean {
  return perdasDb.some((p) => !(p <= LIMITE_PERDA_DB));
}

/**
 * Passa a fala baixa pelo filtro e devolve as perdas nos níveis da régua e o veredito. É a mesma
 * conta que a bancada faz com cada candidato (lá o filtro é o processo do candidato; no teste, uma função).
 */
export async function medirFalaBaixa(
  voz: ArrayLike<number>,
  fala: Trecho,
  filtro: (entrada: Float64Array) => ArrayLike<number> | Promise<ArrayLike<number>>,
  atrasoMaximo: number,
): Promise<{ perdasDb: number[]; atrasos: number[]; reprova: boolean }> {
  const perdasDb: number[] = [];
  const atrasos: number[] = [];
  for (const picoDb of PICOS_DA_FALA_BAIXA_DB) {
    const entrada = escalarAoPico(voz, picoDb);
    const saida = await filtro(entrada);
    const atraso = atrasoPorCorrelacao(entrada, saida, fala, atrasoMaximo);
    atrasos.push(atraso);
    perdasDb.push(perdaNaFalaDb(entrada, saida, fala, atraso));
  }
  return { perdasDb, atrasos, reprova: reprovaNaFalaBaixa(perdasDb) };
}
