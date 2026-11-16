import { PURGED_SUMMARY_TEXT, storedCallAnalysisSchema } from "@deskvoice/core";
import { handle, notFound } from "../../../../../server/context";
import { centsOf, LEDGER_AGENT, UNMEASURED_COUNT } from "../../../../../server/costs";
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
  // O custo de cada agente da ligação, na ordem em que ele gastou, com o mesmo agente por linha da
  // tela de Custos. Arredondado uma vez por agente, a partir dos micro-centavos do extrato. A tela só
  // mostra a lista quando há mais de um agente.
  const byAgent = await q.many<{ agentId: string | null; name: string | null; microcents: string }>(
    `select ${LEDGER_AGENT} as "agentId", a.name, coalesce(sum(l.cost_microcents), 0)::text as microcents
       from usage_ledger l join calls c on c.id = l.call_id left join agents a on a.id = ${LEDGER_AGENT}
      where l.call_id = $1 group by 1, 2 order by min(l.at), 1`,
    [params.id],
  );
  return {
    ...call,
    summary: summaryPurged ? null : call.summary,
    summaryPurged,
    analysis: parsed?.success ? parsed.data : null,
    analysisUnreadable: parsed !== null && !parsed.success,
    costByAgent: byAgent.map((row) => ({ agentId: row.agentId, name: row.name, costCents: centsOf(row.microcents) })),
    // Quantas linhas do extrato da ligação não têm custo medido: com alguma, o valor não é o gasto inteiro.
    unmeasuredCount: (await q.one<{ n: number }>(`select ${UNMEASURED_COUNT} as n from usage_ledger l where l.call_id = $1`, [params.id]))?.n ?? 0,
  };
});
