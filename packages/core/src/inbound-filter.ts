// Este arquivo também vai para a tela (`@deskvoice/core/inbound-filter`): nada de banco aqui.

/**
 * Se o filtro de entrada da central vale para esta linha (R14, contrato 11). É o filtro EFETIVO:
 * a linha por IP filtra sempre, e a coluna `trunks.inbound_filter` só vale para a linha por
 * registro. O render, o plano e a tela leem este valor, nunca a coluna crua.
 *
 * A troca de modo não grava na coluna: a linha por registro com o filtro desligado que passa a IP
 * filtra na hora, e a que volta a registro reencontra o valor que a coluna tinha. Coluna ausente
 * vale ligada (o padrão da coluna).
 */
export function inboundFilterOn(trunk: { authMode: "register" | "ip"; inboundFilter?: boolean | null }): boolean {
  return trunk.authMode === "ip" || trunk.inboundFilter !== false;
}
