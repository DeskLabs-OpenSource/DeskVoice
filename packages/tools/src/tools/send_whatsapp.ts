import { toE164 } from "@deskvoice/core";
import { z } from "zod";
import { loadWhatsAppConnector, sendWhatsApp } from "../connectors/whatsapp";
import { defineTool } from "../define-tool";
import { configSecretKey, type ToolDeps } from "../deps";

export function createSendWhatsApp(deps: ToolDeps = {}) {
  return defineTool({
    name: "send_whatsapp",
    description:
      "Envia uma mensagem de texto por WhatsApp para a pessoa da ligação ou para um número que ela informar. Use para mandar algo que é melhor por escrito: endereço, link, confirmação de horário, resumo do combinado. NÃO use para avisar a equipe interna (use notify_human), nem envie nada que a pessoa não pediu ou não aceitou receber. Confirme o número com a pessoa antes de enviar.",
    inputSchema: z.object({
      to: z.string().min(1).describe("Número de destino com DDD, como a pessoa falou. Ex.: '31 99999-8888'."),
      text: z.string().min(1).max(4000).describe("O texto da mensagem, pronto para ser lido por quem recebe."),
    }),
    async run(input, ctx) {
      const to = toE164(input.to);
      if (to === null) {
        return { ok: false, message: `O número "${input.to}" não é um telefone válido, e nada foi enviado. Peça o número de novo, com DDD, e tente outra vez.` };
      }
      const connector = await loadWhatsAppConnector(ctx.q, (deps.secretKey ?? configSecretKey)());
      if (connector === null) {
        return {
          ok: false,
          message:
            "O envio por WhatsApp não está configurado nesta central, e nada foi enviado. Diga à pessoa que não consegue mandar mensagem agora e passe a informação por voz; se for importante, deixe um aviso para a equipe (notify_human).",
        };
      }
      await sendWhatsApp(connector, { to, text: input.text, callId: ctx.callId }, deps);
      return { ok: true, message: "Mensagem enviada por WhatsApp. Diga à pessoa que a mensagem foi enviada e peça que confira.", data: { to } };
    },
  });
}

export default createSendWhatsApp();
