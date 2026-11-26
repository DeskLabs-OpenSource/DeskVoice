import { type SpokenLanguage, spokenLanguageOf } from "@deskvoice/core";
import { AgendaError, type AgendaRefusal } from "./connectors/agenda";

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
 * A agenda respondeu e recusou: nada foi gravado. Cada motivo diz ao modelo o que fazer em seguida; o
 * texto do outro sistema nunca chega aqui.
 */
export function agendaRefused(refusal: AgendaRefusal, outcome: string): string {
  switch (refusal) {
    case "unknown_service":
      return (
        `Esse tipo de atendimento não está na agenda, e ${outcome}. Pergunte à pessoa qual atendimento ela quer, ` +
        "usando o nome que o operador cadastrou, ou anote o pedido para a equipe retornar (create_task)."
      );
    case "not_published":
      return (
        `A agenda ainda não tem horários publicados para esse atendimento, e ${outcome}. NÃO diga que está lotado ` +
        "e não invente horário: diga que a equipe confirma o horário e anote o pedido (create_task)."
      );
    case "slot_unavailable":
      return (
        `Esse horário não está mais livre, e ${outcome}. Consulte de novo agenda_horarios_livres e ofereça um dos ` +
        "horários que voltarem. Não insista no horário anterior."
      );
    case "appointment_not_found":
      return (
        `Esse agendamento não foi encontrado na agenda, ou é cuidado em outro sistema, e ${outcome}. Não tente de novo: ` +
        "anote o pedido para a equipe retornar (create_task)."
      );
    case "ambiguous_contact":
      return (
        `Há mais de um cadastro com o número de quem ligou, e ${outcome}. Diga à pessoa que a equipe confirma o horário ` +
        "e anote o pedido (create_task) com o dia e a hora que ela escolheu. Não chame de novo."
      );
    case "other":
      return agendaUnavailable(outcome);
  }
}

/**
 * O pedido de escrita saiu e não se sabe se foi gravado (a agenda não respondeu a tempo). A fala não
 * afirma nem nega: a equipe confere. `what` é o que pode ter sido gravado: "o horário", "a remarcação".
 */
export function agendaUncertain(what: string): string {
  return (
    `Não foi possível confirmar agora se ${what} ficou gravado na agenda. Diga à pessoa que você não conseguiu ` +
    "confirmar neste momento e que a equipe confere e retorna. NÃO diga que está marcado, NÃO diga que não foi marcado " +
    "e NÃO chame a ferramenta de novo."
  );
}

/** A ligação não tem um número que o cliente possa usar (oculto, ou ligação sem número). */
export function agendaNoCallerNumber(): string {
  return (
    "O número de quem ligou não está disponível (número oculto ou ligação sem número), e o horário não foi marcado. " +
    "Diga à pessoa que a equipe confirma o horário e anote o pedido (create_task) com o dia e a hora que ela escolheu " +
    "e um telefone de contato, se ela quiser dar."
  );
}

/** A tradução de qualquer falha da agenda para a fala e para o resultado da ferramenta. */
export function agendaFailure(error: unknown, outcome: string, what: string): { ok: false; message: string; outcome?: "unknown" } {
  if (error instanceof AgendaError && error.kind === "uncertain") return { ok: false, message: agendaUncertain(what), outcome: "unknown" };
  if (error instanceof AgendaError && error.kind === "refused") return { ok: false, message: agendaRefused(error.refusal, outcome) };
  return { ok: false, message: agendaUnavailable(outcome) };
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
