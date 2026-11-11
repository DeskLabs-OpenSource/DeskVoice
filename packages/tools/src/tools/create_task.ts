import { enqueueTask, recordEvent } from "@deskvoice/core";
import { z } from "zod";
import { defineTool } from "../define-tool";

export default defineTool({
  name: "create_task",
  description:
    "Agenda uma pendência para a equipe cuidar depois da ligação (retornar, enviar um documento, conferir um cadastro). Ela aparece no painel no momento marcado. Use quando algo combinado na conversa precisa de uma ação humana futura. NÃO use para algo que precisa de atenção agora (use notify_human) nem para o que você mesmo pode resolver na ligação.",
  inputSchema: z.object({
    title: z.string().min(1).max(200).describe("O que precisa ser feito, em uma linha. Ex.: 'Retornar para Maria sobre o orçamento'."),
    details: z.string().min(1).describe("Tudo o que quem for fazer precisa saber: quem é a pessoa, telefone, o que foi combinado."),
    due_in_minutes: z.number().int().min(0).max(43_200).optional().describe("Daqui a quantos minutos a pendência deve aparecer. Sem valor, aparece logo."),
  }),
  async run(input, ctx) {
    const runAt = new Date(ctx.clock.now().getTime() + (input.due_in_minutes ?? 0) * 60_000);
    const taskId = await enqueueTask(ctx.q, { kind: "follow_up", payload: { title: input.title, details: input.details }, callId: ctx.callId, runAt });
    await recordEvent(ctx.q, ctx.callId, "task_queued", { taskId, kind: "follow_up", title: input.title, runAt: runAt.toISOString() }, ctx.clock.now());
    return { ok: true, message: "Pendência registrada para a equipe. Diga à pessoa que ficou anotado, sem prometer horário que não foi combinado.", data: { taskId } };
  },
});
