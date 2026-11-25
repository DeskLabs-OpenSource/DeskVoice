import { randomUUID } from "node:crypto";
import { type Clock, toE164 } from "@deskvoice/core";
import { z } from "zod";
import { callTool, McpHttpError, type McpEndpoint, type McpNet } from "../mcp/client";
import { safeFetch } from "../net/safe-fetch";
import {
  AgendaError,
  type AgendaAppointment,
  type AgendaClient,
  type AgendaFreeSlots,
  type AgendaRefusal,
  type BookRequest,
  type FreeSlotsRequest,
  type RescheduleRequest,
} from "./agenda";

/**
 * O cliente da agenda do DeskcommCRM, pelo MCP do CRM (decisão
 * [`0022`](../../../../docs/decisions/0022-conector-com-o-deskcomm-pelo-mcp.md)).
 *
 * Fala com cinco ferramentas do `/api/mcp` (`crm_list_event_types`, `crm_find_free_slots`,
 * `crm_search_contacts`, `crm_book_appointment`, `crm_reschedule_appointment`) e com uma rota REST,
 * `POST /api/v1/conversations/open-with-contact`, só para criar o contato de um número novo. Toda
 * resposta passa por Zod e é traduzida: o campo `mensagem` do CRM, escrito para o modelo de lá, não
 * sai daqui.
 *
 * O formato das respostas foi lido no código do CRM (`lib/mcp/tools/agendamento.ts` e
 * `lib/mcp/tools/contacts.ts`, `main` em `ee3b3290`) e medido num CRM de verdade em 24/11/2026 para
 * `crm_list_event_types`, `crm_find_free_slots` (agenda sem horário publicado e tipo desconhecido) e
 * `crm_search_contacts`. A forma de uma lista com horários, da marcação e da remarcação vem só da
 * leitura do código.
 */

/** Onde fica o CRM e com que token. O token é `dsk_…`, com `mcp:read` e `mcp:write`. */
export interface DeskcommAgendaConfig {
  /** O endereço do CRM, sem caminho: `https://crm.exemplo.com`. */
  baseUrl: string;
  token: string;
  /** O canal por onde o CRM cria a conversa de um contato novo. Ausente: a regra do CRM escolhe. */
  channelSessionId?: string;
  /**
   * O prazo de cada operação (`freeSlots`, `book`, `reschedule`), somados todos os pedidos dela ao CRM.
   * Ausente: `DESKCOMM_AGENDA_OPERATION_TIMEOUT_SECONDS`.
   */
  timeoutSeconds?: number;
}

export interface DeskcommAgendaDeps {
  clock: Clock;
  net?: McpNet;
  /** A chave de idempotência de cada marcação. Em teste, fixa. */
  newIdempotencyKey?: () => string;
}

/**
 * O prazo de uma operação inteira, e não de cada pedido. Uma marcação faz de três a seis pedidos em
 * série (tipos, até três páginas de busca, às vezes a criação do contato, e a marcação), e quem ligou
 * está esperando na linha depois da fala de espera. Um relógio só por operação: cada pedido herda o
 * que sobra dele. Proposta a confirmar com a latência medida do `/api/mcp`.
 */
export const DESKCOMM_AGENDA_OPERATION_TIMEOUT_SECONDS = 10;

/** Quantos dias o CRM olha, no máximo, numa consulta (`MAXIMO_DE_DIAS` do CRM). */
const MAX_DAYS_AHEAD = 62;
/** Quantos horários o CRM devolve, no máximo, numa consulta (`HORARIOS_MAX` do CRM). */
const MAX_SLOTS = 50;
/** Quantas páginas da busca de contato são lidas antes de desistir de escolher. */
const MAX_CONTACT_PAGES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// As formas que o CRM devolve. `looseObject`: campo novo do lado de lá não quebra o cliente; campo
// que falta, sim.
const refusalShape = z.looseObject({ motivo: z.string(), resultado_incerto: z.boolean().optional() });

const eventTypesShape = z.looseObject({
  tipos: z.array(z.looseObject({ slug: z.string().min(1), nome: z.string(), precisa_confirmacao: z.boolean() })),
});

const freeSlotsShape = z.looseObject({
  horarios: z.array(z.looseObject({ inicio: z.iso.datetime({ offset: true }), fim: z.iso.datetime({ offset: true }) })),
  ha_mais: z.boolean(),
  fuso_da_regra: z.string().min(1),
  publicou_horarios: z.boolean(),
  fuso_suposto: z.boolean(),
  agenda_externa_nunca_lida: z.boolean(),
});

const contactsShape = z.looseObject({
  contacts: z.array(z.looseObject({ id: z.uuid(), phone: z.string().nullable() })),
  cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

const appointmentShape = z.looseObject({ id: z.uuid(), starts_at: z.iso.datetime({ offset: true }) });

const bookedShape = z.looseObject({
  marcado: z.literal(true),
  compromisso: appointmentShape,
  aguarda_confirmacao: z.boolean(),
});

const rescheduledShape = z.looseObject({
  remarcado: z.literal(true),
  // Remarcar para o mesmo horário devolve só `{ id, inalterado: true }`.
  compromisso: z.union([appointmentShape, z.looseObject({ id: z.uuid(), inalterado: z.literal(true) })]),
});

const openedShape = z.looseObject({ data: z.looseObject({ contact_id: z.uuid() }) });

/** O código de recusa do CRM, traduzido. O que não está aqui vira `other`. */
const REFUSALS: Readonly<Record<string, AgendaRefusal>> = {
  tipo_desconhecido: "unknown_service",
  agenda_tipo_desativado: "unknown_service",
  agenda_tipo_de_sistema_externo: "unknown_service",
  agenda_sem_responsavel: "not_published",
  agenda_horario_indisponivel: "slot_unavailable",
  agenda_fora_da_jornada: "slot_unavailable",
  horario_indisponivel: "slot_unavailable",
  not_found: "appointment_not_found",
  agenda_autoridade_externa: "appointment_not_found",
};

/** Recusas em que a escrita pode ter acontecido: a mesma chave ainda corre, ou outro sistema não confirmou. */
const UNCERTAIN = new Set(["idempotency_in_progress", "agenda_amigo_unconfirmed"]);

/** Tira acento e caixa: "Visita de Orçamento" e "visita de orcamento" são o mesmo atendimento. */
const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

export function createDeskcommAgendaClient(config: DeskcommAgendaConfig, deps: DeskcommAgendaDeps): AgendaClient {
  const base = new URL(config.baseUrl);
  const operationMs = (config.timeoutSeconds ?? DESKCOMM_AGENDA_OPERATION_TIMEOUT_SECONDS) * 1000;
  const endpoint: Omit<McpEndpoint, "timeoutSeconds"> = {
    slug: "deskcomm",
    url: new URL("/api/mcp", base).toString(),
    headerName: "Authorization",
    secret: `Bearer ${config.token}`,
  };
  const net = deps.net ?? {};
  const newKey = deps.newIdempotencyKey ?? randomUUID;
  /**
   * A última consulta de cada ligação foi provisória? A marcação que vem dela é dita como
   * "a equipe confirma". Guardado pela ligação, com teto, porque o cliente é da organização.
   */
  const provisionalByCall = new Map<string, boolean>();
  /** O relógio de uma operação: o instante em que ela acaba, pelo `Clock`. */
  const startOperation = (): number => deps.clock.now().getTime() + operationMs;
  /**
   * O que sobra do prazo da operação, em milissegundos: é o prazo do pedido seguinte. Acabou: o pedido
   * não sai, e a operação é `unavailable` (nada foi enviado por ele).
   */
  const remainingMs = (deadline: number, name: string): number => {
    const remaining = deadline - deps.clock.now().getTime();
    if (remaining <= 0) throw new AgendaError("unavailable", `operation deadline passed before ${name}`);
    return remaining;
  };

  const rememberProvisional = (callId: string, provisional: boolean): void => {
    provisionalByCall.delete(callId);
    provisionalByCall.set(callId, provisional);
    if (provisionalByCall.size > 500) provisionalByCall.delete(provisionalByCall.keys().next().value as string);
  };

  /**
   * Chama uma ferramenta e devolve o JSON da resposta. `isError` do MCP e resposta que não é JSON são
   * `unavailable` numa leitura e `uncertain` numa escrita: o CRM pode ter gravado antes de falhar.
   */
  async function call(deadline: number, name: string, args: Record<string, unknown>, writing = false, headers: Record<string, string> = {}): Promise<unknown> {
    const timeoutSeconds = remainingMs(deadline, name) / 1000;
    const result = await callTool({ ...endpoint, timeoutSeconds }, name, args, net, headers);
    const failed = writing ? "uncertain" : "unavailable";
    if (result.isError) throw new AgendaError(failed, `${name} answered isError`);
    try {
      return JSON.parse(result.text) as unknown;
    } catch {
      throw new AgendaError(failed, `${name} answered something that is not JSON`);
    }
  }

  /** A resposta que não é a forma boa: recusa conhecida, ou fora da forma. */
  function refusalOf(name: string, payload: unknown, writing: boolean): AgendaError {
    const refusal = refusalShape.safeParse(payload);
    if (!refusal.success) return new AgendaError(writing ? "uncertain" : "unavailable", `${name} answered out of shape`);
    const { motivo, resultado_incerto } = refusal.data;
    if (writing && (resultado_incerto === true || UNCERTAIN.has(motivo))) {
      return new AgendaError("uncertain", `${name} refused with ${motivo}, result uncertain`);
    }
    return new AgendaError("refused", `${name} refused with ${motivo}`, REFUSALS[motivo] ?? "other");
  }

  /** O tipo de atendimento pelo nome que o operador escreveu, ou pelo slug. */
  async function serviceOf(deadline: number, serviceType: string): Promise<{ slug: string; needsConfirmation: boolean }> {
    const payload = await call(deadline, "crm_list_event_types", {});
    const parsed = eventTypesShape.safeParse(payload);
    if (!parsed.success) throw new AgendaError("unavailable", "crm_list_event_types answered out of shape");
    const wanted = fold(serviceType);
    const found = parsed.data.tipos.find((type) => fold(type.slug) === wanted || fold(type.nome) === wanted);
    if (!found) throw new AgendaError("refused", "service type not found in crm_list_event_types", "unknown_service");
    return { slug: found.slug, needsConfirmation: found.precisa_confirmacao };
  }

  /**
   * O contato de quem ligou. A busca do CRM casa por trecho, então só vale o telefone igual depois de
   * normalizado. Um contato: esse. Nenhum: cria pelo `open-with-contact`. Mais de um: recusa.
   */
  async function contactOf(deadline: number, callerE164: string): Promise<string> {
    const matches = new Set<string>();
    let cursor: string | undefined;
    for (let page = 1; ; page += 1) {
      const payload = await call(deadline, "crm_search_contacts", { query: callerE164, limit: MAX_SLOTS, ...(cursor !== undefined && { cursor }) });
      const parsed = contactsShape.safeParse(payload);
      if (!parsed.success) throw new AgendaError("unavailable", "crm_search_contacts answered out of shape");
      for (const contact of parsed.data.contacts) {
        if (contact.phone !== null && toE164(contact.phone) === callerE164) matches.add(contact.id);
      }
      if (matches.size > 1) throw new AgendaError("refused", "more than one contact with the caller number", "ambiguous_contact");
      const next = parsed.data.has_more === true ? parsed.data.cursor : null;
      if (next === null || next === undefined) break;
      // Páginas demais: um contato igual pode estar além delas, e criar outro seria duplicar.
      if (page === MAX_CONTACT_PAGES) throw new AgendaError("refused", "too many partial matches for the caller number", "ambiguous_contact");
      cursor = next;
    }
    const [only] = matches;
    if (only !== undefined) return only;
    return createContact(deadline, callerE164);
  }

  async function createContact(deadline: number, callerE164: string): Promise<string> {
    const timeoutMs = remainingMs(deadline, "open-with-contact");
    const response = await safeFetch(
      new URL("/api/v1/conversations/open-with-contact", base).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ phone_number: callerE164, ...(config.channelSessionId !== undefined && { channel_session_id: config.channelSessionId }) }),
      },
      { ...net, timeoutMs, redirect: "error" },
    );
    if (!response.ok) throw new AgendaError("unavailable", `open-with-contact answered HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = JSON.parse(response.body) as unknown;
    } catch {
      throw new AgendaError("unavailable", "open-with-contact answered something that is not JSON");
    }
    const parsed = openedShape.safeParse(payload);
    if (!parsed.success) throw new AgendaError("unavailable", "open-with-contact answered out of shape");
    return parsed.data.data.contact_id;
  }

  return {
    async freeSlots(request: FreeSlotsRequest): Promise<AgendaFreeSlots> {
      const deadline = startOperation();
      return guard(false, async () => {
        const { slug } = await serviceOf(deadline, request.serviceType);
        const from = new Date(request.from).getTime();
        const to = new Date(request.to).getTime();
        // O CRM conta os dias a partir de agora, no fuso da agenda. O cliente nunca monta `dia` a
        // partir de um instante em UTC: pede os dias que cobrem a janela e filtra pelo instante.
        const days = Math.min(MAX_DAYS_AHEAD, Math.max(1, Math.ceil((to - deps.clock.now().getTime()) / DAY_MS)));
        const payload = await call(deadline, "crm_find_free_slots", {
          event_type_slug: slug,
          dias_a_frente: days,
          limite: MAX_SLOTS,
        });
        const parsed = freeSlotsShape.safeParse(payload);
        if (!parsed.success) throw refusalOf("crm_find_free_slots", payload, false);
        const agenda = parsed.data;
        if (!agenda.publicou_horarios) throw new AgendaError("refused", "schedule not published", "not_published");

        const slots = agenda.horarios
          .filter((slot) => {
            const at = new Date(slot.inicio).getTime();
            return at >= from && at < to;
          })
          .map((slot) => ({ startsAt: slot.inicio, endsAt: slot.fim }));
        const provisional = agenda.fuso_suposto || agenda.agenda_externa_nunca_lida;
        rememberProvisional(request.callId, provisional);
        return { timezone: agenda.fuso_da_regra, slots, hasMore: agenda.ha_mais, provisional };
      });
    },

    async book(request: BookRequest): Promise<AgendaAppointment> {
      // Um relógio só para a marcação inteira: cada pedido herda o que sobra dele.
      const deadline = startOperation();
      const service = await guard(false, () => serviceOf(deadline, request.serviceType));
      const contactId = await guard(false, () => contactOf(deadline, request.callerE164));
      // Daqui em diante o pedido de escrita sai: falha que não é recusa é resultado incerto.
      return guard(true, async () => {
        const payload = await call(
          deadline,
          "crm_book_appointment",
          { event_type_slug: service.slug, starts_at: request.startsAt, contact_id: contactId },
          true,
          { "Idempotency-Key": newKey() },
        );
        const parsed = bookedShape.safeParse(payload);
        if (!parsed.success) throw refusalOf("crm_book_appointment", payload, true);
        const provisional = provisionalByCall.get(request.callId) === true;
        return {
          id: parsed.data.compromisso.id,
          startsAt: parsed.data.compromisso.starts_at,
          awaitingConfirmation: parsed.data.aguarda_confirmacao || provisional,
        };
      });
    },

    async reschedule(request: RescheduleRequest): Promise<AgendaAppointment> {
      // O CRM não repassa a chave de idempotência na remarcação: ela não é repetida em caso nenhum.
      const deadline = startOperation();
      return guard(true, async () => {
        const payload = await call(deadline, "crm_reschedule_appointment", { appointment_id: request.appointmentId, new_starts_at: request.startsAt }, true);
        const parsed = rescheduledShape.safeParse(payload);
        if (!parsed.success) throw refusalOf("crm_reschedule_appointment", payload, true);
        const appointment = parsed.data.compromisso;
        const startsAt = "starts_at" in appointment && typeof appointment.starts_at === "string" ? appointment.starts_at : request.startsAt;
        return { id: appointment.id, startsAt, awaitingConfirmation: provisionalByCall.get(request.callId) === true };
      });
    },
  };
}

/**
 * Todo erro sai como `AgendaError`. Antes da escrita, é `unavailable`. Depois que o pedido de escrita
 * saiu, só a recusa HTTP 4xx (o CRM não chegou a executar) continua `unavailable`; o resto é `uncertain`.
 */
async function guard<T>(writing: boolean, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AgendaError) throw error;
    const name = error instanceof Error ? error.name : "unknown";
    if (writing && !(error instanceof McpHttpError && error.status >= 400 && error.status < 500)) {
      throw new AgendaError("uncertain", `write did not finish: ${name}`);
    }
    throw new AgendaError("unavailable", error instanceof McpHttpError ? `HTTP ${error.status}` : `request failed: ${name}`);
  }
}
