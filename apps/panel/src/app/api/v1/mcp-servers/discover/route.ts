import { handle } from "../../../../../server/context";
import { discoverBody, lookTools } from "../../../../../server/mcp-servers";

/**
 * Lista as ferramentas de um servidor MCP sem gravar nada, para a tela mostrar antes de salvar. A
 * busca é a da ligação (`listTools`, sem seguir redirecionamento) e fica fora da transação. A sessão
 * de suporte não chama: o pedido manda um segredo digitado a um destino de fora.
 */
const looked = new WeakMap<object, Awaited<ReturnType<typeof lookTools>>>();
export const POST = handle(
  {
    support: false,
    configure: true,
    body: discoverBody,
    before: async ({ body, deps }) => {
      looked.set(
        body,
        await lookTools(deps, {
          slug: body.slug ?? "x".repeat(16),
          url: body.url,
          headerName: body.headerName,
          secret: body.secret,
          timeoutSeconds: body.timeoutSeconds,
        }),
      );
    },
  },
  async ({ body }) => {
    const list = looked.get(body);
    if (!list) throw new Error("the MCP lookup did not run");
    return list;
  },
);
