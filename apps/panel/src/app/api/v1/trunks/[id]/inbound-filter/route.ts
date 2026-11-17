import { ApiError, handle, notFound } from "../../../../../../server/context";
import { TRUNK_COLUMNS, trunkInboundFilter } from "../../../../../../server/shapes";
import { applyTrunks } from "../../store";

/**
 * Liga ou desliga o filtro de entrada de uma linha por registro (R14, contrato 11). Só grava
 * `inbound_filter`: o resto da linha, o estado e o conjunto liberado ficam como estão. A linha por
 * IP filtra sempre e não tem botão; o pedido para ela é recusado. A linha de outra organização não
 * aparece na consulta (a mesma checagem das outras gravações da linha) e dá 404.
 */
export const PATCH = handle(
  {
    body: trunkInboundFilter,
    configure: true,
    after: async (trunk: object | null, { deps, session }) => ({ ...trunk, ...(await applyTrunks(deps, session.organizationId)) }),
  },
  async ({ q, params, body }) => {
    const current = await q.one<{ authMode: string }>(`select auth_mode as "authMode" from trunks where id = $1`, [params.id]);
    if (!current) throw notFound();
    if (current.authMode !== "register") {
      throw new ApiError(409, "filter_always_on", "A line recognized by the provider's IP always has the filter on: the filter is the same list that recognizes the line.");
    }
    return q.one(`update trunks set inbound_filter = $2 where id = $1 and auth_mode = 'register' returning ${TRUNK_COLUMNS}`, [params.id, body.enabled]);
  },
);
