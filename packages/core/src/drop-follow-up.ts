import { spokenLanguageOf, type SpokenLanguage } from "./spoken-language";

// Este arquivo também vai para a tela (`@deskvoice/core/drop-follow-up`): nada de banco aqui.

/** Teto do texto do WhatsApp para quem ligou (`agents.drop_follow_up_message`); o banco confere o mesmo número. */
export const DROP_FOLLOW_UP_MESSAGE_MAX = 300;

/**
 * Um teto de mensagens por organização protege o número (seção 3.3 do desenho): no máximo 3 mensagens
 * para quem ligou em 60 minutos corridos e 20 em 24 horas corridas. Fixo, sem ajuste na tela; a revisão
 * confere e a tela mostra os mesmos números.
 */
export const CALLER_MESSAGE_ORG_PER_HOUR = 3;
export const CALLER_MESSAGE_ORG_PER_DAY = 20;

/**
 * O texto padrão do WhatsApp para quem ligou, quando a ligação cai e o agente não tem texto próprio
 * (`agents.drop_follow_up_message` nulo). Desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.5.
 *
 * A única variável é o nome da organização (`organizations.name`), posto pelo sistema, para a mensagem
 * dizer quem escreve. Ele é do operador, e não de quem ligou: nada da conversa vai para o número, que
 * pode não ser de quem ligou (forjado, ou um fixo atendido por outra pessoa). O texto próprio do agente
 * continua sem variável. A revisão escolhe a língua pela do agente que atendeu (`spokenLanguageOf`), a
 * mesma regra das outras falas fixas; a tela mostra o mesmo texto.
 */
export const DROP_FOLLOW_UP_DEFAULT_MESSAGE: Record<SpokenLanguage, (organization: string) => string> = {
  "pt-BR": (organization) => `Olá, aqui é ${organization}. Sua ligação para nós caiu antes de terminarmos. Se ainda precisar, ligue de novo neste número.`,
  en: (organization) => `Hello, this is ${organization}. Your call to us dropped before we finished. If you still need anything, please call this number again.`,
  es: (organization) => `Hola, le escribe ${organization}. Su llamada con nosotros se cortó antes de terminar. Si todavía lo necesita, vuelva a llamar a este número.`,
};

/** O texto padrão na língua de um agente (`agents.language`, texto livre como `en-US`), com o nome da organização. */
export const dropFollowUpDefaultMessage = (agentLanguage: unknown, organization: string): string => DROP_FOLLOW_UP_DEFAULT_MESSAGE[spokenLanguageOf(agentLanguage)](organization);

/**
 * A religação (modo `call_back`, desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.6; decisão de
 * 18/11, DESA-121, pedido 1 = A): **1 tentativa, 30 minutos depois do fim da ligação**, dentro da
 * janela das ligações de saída, sem ser empurrada para a próxima. Fixos no código, sem ajuste na tela.
 *
 * O teto é 3 (`CALL_BACK_MAX_ATTEMPTS`), e o intervalo nunca fica abaixo de 30 minutos: um teste trava
 * os dois, e o banco confere o mesmo teto em `call_backs.attempt`.
 */
export const CALL_BACK_ATTEMPTS = 1;
export const CALL_BACK_INTERVAL_MINUTES = 30;
export const CALL_BACK_MAX_ATTEMPTS = 3;
export const CALL_BACK_MIN_INTERVAL_MINUTES = 30;
/** A religação `due` que o processo de voz não discou em 1 hora (voz parada) vira `expired`, sem discar. */
export const CALL_BACK_EXPIRE_AFTER_MINUTES = 60;

/**
 * A linha fixa somada às instruções do agente quando a ligação é uma religação (`calls.call_back_of`
 * não nulo), na língua do agente (`spokenLanguageOf`). Nada da conversa anterior entra por aqui.
 */
export const CALL_BACK_INSTRUCTION: Record<SpokenLanguage, string> = {
  "pt-BR": "Esta é uma ligação de retorno: uma ligação deste número para cá caiu antes de terminar. Apresente-se, diga que está retornando e pergunte se a pessoa ainda precisa de ajuda.",
  en: "This is a return call: a call from this number to us dropped before it ended. Introduce yourself, say that you are calling back, and ask whether the person still needs help.",
  es: "Esta es una llamada de retorno: una llamada de este número hacia nosotros se cortó antes de terminar. Preséntese, diga que está devolviendo la llamada y pregunte si la persona todavía necesita ayuda.",
};

/** A linha da religação na língua de um agente (`agents.language`, texto livre como `en-US`). */
export const callBackInstruction = (agentLanguage: unknown): string => CALL_BACK_INSTRUCTION[spokenLanguageOf(agentLanguage)];
