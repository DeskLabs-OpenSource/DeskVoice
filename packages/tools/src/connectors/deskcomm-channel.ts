// Sem dependência nenhuma: a tela do painel importa este número, e o navegador não leva a rede junto.

/**
 * O teto do nome do canal do CRM que se grava com o conector `deskcomm` (`channelLabel`). O nome
 * vem do próprio CRM, e não do que o operador digita: a tela corta nele, e a API recusa acima dele.
 */
export const DESKCOMM_CHANNEL_LABEL_MAX = 120;
