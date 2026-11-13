import { FOLLOW_UP_TITLE_MAX, createFollowUp } from "@deskvoice/core";
import { z } from "zod";
import { defineTool } from "../define-tool";

export default defineTool({
  name: "create_task",
  description:
    "Abre uma pendência para a equipe cuidar depois da ligação (retornar, enviar um documento, conferir um cadastro). Ela vai para a lista de pendências do painel, com uma pessoa responsável, e o responsável é lembrado no momento marcado. Use quando algo combinado na conversa precisa de uma ação humana futura. NÃO use para algo que precisa de atenção agora (use notify_human) nem para o que você mesmo pode resolver na ligação.",
  inputSchema: z.object({
    title: z.string().trim().min(1).max(FOLLOW_UP_TITLE_MAX).describe("O que precisa ser feito, em uma linha. Ex.: 'Retornar para Maria sobre o orçamento'."),
    details: z.string().min(1).describe("Tudo o que quem for fazer precisa saber: quem é a pessoa, telefone, o que foi combinado."),
    due_in_minutes: z.number().int().min(0).max(43_200).optional().describe("Daqui a quantos minutos a pendência vence e o responsável é lembrado. Sem valor, vence logo."),
  }),
  // O título e os detalhes falam de quem ligou: ficam só na pendência, que o prazo de guarda e a
  // exportação alcançam, e não nos argumentos gravados na linha do tempo.
  personalTextArgs: true,
  async run(input, ctx) {
    const now = ctx.clock.now();
    const dueAt = new Date(now.getTime() + (input.due_in_minutes ?? 0) * 60_000);
    // `follow_up_created` entra na linha do tempo por aqui, com o id e sem o texto.
    const followUp = await createFollowUp(ctx.q, { callId: ctx.callId, agentId: ctx.agentId, title: input.title, details: input.details, dueAt }, now);
    return {
      ok: true,
      message: "Pendência registrada para a equipe. Diga à pessoa que ficou anotado, sem prometer horário que não foi combinado.",
      data: { followUpId: followUp.id, taskId: followUp.taskId },
    };
  },
});
