import { recordEvent } from "@deskvoice/core";
import { z } from "zod";
import { defineTool } from "../define-tool";
import { notifyHumans } from "../notify";

const URGENCY_LABEL = { low: "Aviso", normal: "Aviso", high: "URGENTE" } as const;

export default defineTool({
  name: "notify_human",
  description:
    "Deixa um aviso para a equipe humana (no painel e, se configurado, no WhatsApp) e segue a conversa sem esperar resposta. Use para registrar um recado, um pedido de retorno ou algo que a equipe precisa saber depois. NÃO use quando você precisa de uma resposta para continuar (use request_approval) nem quando a pessoa quer falar com alguém agora (use transfer_to_human).",
  inputSchema: z.object({
    message: z.string().min(1).describe("O aviso completo, entendível por quem não ouviu a ligação: quem ligou, o que quer e o que foi combinado."),
    urgency: z.enum(["low", "normal", "high"]).default("normal").describe("high só quando alguém precisa agir ainda hoje."),
  }),
  async run(input, ctx) {
    const channels = await notifyHumans(ctx, `${URGENCY_LABEL[input.urgency]}: ${input.message}`, { whatsapp: true });
    await recordEvent(ctx.q, ctx.callId, "human_notified", { message: input.message, urgency: input.urgency, channels }, ctx.clock.now());
    return {
      ok: true,
      message: "Aviso entregue à equipe. Ninguém vai responder durante a ligação: diga à pessoa que a equipe foi avisada e siga a conversa, sem prometer prazo que você não conhece.",
      data: { channels },
    };
  },
});
