import { ApiError, handle } from "../../../../../server/context";
import { centsOf, LEDGER_AGENT, unmeasuredIn } from "../../../../../server/costs";
import { listEngines } from "../../../../../server/pieces";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 30;
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

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
  // Cada linha do extrato fica com o agente do trecho dela (`LEDGER_AGENT`): numa ligação passada
  // de A para B, o trecho de B não entra na conta de A. `calls` conta as ligações em que o agente teve
  // linha no extrato, e uma ligação com passagem conta para cada agente: a soma das chamadas da lista
  // pode passar do número de ligações. O total não muda, porque cada linha entra num agente só.
  const byAgent = await q.many<{ agentId: string | null; name: string | null; microcents: string; calls: number }>(
    `select ${LEDGER_AGENT} as "agentId", a.name, coalesce(sum(l.cost_microcents), 0)::text as microcents, count(distinct l.call_id)::int as calls
       from usage_ledger l join calls c on c.id = l.call_id left join agents a on a.id = ${LEDGER_AGENT}
       cross join (select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone) z
      where (l.at at time zone z.zone)::date between $1::date and $2::date group by 1, 2 order by 3 desc`,
    range,
  );
  // Os minutos de cada motor são a duração dos trechos que ele atendeu, e não o `seconds` do
  // extrato: esse é o uso que o motor declara para cobrar, e o OpenAI Realtime cobra por token e
  // declara zero segundo (issue #244). O primeiro trecho vai do atendimento à primeira passagem, com
  // o motor da ligação (`calls.engine`); cada passagem abre um trecho com o motor gravado no evento
  // `agent_handoff`, que acaba na passagem seguinte ou no fim da ligação. Sem passagem, é a ligação
  // inteira, como antes. A passagem gravada antes da fatia 4c não guarda o motor, e o motor atual do
  // agente não serve (ele pode ter sido editado depois): essa ligação fica inteira no motor que
  // atendeu, como antes. A ligação conta no dia em que terminou, no fuso da organização, como o resto
  // do quadro: uma ligação com linhas do extrato em dois dias (o desfecho classificado depois da
  // meia-noite) não aparece inteira nos dois períodos.
  const byEngine = await q.many<{ engine: string; microcents: string; seconds: number }>(
    `with scoped as (select l.engine, l.call_id, l.cost_microcents ${scope}),
          ended as (
            select c.id, c.engine, c.answered_at, c.ended_at,
                   exists (select 1 from call_events h where h.call_id = c.id and h.kind = 'agent_handoff' and not (h.payload ? 'engine')) as untold
              from calls c
             cross join (select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone) z
             where c.answered_at is not null and c.ended_at is not null
               and (c.ended_at at time zone z.zone)::date between $1::date and $2::date),
          legs as (
            select e.id as call_id, e.engine, e.answered_at as starts_at, 0::bigint as seq, e.ended_at from ended e
            union all
            select h.call_id, h.payload->>'engine', h.at, h.id, e.ended_at
              from call_events h join ended e on e.id = h.call_id
             where h.kind = 'agent_handoff' and not e.untold),
          timed as (
            select engine, starts_at, coalesce(lead(starts_at) over (partition by call_id order by seq), ended_at) as ends_at from legs),
          answered as (
            select engine, coalesce(sum(extract(epoch from (ends_at - starts_at))), 0)::int as seconds from timed group by 1)
     select s.engine, coalesce(sum(s.cost_microcents), 0)::text as microcents, coalesce(a.seconds, 0)::int as seconds
       from scoped s left join answered a on a.engine = s.engine
      group by s.engine, a.seconds order by coalesce(sum(s.cost_microcents), 0) desc`,
    range,
  );
  // As linhas sem custo medido: o zero delas não é grátis, e a tela diz "não medido" onde houver.
  const unmeasured = await unmeasuredIn(q, from, to);
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
    unmeasured,
  };
});