import type { OrgQuery } from "./types";

/**
 * O fuso da organização, o mesmo da janela de ligações (`outbound_policy.timezone`), como uma
 * tabela de uma linha (`z.zone`) para juntar à consulta. É por ele que se conta o dia do custo.
 */
const ORGANIZATION_ZONE = "(select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone)";

export interface DayRange {
  /** `YYYY-MM-DD`, no fuso da organização. */
  from: string;
  /** `YYYY-MM-DD`, no fuso da organização, incluído. */
  to: string;
}

export interface CostTotal {
  /** A soma de `usage_ledger.cost_microcents`. Nunca a de `cost_cents`, que é a vista arredondada por linha. */
  microcents: number;
  /** Linhas do extrato sem custo medido: o zero delas não é grátis, e a tela diz "não medido". */
  unmeasuredCount: number;
  /** Linhas com custo estimado: entram na soma, acima do real, e a tela diz "inclui estimativa". */
  estimatedCount: number;
}

/**
 * O custo de um período da organização da transação (seção 3.4 do desenho do R8). Uma soma só, para
 * a tela de Custos (`system/costs`), a visão geral da instalação e o teto do mês: o mesmo número em
 * todo lugar. O dia de cada linha do extrato é o do fuso da organização, não o do servidor.
 *
 * O filtro pela data local decide o dia. O intervalo sobre `l.at`, com um dia de folga de cada lado
 * e fixado em UTC por escrito (nunca o fuso da sessão do Postgres), só corta o que nunca entraria:
 * qualquer fuso real fica entre −12 h e +14 h. É ele que deixa a soma ler pelo índice
 * `usage_ledger_org_at_idx` só a fatia do período, e não o extrato inteiro da organização.
 */
export async function costTotal(q: OrgQuery, range: DayRange): Promise<CostTotal> {
  const row = await q.one<{ microcents: string; unmeasured: number; estimated: number }>(
    `select coalesce(sum(l.cost_microcents), 0)::text as microcents,
            count(*) filter (where not l.cost_measured)::int as unmeasured,
            count(*) filter (where l.cost_estimated)::int as estimated
       from usage_ledger l cross join ${ORGANIZATION_ZONE} z
      where (l.at at time zone z.zone)::date between $1::date and $2::date
        and l.at >= ($1::date - 1)::timestamp at time zone 'UTC'
        and l.at < ($2::date + 2)::timestamp at time zone 'UTC'`,
    [range.from, range.to],
  );
  return { microcents: Number(row?.microcents ?? 0), unmeasuredCount: row?.unmeasured ?? 0, estimatedCount: row?.estimated ?? 0 };
}

/**
 * Os dias da organização da transação em `now`, no fuso dela: hoje, o dia 1 do mês corrente e o
 * começo da janela de 30 dias contando hoje (a mesma largura da janela padrão da tela de Custos).
 */
export async function organizationDays(q: OrgQuery, now: Date): Promise<{ today: string; monthStart: string; last30From: string }> {
  const row = await q.one<{ today: string; month: string; since: string }>(
    `select to_char(d, 'YYYY-MM-DD') as today, to_char(d - (extract(day from d)::int - 1), 'YYYY-MM-DD') as month, to_char(d - 29, 'YYYY-MM-DD') as since
       from (select ($1::timestamptz at time zone z.zone)::date as d from ${ORGANIZATION_ZONE} z) t`,
    [now],
  );
  if (!row) throw new Error("organizationDays: no row");
  return { today: row.today, monthStart: row.month, last30From: row.since };
}

/** Quantas ligações da organização da transação começaram no período, pelo dia no fuso dela. */
export async function callCount(q: OrgQuery, range: DayRange): Promise<number> {
  const row = await q.one<{ count: number }>(
    `select count(*)::int as count from calls c cross join ${ORGANIZATION_ZONE} z
      where (c.started_at at time zone z.zone)::date between $1::date and $2::date`,
    [range.from, range.to],
  );
  return row?.count ?? 0;
}
