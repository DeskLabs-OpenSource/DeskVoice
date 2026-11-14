import { MICROCENTS_PER_CENT } from "@deskvoice/voice-engine/pricing";
import { ApiError, handle } from "../../../../../server/context";
import { listEngines } from "../../../../../server/pieces";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 30;
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * O total em centavos, arredondado uma vez só: a soma é feita na unidade exata do extrato
 * (micro-centavos), porque a classificação de uma ligação custa menos de um centavo. Somar o
 * centavo de cada linha dava trinta vezes o valor de tabela por leitura.
 */
const centsOf = (microcents: string | number): number => Math.round(Number(microcents) / MICROCENTS_PER_CENT);

export const GET = handle({}, async ({ q, url, deps }) => {
  const now = deps.clock.now();
  const to = url.searchParams.get("to") ?? isoDay(now);
  const from = url.searchParams.get("from") ?? isoDay(new Date(now.getTime() - (DEFAULT_DAYS - 1) * 86_400_000));
  if (!DAY.test(from) || !DAY.test(to) || from > to) throw new ApiError(400, "validation_error", "from/to: use YYYY-MM-DD, with from before to");

  // O dia é o do fuso da organização (o mesmo da janela de ligações), não o do servidor.
  const scope = `from usage_ledger l
    cross join (select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone) z
    where (l.at at time zone z.zone)::date between $1::date and $2::date`;
  const range = [from, to];
  // Em série: as três consultas dividem a conexão da transação.
  const byDay = await q.many<{ day: string; microcents: string; seconds: number }>(
    `select to_char((l.at at time zone z.zone)::date, 'YYYY-MM-DD') as day, coalesce(sum(l.cost_microcents), 0)::text as microcents, sum(l.seconds)::int as seconds
       ${scope} group by 1 order by 1`,
    range,
  );
  const byAgent = await q.many<{ agentId: string | null; name: string | null; microcents: string; calls: number }>(
    `select c.agent_id as "agentId", a.name, coalesce(sum(l.cost_microcents), 0)::text as microcents, count(distinct l.call_id)::int as calls
       from usage_ledger l join calls c on c.id = l.call_id left join agents a on a.id = c.agent_id
       cross join (select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone) z
      where (l.at at time zone z.zone)::date between $1::date and $2::date group by 1, 2 order by 3 desc`,
    range,
  );
  const byEngine = await q.many<{ engine: string; microcents: string; seconds: number }>(
    `select l.engine, coalesce(sum(l.cost_microcents), 0)::text as microcents, sum(l.seconds)::int as seconds ${scope} group by 1 order by 2 desc`,
    range,
  );
  const engines = new Map((await listEngines()).map((engine) => [engine.id, engine]));
  return {
    from,
    to,
    // O total arredonda a soma inteira, não a soma dos totais de cada motor: um centavo a menos de
    // erro, e o mesmo número que o extrato do período diz.
    totalCents: centsOf(byDay.reduce((sum, row) => sum + Number(row.microcents), 0)),
    byDay: byDay.map((row) => ({ day: row.day, costCents: centsOf(row.microcents), seconds: row.seconds })),
    byAgent: byAgent.map((row) => ({ agentId: row.agentId, name: row.name, costCents: centsOf(row.microcents), calls: row.calls })),
    byEngine: byEngine.map((row) => ({
      engine: row.engine,
      costCents: centsOf(row.microcents),
      seconds: row.seconds,
      label: engines.get(row.engine)?.label ?? row.engine,
      priceCheckedOn: engines.get(row.engine)?.pricing.checkedOn ?? null,
      priceSource: engines.get(row.engine)?.pricing.source ?? null,
    })),
  };
});