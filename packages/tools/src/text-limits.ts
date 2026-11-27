/**
 * Até quantos caracteres o modelo escreve nos campos de texto livre das ferramentas que avisam a
 * equipe, pedem aprovação, abrem pendência ou transferem. O texto vai ao banco, à linha do tempo e,
 * nos avisos, ao WhatsApp da equipe: sem teto, uma ligação enche tudo isso com um texto só.
 *
 * O excesso é recusado, nunca cortado: o modelo ouve o limite e reescreve mais curto.
 */
export const TEXT_MAX = {
  notifyMessage: 1000,
  approvalQuestion: 300,
  approvalContext: 1000,
  taskDetails: 2000,
  transferReason: 300,
} as const;

/** A recusa que o modelo ouve (dentro de "Argumentos inválidos para …" do `runTool`). */
export function tooLong(max: number): string {
  return `texto longo demais, o máximo é ${max} caracteres. Nada foi feito nem cortado: resuma e chame de novo`;
}
