/**
 * Quando transcrever a gravação também custa a classificação da ligação.
 *
 * A transcrição entra na linha do tempo como fala e reenfileira o resumo; com o desfecho ou a
 * análise ligados, o resumo enfileira a classificação, que é outra chamada paga ao provedor.
 * Quem vai clicar em "Transcrever" precisa saber disso antes, não depois, no extrato.
 */
export const transcribeAlsoClassifies = (settings: { outcome: boolean; analysis: boolean }): boolean => settings.outcome || settings.analysis;
