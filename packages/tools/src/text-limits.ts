/**
 * Até quantos caracteres o modelo escreve nos campos de texto livre das ferramentas que avisam a
 * equipe, pedem aprovação, abrem pendência ou transferem. O texto vai ao banco, à linha do tempo e,
 * nos avisos, ao WhatsApp da equipe: sem teto, uma ligação enche tudo isso com um texto só.
 *
 * O excesso é recusado, nunca cortado: o modelo ouve o limite e reescreve mais curto. O registro dos
 * argumentos na linha do tempo (`tool_called`) também tem teto, `TOOL_CALLED_ARGS_MAX`.
 */
export const TEXT_MAX = {
  notifyMessage: 1000,
  approvalQuestion: 300,
  approvalContext: 1000,
  taskDetails: 2000,
  transferReason: 300,
} as const;

/**
 * Até quantos caracteres do `JSON.stringify` dos argumentos o `tool_called` grava. Acima disso grava
 * só a marca `{ omitted: "too_long", chars }`, sem nenhum pedaço do texto, valha a ferramenta que for
 * (inclusive a que não existe ou não está ligada). O maior argumento válido sem `personalTextArgs`
 * (o do `request_approval`, 300 + 1000 caracteres) fica abaixo disso mesmo com todo caractere escapado.
 */
export const TOOL_CALLED_ARGS_MAX = 4000;

/** A recusa que o modelo ouve (dentro de "Argumentos inválidos para …" do `runTool`). */
export function tooLong(max: number): string {
  return `texto longo demais, o máximo é ${max} caracteres. Nada foi feito nem cortado: resuma e chame de novo`;
}
