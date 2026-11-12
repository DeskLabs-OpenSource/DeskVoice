const whatsappCalls = {
  title: "Ligação pelo WhatsApp",
  lead: "Conecte o número da empresa lendo um QR Code, como mais um aparelho do WhatsApp. É por ele que o agente vai atender quem liga pelo WhatsApp.",
  nextVersion:
    "Nesta versão o serviço só conecta o número. O atendimento das ligações pelo agente chega na próxima versão; até lá, quem liga pelo WhatsApp é atendido como hoje, pelo celular.",
  unavailable: "O processo de voz deste servidor ainda não tem a chave do serviço de ligação pelo WhatsApp. Isso acontece quando a atualização foi feita por um atualizador antigo. Rode no servidor, uma vez:",
  serviceAbsent: "O serviço de ligação pelo WhatsApp não está instalado neste servidor.",
  serviceCost:
    "Ele é uma peça à parte, que só é baixada e ligada se você pedir. A imagem tem cerca de 19 MB para baixar (conferido no registro de imagens em 12/11/2026). A memória e o espaço em disco que ele usa ainda não foram medidos; o teto de memória é de 256 MB.",
  installService: "Instalar o serviço de ligação pelo WhatsApp",
  servicePreparing: "Preparando o serviço: o servidor está baixando a ligação pelo WhatsApp. Leva alguns minutos, e esta tela acompanha.",
  serviceFailed: {
    no_disk: "O servidor não tem espaço em disco para o serviço de ligação pelo WhatsApp. Nada foi baixado.",
    pull_failed: "O servidor não conseguiu baixar o serviço de ligação pelo WhatsApp. Costuma ser a internet do servidor, o registro de imagens fora do ar ou falta de espaço em disco.",
    start_failed: "O servidor baixou o serviço de ligação pelo WhatsApp, mas ele não subiu. Costuma ser falta de memória ou de espaço em disco.",
    remove_failed: "O servidor não conseguiu remover o serviço de ligação pelo WhatsApp.",
    unknown: "O servidor não conseguiu instalar o serviço de ligação pelo WhatsApp.",
  },
  noDisk: "O servidor não tem espaço em disco para o serviço de ligação pelo WhatsApp: há {free} GB livres e ele pede {needed} GB. Faltam cerca de {missing} GB. Nada foi baixado. Libere espaço (backups antigos em backups/, por exemplo) ou aumente o disco.",
  lowMemory: "Quando o serviço foi instalado, o servidor tinha menos memória disponível que o teto dele (256 MB). Ele está de pé, mas pode faltar memória para o resto do DeskVoice. Acompanhe o servidor, ou remova o serviço.",
  imageKept: "O serviço foi removido e a memória foi liberada, mas os arquivos dele não saíram do disco, porque outra coisa neste servidor os usa. O servidor tenta de novo sozinho a cada minuto. Para tentar agora, rode no servidor:",
  serviceRetry: "O servidor tenta de novo sozinho em cerca de 10 minutos. O registro do que aconteceu fica no servidor, em deploy/agent/agent.log.",
  serviceRemoving: "Removendo o serviço de ligação pelo WhatsApp do servidor. Leva até um minuto.",
  removeService: "Remover o serviço de ligação pelo WhatsApp",
  removeServiceConfirm:
    "Remover o serviço de ligação pelo WhatsApp deste servidor? Nenhum número fica conectado para ligações, e a memória e o disco dele são liberados. Se um número já foi conectado aqui, confira no celular dele, em Dispositivos conectados, se este aparelho saiu, e remova-o se ainda estiver lá. Para voltar, é só instalar de novo.",
  removeServiceConfirmPhone:
    "Remover o serviço de ligação pelo WhatsApp deste servidor? O número {phone} foi o último conectado aqui: confira no celular dele, em Dispositivos conectados, se este aparelho saiu, e remova-o se ainda estiver lá. A memória e o disco do serviço são liberados. Para voltar, é só instalar de novo.",
  removeServiceYes: "Remover o serviço de ligação pelo WhatsApp",
  agentNever: "O agente deste servidor, que é quem instala e remove o serviço, ainda não falou com o painel. Sem ele, o pedido fica esperando. Para executar agora, rode no servidor:",
  agentSilent: "O agente deste servidor, que é quem instala e remove o serviço, não está respondendo. O pedido fica esperando até ele voltar. Para executar agora, rode no servidor:",
  riskTitle: "Antes de conectar",
  risk: "A ligação pelo WhatsApp usa um cliente não oficial (o WaCalls), que conecta o número como mais um aparelho, e não a API oficial da Meta. O WhatsApp pode restringir ou bloquear o número, sem aviso. Use um número dedicado ao atendimento, nunca o seu pessoal.",
  devices:
    "O WhatsApp aceita até quatro aparelhos conectados a um número, e as ligações tocam em todos eles. Este serviço ocupa um desses lugares. Com mais de quatro aparelhos (contas com Meta Verified, por exemplo), as ligações tocam só no celular, e este serviço deixa de recebê-las.",
  messagesNumber:
    "O número {phone} está conectado para mensagens, em WhatsApp. Se você conectar o mesmo número aqui, serão dois aparelhos conectados ao mesmo WhatsApp: se o número for bloqueado, as mensagens e as ligações param juntas.",
  sameNumber:
    "Este número também está conectado para mensagens. São dois aparelhos conectados ao mesmo WhatsApp. Se o número for bloqueado, as mensagens e as ligações param juntas. O WhatsApp aceita até quatro aparelhos conectados; com mais que isso, as ligações tocam só no celular.",
  connect: "Conectar",
  starting: "Preparando a conexão. O QR Code aparece em alguns segundos.",
  qrTitle: "Leia o código com o celular do número",
  steps: [
    "Abra o WhatsApp no celular do número que vai receber as ligações.",
    "Toque em Mais opções (ou em Configurações) e depois em Dispositivos conectados.",
    "Toque em Conectar dispositivo e aponte a câmera para este código.",
  ],
  qrAlt: "QR Code para conectar o número à ligação pelo WhatsApp",
  qrRenew: "O código é trocado sozinho algumas vezes e vale por poucos minutos. Esta tela acompanha e avisa quando conectar.",
  qrBetween: "Gerando o próximo código.",
  connected: "Conectado",
  connectedNumber: "Número conectado: {phone}",
  connectedUnknown: "Um número está conectado.",
  since: "Conectado desde {when}.",
  disconnect: "Desconectar",
  disconnectConfirm: "Desconectar {phone} da ligação pelo WhatsApp? O aparelho sai de Dispositivos conectados no celular, e para voltar será preciso ler o QR Code outra vez.",
  disconnectYes: "Desconectar {phone}",
  thisNumber: "o número conectado",
  failed: {
    logged_out:
      "O número desconectou: o aparelho foi removido em Dispositivos conectados, no celular, ou o WhatsApp encerrou a conexão. O WhatsApp desconecta os aparelhos vinculados quando o celular principal fica mais de 14 dias sem uso.",
    qr_expired: "O QR Code não foi lido a tempo, e a tentativa foi encerrada.",
    missing:
      "O serviço de ligação pelo WhatsApp não tem mais os dados desta conexão. Isso acontece depois de restaurar um backup, de mudar de servidor ou de reinstalar o serviço, porque o pareamento não entra no backup.",
  },
  reconnect: "Conectar de novo",
  newCode: "Gerar novo código",
};

export default whatsappCalls;
export type WhatsAppCallsDictionary = typeof whatsappCalls;
