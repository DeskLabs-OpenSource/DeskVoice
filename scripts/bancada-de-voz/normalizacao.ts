/**
 * A regra de normalização da bancada, num arquivo só. O resultado de toda medida diz qual regra usou
 * (`REGRA_DE_NORMALIZACAO`). Mudar a regra muda o número: troque o nome junto.
 *
 * Para o erro de palavra (WER), referência e transcrição passam pela mesma regra:
 *   1. minúsculas; acento e cedilha **ficam** ("melgaço" e "melgaco" são palavras diferentes);
 *   2. pontuação vira espaço, menos o separador de milhar ("10.348") e o de hora ("3:15", "3h15"),
 *      que somem entre dígitos;
 *   3. número por extenso vira algarismo ("dez mil trezentos e quarenta e oito" → "10348"; "um" e
 *      "uma" também, dos dois lados);
 *   4. algarismos vizinhos se juntam, inclusive separados só por "e": "quatro sete dois", "472" e
 *      "quatrocentos e setenta e dois" dão "472"; "três e quinze" e "3:15" dão "315". É a forma de
 *      tratar como iguais o número por extenso e por algarismo sem adivinhar o agrupamento.
 *
 * Para o acerto em nomes, a regra é outra e mais dura (`termoExato`): o termo precisa aparecer
 * letra por letra, com maiúscula, acento e cedilha, entre limites de palavra. "Melgaco" é erro.
 * Só os números do manifesto (`numeros`) são comparados depois da normalização, como pede o desenho.
 */

export const REGRA_DE_NORMALIZACAO = "pt-br-v1";

const UNIDADES: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19,
};
const DEZENAS: Record<string, number> = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const CENTENAS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

/** Ordem de grandeza da palavra dentro de um grupo de três dígitos: 3 centena, 2 dezena, 1 unidade. */
function ordem(palavra: string): number {
  if (palavra in CENTENAS) return 3;
  if (palavra in DEZENAS) return 2;
  if (palavra in UNIDADES) return (UNIDADES[palavra] ?? 0) >= 10 ? 2 : 1;
  return 0;
}

function valor(palavra: string): number {
  return CENTENAS[palavra] ?? DEZENAS[palavra] ?? UNIDADES[palavra] ?? 0;
}

/**
 * Lê um número por extenso a partir de `inicio`. Devolve o valor e quantas palavras consumiu, ou
 * nada se ali não começa um número. "e" só continua o número quando vem uma ordem menor depois
 * ("cento e dois", "mil e vinte"); "três e quinze" para em "três".
 */
function lerExtenso(palavras: readonly string[], inicio: number): { valor: number; usadas: number } | null {
  let total = 0;
  let grupo = 0;
  let ultimaOrdem = 4; // nada lido ainda: qualquer ordem cabe
  let i = inicio;
  let lidas = 0;
  while (i < palavras.length) {
    const palavra = palavras[i] ?? "";
    if (palavra === "mil" && (grupo > 0 || lidas === 0)) {
      total += (grupo || 1) * 1000;
      grupo = 0;
      ultimaOrdem = 4;
      i++;
      lidas = i - inicio;
      continue;
    }
    if (palavra === "e" && lidas > 0) {
      const proxima = palavras[i + 1] ?? "";
      const o = ordem(proxima);
      if (o > 0 && o < ultimaOrdem) {
        i++;
        continue;
      }
      break;
    }
    const o = ordem(palavra);
    if (o === 0 || o >= ultimaOrdem) break;
    // Depois de "e" ou direto: "vinte e um" ou "cento vinte" (forma falada solta). Sem "e", só
    // continua se a ordem desce; "quatro sete" são dois números.
    grupo += valor(palavra);
    ultimaOrdem = o;
    i++;
    lidas = i - inicio;
  }
  if (lidas === 0) return null;
  return { valor: total + grupo, usadas: lidas };
}

/** Palavras normalizadas, na ordem. É o que o WER compara. */
export function normalizar(texto: string): string[] {
  const limpo = texto
    .toLowerCase()
    .normalize("NFC")
    .replace(/(\d)[.:h](?=\d)/g, "$1") // 10.348, 3:15, 3h15
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const palavras = limpo.length > 0 ? limpo.split(/\s+/) : [];

  const comNumeros: string[] = [];
  for (let i = 0; i < palavras.length; ) {
    const lido = lerExtenso(palavras, i);
    if (lido) {
      comNumeros.push(String(lido.valor));
      i += lido.usadas;
    } else {
      comNumeros.push(palavras[i] ?? "");
      i++;
    }
  }

  // Junta algarismos vizinhos, inclusive separados só por "e".
  const saida: string[] = [];
  for (let i = 0; i < comNumeros.length; i++) {
    const palavra = comNumeros[i] ?? "";
    const anterior = saida[saida.length - 1];
    const ehNumero = /^\d+$/.test(palavra);
    if (ehNumero && anterior !== undefined && /^\d+$/.test(anterior)) {
      saida[saida.length - 1] = anterior + palavra;
      continue;
    }
    if (palavra === "e" && anterior !== undefined && /^\d+$/.test(anterior) && /^\d+$/.test(comNumeros[i + 1] ?? "")) continue;
    saida.push(palavra);
  }
  return saida;
}

/** O termo aparece letra por letra (maiúscula, acento e cedilha), entre limites de palavra. */
export function termoExato(transcricao: string, termo: string): boolean {
  const escapado = termo.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapado}(?![\\p{L}\\p{N}])`, "u").test(transcricao.normalize("NFC"));
}

/** O número aparece na transcrição depois da normalização (por extenso ou por algarismo). */
export function numeroPresente(transcricao: string, numero: string): boolean {
  const alvo = normalizar(numero).join(" ");
  return ` ${normalizar(transcricao).join(" ")} `.includes(` ${alvo} `);
}
