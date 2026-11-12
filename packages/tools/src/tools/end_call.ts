import { z } from "zod";
import { defineTool } from "../define-tool";

export default defineTool({
  name: "end_call",
  description:
    "Encerra a ligação. Use quando a pessoa disser que não precisa de mais nada, pedir para desligar, ou quando ficar claro que a ligação foi engano. NÃO use enquanto houver pergunta sem resposta, pedido em andamento ou aprovação pendente, nem para se livrar de uma conversa difícil: nesse caso, transfira para um humano. A despedida vai em `farewell`: você a fala uma vez ao receber o resultado, e a ligação cai em seguida. Não fale outra despedida antes de chamar.",
  inputSchema: z.object({
    reason: z.string().min(1).describe("Por que a ligação está sendo encerrada, em uma frase. Fica no histórico da chamada."),
    farewell: z.string().min(1).max(300).optional().describe("A despedida, curta e calorosa, que a pessoa ouve antes de a ligação cair. Ex.: 'Foi um prazer, Jéssica! Tenha um ótimo dia.'"),
  }),
  async run(input, ctx) {
    await ctx.telephony.hangup(input.farewell);
    // Com despedida, o modelo a fala ao receber este resultado, e a ligação cai em seguida.
    if (input.farewell) return { ok: true, message: `A ligação vai encerrar. Diga agora, uma vez só, exatamente esta despedida e nada mais: "${input.farewell}"` };
    return { ok: true, message: "Ligação encerrada. Não diga mais nada." };
  },
});
