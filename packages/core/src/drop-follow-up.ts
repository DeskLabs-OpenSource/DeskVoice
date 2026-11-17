import { spokenLanguageOf, type SpokenLanguage } from "./spoken-language";

// Este arquivo também vai para a tela (`@deskvoice/core/drop-follow-up`): nada de banco aqui.

/** Teto do texto do WhatsApp para quem ligou (`agents.drop_follow_up_message`); o banco confere o mesmo número. */
export const DROP_FOLLOW_UP_MESSAGE_MAX = 300;

/**
 * O texto padrão do WhatsApp para quem ligou, quando a ligação cai e o agente não tem texto próprio
 * (`agents.drop_follow_up_message` nulo). Desenho 2026-11-16-follow-up-da-ligacao-que-caiu, seção 3.5.
 *
 * Fixo, sem variável: o número de quem liga pode não ser de quem ligou (forjado, ou um fixo atendido
 * por outra pessoa), e nada da conversa vai para ele. A revisão escolhe a língua pela do agente que
 * atendeu (`spokenLanguageOf`), a mesma regra das outras falas fixas; a tela mostra o mesmo texto.
 */
export const DROP_FOLLOW_UP_DEFAULT_MESSAGE: Record<SpokenLanguage, string> = {
  "pt-BR": "Olá. Sua ligação para nós caiu antes de terminarmos. Se ainda precisar, ligue de novo neste número.",
  en: "Hello. Your call to us dropped before we finished. If you still need anything, please call this number again.",
  es: "Hola. Su llamada con nosotros se cortó antes de terminar. Si todavía lo necesita, vuelva a llamar a este número.",
};

/** O texto padrão na língua de um agente (`agents.language`, texto livre como `en-US`). */
export const dropFollowUpDefaultMessage = (agentLanguage: unknown): string => DROP_FOLLOW_UP_DEFAULT_MESSAGE[spokenLanguageOf(agentLanguage)];
