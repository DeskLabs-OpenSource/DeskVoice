import { PURGED_SUMMARY_TEXT, storedCallAnalysisSchema } from "@deskvoice/core";
import { handle, notFound } from "../../../../../server/context";
import { CALL_COLUMNS } from "../../../../../server/shapes";

export const GET = handle({}, async ({ q, params }) => {
  const call = await q.one<Record<string, unknown> & { analysis: unknown; summary: string | null }>(
    `select ${CALL_COLUMNS}, a.max_call_seconds as "maxCallSeconds", a.cost_ceiling_cents as "costCeilingCents",
            c.analysis, c.erased_at is not null as "erased"
       from calls c left join agents a on a.id = c.agent_id where c.id = $1`,
    [params.id],
  );
  if (!call) throw notFound();
  // A análise é lida com o schema de `core`. Fora da forma, a tela diz que não pôde ler, e o
  // detalhe continua de pé: nada do `jsonb` cru chega à tela.
  const parsed = call.analysis === null ? null : storedCallAnalysisSchema.safeParse(call.analysis);
  // O resumo que saiu pelo prazo de guarda é um marcador no banco. A tela não mostra o marcador: ela
  // diz, no idioma de quem lê, que o resumo saiu com o prazo.
  const summaryPurged = call.summary === PURGED_SUMMARY_TEXT;
  return {
    ...call,
    summary: summaryPurged ? null : call.summary,
    summaryPurged,
    analysis: parsed?.success ? parsed.data : null,
    analysisUnreadable: parsed !== null && !parsed.success,
  };
});
