/**
 * As falas da agenda. As três ferramentas dizem a mesma coisa quando a agenda não está ligada ou
 * quando ela não responde; a fala mora aqui para não divergir entre elas.
 *
 * `outcome` é o que deixou de acontecer, na voz do resultado: "o horário não foi marcado",
 * "os horários não foram consultados".
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
 * O horário em palavras, para o agente ler ao telefone: dia da semana, data e hora no fuso da regra
 * da agenda. Datas vêm do CRM em ISO; a conversão é só de apresentação e não lê o relógio.
 */
export function speakSlot(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(startsAt));
}
