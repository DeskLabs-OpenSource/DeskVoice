/**
 * Como mostrar um valor do extrato que pode ter linha de custo não medido (modelo sem preço, ou
 * consumo que não pôde ser medido). O zero dessa linha não é grátis: sem nada medido, a tela
 * mostra só "não medido", nunca "R$ 0,00"; com uma parte medida, mostra o valor e a marca de que
 * falta uma parte.
 */
export type AmountShown = "money" | "unmeasured" | "money-and-unmeasured";

export const amountShown = (cents: number, unmeasured: boolean): AmountShown => (!unmeasured ? "money" : cents === 0 ? "unmeasured" : "money-and-unmeasured");

/**
 * As marcas de um valor do extrato, a partir das contagens que a API manda ao lado de cada soma. A
 * estimativa (`cost_estimated`, desde a fatia 7a) é ortogonal ao não medido: ela entra no valor,
 * acima do real, e a marca "inclui estimativa" vem ao lado do que `amountShown` decidiu, sem nunca
 * tomar o lugar do "não medido".
 */
export interface AmountMarks {
  shown: AmountShown;
  estimated: boolean;
}

export const amountMarks = (cents: number, unmeasuredCount: number, estimatedCount: number): AmountMarks => ({
  shown: amountShown(cents, unmeasuredCount > 0),
  estimated: estimatedCount > 0,
});
