import { z } from "zod";
import { ApiError, handle, notFound } from "../../../../../../server/context";

const body = z.object({ decision: z.enum(["approved", "denied"]) });

export const POST = handle({ body }, async ({ q, params, body, session, deps }) => {
  const now = deps.clock.now();
  // Atualização condicional: de dois cliques simultâneos, só um encontra o pedido pendente. A troca
  // de estado avisa o canal `approvals`, que é o que solta a ferramenta parada na ligação.
  const decided = await q.one(
    `update approvals set status = $2, decided_by = $3, decided_at = $4
      where id = $1 and status = 'pending' and expires_at > $4
      returning id, status, decided_at as "decidedAt"`,
    [params.id, body.decision, session.userId, now],
  );
  if (decided) return decided;
  const current = await q.one<{ status: string }>("select status from approvals where id = $1", [params.id]);
  if (!current) throw notFound();
  if (current.status === "pending") throw new ApiError(409, "approval_expired", "The time to answer this request has run out.");
  throw new ApiError(409, "already_decided", `This request was already ${current.status}.`);
});
