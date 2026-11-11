import { ApiError, handlePublic, notFound } from "../../../../../server/context";
import { agentCheckIn, agentReport, isAgent } from "../../../../../server/update";

/**
 * A rota do agente de atualização (`install/agent.sh`). Não tem sessão: quem fala é um script no
 * servidor, autenticado pelo segredo que o instalador gerou.
 *
 * O agente chama de DENTRO do contêiner do painel, direto na porta dele. Pedido que passou por
 * um proxy (o Caddy sempre acrescenta `X-Forwarded-For`) veio de fora e não chega aqui: para a
 * internet esta rota não existe, com ou sem o segredo.
 *
 * A resposta é `{ update: boolean }` e mais nada. Um painel capaz de mandar comando, versão ou
 * endereço ao servidor seria uma porta de administração remota.
 */
export const POST = handlePublic({}, async ({ request, deps }) => {
  if (request.headers.has("x-forwarded-for")) throw notFound();
  if (!isAgent(request, deps)) throw new ApiError(401, "unauthenticated", "The agent secret is missing or wrong.");
  const report = agentReport.safeParse(await request.json().catch(() => null));
  if (!report.success) throw new ApiError(400, "validation_error", "The agent report is malformed.");
  const { update } = await agentCheckIn(deps, report.data);
  return { update };
});
