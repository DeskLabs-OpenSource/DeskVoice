import { z } from "zod";
import { agendaNotWired, agendaUnavailable, speakSlot } from "../agenda-speech";
import { defineTool } from "../define-tool";
import type { ToolDeps } from "../deps";

/** Janela padrão quando a pessoa não diz o período: uma semana à frente. */
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Opções que vão na fala: três já é o bastante ao telefone, e a lista completa fica em `data.slots`. */
const SPOKEN_SLOTS = 3;

export function createAgendaHorariosLivres(deps: ToolDeps = {}) {
  return defineTool({
    name: "agenda_horarios_livres",
    available: deps.agenda !== undefined,
    description:
      "Consulta os horários livres na agenda para um tipo de atendimento, num período. Use quando a pessoa quiser marcar ou remarcar e ainda não souber que horas há vaga. Devolve os horários em ISO 8601 e em palavras, no fuso da agenda: leia em voz alta o dia da semana e a hora de até três opções e peça que a pessoa escolha. NÃO use para gravar nada nem para confirmar horário: para marcar, use agenda_marcar depois que a pessoa confirmar em voz alta; para trocar um horário já marcado, use agenda_remarcar. NÃO ofereça horário que não esteja na lista devolvida.",
    inputSchema: z.object({
      service_type: z
        .string()
        .min(1)
        .max(200)
        .describe("O tipo de atendimento, exatamente como o operador cadastrou na agenda. Ex.: 'Consulta' ou 'Visita de orçamento'."),
      from: z.iso
        .datetime({ offset: true })
        .optional()
        .describe("Começo da janela, em ISO 8601 com fuso. Sem valor, começa agora."),
      to: z.iso
        .datetime({ offset: true })
        .optional()
        .describe("Fim da janela, em ISO 8601 com fuso. Sem valor, sete dias depois do começo."),
      duration_minutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60)
        .optional()
        .describe("Duração do atendimento em minutos, quando for diferente da duração padrão do tipo."),
    }),
    async run(input, ctx) {
      const client = deps.agenda;
      if (!client) return { ok: false, message: agendaNotWired("os horários não foram consultados") };

      const from = input.from ? new Date(input.from) : ctx.clock.now();
      const to = input.to ? new Date(input.to) : new Date(from.getTime() + DEFAULT_WINDOW_MS);
      if (to.getTime() <= from.getTime()) {
        return {
          ok: false,
          message:
            "O fim do período precisa ser depois do começo, e nada foi consultado. Corrija a janela e chame de novo, ou pergunte à pessoa para qual dia ela quer.",
        };
      }

      ctx.say("Um instante, estou conferindo a agenda.");
      try {
        const agenda = await client.freeSlots({
          serviceType: input.service_type,
          from: from.toISOString(),
          to: to.toISOString(),
          durationMinutes: input.duration_minutes,
          callId: ctx.callId,
        });

        if (agenda.slots.length === 0) {
          return {
            ok: true,
            message:
              `Não há horário livre para ${input.service_type} nesse período. Ofereça outro período, ` +
              "ou anote o pedido para a equipe retornar (create_task). Não invente horário.",
            data: { slots: [], timezone: agenda.timezone },
          };
        }

        const spoken = agenda.slots
          .slice(0, SPOKEN_SLOTS)
          .map((slot) => speakSlot(slot.startsAt, agenda.timezone))
          .join("; ");
        return {
          ok: true,
          message:
            `Há ${agenda.slots.length} horário(s) livre(s) para ${input.service_type} (fuso ${agenda.timezone}). ` +
            `Leia em voz alta, uma por vez, e peça que a pessoa escolha: ${spoken}. ` +
            "Depois que ela confirmar o dia e a hora em voz alta, chame agenda_marcar com esse horário e confirmed=true. " +
            "Não ofereça horário fora da lista.",
          data: { slots: agenda.slots, timezone: agenda.timezone },
        };
      } catch {
        return { ok: false, message: agendaUnavailable("os horários não foram consultados") };
      }
    },
  });
}

export default createAgendaHorariosLivres();
