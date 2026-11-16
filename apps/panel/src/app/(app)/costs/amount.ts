/**
 * Como mostrar um valor do extrato que pode ter linha de custo não medido (modelo sem preço). O zero
 * dessa linha não é grátis: sem nada medido, a tela mostra só "não medido", nunca "R$ 0,00"; com uma
 * parte medida, mostra o valor e a marca de que falta uma parte.
 */
export type AmountShown = "money" | "unmeasured" | "money-and-unmeasured";

export const amountShown = (cents: number, unmeasured: boolean): AmountShown => (!unmeasured ? "money" : cents === 0 ? "unmeasured" : "money-and-unmeasured");
