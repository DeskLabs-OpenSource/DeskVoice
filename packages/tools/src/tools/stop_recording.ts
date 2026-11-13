import { z } from "zod";
import { defineTool } from "../define-tool";

export default defineTool({
  name: "stop_recording",
  description:
    "Para de gravar a ligação. Use SÓ quando a pessoa pedir para não ser gravada, ou disser que não quer que a conversa fique registrada. O trecho em que ela fez o pedido continua gravado, como prova de que pediu; do pedido em diante nada mais é gravado, e não há como voltar atrás na mesma ligação. NÃO use por conta própria, nem para 'proteger' a conversa sem pedido: gravar sem aviso já é o padrão, e parar sem pedido tira da empresa a prova do que foi combinado. Depois de chamar, confirme em voz alta que o pedido foi atendido.",
  inputSchema: z.object({
    reason: z
      .string()
      .min(1)
      .max(300)
      .describe("A frase em que a pessoa pediu para não ser gravada, nas palavras dela. Fica no histórico da chamada."),
  }),
  async run(input, ctx) {
    if (!ctx.telephony.pauseRecording) {
      return {
        ok: false,
        message:
          "Esta chamada não tem gravação que se possa parar. Se a pessoa pedir para não ser gravada, diga que a conversa não está sendo gravada.",
      };
    }
    await ctx.telephony.pauseRecording(input.reason);
    return {
      ok: true,
      message: "A gravação parou neste ponto, e o pedido ficou registrado. Confirme para a pessoa que, a partir de agora, a conversa não fica gravada.",
      data: { recording: "stopped" },
    };
  },
});
