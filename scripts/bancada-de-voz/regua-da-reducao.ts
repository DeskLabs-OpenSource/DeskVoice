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
 *
 * Fatia 4b (a medida que falta antes de ligar). A régua da frase inteira deixa passar o filtro que
 * corta a sílaba fraca, porque a energia da frase é das sílabas fortes. Por isso:
 * - **Perda por quadro:** a fala é cortada em quadros de 20 ms. São "quadros com fala" os que
 *   ficam a até `QUADRO_COM_FALA_DB` do quadro mais forte, na voz limpa. Do quarto mais fraco deles,
 *   a perda de cada quadro é a energia que entrou sobre a que saiu (dB), e a perda do áudio é a
 *   média dos quadros. Um quadro zerado dá perda infinita. **Acima de 1 dB de perda média, reprova.**
 * - **Fala baixa debaixo de ruído:** a mesma régua, com o ruído por baixo da fala baixa. A perda é
 *   medida contra a voz limpa, só nos mesmos quadros, com o atraso medido sem ruído. O ruído que
 *   sobra na saída **não** conta como voz: o filtro recebe a voz com o ruído e, à parte, a voz com
 *   o ruído invertido, e a parte da saída que é voz é a média das duas saídas (a do ruído se
 *   cancela). É a separação por inversão de fase (Hagerman e Olofsson, 2004). Ela vale quando o
 *   filtro trata as duas misturas do mesmo jeito; com a mesma relação voz/ruído e o mesmo
 *   espectro, um redutor de ruído quase sempre trata.
 */

/** Perda na fala baixa acima disto reprova o candidato (dB). */
export const LIMITE_PERDA_DB = 1;
/** Os níveis da fala baixa, em dB abaixo do fundo de escala, medidos no pico. */
export const PICOS_DA_FALA_BAIXA_DB = [-20, -30] as const;

/** O quadro da régua por quadro (ms). */
export const QUADRO_MS = 20;
/** Quadro com fala: a energia fica a até isto (dB) abaixo da do quadro mais forte, na voz limpa. */
export const QUADRO_COM_FALA_DB = 30;
/** A parte mais fraca dos quadros com fala que entra na régua por quadro. */
export const PARTE_MAIS_FRACA = 0.25;

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

/** Os quadros de `QUADRO_MS` dentro da fala (o último, se incompleto, fica de fora). */
function quadrosDoTrecho(fala: Trecho, taxaHz: number): Trecho[] {
  const n = Math.round((taxaHz * QUADRO_MS) / 1000);
  const quadros: Trecho[] = [];
  for (let a = fala.inicio; a + n <= fala.fim; a += n) quadros.push({ inicio: a, fim: a + n });
  return quadros;
}

/**
 * O quarto mais fraco dos quadros com fala da voz limpa, do mais fraco para o mais forte. Quadro
 * com fala é o que fica a até `QUADRO_COM_FALA_DB` do mais forte. Depende só da forma da voz, e
 * não do nível: os mesmos quadros valem para −20 e −30 dB do pico, com e sem ruído.
 */
export function quadrosMaisFracos(voz: ArrayLike<number>, fala: Trecho, taxaHz: number): Trecho[] {
  const comEnergia = quadrosDoTrecho(fala, taxaHz).map((q) => ({ q, e: energia(voz, q.inicio, q.fim) }));
  const maisForte = Math.max(0, ...comEnergia.map((x) => x.e));
  if (maisForte === 0) throw new Error("voz sem energia nos quadros da fala");
  const piso = maisForte * 10 ** (-QUADRO_COM_FALA_DB / 10);
  const comFala = comEnergia.filter((x) => x.e > 0 && x.e >= piso).sort((a, b) => a.e - b.e);
  return comFala.slice(0, Math.max(1, Math.ceil(comFala.length * PARTE_MAIS_FRACA))).map((x) => x.q);
}

/**
 * A perda (dB) de cada quadro, da referência para a saída deslocada pelo atraso, e a média. Um
 * quadro em que a saída zera (calado) dá perda infinita, e a média também; `calados` é a fração
 * dos quadros nessa situação e `semCaladosDb` a média dos outros, para dizer o tamanho do corte
 * quando a média não diz. Só a média decide.
 */
export function perdaPorQuadroDb(
  referencia: ArrayLike<number>,
  saida: ArrayLike<number>,
  quadros: readonly Trecho[],
  atraso: number,
): { mediaDb: number; porQuadroDb: number[]; calados: number; semCaladosDb: number } {
  if (quadros.length === 0) throw new Error("nenhum quadro para medir");
  const porQuadroDb = quadros.map((q) => razaoDeEnergiaDb(referencia, saida, [q], atraso));
  const falam = porQuadroDb.filter((p) => p !== Number.POSITIVE_INFINITY);
  return {
    mediaDb: porQuadroDb.reduce((a, b) => a + b, 0) / porQuadroDb.length,
    porQuadroDb,
    calados: 1 - falam.length / porQuadroDb.length,
    // A média só dos quadros que não calaram (NaN se todos calaram): o tamanho do corte além dos mudos.
    semCaladosDb: falam.length ? falam.reduce((a, b) => a + b, 0) / falam.length : Number.NaN,
  };
}

/**
 * A régua por quadro, sem ruído: a voz com o pico a −20 e a −30 dB entra no filtro, e a perda é a
 * média do quarto mais fraco dos quadros com fala. Reprova se algum nível passa de 1 dB. Devolve
 * também a perda da frase inteira (a régua da fatia 4) da mesma saída, para as duas lado a lado.
 */
export async function medirPorQuadro(
  voz: ArrayLike<number>,
  fala: Trecho,
  taxaHz: number,
  filtro: (entrada: Float64Array) => ArrayLike<number> | Promise<ArrayLike<number>>,
  atrasoMaximo: number,
): Promise<{ perdasDb: number[]; calados: number[]; semCaladosDb: number[]; perdasFraseDb: number[]; atrasos: number[]; reprova: boolean }> {
  const quadros = quadrosMaisFracos(voz, fala, taxaHz);
  const perdasDb: number[] = [];
  const calados: number[] = [];
  const semCaladosDb: number[] = [];
  const perdasFraseDb: number[] = [];
  const atrasos: number[] = [];
  for (const picoDb of PICOS_DA_FALA_BAIXA_DB) {
    const entrada = escalarAoPico(voz, picoDb);
    const saida = await filtro(entrada);
    const atraso = atrasoPorCorrelacao(entrada, saida, fala, atrasoMaximo);
    atrasos.push(atraso);
    const porQuadro = perdaPorQuadroDb(entrada, saida, quadros, atraso);
    perdasDb.push(porQuadro.mediaDb);
    calados.push(porQuadro.calados);
    semCaladosDb.push(porQuadro.semCaladosDb);
    perdasFraseDb.push(perdaNaFalaDb(entrada, saida, fala, atraso));
  }
  return { perdasDb, calados, semCaladosDb, perdasFraseDb, atrasos, reprova: reprovaNaFalaBaixa(perdasDb) };
}

/**
 * A régua por quadro debaixo de ruído. `vozNoNivel` é a fala baixa (já escalada) e `ruidoNoNivel`
 * o ruído já no nível da relação pedida. O filtro recebe `voz + ruído` e `voz − ruído`, cada uma
 * do começo, e a parte da saída que é voz é a média das duas. Ela é comparada com a voz limpa, só
 * nos quadros mais fracos da fala, com o `atraso` medido sem ruído (o ruído atrapalha a
 * correlação). Assim o ruído que o filtro deixa passar não esconde a sílaba fraca que ele cortou.
 */
export async function medirSobRuido(
  vozNoNivel: ArrayLike<number>,
  ruidoNoNivel: ArrayLike<number>,
  quadros: readonly Trecho[],
  atraso: number,
  filtro: (entrada: Float64Array) => ArrayLike<number> | Promise<ArrayLike<number>>,
): Promise<{ mediaDb: number; calados: number; semCaladosDb: number }> {
  if (ruidoNoNivel.length < vozNoNivel.length) throw new Error("o ruído precisa cobrir a voz inteira");
  const comRuido = Float64Array.from({ length: vozNoNivel.length }, (_, i) => (vozNoNivel[i] ?? 0) + (ruidoNoNivel[i] ?? 0));
  const comRuidoInvertido = Float64Array.from({ length: vozNoNivel.length }, (_, i) => (vozNoNivel[i] ?? 0) - (ruidoNoNivel[i] ?? 0));
  const saida = await filtro(comRuido);
  const saidaInvertida = await filtro(comRuidoInvertido);
  const vozNaSaida = Float64Array.from({ length: Math.min(saida.length, saidaInvertida.length) }, (_, i) => ((saida[i] ?? 0) + (saidaInvertida[i] ?? 0)) / 2);
  const { mediaDb, calados, semCaladosDb } = perdaPorQuadroDb(vozNoNivel, vozNaSaida, quadros, atraso);
  return { mediaDb, calados, semCaladosDb };
}

/** Média e p99 (posição mais próxima) de uma lista de tempos. */
export function mediaEP99(valores: readonly number[]): { media: number; p99: number } {
  if (valores.length === 0) throw new Error("nenhum valor");
  const ordenados = [...valores].sort((a, b) => a - b);
  const p99 = ordenados[Math.min(ordenados.length - 1, Math.ceil(0.99 * ordenados.length) - 1)] ?? 0;
  return { media: valores.reduce((a, b) => a + b, 0) / valores.length, p99 };
}
