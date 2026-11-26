/**
 * A agenda vista pela ligação.
 *
 * As ferramentas de agenda falam com esta interface e recebem um cliente de fora (`ToolDeps.agenda`):
 * no teste, um CRM simulado; com o DeskcommCRM, o cliente de [`deskcomm-agenda.ts`](deskcomm-agenda.ts),
 * que fala pelo MCP do CRM, como fixa a decisão
 * [`0022`](../../../../docs/decisions/0022-conector-com-o-deskcomm-pelo-mcp.md). A interface é genérica:
 * outra agenda entra pelo mesmo lugar.
 *
 * As regras da agenda moram em quem a guarda. O cliente traz para cá o que a ligação precisa saber
 * delas (horário provisório, reserva que a equipe ainda confirma, lista cortada) e nunca o texto que o
 * outro sistema escreveu: o que chega ao modelo são as falas do DeskVoice.
 *
 * Todo fracasso é um `AgendaError`. Um cliente nunca resolve a promessa numa recusa, num erro HTTP
 * (4xx incluído) ou numa resposta fora da forma: a ferramenta leria isso como horário marcado.
 */

/** Um horário que a agenda oferece. Instantes em ISO 8601, com fuso. */
export interface AgendaSlot {
  startsAt: string;
  endsAt: string;
}

/** O compromisso que a agenda gravou. */
export interface AgendaAppointment {
  id: string;
  startsAt: string;
  /**
   * `true`: o horário ficou reservado, mas alguém da equipe ainda aprova, ou a agenda não pôde ser
   * conferida por inteiro (fuso suposto, agenda externa nunca lida). A fala é "separei o horário, a
   * equipe confirma", nunca "está reservado".
   */
  awaitingConfirmation: boolean;
}

/** O que a consulta devolve: os horários e o fuso em que a regra da agenda vale. */
export interface AgendaFreeSlots {
  timezone: string;
  slots: AgendaSlot[];
  /** `true`: a agenda tem mais horários do que vieram. Lista curta ou vazia não é agenda cheia. */
  hasMore: boolean;
  /**
   * `true`: a agenda não pôde ser conferida por inteiro (o fuso veio do padrão, ou a agenda externa
   * nunca foi lida). O horário é oferecido pedindo confirmação, e não afirmado.
   */
  provisional: boolean;
}

export interface FreeSlotsRequest {
  serviceType: string;
  /** Começo da janela, em ISO 8601 com fuso. */
  from: string;
  /** Fim da janela, em ISO 8601 com fuso. */
  to: string;
  durationMinutes?: number;
  callId: string;
}

export interface BookRequest {
  serviceType: string;
  startsAt: string;
  /** Quem será atendido: o número do registro da ligação, já em E.164. Nunca um argumento do modelo. */
  callerE164: string;
  callId: string;
}

export interface RescheduleRequest {
  appointmentId: string;
  startsAt: string;
  callId: string;
}

/**
 * Por que a agenda recusou. O cliente traduz o código do outro sistema para um destes; o que ele não
 * conhece vira `other`, e a fala é a genérica.
 */
export type AgendaRefusal =
  /** O tipo de atendimento não existe ou não está sendo marcado. */
  | "unknown_service"
  /** Quem atende ainda não publicou horários: não é agenda cheia. */
  | "not_published"
  /** O horário deixou de estar livre, ou está fora do expediente. */
  | "slot_unavailable"
  /** O compromisso não existe nesta agenda, ou é gerido em outro sistema. */
  | "appointment_not_found"
  /** Mais de um contato com o número de quem ligou: o cliente não escolhe, não cria e não marca. */
  | "ambiguous_contact"
  | "other";

/**
 * `refused`: a agenda respondeu e não fez (nada foi gravado). `unavailable`: a agenda não respondeu
 * ou respondeu fora da forma, antes de qualquer escrita. `uncertain`: o pedido de escrita saiu e não
 * se sabe se foi gravado; a fala não diz "não foi marcado" e o cliente não repete.
 */
export type AgendaErrorKind = "refused" | "unavailable" | "uncertain";

export class AgendaError extends Error {
  override name = "AgendaError";
  constructor(
    readonly kind: AgendaErrorKind,
    /** Só para o log e a linha do tempo: sem dado pessoal, e nunca vai ao modelo. */
    detail: string,
    readonly refusal: AgendaRefusal = "other",
  ) {
    super(detail);
  }
}

/**
 * O contrato da agenda. Quem implementa fala com o CRM; as ferramentas não sabem de HTTP,
 * de rota nem de token.
 */
export interface AgendaClient {
  freeSlots(request: FreeSlotsRequest): Promise<AgendaFreeSlots>;
  book(request: BookRequest): Promise<AgendaAppointment>;
  reschedule(request: RescheduleRequest): Promise<AgendaAppointment>;
}
