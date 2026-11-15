import { z } from "zod";
import { agendaNotWired, agendaUnavailable } from "../agenda-speech";
import { defineTool } from "../define-tool";
import type { ToolDeps } from "../deps";

export function createAgendaRemarcar(deps: ToolDeps = {}) {
  return defineTool({
    name: "agenda_remarcar",
    available: deps.agenda !== undefined,
    description:
      "Troca o horário de um compromisso que já existe na agenda, depois que a pessoa confirmou o novo dia e a nova hora em voz alta. Use só com o identificador do agendamento que agenda_marcar devolveu ou que o operador informou. Chame só depois de ler o novo dia e a nova hora e ouvir o sim dela: sem `confirmed: true` nada é alterado. NÃO use para marcar um compromisso novo (use agenda_marcar) nem para desmarcar. NÃO remarque para um horário que já passou.",
    inputSchema: z.object({
      appointment_id: z
        .string()
        .min(1)
        .describe("O identificador do compromisso que vai ser remarcado, como veio de agenda_marcar ou das instruções do agente."),
      starts_at: z.iso
        .datetime({ offset: true })
        .describe("O novo horário, em ISO 8601 com fuso, exatamente como veio de agenda_horarios_livres."),
      confirmed: z
        .boolean()
        .describe("Só `true` depois de ler o novo dia e a nova hora em voz alta e a pessoa confirmar. Sem isso, nada é alterado."),
    }),
    async run(input, ctx) {
      if (input.confirmed !== true) {
        return {
          ok: false,
          noEffect: true,
          message:
            "Nada foi remarcado: falta a confirmação da pessoa. Leia em voz alta o novo dia e a nova hora, pergunte se pode trocar " +
            "e, só depois do sim dela, chame de novo com confirmed=true.",
        };
      }

      const client = deps.agenda;
      if (!client) return { ok: false, noEffect: true, message: agendaNotWired("o horário não foi remarcado") };

      if (new Date(input.starts_at).getTime() <= ctx.clock.now().getTime()) {
        return {
          ok: false,
          noEffect: true,
          message:
            "Esse horário já passou, e nada foi remarcado. Confira o dia e a hora com a pessoa e consulte de novo os horários livres.",
        };
      }

      ctx.say("Um instante, estou remarcando.");
      try {
        const appointment = await client.reschedule({
          appointmentId: input.appointment_id,
          startsAt: input.starts_at,
          callId: ctx.callId,
        });
        return {
          ok: true,
          message:
            "Horário remarcado. Confirme com a pessoa o novo dia e a nova hora e diga que o compromisso anterior foi trocado.",
          data: { appointmentId: appointment.id, startsAt: appointment.startsAt },
        };
      } catch {
        return { ok: false, message: agendaUnavailable("o horário não foi remarcado") };
      }
    },
  });
}

export default createAgendaRemarcar();
