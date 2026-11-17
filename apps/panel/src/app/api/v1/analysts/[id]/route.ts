import { handle, notFound } from "../../../../../server/context";
import { ANALYST_COLUMNS, analystPatch, saveAnalyst, type AnalystRow } from "../store";

export const GET = handle({}, async ({ q, params }) => {
  const analyst = await q.one(`select ${ANALYST_COLUMNS} from analysts where id = $1`, [params.id]);
  if (!analyst) throw notFound();
  return analyst;
});

export const PATCH = handle({ body: analystPatch, configure: true }, async ({ q, params, body, session, deps }) => {
  const current = await q.one<AnalystRow>(`select ${ANALYST_COLUMNS} from analysts where id = $1 for update`, [params.id]);
  if (!current) throw notFound();
  return saveAnalyst(q, session, deps.clock.now(), body, current);
});

/**
 * Apaga o analista. Os agentes que o usavam ficam sem analista (`on delete set null`), e a resposta
 * diz quantos: a tela nomeia o alvo antes de pedir a confirmação (fatia 4). A trava na linha segura a
 * contagem: um agente que tentasse ligar este analista no meio espera o fim do apagamento.
 */
export const DELETE = handle({ configure: true }, async ({ q, params }) => {
  if (!(await q.one("select 1 from analysts where id = $1 for update", [params.id]))) throw notFound();
  const linked = await q.one<{ count: number }>("select count(*)::int as count from agents where analyst_id = $1", [params.id]);
  await q.exec("delete from analysts where id = $1", [params.id]);
  return { agentsUnlinked: linked?.count ?? 0 };
});
