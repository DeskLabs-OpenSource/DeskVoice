/**
 * A agenda vista pela ligação.
 *
 * O conector com o CRM da casa ainda não existe neste repositório: a decisão
 * [`0001`](../../../../docs/decisions/0001-fronteira-com-o-deskcomm.md) deixa o conector para depois, e o
 * [`ROADMAP.md`](../../../../ROADMAP.md) o lista como trabalho futuro, sem data. Para as ferramentas de agenda
 * não ficarem presas nisso, elas falam com esta interface e recebem um cliente de fora
 * (`ToolDeps.agenda`): em produção, quem liga a central injeta o cliente do CRM; no teste, um CRM simulado.
 *
 * O que foi medido no DeskcommCRM (`main`, 14/11/2026) e que o cliente de verdade precisa falar:
 *
 * - `GET /api/v1/agenda/horarios-livres?event_type_id=&de=&ate=[&duracao_minutos=]`
 *   devolve `{ data: { slots: [{ inicio, fim }], fuso_da_regra, ... } }`.
 * - `POST /api/v1/agenda/agendamentos` recebe `{ event_type_id, starts_at, ... }` e devolve `201`.
 * - `PATCH /api/v1/agenda/agendamentos` recebe `{ id, starts_at, ... }` e devolve `200`.
 *
 * As três rotas usam `Authorization: Bearer dsk_…`. Duas ressalvas medidas, e que ficam declaradas
 * no PR: a leitura usa `requireRole("viewer")`, que hoje só aceita sessão de navegador (token de
 * servidor cai em 401), e o tipo de atendimento é um UUID do CRM — quem administra a central informa
 * esse id nas instruções do agente, porque o CRM não publica uma rota de tipos de atendimento para
 * integração.
 *
 * Nada disso é chamado daqui. Sem a tela de configuração do conector, um cliente HTTP seria código
 * morto; esta fatia entrega o contrato e as ferramentas, e a fatia do conector vem depois.
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
}

/** O que a consulta devolve: os horários e o fuso em que a regra da agenda vale. */
export interface AgendaFreeSlots {
  timezone: string;
  slots: AgendaSlot[];
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
  callId: string;
}

export interface RescheduleRequest {
  appointmentId: string;
  startsAt: string;
  callId: string;
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
