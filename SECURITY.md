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
