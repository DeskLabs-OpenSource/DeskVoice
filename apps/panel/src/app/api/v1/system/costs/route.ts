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
  // Os minutos de cada motor são a duração das ligações que ele atendeu (do atendimento ao fim),
  // e não o `seconds` do extrato: esse é o uso que o motor declara para cobrar, e o OpenAI Realtime
  // cobra por token e declara zero segundo (issue #244). A ligação conta no dia em que terminou, no
  // fuso da organização, como o resto do quadro: uma ligação com linhas do extrato em dois dias (o
  // desfecho classificado depois da meia-noite) não aparece inteira nos dois períodos.
  const byEngine = await q.many<{ engine: string; microcents: string; seconds: number }>(
    `with scoped as (select l.engine, l.call_id, l.cost_microcents ${scope}),
          answered as (
            select c.engine, coalesce(sum(extract(epoch from (c.ended_at - c.answered_at))), 0)::int as seconds
              from calls c
             cross join (select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone) z
             where c.answered_at is not null and c.ended_at is not null
               and (c.ended_at at time zone z.zone)::date between $1::date and $2::date
             group by 1)
     select s.engine, coalesce(sum(s.cost_microcents), 0)::text as microcents, coalesce(a.seconds, 0)::int as seconds
       from scoped s left join answered a on a.engine = s.engine
      group by s.engine, a.seconds order by coalesce(sum(s.cost_microcents), 0) desc`,
    range,
  );
  const engines = new Map((await listEngines()).map((engine) => [engine.id, engine]));
  return {
    from,
    to,
    // O total arredonda a soma inteira, não a soma dos totais de cada motor: um centavo a menos de
    // erro, e o mesmo número que o extrato do período diz.
    totalCents: centsOf(byDay.reduce((sum, row) => sum + Number(row.microcents), 0)),
    // Dois nomes, porque são duas medidas: `billedSeconds` é o uso que os motores declararam para
    // cobrar (o OpenAI Realtime declara token, não segundo), e `callSeconds` é a duração das ligações.
    byDay: byDay.map((row) => ({ day: row.day, costCents: centsOf(row.microcents), billedSeconds: row.seconds })),
    byAgent: byAgent.map((row) => ({ agentId: row.agentId, name: row.name, costCents: centsOf(row.microcents), calls: row.calls })),
    byEngine: byEngine.map((row) => ({
      engine: row.engine,
      costCents: centsOf(row.microcents),
      callSeconds: row.seconds,
      label: engines.get(row.engine)?.label ?? row.engine,
      priceCheckedOn: engines.get(row.engine)?.pricing.checkedOn ?? null,
      priceSource: engines.get(row.engine)?.pricing.source ?? null,
    })),
  };
});