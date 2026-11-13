import { z } from "zod";
import { defineTool } from "../define-tool";
import type { RecordingStop, ToolResult } from "../types";

const RESULTS: Record<RecordingStop, ToolResult> = {
  stopped: {
    ok: true,
    message: "A gravação parou neste ponto, e o pedido ficou registrado. Confirme para a pessoa que, a partir de agora, a conversa não fica gravada.",
    data: { recording: "stopped" },
  },
  already_stopped: {
    ok: true,
    message: "A gravação já tinha parado antes, nesta mesma ligação, e aquele pedido já está registrado. Confirme para a pessoa que a conversa não está sendo gravada.",
    data: { recording: "already_stopped" },
  },
  not_recording: {
    ok: true,
    message: "Esta ligação não está sendo gravada, então não havia gravação para parar e nada foi registrado. Diga à pessoa, com naturalidade, que a conversa não está sendo gravada.",
    data: { recording: "not_recording" },
  },
};

export default defineTool({
  name: "stop_recording",
  description:
    "Para de gravar a ligação. Use SÓ quando a pessoa pedir para não ser gravada, ou disser que não quer que a conversa fique registrada. O trecho em que ela fez o pedido continua gravado, como prova de que pediu; do pedido em diante nada mais é gravado, e não há como voltar atrás na mesma ligação. NÃO use por conta própria, nem para 'proteger' a conversa sem pedido: parar sem pedido tira da empresa a prova do que foi combinado. Depois de chamar, diga à pessoa o que o resultado informar: que a gravação parou, ou que a ligação não estava sendo gravada.",
  inputSchema: z.object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("A frase em que a pessoa pediu para não ser gravada, nas palavras dela. Fica no histórico da chamada até o prazo de guarda."),
  }),
  // O motivo é a fala de quem ligou: fica só em `calls` e no evento da parada, que o prazo de
  // guarda alcança, e não nos argumentos gravados na linha do tempo.
  personalTextArgs: true,
  async run(input, ctx) {
    return RESULTS[await ctx.telephony.pauseRecording(input.reason)];
  },
});
