import { ApiError, handle, notFound } from "../../../../../server/context";
import { MCP_SLUG, deleteBody, lookTools, refuseTaken, removeServer, saveBody, saveServer, storedServer, type Looked } from "../../../../../server/mcp-servers";

const slugOf = (params: Record<string, string>): string => {
  const slug = params.slug ?? "";
  if (!MCP_SLUG.test(slug)) throw notFound();
  return slug;
};

/**
 * Grava o servidor com o retrato e as marcas. A busca no servidor vem antes, fora da transação, e a
 * impressão digital de cada ferramenta da tela tem de bater com ela. Endereço novo sem segredo novo
 * fica sem segredo: o antigo nunca vai a outro destino. O pedido de criação (`create`) com um `slug`
 * que já existe é recusado com 409 antes da busca, e nada muda. A sessão de suporte não grava: é uma
 * credencial que sobrevive a ela.
 */
const looked = new WeakMap<object, Looked>();
export const PUT = handle(
  {
    support: false,
    configure: true,
    body: saveBody,
    before: async ({ body, deps, session, params }) => {
      const slug = slugOf(params);
      const previous = await storedServer(deps, session, slug);
      refuseTaken(body.create, previous);
      const secret = body.secret ?? (previous?.url === body.url ? previous.secret : undefined);
      const list = await lookTools(deps, {
        slug,
        url: body.url,
        headerName: body.headerName,
        secret,
        timeoutSeconds: body.timeoutSeconds,
      });
      looked.set(body, { secret, list });
    },
  },
  async ({ q, deps, body, params }) => {
    const found = looked.get(body);
    if (!found) throw new Error("the MCP lookup did not run");
    return saveServer(q, deps, slugOf(params), body, found);
  },
);

/**
 * Descadastra o servidor. Destrutivo: sem `confirm` igual ao `slug`, responde 400 e nada muda. Os
 * nomes `<slug>__*` saem de todo agente da organização na mesma transação.
 */
export const DELETE = handle({ support: false, configure: true, body: deleteBody }, async ({ q, deps, body, params }) => {
  const slug = slugOf(params);
  if (body.confirm !== slug) throw new ApiError(400, "confirm_mismatch", "Type the server slug to confirm the removal.");
  return removeServer(q, deps, slug);
});
