/**
 * A concordância curta de quem ligou ("aham", "sim", "tá"), dita só para mostrar que está ouvindo
 * (desenho do pipeline, fatia 6, "Pendência antes da ligação real", regra R-lista; nota da revisora no
 * #573). Enquanto a resposta do cérebro sai, o trecho que só tem palavras desta lista não corta o agente.
 *
 * A regra: o texto em minúsculas, sem pontuação e sem acento, partido em palavras, precisa ser coberto
 * inteiro por termos da lista do idioma do agente (um termo pode ter mais de uma palavra, como "got it").
 * Uma palavra de fora ("não", "mas", um número) e o trecho deixa de ser concordância: a parcial que
 * cresce ("sim, mas...") corta na primeira palavra fora da lista. "Não", "no", "espera" e "wait" nunca
 * entram na lista. Idioma sem lista: nada é concordância, e tudo corta, como antes desta regra.
 *
 * **Não medido:** quantas concordâncias de verdade ainda cortam (o transcritor pode escrever "Ahã" ou
 * "Hum hum"), e quantas interrupções de verdade a lista engole. O número de falsos cortes sai da bancada
 * da R12 (40 concordâncias e 40 interrupções por idioma). As listas de en e es não foram revistas por
 * falante nativo.
 */

/** As listas por idioma, na forma do desenho. Hífen vira espaço na comparação ("uh-huh" é "uh huh"). */
export const AGREEMENT_TERMS: Readonly<Record<string, readonly string[]>> = {
  pt: ["aham", "uhum", "hum", "hã", "sim", "é", "tá", "certo", "ok", "isso", "entendi", "sei"],
  en: ["uh-huh", "mhm", "hmm", "yeah", "yes", "ok", "okay", "right", "sure", "got it", "i see"],
  es: ["ajá", "mhm", "sí", "vale", "claro", "ok", "entiendo", "ya"],
};

/** Minúsculas, sem acento, e só letras e dígitos separados por espaço. */
const words = (text: string): string[] =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");

const lists = new Map(Object.entries(AGREEMENT_TERMS).map(([language, terms]) => [language, terms.map(words)]));

/** A lista do idioma do agente (`pt-BR` usa `pt`), ou nenhuma. */
const termsOf = (language: string): string[][] | undefined => lists.get(language.toLowerCase().split(/[-_]/)[0] ?? "");

/**
 * Verdadeiro quando o texto tem palavra e todas elas são concordância no idioma do agente. O texto vazio
 * (o trecho sem palavra) não é concordância: ele já não corta nada por outra regra.
 */
export function isAgreementOnly(text: string, language: string): boolean {
  const terms = termsOf(language);
  if (!terms) return false;
  const said = words(text);
  if (said.length === 0) return false;
  // Cobertura da esquerda para a direita, tentando o termo mais longo primeiro: "got it" antes de "got".
  const covered = new Array<boolean>(said.length + 1).fill(false);
  covered[0] = true;
  for (let at = 0; at < said.length; at++) {
    if (!covered[at]) continue;
    for (const term of terms) {
      if (term.every((word, index) => said[at + index] === word)) covered[at + term.length] = true;
    }
  }
  return covered[said.length] === true;
}
