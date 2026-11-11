import { recordEvent, type ApprovalOutcome } from "@deskvoice/core";
import { notifyHumans } from "./notify";
import type { ToolContext } from "./types";

export interface ApprovalRequest {
  question: string;
  context: string;
  defaultOnTimeout: "approved" | "denied";
  timeoutSeconds: number;
  /** O que o agente diz a quem está na linha enquanto espera. */
  say: string;
}

export interface ApprovalAnswer {
  approvalId: string;
  outcome: ApprovalOutcome;
  /** O que vale na prática: a decisão humana ou, sem resposta, o padrão. */
  decision: "approved" | "denied";
}

/**
 * Pergunta a um humano e espera a resposta com a pessoa na linha: cria a aprovação, avisa a
 * equipe, registra `approval_requested` e `approval_decided`. É o mecanismo único de aprovação;
 * `request_approval` e qualquer ferramenta que precise de confirmação humana passam por aqui.
 */
export async function askApproval(ctx: ToolContext, request: ApprovalRequest): Promise<ApprovalAnswer> {
  const timeoutMs = request.timeoutSeconds * 1000;
  const expiresAt = new Date(ctx.clock.now().getTime() + timeoutMs);
  const approval = await ctx.q.one<{ id: string }>(
    "insert into approvals (organization_id, call_id, question, context, default_on_timeout, expires_at) values ($1, $2, $3, $4, $5, $6) returning id",
    [ctx.organizationId, ctx.callId, request.question, JSON.stringify({ text: request.context }), request.defaultOnTimeout, expiresAt],
  );
  if (!approval) throw new Error("Approval was not created");

  await notifyHumans(ctx, `Aprovação pedida durante uma ligação: ${request.question}\n\n${request.context}`, { whatsapp: true });
  await recordEvent(
    ctx.q,
    ctx.callId,
    "approval_requested",
    { approvalId: approval.id, question: request.question, context: request.context, defaultOnTimeout: request.defaultOnTimeout, expiresAt: expiresAt.toISOString() },
    ctx.clock.now(),
  );
  ctx.say(request.say);

  let outcome = await ctx.waitForApproval(approval.id, timeoutMs);
  if (outcome === "expired") {
    // Só vence o que ainda está pendente: a rotina `expire_approvals` pode ter chegado antes, e
    // um humano pode ter decidido no último instante. Nesse caso vale a decisão dele.
    await ctx.q.exec("update approvals set status = 'expired', decided_at = $2 where id = $1 and status = 'pending'", [approval.id, ctx.clock.now()]);
    const current = await ctx.q.one<{ status: ApprovalOutcome }>("select status from approvals where id = $1", [approval.id]);
    if (current) outcome = current.status;
  }

  const decision = outcome === "expired" ? request.defaultOnTimeout : outcome;
  await recordEvent(ctx.q, ctx.callId, "approval_decided", { approvalId: approval.id, outcome, decision }, ctx.clock.now());
  return { approvalId: approval.id, outcome, decision };
}
