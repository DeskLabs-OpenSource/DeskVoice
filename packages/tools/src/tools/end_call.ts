import { z } from "zod";
import { defineTool } from "../define-tool";

export default defineTool({
  name: "end_call",
  description:
    "Encerra a ligação. Use depois de se despedir, quando a pessoa disser que não precisa de mais nada, pedir para desligar, ou quando ficar claro que a ligação foi engano. NÃO use enquanto houver pergunta sem resposta, pedido em andamento ou aprovação pendente, nem para se livrar de uma conversa difícil: nesse caso, transfira para um humano. Despeça-se ANTES de chamar; depois dela ninguém ouve mais nada.",
  inputSchema: z.object({
    reason: z.string().min(1).describe("Por que a ligação está sendo encerrada, em uma frase. Fica no histórico da chamada."),
  }),
  async run(_input, ctx) {
    await ctx.telephony.hangup();
    return { ok: true, message: "Ligação encerrada. Não diga mais nada." };
  },
});
