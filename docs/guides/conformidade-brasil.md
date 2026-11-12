# Conformidade no Brasil

Leia este guia antes de ligar o recurso de ligações de saída, e antes de colocar um agente
para atender em nome de uma empresa.

> **Este guia não é aconselhamento jurídico.** Ele foi escrito por quem constrói software, e não
> por advogados. Ele diz o que o DeskVoice controla, o que ele não controla e o que você precisa
> conferir na fonte oficial. **Quem opera a instalação responde pelo uso que faz dela.** Para
> uma operação concreta, procure quem conhece o seu caso.

## O que sabemos, e com que certeza

O projeto separa o que leu do que ouviu dizer.

| Afirmação | Fonte | Grau de certeza |
|---|---|---|
| A Anatel bloqueia linhas com padrão de chamadas curtas em massa | Conhecimento público sobre a atuação da agência | Alto quanto ao fato. Os critérios exatos mudam: confira na Anatel |
| Novos critérios de bloqueio valem a partir de 12/11/2026 | **Segundo noticiado pela imprensa** | **Não conferido.** O projeto não leu o texto oficial |
| A MP 1.396/2026 trata do tema e ainda aguarda regulamentação | **Segundo noticiado pela imprensa** | **Não conferido.** O projeto não leu o texto oficial |
| A LGPD se aplica ao tratamento de dados pessoais em ligações | Lei 13.709/2018 | Alto quanto à aplicação. Como ela se aplica ao seu caso depende do caso |

Data desta revisão: 10/11/2026. Se você está lendo isto meses depois, considere tudo
desatualizado até conferir.

### Onde conferir

- **Anatel:** o site oficial da agência, para as regras de telemarketing e os critérios de
  bloqueio de linhas.
- **Texto da medida provisória e sua situação:** o portal de legislação do Planalto e o do
  Congresso Nacional.
- **ANPD:** a Autoridade Nacional de Proteção de Dados, para orientações sobre a LGPD.
- **A sua operadora:** ela aplica regras próprias de uso do tronco, e é quem bloqueia a linha na
  prática. Pergunte por escrito quais são os limites do seu plano.

Não confie em resumo de vídeo, de blog ou deste guia para uma decisão que pode custar o número
da empresa.

## Ligações recebidas

Atender ligações com um agente de IA tem menos risco regulatório do que fazer ligações, mas não
tem risco zero. Três pontos:

### 1. A conversa é registrada

A fundação do DeskVoice **não grava o áudio**. Ela guarda a **transcrição** da conversa e os
eventos da chamada. Transcrição de conversa com uma pessoa identificável é dado pessoal.

O que o sistema faz: a chamada começa com um aviso de que a conversa é registrada, e o aviso
fica marcado na linha do tempo.

O que cabe a você: garantir que o texto do aviso corresponde ao que você faz com o dado, e
definir por quanto tempo guarda as transcrições e quem tem acesso a elas.

### 2. A pessoa está falando com uma IA

Considere dizer isso na saudação. Além de ser uma prática transparente, evita a frustração de
quem descobre no meio da conversa. Se existe obrigação legal de informar no seu setor, confira.

### 3. Dados sensíveis

Clínicas, escritórios de advocacia e serviços financeiros lidam com dados que têm proteção
adicional. Antes de pôr um agente para atender nesses ramos:

- defina o que o agente **não** deve perguntar nem registrar;
- lembre que a conversa passa pelo provedor de IA que você contratou, sob os termos dele. Leia
  esses termos, em especial sobre retenção e uso dos dados;
- os dados da instalação ficam na sua VPS. O DeskVoice não envia telemetria.

### 4. O que sai do país, e para onde

Se você atende em nome de outra empresa — clínica, escritório, financeira — a primeira pergunta
do contrato costuma ser esta: *onde ficam os dados?* A resposta tem duas partes, e elas não se
confundem.

| O que | Para onde | Como sabemos |
|---|---|---|
| Áudio e transcrição da chamada, motor `gemini-live` | Google — o provedor **não publica** a lista de países de processamento da Gemini Developer API | pedido oficial em aberto no fórum do Google (02/11/2026); quem precisa de região usa Vertex AI, com região explícita |
| Áudio e transcrição da chamada, motor `openai-realtime` | OpenAI — depende do **projeto/região** escolhidos na conta (há data residency nos Estados Unidos, na Europa, no Reino Unido, no Japão, entre outros) | documentação da OpenAI sobre os seus dados, consultada em 12/11/2026 |
| Chamada com o motor `simulated` | **Nada sai**: roda neste servidor | código do motor |
| Banco, transcrições e gravações | a sua VPS, no país do contrato dela | a instalação |

Três cuidados, e o primeiro é o que mais se erra:

1. **Transferência internacional é regulada** — Resolução CD/ANPD nº 19/2024; entre os caminhos
   estão as cláusulas-padrão contratuais. Qual usar é decisão de quem opera, com o advogado
   dela; não é escolha do DeskVoice.
2. **"Servidor no Brasil" não é argumento sozinho**: o banco pode estar no Brasil e o áudio sair
   para fora do mesmo jeito. As duas informações são independentes.
3. **Não prometa região que o provedor não declara.** É por isso que a tela de Configurações →
   motor diz "o provedor não declara o país" em vez de escrever um país: informação sem fonte e
   sem data envelhece calada, e o contrato continua valendo.

## Ligações de saída

É aqui que mora o risco maior.

### O recurso vem desligado

Uma instalação nova do DeskVoice não consegue fazer ligações. Para ligar o recurso, o dono da
instalação declara, pela tela, **a finalidade** das ligações e **a base legal** em que se apoia.

Leve essa declaração a sério. Escreva a finalidade real, de forma que um terceiro entenda. Se
você não sabe que base legal preencher, esse é o sinal para procurar orientação antes de
ligar.

### Os cinco controles

Depois de ligado, toda tentativa de chamada passa por estes controles. Os valores iniciais são
conservadores e ajustáveis.

| Controle | O que faz | Valor inicial |
|---|---|---|
| Teto diário por linha | Recusa novas chamadas ao atingir o limite do dia | 200 chamadas |
| Lista de não ligar | Recusa chamada para número cadastrado, em qualquer formato digitado | Vazia |
| Janela de horário | Recusa chamada fora do horário permitido | Das 9h às 20h, no fuso configurado |
| Tentativas por pessoa | Recusa nova tentativa depois do limite | 3 tentativas |
| Aviso de gravação | Informa, no início, que a conversa é registrada | Sempre |

**Os valores iniciais não são a norma.** São uma escolha do projeto. A regra aplicável ao seu
caso pode exigir menos chamadas, outro horário ou restrições que o sistema não conhece, como
dias da semana e feriados. Confira e ajuste.

### O que conferir antes de ligar o recurso

- [ ] Li a regra vigente da Anatel sobre telemarketing e bloqueio de linhas, na fonte oficial,
      com a data de hoje.
- [ ] Sei se a minha operação se enquadra como telemarketing ativo. Lembrete de compromisso
      marcado pelo próprio cliente e oferta de produto são coisas diferentes.
- [ ] Sei se preciso de consentimento prévio das pessoas para quem vou ligar, e tenho como
      demonstrá-lo.
- [ ] Sei se há exigência de numeração ou de identificação específica para o meu tipo de
      chamada.
- [ ] Sei se há cadastro de bloqueio que devo consultar para o meu setor.
- [ ] Perguntei à operadora, por escrito, os limites de uso do meu tronco.
- [ ] Tenho um jeito de a pessoa pedir para não ser mais chamada, e alguém responsável por
      incluir o número na lista de não ligar.
- [ ] Ajustei teto, janela e tentativas ao que a regra pede, e não ao que eu gostaria.
- [ ] A finalidade e a base legal declaradas na tela correspondem ao que eu faço.

Se algum item ficou sem resposta, não ligue o recurso ainda.

### Chamadas curtas

O padrão que leva ao bloqueio, segundo o que se conhece da atuação da Anatel, é o de muitas
chamadas de poucos segundos: a ligação que desliga quando a pessoa atende, ou que a pessoa
desliga na hora.

O que reduz esse padrão, além dos controles do sistema:

- ligar só para quem espera a ligação;
- a primeira frase do agente dizer quem é e por que está ligando;
- não insistir. O limite de tentativas existe para isso.

### O que o DeskVoice não faz

- **Não consulta cadastros externos de bloqueio.** A lista de não ligar é a da sua instalação,
  mantida por você.
- **Não conhece feriados nem regras por dia da semana.**
- **Não avalia se a sua finalidade é lícita.** Ele registra o que você declarou.
- **Não garante que a linha não será bloqueada.** A operadora e a Anatel decidem com critérios
  próprios.
- **Não faz disparo em massa**, e não vai fazer. Importação de lista para discagem e discador
  automático são recusados pelo projeto. Veja a
  [doutrina de ligações de saída](../doctrine/ligacoes-de-saida.md).

## Guardar e apagar

A transcrição da conversa é dado pessoal, e hoje fica no banco até alguém apagá-la. **Não existe
expurgo automático** no DeskVoice: não há prazo embutido e nenhuma rotina que apague sozinha. Quem
responde pelos dados é você, e o prazo é decisão sua. A LGPD não fixa um número.

Três lugares guardam dado tirado da conversa, e não só a transcrição:

- **a transcrição**, nos eventos da chamada;
- **o resumo da chamada**, que é escrito a partir da conversa;
- **os argumentos das ferramentas** que o agente usou, por exemplo o texto de uma mensagem enviada
  por WhatsApp, que ficam na linha do tempo.

E **os backups** (`install/backup.sh` guarda os 14 mais recentes) levam tudo isso junto, até serem
descartados. Apagar do banco não apaga dos backups que já existem.

Hoje também não há tela nem comando para entregar a uma pessoa o que a instalação guarda sobre ela.
O pedido dela se atende à mão.

O projeto decidiu, em 12/11/2026, que o prazo de guarda e a entrega dos dados de uma pessoa virão
pela tela, por organização e com registro de quem fez. Até essa versão sair, vale o que está escrito
acima.

## Para implementadores

Se você instala o DeskVoice para clientes:

- **A decisão de ligar o recurso de saída é do cliente**, e a declaração de finalidade deve ser
  dele. Não a preencha em nome dele sem que ele leia.
- **Não venda conformidade.** Você entrega controles e orientação sobre onde conferir.
- **Deixe por escrito**, na entrega, quem é o responsável pela operação e pela lista de não
  ligar.
- **Mantenha as contas no nome do cliente:** número, tronco, provedor de IA.

Mais em [ganhar dinheiro implementando](ganhar-dinheiro-implementando.md).

## Como este guia é mantido

Este guia vai ficar desatualizado, e o projeto sabe disso. Encontrou algo errado, ou leu o texto
oficial que nós não lemos? Abra um PR citando a fonte oficial e a data da consulta. Afirmação
sobre regra sem fonte oficial não entra, e as que estão marcadas como "segundo noticiado"
continuam marcadas assim até alguém conferir.

O motivo da posição do projeto está na
[decisão 0004](../decisions/0004-ligacoes-de-saida-desligadas.md).
