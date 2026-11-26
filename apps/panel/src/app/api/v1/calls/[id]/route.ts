import { PURGED_SUMMARY_TEXT, storedCallAnalysisSchema } from "@deskvoice/core";
import { handle, notFound } from "../../../../../server/context";
import { centsOf, ESTIMATED_COUNT, LEDGER_AGENT, UNMEASURED_COUNT } from "../../../../../server/costs";
import { PIECE_KINDS, PIECE_LINE, pieceLabels, pieceOfLedger } from "../../../../../server/piece-costs";
import { CALL_COLUMNS } from "../../../../../server/shapes";

export const GET = handle({}, async ({ q, params }) => {
  const call = await q.one<Record<string, unknown> & { analysis: unknown; summary: string | null }>(
    `select ${CALL_COLUMNS}, a.max_call_seconds as "maxCallSeconds", a.cost_ceiling_cents as "costCeilingCents",
            c.analysis, c.erased_at is not null as "erased",
            -- A religação aponta para a ligação que caiu (desenho do follow-up, seção 3.6): o cabeçalho diz
            -- "Retorno da ligação de <hora>", com o link. Só o id e a hora; nada da original.
            c.call_back_of as "callBackOf", o.started_at as "callBackOfStartedAt"
       from calls c left join agents a on a.id = c.agent_id left join calls o on o.id = c.call_back_of where c.id = $1`,
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
  const byAgent = await q.many<{ agentId: string | null; name: string | null; microcents: string; unmeasured: number; estimated: number }>(
    `select ${LEDGER_AGENT} as "agentId", a.name, coalesce(sum(l.cost_microcents), 0)::text as microcents,
            ${UNMEASURED_COUNT} as unmeasured, ${ESTIMATED_COUNT} as estimated
       from usage_ledger l left join calls c on c.id = l.call_id left join agents a on a.id = ${LEDGER_AGENT}
      where l.call_id = $1 group by 1, 2 order by min(l.at), 1`,
    [params.id],
  );
  // Quantas linhas do extrato da ligação não têm custo medido (com alguma, o valor não é o gasto
  // inteiro) e quantas têm custo estimado (com alguma, o valor inclui uma estimativa).
  const ledger = await q.one<{ unmeasured: number; estimated: number }>(
    `select ${UNMEASURED_COUNT} as unmeasured, ${ESTIMATED_COUNT} as estimated from usage_ledger l where l.call_id = $1`,
    [params.id],
  );
  // O custo de cada peça do pipeline (fatia 5c): a transcrição, o cérebro e a voz, nessa ordem, com o
  // modelo quando a peça usou um só. Só na ligação que passou pelo pipeline (atendida por ele, ou passada
  // a um agente nele); na do motor direto a lista vem vazia, e o detalhe não muda. A peça sem nenhuma linha no extrato vem com `lines: 0`, e a tela a
  // mostra como não medida: sem linha, não se sabe o custo, e ele nunca aparece como zero.
  const pieceRows = await q.many<{ engine: string; model: string | null; microcents: string; lines: number; unmeasured: number; estimated: number }>(
    `select l.engine, case when count(distinct l.model) = 1 then min(l.model) end as model, coalesce(sum(l.cost_microcents), 0)::text as microcents,
            count(*)::int as lines, ${UNMEASURED_COUNT} as unmeasured, ${ESTIMATED_COUNT} as estimated
       from usage_ledger l where l.call_id = $1 and ${PIECE_LINE} group by l.engine order by min(l.at), l.engine`,
    [params.id],
  );
  const costByPiece: Array<{ piece: string; id: string | null; label: string | null; model: string | null; costCents: number; lines: number; unmeasuredCount: number; estimatedCount: number }> = [];
  const pipeline =
    call.engine === "pipeline" ||
    (await q.one<{ found: boolean }>("select exists (select 1 from call_events where call_id = $1 and kind = 'agent_handoff' and payload->>'engine' = 'pipeline') as found", [params.id]))?.found === true;
  if (pipeline) {
    const labelOf = await pieceLabels();
    for (const kind of PIECE_KINDS) {
      const rows = pieceRows.flatMap((row) => {
        const piece = pieceOfLedger(row.engine);
        return piece?.kind === kind ? [{ ...row, id: piece.id }] : [];
      });
      if (rows.length === 0) costByPiece.push({ piece: kind, id: null, label: null, model: null, costCents: 0, lines: 0, unmeasuredCount: 0, estimatedCount: 0 });
      for (const row of rows) {
        costByPiece.push({
          piece: kind,
          id: row.id,
          label: labelOf(kind, row.id) ?? null,
          model: row.model,
          costCents: centsOf(row.microcents),
          lines: row.lines,
          unmeasuredCount: row.unmeasured,
          estimatedCount: row.estimated,
        });
      }
    }
  }
  return {
    ...call,
    summary: summaryPurged ? null : call.summary,
    summaryPurged,
    analysis: parsed?.success ? parsed.data : null,
    analysisUnreadable: parsed !== null && !parsed.success,
    costByAgent: byAgent.map((row) => ({
      agentId: row.agentId,
      name: row.name,
      costCents: centsOf(row.microcents),
      unmeasuredCount: row.unmeasured,
      estimatedCount: row.estimated,
    })),
    costByPiece,
    unmeasuredCount: ledger?.unmeasured ?? 0,
    estimatedCount: ledger?.estimated ?? 0,
  };
});
