import { ApiError, handlePublic, notFound } from "../../../../../server/context";
import { agentCheckIn, agentReport, isAgent } from "../../../../../server/update";

/**
 * A rota do agente de atualização (`install/agent.sh`). Não tem sessão: quem fala é um script no
 * servidor, autenticado pelo segredo que o instalador gerou.
 *
 * O agente chama de DENTRO do contêiner do painel, direto na porta dele. Pedido que passou por
 * um proxy veio de fora e não chega aqui: para a internet esta rota não existe, com ou sem o
 * segredo.
 *
 * Como se distingue: o servidor do Next preenche `X-Forwarded-For` com o endereço da conexão
 * quando o pedido chega sem ele. Na chamada direta do agente esse endereço é o da própria
 * máquina (loopback). Pedido que veio pelo Caddy traz o endereço de quem chamou, ou uma lista.
 *
 * Esta checagem NÃO é autenticação: um cabeçalho pode ser forjado por quem alcança a porta do
 * painel. Quem autentica é o segredo, que só o painel e o agente conhecem. Ela é a terceira
 * camada, atrás do Caddy (que responde 404 neste caminho) e de o painel não publicar porta em
 * modo nenhum. Não confie nela sozinha, nem a use como modelo para outra rota.
 *
 * A primeira instalação de verdade no CI mostrou que "o cabeçalho não existe" nunca acontece
 * com o servidor real: a regra antiga recusava o próprio agente.
 *
 * A resposta é `{ update: boolean, whatsapp: boolean }` e mais nada: há atualização pedida, e
 * esta instalação quer o serviço de WhatsApp. Um painel capaz de mandar comando, versão, imagem
 * ou endereço ao servidor seria uma porta de administração remota. Os campos são copiados um a
 * um, de propósito: o que `agentCheckIn` passar a devolver não vaza para o servidor por engano.
 */
export const POST = handlePublic({}, async ({ request, deps }) => {
  if (!cameFromThisMachine(request.headers.get("x-forwarded-for"))) throw notFound();
  if (!isAgent(request, deps)) throw new ApiError(401, "unauthenticated", "The agent secret is missing or wrong.");
  const report = agentReport.safeParse(await request.json().catch(() => null));
  if (!report.success) throw new ApiError(400, "validation_error", "The agent report is malformed.");
  const { update, whatsapp } = await agentCheckIn(deps, report.data);
  return { update: update === true, whatsapp: whatsapp === true };
});

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Sem o cabeçalho (chamada em processo, nos testes) ou com um único endereço de loopback. */
function cameFromThisMachine(forwardedFor: string | null): boolean {
  return forwardedFor === null || LOOPBACK.has(forwardedFor.trim());
}
