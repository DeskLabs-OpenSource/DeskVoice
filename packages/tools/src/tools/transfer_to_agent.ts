import { z } from "zod";
import { defineTool } from "../define-tool";
import { handoffTargetsOf, MAX_AGENT_HANDOFFS_PER_CALL } from "../handoff";

const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase("und") === b.trim().toLocaleLowerCase("und");

/**
 * Passa a ligação para outro agente da organização (fatia 4a do desenho de 13/11, seção 4.2). Quem
 * confere o destino é esta ferramenta, contra a lista lida do banco; quem troca a sessão, conta as
 * passagens e aplica os limites da ligação é o processo de voz (`ctx.handoff`).
 *
 * O operador não a marca: a sessão a oferece quando o agente tem ao menos um destino.
 * `personalTextArgs`: o motivo e o resumo são texto sobre quem ligou, e não vão para `tool_called`;
 * eles moram em `agent_handoff`, que o prazo de guarda e o apagamento a pedido alcançam.
 */
export default defineTool({
  name: "transfer_to_agent",
  description:
    "Passa a ligação para outro agente da equipe, que continua o atendimento com as instruções dele. Use quando o assunto for de um dos agentes listados nas suas instruções como destinos de passagem. NÃO use para falar com uma pessoa da equipe (para isso existe transfer_to_human), para tirar uma dúvida (request_approval), nem para um agente que não está na lista. Avise a pessoa de que vai passar a ligação ANTES de chamar. O próximo agente não ouviu a conversa: tudo o que ele precisa saber vai no resumo.",
  personalTextArgs: true,
  offeredBySession: true,
  inputSchema: z.object({
    agent: z.string().min(1).max(200).describe("O nome do agente que vai continuar, exatamente como aparece na lista das suas instruções."),
    reason: z.string().min(1).max(300).describe("Por que a ligação está sendo passada, em uma frase."),
    summary: z
      .string()
      .min(1)
      .max(1000)
      .describe("Resumo para o próximo agente: quem é a pessoa, o que ela quer e o que já foi feito ou combinado. Ele não ouviu a conversa."),
  }),
  async run(input, ctx) {
    if (!ctx.handoff) {
      return { ok: false, noEffect: true, message: "Esta ligação não pode ser passada para outro agente, então ela NÃO foi passada. Continue o atendimento você mesmo." };
    }
    const { self, targets } = await handoffTargetsOf(ctx.q, ctx.agentId);
    const matches = targets.filter((target) => sameName(target.name, input.agent));
    const names = targets.map((target) => target.name).join(", ");
    if (matches.length === 0) {
      if (self && sameName(self.name, input.agent)) {
        return { ok: false, noEffect: true, message: `Você já é ${self.name}: a ligação NÃO foi passada. Continue o atendimento você mesmo.` };
      }
      return {
        ok: false,
        noEffect: true,
        message:
          targets.length === 0
            ? "Você não tem para quem passar a ligação, então ela NÃO foi passada. Continue o atendimento você mesmo."
            : `"${input.agent}" não está entre os agentes para quem você pode passar a ligação, então ela NÃO foi passada. Os destinos são: ${names}.`,
      };
    }
    const [target] = matches;
    if (!target || matches.length > 1) {
      return { ok: false, noEffect: true, message: `Há mais de um agente chamado "${input.agent}" na sua lista, então a ligação NÃO foi passada. Continue o atendimento ou use transfer_to_human.` };
    }
    const outcome = await ctx.handoff(target, { reason: input.reason, summary: input.summary });
    if (outcome.ok) return { ok: true, message: `A ligação passou para ${target.name}, que já está com a pessoa. Não diga mais nada.` };
    switch (outcome.problem) {
      case "limit":
        return {
          ok: false,
          noEffect: true,
          message: `Esta ligação já passou ${MAX_AGENT_HANDOFFS_PER_CALL} vezes de um agente para outro, o máximo, então ela NÃO foi passada. Se você não consegue resolver, transfira para uma pessoa da equipe com transfer_to_human.`,
        };
      case "busy":
        return { ok: false, noEffect: true, message: "Outra passagem desta ligação está em curso, então esta NÃO foi feita. Espere e não chame de novo." };
      case "closing":
        return { ok: false, noEffect: true, message: "A ligação está sendo encerrada. Não chame mais ferramentas." };
      case "unavailable":
        return {
          ok: false,
          noEffect: true,
          message: `Não foi possível passar a ligação para ${target.name} agora, então você continua na linha. Diga à pessoa, com calma, que vai continuar o atendimento você mesmo, e siga. Se não conseguir resolver, use transfer_to_human.`,
        };
    }
  },
});
