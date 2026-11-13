import { recordEvent } from "@deskvoice/core";
import { z } from "zod";
import { defineTool } from "../define-tool";

/** Só o teclado de um telefone, e pouco: menu de URA é uma ou duas teclas, não uma sequência longa. */
const DIGITS = /^[0-9*#A-D]{1,8}$/;

export default defineTool({
  name: "send_dtmf",
  description:
    "Aperta teclas no menu automático do outro lado (URA de operadora, convênio, banco, secretária eletrônica) — o mesmo que a pessoa faria digitando. Use apenas depois de ouvir as opções e saber qual delas serve, e escute a resposta antes de dizer qualquer coisa. NÃO use para encerrar (end_call) nem para adivinhar menu no escuro: tecla errada pode levar a um caminho sem volta.",
  inputSchema: z.object({
    digits: z
      .string()
      .regex(DIGITS, "Use de 1 a 8 caracteres entre 0-9, *, # e A-D.")
      .describe("As teclas, na ordem. Ex.: \"1\" para a primeira opção, \"0123\" para um código."),
  }),
  async run(input, ctx) {
    if (!ctx.telephony.sendDtmf) {
      return {
        ok: false,
        message:
          "Esta chamada não tem como apertar teclas (não há telefonia por trás dela). Diga à pessoa que ela mesma precisa escolher a opção no menu.",
      };
    }
    await ctx.telephony.sendDtmf(input.digits);
    await recordEvent(ctx.q, ctx.callId, "dtmf_sent", { digits: input.digits }, ctx.clock.now());
    return {
      ok: true,
      message: `Teclas ${input.digits} enviadas. Escute o que o menu responder antes de falar.`,
      data: { digits: input.digits },
    };
  },
});
