import { MICROCENTS_PER_CENT } from "@deskvoice/voice-engine/pricing";
import type { OrgQuery } from "@deskvoice/core";

/**
 * O valor em centavos, arredondado uma vez só: a soma é feita na unidade exata do extrato
 * (micro-centavos), porque a classificação de uma ligação custa menos de um centavo. Somar o
 * centavo de cada linha dava trinta vezes o valor de tabela por leitura.
 */
export const centsOf = (microcents: string | number): number => Math.round(Number(microcents) / MICROCENTS_PER_CENT);

/**
 * O agente de uma linha do extrato (`usage_ledger l`, com `calls c` da ligação dela). Desde a
 * passagem entre agentes (fatia 4a), cada medição leva o agente do trecho em que a ligação estava.
 * Ficam com o agente que atendeu as linhas sem trecho: as de antes da 4a (`agent_id` nulo) e as de
 * depois da ligação (transcrição da gravação, classificação), que não pertencem a trecho nenhum.
 * O agente apagado deixa o `agent_id` nulo (`on delete set null`): a linha volta ao que atendeu e,
 * se ele também foi apagado, fica em "Agente apagado". Isso vale também para o trecho de um agente
 * de destino apagado: o custo dele aparece no agente que atendeu, e não em "Agente apagado". Depois
 * do apagamento, a linha desse trecho não se distingue das linhas sem trecho, porque todas têm o
 * `agent_id` nulo, e separar pelo horário seria adivinhar. Mostrar "Agente apagado" nesse caso pede
 * mudança de schema.
 */
export const LEDGER_AGENT = "coalesce(l.agent_id, c.agent_id)";

/**
 * O que o extrato do período tem de custo não medido (`cost_measured = false`: modelo sem preço, ou
 * consumo que o provedor não declarou). O custo dessas linhas é zero no banco, e o zero não quer
 * dizer grátis: a tela marca o total, o dia, o agente e o motor que têm uma linha assim. Com o mesmo
 * dia (fuso da organização) e o mesmo agente por linha (`LEDGER_AGENT`) das somas de `/costs`.
 */
export async function unmeasuredIn(q: OrgQuery, from: string, to: string): Promise<Unmeasured> {
  const rows = await q.many<{ day: string; agentId: string | null; engine: string; callId: string }>(
    `select to_char((l.at at time zone z.zone)::date, 'YYYY-MM-DD') as day, ${LEDGER_AGENT} as "agentId", l.engine, l.call_id as "callId"
       from usage_ledger l join calls c on c.id = l.call_id
      cross join (select coalesce((select timezone from outbound_policy), 'America/Sao_Paulo') as zone) z
      where not l.cost_measured and (l.at at time zone z.zone)::date between $1::date and $2::date`,
    [from, to],
  );
  const distinct = <T>(values: T[]): T[] => [...new Set(values)];
  return {
    calls: distinct(rows.map((row) => row.callId)).length,
    days: distinct(rows.map((row) => row.day)).sort(),
    agentIds: distinct(rows.map((row) => row.agentId)),
    engines: distinct(rows.map((row) => row.engine)).sort(),
  };
}

export interface Unmeasured {
  /** Quantas ligações do período têm ao menos uma linha não medida. */
  calls: number;
  days: string[];
  /** `null` é o agente apagado, como em `byAgent`. */
  agentIds: Array<string | null>;
  engines: string[];
}

/** Se alguma linha do extrato da ligação tem custo não medido. */
export async function callCostUnmeasured(q: OrgQuery, callId: string): Promise<boolean> {
  return (await q.one("select 1 from usage_ledger where call_id = $1 and not cost_measured limit 1", [callId])) !== null;
}
