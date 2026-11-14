import { storedCallAnalysisSchema } from "@deskvoice/core";
import { handle, notFound } from "../../../../../server/context";
import { CALL_COLUMNS } from "../../../../../server/shapes";

export const GET = handle({}, async ({ q, params }) => {
  const call = await q.one<Record<string, unknown> & { analysis: unknown }>(
    `select ${CALL_COLUMNS}, a.max_call_seconds as "maxCallSeconds", a.cost_ceiling_cents as "costCeilingCents",
            c.analysis, c.erased_at is not null as "erased"
       from calls c left join agents a on a.id = c.agent_id where c.id = $1`,
    [params.id],
  );
  if (!call) throw notFound();
  // A análise é lida com o schema de `core`. Fora da forma, a tela diz que não pôde ler, e o
  // detalhe continua de pé: nada do `jsonb` cru chega à tela.
  const parsed = call.analysis === null ? null : storedCallAnalysisSchema.safeParse(call.analysis);
  return { ...call, analysis: parsed?.success ? parsed.data : null, analysisUnreadable: parsed !== null && !parsed.success };
});
