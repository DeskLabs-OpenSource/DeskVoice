import { type SpokenLanguage, spokenLanguageOf } from "@deskvoice/core";

/**
 * As falas da agenda. As três ferramentas dizem a mesma coisa quando a agenda não está ligada ou
 * quando ela não responde; a fala mora aqui para não divergir entre elas.
 *
 * `outcome` é o que deixou de acontecer, na voz do resultado: "o horário não foi marcado",
 * "os horários não foram consultados".
 *
 * O idioma é o do agente, escolhido por `spokenLanguageOf`, em `@deskvoice/core`: o mesmo ponto do
 * aviso da caixa postal e da saudação da passagem entre agentes. O prefixo vale (`en-US` fala
 * inglês) e um idioma que as falas não têm cai no padrão do produto.
 */

/** A agenda ainda não tem cliente ligado nesta central (o conector é a fatia seguinte). */
export function agendaNotWired(outcome: string): string {
  return (
    `A agenda não está ligada nesta central, e ${outcome}. Diga à pessoa, com naturalidade, ` +
    "que você não consegue mexer na agenda agora e ofereça anotar o pedido para a equipe retornar " +
    "(create_task) ou transferir para uma pessoa (transfer_to_human)."
  );
}

/** A agenda respondeu com erro ou não respondeu: a ligação continua, sem promessa falsa. */
export function agendaUnavailable(outcome: string): string {
  return (
    `O sistema de agenda não respondeu agora, e ${outcome}. Diga à pessoa que não foi possível ` +
    "concluir neste momento e ofereça anotar o pedido para a equipe retornar (create_task) ou transferir " +
    "para uma pessoa (transfer_to_human). NÃO diga que está marcado."
  );
}

/**
 * O que o agente diz enquanto a agenda trabalha. Vai para `ctx.say`, que o motor fala como está: por
 * isso já sai no idioma do agente, e não como instrução para ele traduzir.
 */
export const AGENDA_WAIT_LINES: Readonly<Record<SpokenLanguage, Readonly<Record<"checking" | "booking" | "rescheduling", string>>>> = {
  "pt-BR": {
    checking: "Um instante, estou conferindo a agenda.",
    booking: "Um instante, estou marcando.",
    rescheduling: "Um instante, estou remarcando.",
  },
  en: {
    checking: "One moment, I'm checking the schedule.",
    booking: "One moment, I'm booking that for you.",
    rescheduling: "One moment, I'm rescheduling that for you.",
  },
  es: {
    checking: "Un momento, estoy revisando la agenda.",
    booking: "Un momento, estoy agendando.",
    rescheduling: "Un momento, estoy cambiando la cita.",
  },
};

export function agendaWaitLine(kind: "checking" | "booking" | "rescheduling", language: string): string {
  return AGENDA_WAIT_LINES[spokenLanguageOf(language)][kind];
}

/**
 * O horário em palavras, para o agente ler ao telefone: dia da semana, data e hora no fuso da regra
 * da agenda, no idioma do agente. Em inglês a hora sai em 12 horas, como se fala nos EUA; em
 * português e espanhol, em 24. Datas vêm do CRM em ISO; a conversão é só de apresentação e não lê o relógio.
 */
export function speakSlot(startsAt: string, timezone: string, language: string): string {
  const lang = spokenLanguageOf(language);
  return new Intl.DateTimeFormat(lang, {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    // "9:00 AM" em inglês, sem o zero que ninguém fala; "09:00" em português e espanhol, como sempre foi.
    hour: lang === "en" ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: lang === "en",
  }).format(new Date(startsAt));
}
