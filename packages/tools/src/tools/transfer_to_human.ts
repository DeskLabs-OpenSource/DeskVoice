import { recordEvent } from "@deskvoice/core";
import { z } from "zod";
import { defineTool } from "../define-tool";
import { notifyHumans } from "../notify";

export default defineTool({
  name: "transfer_to_human",
  description:
    "Transfere a ligação para um atendente humano, que recebe o seu resumo e continua de onde você parou. Use quando a pessoa pedir para falar com alguém, quando o assunto fugir do que você pode resolver, ou quando ela estiver irritada ou em situação delicada. NÃO use para tirar uma dúvida sua com a equipe (para isso existe request_approval) nem para deixar um recado (notify_human). Avise a pessoa de que vai transferir ANTES de chamar.",
  inputSchema: z.object({
    reason: z.string().min(1).describe("Por que a transferência é necessária, em uma frase."),
    summary: z
      .string()
      .min(1)
      .describe("Resumo para o humano que vai atender: quem é a pessoa, o que ela quer e o que já foi feito ou combinado. Ele não ouviu a conversa."),
  }),
  async run(input, ctx) {
    // Sem `transfer_started`: registrar uma transferência que não aconteceu seria falso.
    if (!ctx.telephony.canTransfer) {
      return {
        ok: false,
        message:
          "Nesta ligação não há como transferir para uma pessoa, então a ligação NÃO foi transferida. Diga isso à pessoa com calma e ofereça deixar um recado para a equipe retornar (use notify_human).",
      };
    }
    const agent = await ctx.q.one<{ transfer_to_e164: string | null }>("select transfer_to_e164 from agents where id = $1", [ctx.agentId]);
    const to = agent?.transfer_to_e164;
    if (!to) {
      return {
        ok: false,
        message:
          "Não há número de transferência configurado para este agente, então a ligação NÃO foi transferida. Diga à pessoa que não consegue transferir agora e ofereça deixar um recado para a equipe retornar (use notify_human).",
      };
    }
    await recordEvent(ctx.q, ctx.callId, "transfer_started", { to, reason: input.reason, summary: input.summary }, ctx.clock.now());
    await notifyHumans(ctx, `Ligação transferida para ${to}. Motivo: ${input.reason}\n\n${input.summary}`, { whatsapp: false });
    await ctx.telephony.transfer(to);
    return { ok: true, message: "Transferência iniciada; o atendente recebeu o seu resumo. Não diga mais nada: a pessoa já está sendo conectada." };
  },
});
