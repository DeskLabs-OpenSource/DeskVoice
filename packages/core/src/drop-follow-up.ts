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
