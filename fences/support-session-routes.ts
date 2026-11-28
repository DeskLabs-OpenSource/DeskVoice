/**
 * O que a sessão de suporte da instalação (`users.kind = 'support'`, R8 seção 3.6) pode fazer em cada
 * rota de escrita do painel: toda rota com `POST`, `PUT`, `PATCH` ou `DELETE`, método por método.
 *
 * A pergunta de cada linha: "esta ação cria credencial, convite ou acesso que sobrevive ao fim da
 * sessão de suporte, ou mexe na equipe ou na conta?". Sim, ou na dúvida, é `forbid`: a rota passa
 * `support: false` ao `handle` (ou `handlePublic`, `handleInstallation`, `requireRole`) e a sessão de
 * suporte recebe 403 `support_session_forbidden` antes de qualquer gravação. Não é `allow`.
 *
 * A cerca `support-session-routes-are-classified.test.ts` confere a tabela contra o disco, e o teste
 * `apps/panel/src/app/api/v1/support-session.db.test.ts` chama cada linha `forbid` com uma sessão
 * de suporte e com um `admin` da equipe. Rota nova nasce sem linha, e o CI recusa. Toda rota em
 * `team/**` é `forbid`.
 *
 * `route` é o caminho sob `apps/panel/src/app/api/v1/`, sem o `/route.ts`.
 */
export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface SupportSessionRoute {
  route: string;
  method: WriteMethod;
  rule: "forbid" | "allow";
  reason: string;
}

const forbid = (route: string, method: WriteMethod, reason: string): SupportSessionRoute => ({ route, method, rule: "forbid", reason });
const allow = (route: string, method: WriteMethod, reason: string): SupportSessionRoute => ({ route, method, rule: "allow", reason });

export const SUPPORT_SESSION_ROUTES: SupportSessionRoute[] = [
  // A equipe e os convites (seção 3.6: o vínculo de suporte não convida nem mexe na equipe).
  forbid("team/invites", "POST", "o convite é um acesso novo que sobrevive à sessão de suporte"),
  forbid("team/invites/[id]", "DELETE", "mexe nos convites da equipe; toda rota de team/** é recusada"),
  forbid("team/users/[id]", "PATCH", "muda papel ou ativa pessoa da equipe"),
  forbid("team/users/[id]", "DELETE", "tira pessoa da equipe"),
  forbid("invites/[token]/accept", "POST", "aceitar convite cria vínculo e sessão que sobrevivem à de suporte"),

  // A conta e a sessão.
  forbid("auth/password", "POST", "troca a senha da conta de quem administra a instalação"),
  forbid("auth/me", "PATCH", "o vínculo de suporte nasce sem telefone e sem WhatsApp e assim fica"),
  forbid("auth/switch", "POST", "leva a sessão para outra organização; a saída da sessão de suporte é `auth/support/end`"),
  allow("auth/support/end", "POST", "encerra o acesso de suporte da própria sessão e a leva de volta à organização da conta"),
  allow("auth/login", "POST", "rota sem sessão: o login só escolhe vínculo `member`"),
  allow("auth/logout", "POST", "encerra a própria sessão, não cria nada"),

  // A área da instalação age pela conta, não pelo vínculo de suporte. `handleInstallation` recusa a
  // sessão de suporte em toda rota, a de leitura também; a linha daqui é para a escrita.
  forbid("installation/organizations/[id]/invite", "POST", "o vínculo de suporte não convida, nem pela área da instalação"),
  forbid("installation/organizations", "POST", "cria organização com convite de dono: acesso que sobrevive"),
  forbid("installation/organizations/[id]", "PATCH", "a área da instalação age pela conta, fora da sessão de suporte"),
  forbid("installation/organizations/[id]/suspension", "POST", "suspender é ato da conta que administra, fora da sessão de suporte"),
  forbid("installation/organizations/[id]/suspension", "DELETE", "reativar é ato da conta que administra, fora da sessão de suporte"),
  forbid("installation/organizations/[id]/support", "POST", "uma sessão de suporte não abre outra; a área da instalação age pela conta"),
  forbid("installation/organizations/[id]/limits", "PUT", "muda o limite da organização: ato da conta que administra a instalação, fora da sessão de suporte"),
  forbid("installation/defaults/limits", "PUT", "muda os limites com que nasce toda organização nova: ato da conta que administra a instalação, fora da sessão de suporte"),
  forbid("installation/defaults/organization", "PUT", "muda o fuso e o idioma com que nasce toda organização nova: ato da conta que administra a instalação, fora da sessão de suporte"),
  forbid("installation/admins", "POST", "dá o papel da instalação a uma conta: acesso que sobrevive"),
  forbid("installation/admins/[id]", "DELETE", "mexe em quem administra a instalação"),

  // O servidor.
  forbid("system/update", "POST", "dúvida: pede a atualização da instalação inteira com a senha da conta"),
  allow("system/agent", "POST", "rota sem sessão: o agente de atualização se autentica pelo segredo"),

  // Destinos de saída que continuam recebendo dados depois da sessão.
  forbid("calls/[id]/share", "POST", "o link público da ligação sobrevive à sessão de suporte"),
  allow("calls/[id]/share", "DELETE", "revoga o link público, não cria acesso"),
  forbid("settings/[key]", "PUT", "algumas chaves são destino de saída (conector, ganchos, endpoint de classificação)"),
  // Os servidores MCP (item 8, fatia 8b): a mesma classificação do `PUT settings/[key]`, onde os webhooks moram.
  forbid("mcp-servers/discover", "POST", "manda um segredo digitado a um destino de fora"),
  forbid("mcp-servers/[slug]", "PUT", "grava uma credencial e um destino de saída que sobrevivem à sessão de suporte"),
  forbid("mcp-servers/[slug]/refresh", "POST", "usa o segredo guardado contra o servidor de fora"),
  forbid("mcp-servers/[slug]", "DELETE", "descadastra o servidor e tira as ferramentas dele de todo agente da organização"),
  forbid("whatsapp/connect", "POST", "pareia um número por QR Code: canal de saída que sobrevive à sessão"),
  allow("whatsapp/disconnect", "POST", "desliga o canal, não cria acesso"),
  forbid("whatsapp/service", "POST", "dúvida: liga o serviço de WhatsApp da instalação inteira, não só da organização"),
  allow("whatsapp/test", "POST", "manda uma mensagem de teste pelo canal que já existe"),
  allow("whatsapp/crm-check", "POST", "só lê o CRM do conector já gravado, com o token que já existe: não cria credencial nem acesso, e nada é gravado"),
  forbid("whatsapp-calls/connect", "POST", "pareia um número por QR Code: canal que sobrevive à sessão"),
  allow("whatsapp-calls/disconnect", "POST", "desliga o canal, não cria acesso"),
  forbid("whatsapp-calls/service", "POST", "dúvida: liga o serviço de ligação pelo WhatsApp da instalação inteira"),
  allow("whatsapp-calls", "PATCH", "só escolhe entre atendentes que já existem na organização, não cria destino"),

  // Chaves de provedor: gravar a chave é `forbid`; apagar e conferir não criam destino novo.
  forbid("brains/[brain]/key", "PUT", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  allow("brains/[brain]/key", "DELETE", "apaga a chave do provedor, não cria acesso"),
  allow("brains/[brain]/models/refresh", "POST", "relê a lista de modelos do provedor"),
  forbid("synthesizers/[synthesizer]/key", "PUT", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  allow("synthesizers/[synthesizer]/key", "POST", "confere a chave do provedor"),
  allow("synthesizers/[synthesizer]/key", "DELETE", "apaga a chave do provedor, não cria acesso"),
  forbid("transcribers/[transcriber]/consent", "PUT", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  allow("transcribers/[transcriber]/consent", "DELETE", "apaga a confirmação do envio, não cria acesso"),
  forbid("speech-filter/[model]/key", "PUT", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  allow("speech-filter/[model]/key", "DELETE", "apaga a chave do provedor, não cria acesso"),
  allow("speech-filter", "PUT", "configuração do filtro de fala da organização"),
  allow("engines/[engine]/key-check", "POST", "confere a chave do motor, não grava acesso"),

  // Atendimento: configuração e operação da organização, o motivo de existir suporte. Criar e editar
  // atendente e tronco é `forbid`: apontam a ligação para um destino que sobrevive à sessão.
  forbid("agents", "POST", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  forbid("agents/[id]", "PATCH", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  allow("agents/[id]", "DELETE", "configuração de atendente da organização"),
  allow("agents/[id]/tests", "POST", "teste do agente: uma conversa escrita, sem destino fora e sem acesso"),
  allow("agents/[id]/tests/[testId]", "PATCH", "teste do agente: uma conversa escrita, sem destino fora e sem acesso"),
  allow("agents/[id]/tests/[testId]", "DELETE", "apaga um teste do agente, não cria acesso"),
  allow("agents/[id]/tests/[testId]/run", "POST", "roda um teste do agente em texto; nenhuma ferramenta roda e nada sai"),
  allow("analysts", "POST", "configuração de analista da organização"),
  allow("analysts/[id]", "PATCH", "configuração de analista da organização"),
  allow("analysts/[id]", "DELETE", "configuração de analista da organização"),
  allow("approvals/[id]/decide", "POST", "decide um pedido pendente, não cria acesso"),
  allow("caller-notes/[id]", "DELETE", "apaga uma nota, não cria acesso"),
  allow("calls/[id]/recording/pause", "POST", "pausa a gravação de uma ligação em curso"),
  allow("calls/[id]/transcription", "POST", "pede a transcrição de uma ligação"),
  allow("calls/outbound", "POST", "faz uma ligação sob a política de saída da organização"),
  allow("calls/simulate", "POST", "simula uma ligação para testar o atendente"),
  allow("calls/web", "POST", "ligação de teste pelo navegador, que acaba com a página"),
  allow("do-not-call", "POST", "acrescenta número à lista de não ligar"),
  allow("do-not-call", "DELETE", "tira número da lista de não ligar"),
  allow("follow-ups/[id]", "PATCH", "edita um retorno; responsável só entre vínculos `member` (5a)"),
  allow("follow-ups/[id]/close", "POST", "fecha um retorno"),
  allow("ivr-menus", "POST", "configuração do menu por teclas da organização"),
  allow("ivr-menus/[id]", "PATCH", "configuração do menu por teclas da organização"),
  allow("ivr-menus/[id]", "DELETE", "configuração do menu por teclas da organização"),
  allow("ivr-menus/[id]/options", "PUT", "configuração do menu por teclas da organização"),
  allow("ivr-menus/[id]/audio", "PUT", "o anúncio do menu por teclas da organização"),
  allow("notifications/[id]/read", "POST", "marca um aviso como lido"),
  forbid("outbound-policy", "PUT", "a política de saída da organização fica depois da sessão"),
  allow("phone-numbers", "POST", "configuração de número da organização"),
  allow("phone-numbers/[id]", "PATCH", "configuração de número da organização"),
  allow("phone-numbers/[id]", "DELETE", "configuração de número da organização"),
  forbid("trunks", "POST", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  forbid("trunks/[id]", "PATCH", "aponta o dado ou a ligação da organização para um destino que sobrevive à sessão"),
  allow("trunks/[id]", "DELETE", "configuração de telefonia da organização"),
  allow("trunks/[id]/check", "POST", "confere o tronco, não grava acesso"),
  allow("trunks/[id]/inbound-filter", "PATCH", "filtro de entrada do tronco da organização"),

  // Privacidade: o conteúdo volta na resposta; nada fica publicado.
  allow("privacy/export", "POST", "devolve os dados na própria resposta: não grava link nem arquivo para depois"),
  allow("privacy/erasure/preview", "POST", "só mostra o que seria apagado"),
  allow("privacy/erasure", "POST", "apaga dados, não cria acesso"),
  allow("privacy/forget", "POST", "apaga dados de quem ligou, não cria acesso"),
  allow("privacy/caller-memory", "PUT", "configuração de privacidade da organização"),
  allow("privacy/caller-notes-retention", "PUT", "prazo de guarda das notas da organização"),
  allow("privacy/recording", "PUT", "configuração de gravação da organização"),
  allow("privacy/retention", "PUT", "prazo de guarda da organização"),
];
