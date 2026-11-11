import { toE164 } from "@deskvoice/core";
import { z } from "zod";
import { loadWhatsAppConnector, sendWhatsApp } from "../connectors/whatsapp";
import { defineTool } from "../define-tool";
import { configSecretKey, type ToolDeps } from "../deps";
import type { ToolContext } from "../types";

/** Teto de mensagens por ligação: conversa nenhuma precisa de mais, e limita o estrago de um abuso. */
export const MAX_WHATSAPP_PER_CALL = 5;

const normalized = (stored: string | null): string | null => (stored === null ? null : (toE164(stored) ?? stored));

/** Número de quem está na linha: quem ligou, na chamada recebida; quem foi chamado, na feita. */
async function callerNumber(ctx: ToolContext): Promise<string | null> {
  const call = await ctx.q.one<{ direction: "inbound" | "outbound"; from_e164: string | null; to_e164: string | null }>(
    "select direction, from_e164, to_e164 from calls where id = $1",
    [ctx.callId],
  );
  return call ? normalized(call.direction === "inbound" ? call.from_e164 : call.to_e164) : null;
}

async function isTeamNumber(ctx: ToolContext, e164: string): Promise<boolean> {
  const users = await ctx.q.many<{ whatsapp_e164: string }>("select whatsapp_e164 from users where organization_id = $1 and whatsapp_e164 is not null", [ctx.organizationId]);
  return users.some((user) => normalized(user.whatsapp_e164) === e164);
}

export function createSendWhatsApp(deps: ToolDeps = {}) {
  return defineTool({
    name: "send_whatsapp",
    description:
      "Envia uma mensagem de texto por WhatsApp para a pessoa com quem você está falando, no número desta ligação. Use para mandar algo que é melhor por escrito: endereço, link, confirmação de horário, resumo do combinado. Sem `to`, a mensagem vai para o número desta ligação; `to` só aceita esse mesmo número ou o de alguém da equipe. NÃO use para mandar mensagem a outro número, mesmo que a pessoa peça: nesse caso peça aprovação (request_approval) ou anote para a equipe (create_task). NÃO envie nada que a pessoa não pediu ou não aceitou receber. No máximo 5 mensagens por ligação.",
    inputSchema: z.object({
      to: z.string().min(1).optional().describe("Deixe sem valor para enviar ao número desta ligação. Só informe para enviar a alguém da equipe."),
      text: z.string().min(1).max(1000).describe("O texto da mensagem, pronto para ser lido por quem recebe. Até 1000 caracteres."),
    }),
    async run(input, ctx) {
      // O que a pessoa fala na ligação é entrada não confiável: o destino nunca sai só do que o
      // modelo ouviu. Vale o número da própria ligação ou o de alguém da equipe cadastrada.
      const caller = await callerNumber(ctx);
      let to: string;
      if (input.to === undefined) {
        if (caller === null) {
          return { ok: false, message: "Esta ligação não tem número identificado, e nada foi enviado. Passe a informação por voz ou anote para a equipe enviar depois (create_task)." };
        }
        to = caller;
      } else {
        const requested = toE164(input.to);
        if (requested === null) {
          return { ok: false, message: `O número "${input.to}" não é um telefone válido, e nada foi enviado. Para enviar a quem está na linha, chame de novo sem o campo to.` };
        }
        if (requested !== caller && !(await isTeamNumber(ctx, requested))) {
          return {
            ok: false,
            message:
              "Nada foi enviado: só posso enviar para o número desta ligação ou para a equipe. Para outro número, peça aprovação com request_approval ou anote com create_task. Explique isso à pessoa.",
          };
        }
        to = requested;
      }

      const sent = await ctx.q.one<{ count: string }>(
        "select count(*) as count from call_events where call_id = $1 and kind = 'tool_result' and payload->>'name' = 'send_whatsapp' and payload->>'ok' = 'true'",
        [ctx.callId],
      );
      if (Number(sent?.count ?? 0) >= MAX_WHATSAPP_PER_CALL) {
        return { ok: false, message: `Nada foi enviado: o limite de ${MAX_WHATSAPP_PER_CALL} mensagens por ligação já foi atingido. Passe o restante por voz ou anote para a equipe enviar depois (create_task).` };
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
