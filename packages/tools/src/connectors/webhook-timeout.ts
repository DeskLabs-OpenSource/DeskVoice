// Sem dependência nenhuma: a tela do painel importa estes números, e o navegador não leva a rede junto.

/** Quanto se espera a resposta de um webhook sem prazo gravado: o de sempre. */
export const WEBHOOK_DEFAULT_TIMEOUT_SECONDS = 10;
/** O menor prazo que o operador grava. */
export const WEBHOOK_MIN_TIMEOUT_SECONDS = 1;
/** O teto: durante a ligação, a pessoa fica na linha esperando a resposta. */
export const WEBHOOK_MAX_TIMEOUT_SECONDS = 30;
