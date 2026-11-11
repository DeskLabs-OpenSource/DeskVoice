import { recordEvent, type ApprovalOutcome } from "@deskvoice/core";
import { z } from "zod";
import { defineTool } from "../define-tool";
import { notifyHumans } from "../notify";

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
    const timeoutMs = input.timeout_seconds * 1000;
    const expiresAt = new Date(ctx.clock.now().getTime() + timeoutMs);
    const approval = await ctx.q.one<{ id: string }>(
      "insert into approvals (organization_id, call_id, question, context, default_on_timeout, expires_at) values ($1, $2, $3, $4, $5, $6) returning id",
      [ctx.organizationId, ctx.callId, input.question, JSON.stringify({ text: input.context }), input.default_on_timeout, expiresAt],
    );
    if (!approval) throw new Error("Approval was not created");

    await notifyHumans(ctx, `Aprovação pedida durante uma ligação: ${input.question}\n\n${input.context}`, { whatsapp: true });
    await recordEvent(
      ctx.q,
      ctx.callId,
      "approval_requested",
      { approvalId: approval.id, question: input.question, context: input.context, defaultOnTimeout: input.default_on_timeout, expiresAt: expiresAt.toISOString() },
      ctx.clock.now(),
    );
    ctx.say("Um instante, por favor. Vou conferir isso com um responsável.");

    let outcome = await ctx.waitForApproval(approval.id, timeoutMs);
    if (outcome === "expired") {
      // Só vence o que ainda está pendente: a rotina `expire_approvals` pode ter chegado antes, e
      // um humano pode ter decidido no último instante. Nesse caso vale a decisão dele.
      await ctx.q.exec("update approvals set status = 'expired', decided_at = $2 where id = $1 and status = 'pending'", [approval.id, ctx.clock.now()]);
      const current = await ctx.q.one<{ status: ApprovalOutcome }>("select status from approvals where id = $1", [approval.id]);
      if (current) outcome = current.status;
    }

    const decision = outcome === "expired" ? input.default_on_timeout : outcome;
    await recordEvent(ctx.q, ctx.callId, "approval_decided", { approvalId: approval.id, outcome, decision }, ctx.clock.now());
    return { ok: true, message: MESSAGES[outcome][input.default_on_timeout], data: { approvalId: approval.id, outcome, decision } };
  },
});
