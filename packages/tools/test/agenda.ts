import type { AgendaAppointment, AgendaClient, AgendaFreeSlots, AgendaSlot, BookRequest, FreeSlotsRequest, RescheduleRequest } from "../src/connectors/agenda";
import type { ToolContext } from "../src/types";

/** O momento da ligação nos testes: um instante fixo, nunca o relógio da máquina. */
export const AGORA = new Date("2026-11-17T12:00:00-03:00");

/** Dois horários livres na quarta seguinte, no fuso da agenda. */
export const HORARIOS_LIVRES: AgendaSlot[] = [
  { startsAt: "2026-11-18T09:00:00-03:00", endsAt: "2026-11-18T10:00:00-03:00" },
  { startsAt: "2026-11-18T14:00:00-03:00", endsAt: "2026-11-18T15:00:00-03:00" },
];

/**
 * O CRM simulado: guarda o que as ferramentas pedirem, como o servidor do CRM guardaria. Serve para
 * provar a escrita — e a ausência dela — sem HTTP, sem rede e sem depender do CRM de verdade.
 */
export interface CrmSimulado extends AgendaClient {
  readonly pedidos: { horarios: FreeSlotsRequest[]; marcacoes: BookRequest[]; remarcacoes: RescheduleRequest[] };
  readonly compromissos: Map<string, AgendaAppointment>;
  /** Derruba o CRM simulado: a próxima chamada, e as seguintes, falham como servidor fora do ar. */
  foraDoAr(motivo?: string | Error): void;
}

export function crmSimulado(options: { slots?: AgendaSlot[]; timezone?: string; hasMore?: boolean; provisional?: boolean; awaitingConfirmation?: boolean } = {}): CrmSimulado {
  const slots = options.slots ?? HORARIOS_LIVRES;
  const timezone = options.timezone ?? "America/Sao_Paulo";
  const pedidos = { horarios: [] as FreeSlotsRequest[], marcacoes: [] as BookRequest[], remarcacoes: [] as RescheduleRequest[] };
  const compromissos = new Map<string, AgendaAppointment>();
  const awaitingConfirmation = options.awaitingConfirmation ?? false;
  let falha: Error | null = null;
  let proximo = 0;

  const conferir = (): void => {
    if (falha) throw falha;
  };

  return {
    pedidos,
    compromissos,
    foraDoAr(motivo: string | Error = "connect ECONNREFUSED 10.0.0.5:443") {
      falha = motivo instanceof Error ? motivo : new Error(motivo);
    },
    async freeSlots(pedido: FreeSlotsRequest): Promise<AgendaFreeSlots> {
      pedidos.horarios.push(pedido);
      conferir();
      return { timezone, slots, hasMore: options.hasMore ?? false, provisional: options.provisional ?? false };
    },
    async book(pedido: BookRequest): Promise<AgendaAppointment> {
      pedidos.marcacoes.push(pedido);
      conferir();
      proximo += 1;
      const compromisso = { id: `agendamento-${proximo}`, startsAt: pedido.startsAt, awaitingConfirmation };
      compromissos.set(compromisso.id, compromisso);
      return compromisso;
    },
    async reschedule(pedido: RescheduleRequest): Promise<AgendaAppointment> {
      pedidos.remarcacoes.push(pedido);
      conferir();
      const atual = compromissos.get(pedido.appointmentId);
      if (!atual) throw new Error(`compromisso ${pedido.appointmentId} não existe no CRM (HTTP 404)`);
      const remarcado = { id: atual.id, startsAt: pedido.startsAt, awaitingConfirmation };
      compromissos.set(remarcado.id, remarcado);
      return remarcado;
    },
  };
}

/** Quem ligou, no registro da ligação de teste. */
export const QUEM_LIGOU = "+5531999998888";

/**
 * Contexto de uma ligação: relógio fixo, `say` gravado e banco que só responde o registro da ligação
 * (de onde a marcação lê quem ligou). Qualquer outra consulta reprova o teste.
 */
export function contextoDaAgenda(
  language = "pt-BR",
  ligacao: { direction: "inbound" | "outbound"; from_e164: string | null; to_e164: string | null } | null = { direction: "inbound", from_e164: QUEM_LIGOU, to_e164: "+5531300000000" },
): ToolContext & { said: string[] } {
  const said: string[] = [];
  const naoUsaBanco = async (): Promise<never> => {
    throw new Error("as ferramentas de agenda só leem o registro da ligação");
  };
  const umaLinha = async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
    if (sql === "select direction, from_e164, to_e164 from calls where id = $1" && params?.[0] === "call-1") return ligacao as T | null;
    return naoUsaBanco();
  };
  return {
    organizationId: "org-1",
    callId: "call-1",
    agentId: "agent-1",
    language,
    q: { organizationId: "org-1", many: naoUsaBanco, one: umaLinha, exec: naoUsaBanco },
    clock: { now: () => AGORA },
    telephony: {
      canTransfer: true,
      transfer: async () => undefined,
      hangup: async () => undefined,
      pauseRecording: async () => "not_recording",
    },
    say: (texto) => {
      said.push(texto);
    },
    waitForApproval: async () => "denied",
    said,
  };
}
