import type { ApprovalOutcome } from "@deskvoice/core";
import { z } from "zod";
import { askApproval } from "../approval";
import { defineTool } from "../define-tool";

const MESSAGES: Record<ApprovalOutcome, Record<"approved" | "denied", string>> = {
  approved: {
    approved: "O responsável APROVOU. Diga isso à pessoa e prossiga com o que foi aprovado.",
    denied: "O responsável APROVOU. Diga isso à pessoa e prossiga com o que foi aprovado.",
  },
  denied: {
    approved: "O responsável NEGOU. NÃO prossiga com o que foi pedido. Diga isso à pessoa com gentileza e ofereça uma alternativa ou um retorno da equipe.",
    denied: "O responsável NEGOU. NÃO prossiga com o que foi pedido. Diga isso à pessoa com gentileza e ofereça uma alternativa ou um retorno da equipe.",
  },
  expired: {
    approved: "Ninguém respondeu no prazo, e a regra para esse caso é tratar como APROVADO. Prossiga com o que foi pedido e diga à pessoa que pode seguir.",
    denied:
      "Ninguém respondeu no prazo, e a regra para esse caso é tratar como NEGADO. NÃO prossiga com o que foi pedido. Diga à pessoa que não conseguiu a confirmação agora e que a equipe vai retornar.",
  },
};

export default defineTool({
  name: "request_approval",
  description:
    "Pergunta a um responsável humano se você pode fazer algo, e ESPERA a resposta com a pessoa na linha. Use antes de qualquer coisa que as suas instruções não autorizam você a decidir sozinho: desconto, exceção a uma regra, promessa de prazo, cancelamento. NÃO use para o que as suas instruções já permitem ou proíbem, nem para apenas avisar a equipe (use notify_human). A ferramenta já avisa a pessoa de que você vai conferir; não precisa avisar antes.",
  inputSchema: z.object({
    question: z.string().min(1).describe("A pergunta para o responsável, respondível com sim ou não. Ex.: 'Posso dar 10% de desconto no plano anual?'"),
    context: z.string().min(1).describe("O que o responsável precisa saber para decidir sem ter ouvido a ligação."),
    default_on_timeout: z
      .enum(["approved", "denied"])
      .describe("O que vale se ninguém responder no prazo. Use 'denied' sempre que seguir sem resposta puder custar dinheiro ou criar um compromisso."),
    timeout_seconds: z.number().int().min(15).max(300).default(60).describe("Quanto tempo esperar, de 15 a 300 segundos. A pessoa fica na linha esse tempo."),
  }),
  async run(input, ctx) {
    const answer = await askApproval(ctx, {
      question: input.question,
      context: input.context,
      defaultOnTimeout: input.default_on_timeout,
      timeoutSeconds: input.timeout_seconds,
      say: "Um instante, por favor. Vou conferir isso com um responsável.",
    });
    return { ok: true, message: MESSAGES[answer.outcome][input.default_on_timeout], data: answer };
  },
});
