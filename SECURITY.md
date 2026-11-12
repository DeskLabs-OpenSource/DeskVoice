# Política de segurança

## Como relatar uma vulnerabilidade

**Não abra issue pública para vulnerabilidade.**

Use o relato privado do GitHub:
[abrir um aviso de segurança](https://github.com/DeskLabs-OpenSource/DeskVoice/security/advisories/new).
O relato chega só aos mantenedores, e o histórico fica auditável.

O que esperar:

- **Confirmação de recebimento** em até 7 dias.
- **Avaliação e resposta** em até 30 dias, com plano de correção quando a falha for confirmada.
- **Crédito** no aviso publicado, se você quiser.

Ajuda muito se o relato trouxer: a versão ou o commit, os passos para reproduzir e o que um
atacante consegue fazer. Não inclua dados reais de terceiros, como números de telefone ou
transcrições.

## Versões suportadas

Correções de segurança saem para a versão mais recente publicada. Mantenha a sua instalação
atualizada.

| Versão | Recebe correção |
|---|---|
| A mais recente publicada | Sim |
| Anteriores | Não |

## Escopo

Interessam em especial relatos sobre:

- **Vazamento entre organizações:** dado de uma organização lido ou alterado por outra,
  contornando a camada de isolamento.
- **Autenticação e sessão do painel:** entrar sem credencial, elevar papel, reutilizar sessão.
- **Segredos:** senha de tronco, chave de IA ou chave de cifra expostas em resposta de API, log,
  evento ou backup.
- **Controle da telefonia:** qualquer forma de originar, transferir ou escutar chamada sem
  permissão, ou de alcançar a interface de controle do Asterisk de fora.
- **Ligações de saída:** originar chamada com a política desligada, ou contornar teto, janela
  de horário ou lista de não ligar.
- **Aprovação humana:** fazer o agente executar o que dependia de aprovação sem que alguém
  tenha aprovado.
- **Webhooks:** fazer a ferramenta de webhook alcançar endereço interno ou não cadastrado.
- **Instalador e atualização:** execução de comando ou escrita de arquivo fora do previsto.

Fora do escopo do projeto: configuração do servidor de quem hospeda (firewall, sistema
operacional, acesso SSH) e falhas dos provedores de IA ou de telefonia. Melhorias no instalador
que tornem o padrão mais seguro são bem-vindas como issue comum.

## A porta de controle do Asterisk nunca é publicada

O DeskVoice comanda o Asterisk pela interface ARI. Quem alcança essa interface controla as
chamadas da instalação. Por isso:

- **A porta do ARI só existe na rede interna do Docker.** A instalação padrão não a publica, e
  nenhum guia do projeto pede que você a publique.
- O mesmo vale para a porta do AudioSocket e para o Postgres.
- Para fora, a instalação expõe o painel (80 e 443), a sinalização SIP e a faixa de áudio RTP.
  Nada mais.

Se você alterar os arquivos de implantação, não acrescente publicação de porta para o ARI. Se
encontrar uma instalação padrão em que ele esteja acessível de fora, isso é uma vulnerabilidade:
relate.

## Limites conhecidos desta fundação

Preferimos dizer o que ainda não está fechado a deixar alguém descobrir em produção.

- **Troca de organização por injeção de SQL.** O isolamento entre organizações é feito no banco
  (RLS) a partir de um valor que a própria conexão define. Se um dia existir uma falha de injeção
  de SQL numa consulta, quem a explorar e souber o identificador de outra organização consegue
  trocar de organização. Hoje as consultas são parametrizadas e uma cerca reprova SQL fora de
  `packages/core`. Fechar de vez pede outro desenho, e é uma frente aberta no roadmap.
- **Limite de tentativas de login em memória.** Vale por processo do painel. Reiniciar o painel
  zera a contagem.
- **Quem sabe o e-mail de um usuário consegue trancá-lo fora por alguns minutos.** Cinco senhas
  erradas bloqueiam novas tentativas para aquele e-mail por um tempo, inclusive as do dono. É o
  preço de limitar tentativa por e-mail; a saída de emergência é `bash install/reset-password.sh`,
  de dentro da VPS.
- **A cerca de SQL não lê o conteúdo das consultas.** Ela barra conexão direta com o Postgres e
  uso não listado de `withSystem`. Uma consulta errada dentro de `withOrg` ainda é barrada pelo
  banco (RLS), não pela cerca.
- **O CI instala de verdade só o caminho mais simples.** O job `install` constrói as imagens e
  sobe a instalação no runner, sem domínio, e confere uma passada do agente de atualização e o
  que a entrada única deixa passar. Atualização entre versões, volta, backup e restauração
  seguem rodando contra um Docker simulado: uma falha deles que só aparece com Docker real
  (permissão de arquivo entre contêineres, por exemplo) passa pelo CI. Nenhuma atualização
  pela tela rodou de ponta a ponta numa instalação real.
- **Tarefa atrasada pode rodar duas vezes.** A recuperação de tarefa presa mede a idade pelo
  horário agendado, não pelo horário em que foi pega. As rotinas da fundação são seguras de
  repetir; rotina nova precisa ser também.
- **O que o segredo do agente de atualização protege, e o que não.** A rota por onde o agente do
  servidor fala com o painel só responde a quem traz o segredo gerado pelo instalador, e não é
  alcançável pela internet: o agente chama de dentro do contêiner do painel. O segredo fica em
  `deploy/.env` e o Compose o entrega só ao painel; os processos de voz e de rotinas não o
  recebem. Ele protege contra outro processo da rede interna do Docker (um contêiner do operador
  ligado a ela, ou um processo de voz ou de rotinas comprometido) se passando pelo agente. O pior que alguém com o segredo consegue é anunciar uma
  versão falsa, marcar um pedido como concluído ou fazer um pedido pendente ser lido; ele não
  ganha execução no servidor, porque a rota só devolve um booleano. O segredo **não** protege
  contra quem tem acesso ao servidor: essa pessoa lê `deploy/.env` e já pode rodar o
  atualizador. E quem tem conta de dono ou administrador no painel, com a senha, consegue tirar
  o sistema do ar por alguns minutos pedindo uma atualização: é o recurso funcionando.
- **O WhatsApp por QR Code usa um cliente não oficial.** O número conectado em Configurações é
  mantido pelo [WAHA](https://github.com/devlikeapro/waha), que fala com o WhatsApp como um
  aparelho conectado, e não pela API oficial da Meta. O WhatsApp pode restringir ou bloquear o
  número, sem aviso; use um número dedicado. O pareamento (a credencial do aparelho) fica no
  volume `waha-sessions` da VPS, sem cifra própria: quem tem acesso ao servidor ou a esse volume
  envia e lê como o número. Ele não entra no backup, e continua no disco depois que o serviço
  é removido pela tela. O serviço só existe na instalação que o pediu (Configurações →
  WhatsApp); quem o baixa, sobe e remove é o agente do servidor, que recebe do painel só um sim
  ou não. O contêiner do WAHA roda como o usuário padrão da imagem (root dentro do contêiner),
  só na rede interna, sem porta publicada, com o painel e a documentação da API dele desligados. A imagem é de terceiros, fixada por resumo: uma
  falha de segurança nela chega à instalação até a versão ser trocada aqui.
- **O que a chave do WAHA protege, e o que não.** A chave (`WAHA_API_KEY`, em `deploy/.env`) é
  gerada pelo instalador e entregue a painel, voz e rotinas, os três processos que falam com o
  WAHA; o contêiner do WAHA guarda só o hash dela. Ela protege o número contra outro contêiner
  ligado à rede interna do Docker. **Não** separa os três processos entre si: um processo de
  painel, de voz ou de rotinas comprometido usa a chave para enviar mensagem a qualquer número
  pelo WhatsApp conectado (as regras de destino, a confirmação humana e o teto por ligação são
  da ferramenta, não do WAHA), para ler o QR Code de uma conexão em andamento, para parar ou
  desfazer a conexão e, como o WAHA atende a instalação inteira, para agir na sessão de qualquer
  organização dela. O WAHA não entrega as mensagens recebidas a ninguém nesta versão (nenhum
  webhook, e estados, grupos, canais e difusão são ignorados), mas quem tem a chave pode pedir a
  ele o que a API oferece. O endereço do WAHA é fixo no código: nenhuma configuração do operador
  faz o DeskVoice mandar a chave para outro lugar. A chave não protege contra quem tem acesso ao
  servidor.
- **A queda do WhatsApp só é percebida com a tela aberta.** Nesta versão o WAHA não avisa o
  painel. Uma sessão que caiu aparece na próxima visita a Configurações; até lá, cada envio falha
  com o motivo na linha do tempo da chamada, e o aviso por WhatsApp para a equipe fica marcado
  como falho, sem alerta no painel.
- **O que o segundo sim ou não do agente permite.** A rota do agente responde dois booleanos:
  há atualização pedida, e esta instalação quer o serviço de WhatsApp. Quem tem conta de dono ou
  administrador no painel, ou quem consegue escrever no banco do painel, consegue fazer o
  servidor baixar e subir o WAHA (a imagem é a que o kit da instalação fixa, nunca uma vinda do
  painel), gastando cerca de 3,2 GB de disco e 360 MB de memória, ou tirar o serviço do ar. Não
  consegue escolher imagem, comando ou endereço, nem apagar o pareamento do número.
- **Mensagem enviada sem conferir o endereço do número.** Antes de enviar pelo número conectado,
  o DeskVoice pergunta ao WhatsApp o endereço certo do destino. Se o WAHA recusar essa consulta
  em si, a mensagem sai para o número como ele é, e a ressalva fica registrada (na linha do tempo
  da chamada, ou no aviso). No Brasil isso pode significar mensagem que não chega, quando o
  WhatsApp guarda o número sem o nono dígito.
- **A atualização pela tela confia no repositório.** O servidor atualiza para a maior tag
  publicada no repositório de onde foi clonado e baixa as imagens dessa versão. Quem controla o
  repositório ou o registro de imagens controla o que a instalação passa a rodar, como já era
  na atualização pelo terminal. As tags não têm assinatura conferida.
- **Motor de voz caído não fala.** Quem está na linha ouve um sinal de aviso e é transferido ou
  desligado. Uma mensagem gravada é melhor e ainda não existe.
- **Nada foi provado com operadora real.** A conversa inteira roda em simulação e a configuração
  carrega num Asterisk de verdade, mas nenhuma ligação por tronco SIP foi feita. Veja a tabela
  "O que ele faz hoje" no [README](README.md).

## Responsabilidade de quem hospeda

Cada instalação é operada por quem a instalou. Atualizar o sistema, restringir o acesso SSH,
guardar backup fora da máquina e proteger as contas dos provedores é responsabilidade do
operador.
