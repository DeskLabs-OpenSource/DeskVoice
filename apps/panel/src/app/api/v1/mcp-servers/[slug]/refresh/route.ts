import { handle, notFound } from "../../../../../../server/context";
import { MCP_SLUG, lookTools, refreshView, storedServer } from "../../../../../../server/mcp-servers";

/**
 * Busca de novo as ferramentas de um servidor gravado e diz o que mudou por ferramenta (nova, mudou,
 * sumiu), sem gravar: a que mudou volta desmarcada, e quem grava é o `PUT`. A busca usa o segredo
 * guardado contra o servidor, por isso a sessão de suporte não chama.
 */
const looked = new WeakMap<object, ReturnType<typeof refreshView>>();
const key = (params: Record<string, string>): object => params;
export const POST = handle(
  {
    support: false,
    configure: true,
    before: async ({ deps, session, params }) => {
      const slug = params.slug ?? "";
      const server = MCP_SLUG.test(slug) ? await storedServer(deps, session, slug) : undefined;
      if (!server) throw notFound();
      looked.set(key(params), refreshView(server, await lookTools(deps, server)));
    },
  },
  async ({ params }) => {
    const view = looked.get(key(params));
    if (!view) throw new Error("the MCP lookup did not run");
    return view;
  },
);
