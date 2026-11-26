import { MICROCENTS_PER_CENT } from "@deskvoice/voice-engine/pricing";

/**
 * O valor em centavos, arredondado uma vez só: a soma é feita na unidade exata do extrato
 * (micro-centavos), porque a classificação de uma ligação custa menos de um centavo. Somar o
 * centavo de cada linha dava trinta vezes o valor de tabela por leitura.
 */
export const centsOf = (microcents: string | number): number => Math.round(Number(microcents) / MICROCENTS_PER_CENT);

/**
 * O agente de uma linha do extrato (`usage_ledger l`, com `calls c` da ligação dela, sempre por
 * `left join`: a linha do teste do agente não tem ligação, e fica com o `agent_id` dela). Desde a
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
 * Quantas linhas de um grupo do extrato (`usage_ledger l`) não têm custo medido (`cost_measured =
 * false`: modelo sem preço, ou consumo que o sistema não pôde medir). O custo delas é zero no banco, e
 * o zero não quer dizer grátis: cada soma de `/costs` e da chamada leva esta contagem ao lado, no
 * mesmo `group by` da soma, e a tela diz "não medido" onde ela passa de zero.
 */
export const UNMEASURED_COUNT = `count(*) filter (where not l.cost_measured)::int`;

/**
 * Quantas linhas de um grupo do extrato (`usage_ledger l`) têm custo estimado (`cost_estimated =
 * true`, desde a fatia 7a: o pedido ao modelo saiu e o consumo não foi lido). Ao contrário do não
 * medido, a estimativa entra na soma e no teto, e fica acima do real. A contagem vai ao lado da
 * soma, no mesmo `group by`, e a tela diz "inclui estimativa" onde ela passa de zero.
 */
export const ESTIMATED_COUNT = `count(*) filter (where l.cost_estimated)::int`;
