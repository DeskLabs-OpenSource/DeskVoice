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
 */
export async function costTotal(q: OrgQuery, range: DayRange): Promise<CostTotal> {
  const row = await q.one<{ microcents: string; unmeasured: number; estimated: number }>(
    `select coalesce(sum(l.cost_microcents), 0)::text as microcents,
            count(*) filter (where not l.cost_measured)::int as unmeasured,
            count(*) filter (where l.cost_estimated)::int as estimated
       from usage_ledger l cross join ${ORGANIZATION_ZONE} z
      where (l.at at time zone z.zone)::date between $1::date and $2::date`,
    [range.from, range.to],
  );
  return { microcents: Number(row?.microcents ?? 0), unmeasuredCount: row?.unmeasured ?? 0, estimatedCount: row?.estimated ?? 0 };
}
