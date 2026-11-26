import { toE164 } from "@deskvoice/core";
import { z } from "zod";
import { agendaFailure, agendaNoCallerNumber, agendaNotWired, agendaWaitLine } from "../agenda-speech";
import { defineTool } from "../define-tool";
import type { ToolDeps } from "../deps";
import type { ToolContext } from "../types";

/**
 * Quem será atendido: o número do registro da ligação (quem ligou, na recebida; quem foi chamado, na
 * feita), em E.164. Nunca um argumento do modelo. O que não se normaliza (número oculto, o `@lid` da
 * ligação pelo WhatsApp) volta `null`.
 */
async function callerOf(ctx: ToolContext): Promise<string | null> {
  const call = await ctx.q.one<{ direction: "inbound" | "outbound"; from_e164: string | null; to_e164: string | null }>(
    "select direction, from_e164, to_e164 from calls where id = $1",
    [ctx.callId],
  );
  const raw = call === null ? null : call.direction === "inbound" ? call.from_e164 : call.to_e164;
  return raw === null ? null : toE164(raw);
}

export function createAgendaMarcar(deps: ToolDeps = {}) {
  return defineTool({
    name: "agenda_marcar",
    available: deps.agenda !== undefined,
    description:
      "Marca um horário na agenda, depois que a pessoa confirmou o dia e a hora em voz alta. Chame só depois de ler o dia e a hora e ouvir o sim dela: sem `confirmed: true` nada é gravado. Use o horário exato que agenda_horarios_livres devolveu. NÃO use para trocar um horário já marcado (use agenda_remarcar), nem para marcar sem a confirmação da pessoa, nem para um horário que já passou. NÃO chame duas vezes para o mesmo pedido.",
    inputSchema: z.object({
      service_type: z.string().min(1).max(200).describe("O tipo de atendimento, como o operador cadastrou na agenda."),
      starts_at: z.iso
        .datetime({ offset: true })
        .describe("O horário escolhido, em ISO 8601 com fuso, exatamente como veio de agenda_horarios_livres."),
      confirmed: z
        .boolean()
        .describe("Só `true` depois de ler o dia e a hora em voz alta e a pessoa confirmar. Sem isso, nada é gravado."),
    }),
    async run(input, ctx) {
      if (input.confirmed !== true) {
        return {
          ok: false,
          noEffect: true,
          message:
            "Nada foi marcado: falta a confirmação da pessoa. Leia em voz alta o dia e a hora, pergunte se pode marcar e, " +
            "só depois do sim dela, chame de novo com confirmed=true.",
        };
      }

      const client = deps.agenda;
      if (!client) return { ok: false, noEffect: true, message: agendaNotWired("o horário não foi marcado") };

      if (new Date(input.starts_at).getTime() <= ctx.clock.now().getTime()) {
        return {
          ok: false,
          noEffect: true,
          message:
            "Esse horário já passou, e nada foi marcado. Confira o dia e a hora com a pessoa e consulte de novo os horários livres.",
        };
      }

      const callerE164 = await callerOf(ctx);
      if (callerE164 === null) return { ok: false, noEffect: true, message: agendaNoCallerNumber() };

      ctx.say(agendaWaitLine("booking", ctx.language));
      try {
        const appointment = await client.book({
          serviceType: input.service_type,
          startsAt: input.starts_at,
          callerE164,
          callId: ctx.callId,
        });
        return {
          ok: true,
          message: appointment.awaitingConfirmation
            ? "O horário ficou separado, mas a equipe ainda confirma. Diga à pessoa que separou o dia e a hora que ela escolheu " +
              "e que a equipe confirma. NÃO diga que está confirmado, reservado nem garantido. " +
              "Guarde o identificador do agendamento para uma remarcação."
            : "Horário marcado. Confirme com a pessoa o dia e a hora que ela confirmou e diga que o horário está reservado. " +
              "Guarde o identificador do agendamento para uma remarcação.",
          data: { appointmentId: appointment.id, startsAt: appointment.startsAt, awaitingConfirmation: appointment.awaitingConfirmation },
        };
      } catch (error) {
        return agendaFailure(error, "o horário não foi marcado", "o horário");
      }
    },
  });
}

export default createAgendaMarcar();
