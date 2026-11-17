import { ApiError, handle } from "../../../../server/context";
import { ESTIMATED_COUNT, UNMEASURED_COUNT } from "../../../../server/costs";
import { CALL_COLUMNS, CALL_STATUSES } from "../../../../server/shapes";

export const GET = handle({}, ({ q, url }) => {
  const statuses = url.searchParams.get("status")?.split(",").filter(Boolean) ?? [];
  const unknown = statuses.find((status) => !(CALL_STATUSES as readonly string[]).includes(status));
  if (unknown) throw new ApiError(400, "validation_error", `status: unknown call status "${unknown}"`);
  // Cada linha diz quantas linhas do extrato dela não têm custo medido e quantas têm custo estimado,
  // como o detalhe: sem isso, a ligação lida só por um modelo sem preço aparece como R$ 0,00. Uma
  // subconsulta por ligação, pelo índice `usage_ledger_call_idx`, e só nas 200 da página: o limite
  // vem antes da junção, para a contagem não rodar em toda ligação da organização antes da ordem.
  return q.many(
    `select ${CALL_COLUMNS}, u.unmeasured as "unmeasuredCount", u.estimated as "estimatedCount"
       from (select * from calls c where ($1::text[] is null or c.status = any($1)) order by c.started_at desc limit 200) c
       left join agents a on a.id = c.agent_id
       left join lateral (
         select ${UNMEASURED_COUNT} as unmeasured, ${ESTIMATED_COUNT} as estimated
           from usage_ledger l where l.organization_id = c.organization_id and l.call_id = c.id
       ) u on true
      order by c.started_at desc`,
    [statuses.length > 0 ? statuses : null],
  );
});
