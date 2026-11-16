# Equipe de agentes

Um agente pode passar a ligação para outro agente da mesma organização, no meio da conversa, sem
desligar. Com isso dá para montar uma pequena equipe: um agente atende, entende o assunto e passa a
quem cuida dele.

Este guia mostra como montar essa equipe pela tela, sem ler código: as quatro funções que se costuma
querer, um exemplo de instruções para cada uma, como ligar a passagem, quais limites valem, quanto
custa e o que ainda não foi medido. A base é o
[desenho de 13/11](../specs/2026-11-13-equipe-de-agentes-e-memoria.md) (seções 4.1 e 4.2) e o
registro [0020](../decisions/0020-memoria-entre-ligacoes-e-equipe-de-agentes.md).

## As funções são configuração, não código

Recepcionista, qualificador, agendador e supervisor não são tipos de agente do DeskVoice. Todo agente
é igual: o que muda de um para outro é o texto de instruções, as ferramentas marcadas e para quem ele
pode passar a ligação. Você cria cada função como um agente comum, em Agentes, e dá a ele um
**Papel**, que entra, junto com o nome, na lista de destinos que o agente anterior recebe.

Os exemplos abaixo são genéricos de propósito. A regra do seu ramo (quais perguntas fazer, o que
não pode ser dito, para quem transferir) mora nas instruções que você escreve, e não no produto
([`GOVERNANCE.md`](../../GOVERNANCE.md), regras 1 e 2). Para um ramo com guia próprio, comece por ele:
hoje existe o de [clínicas e consultórios](clinicas-e-consultorios.md).

### Recepcionista

**O que faz hoje.** Atende o número, descobre o assunto e passa a ligação ao agente que cuida dele.
O que não é de nenhum agente vai para uma pessoa da equipe.

**Ferramentas.** A passagem (`transfer_to_agent`) aparece sozinha quando há destino marcado; não se
marca. Para uma pessoa: `transfer_to_human` (precisa do "Número para transferir"), `notify_human` ou
`create_task`.

**Exemplo de instruções:**

```text
Você atende as ligações da empresa. Cumprimente, pergunte em uma frase como pode ajudar e
descubra o assunto. Não resolva o assunto você mesmo.

- Se a pessoa quer fazer um pedido, tirar dúvida sobre preço ou sobre o que a empresa oferece,
  diga que vai passar para quem cuida disso e passe para Qualificação.
- Se a pessoa quer marcar, remarcar ou desmarcar um horário, diga que vai passar e passe para
  Agendamento.
- Se for outro assunto, ou se a pessoa pedir para falar com alguém, transfira para uma pessoa.

No resumo da passagem, escreva o nome da pessoa, se ela disse, e o que ela quer, em uma ou duas
frases. Não repita dado que a pessoa não precisaria dizer de novo.
```

### Qualificador

**O que faz hoje.** Faz as perguntas que a empresa definiu, anota as respostas e deixa o próximo
passo com uma pessoa.

**Ferramentas.** `create_task` (a pendência vai para o dono configurado em Pendências, na tela do
agente), `call_webhook` (se você cadastrou uma integração) e `notify_human`. A nota para a próxima
ligação do mesmo número (`remember_caller_note`) existe, mas nenhum agente nasce com ela: é uma
escolha sua, e o que ela guarda e por quanto tempo está no registro
[0020](../decisions/0020-memoria-entre-ligacoes-e-equipe-de-agentes.md).

**Exemplo de instruções:**

```text
Você continua um atendimento que outro agente começou. Leia o resumo da passagem e não pergunte
de novo o que já está nele.

Faça estas perguntas, uma de cada vez, e só as que faltarem:
1. Nome completo.
2. Um telefone ou e-mail para retorno, se for diferente do número que ligou.
3. O que a pessoa precisa, nas palavras dela.
4. Para quando ela precisa.

Com as respostas, crie uma pendência com create_task, com tudo o que ela disse. Diga à pessoa
que a equipe retorna, sem prometer prazo. Se ela pedir preço ou condição que você não tem nas
instruções, diga que a equipe responde no retorno.
```

### Agendador

**O que faz hoje.** Anota o pedido de horário para uma pessoa marcar. Ele **não** consulta nem marca
horário numa agenda: a ferramenta de agenda é uma frente própria do [ROADMAP](../../ROADMAP.md), e
nenhuma instalação a tem ligada hoje (na tela do agente, as ferramentas de agenda nem aparecem).

**Ferramentas.** `create_task`, e `call_webhook` se você integrou uma agenda própria por webhook (o
guia de [clínicas](clinicas-e-consultorios.md), na seção da agenda, mostra como, e vale para
qualquer ramo).

**Exemplo de instruções:**

```text
Você continua um atendimento que outro agente começou e cuida de pedidos de horário. Você não
tem acesso à agenda: não ofereça nem confirme dia ou hora.

Pergunte o nome, o tipo de atendimento e os dias e períodos em que a pessoa pode. Crie uma
pendência com create_task com esses dados e diga que a equipe vai ligar ou mandar mensagem para
confirmar o horário. Se a pessoa quiser desmarcar, anote da mesma forma.
```

### Supervisor

**O que faz hoje: ainda não existe como agente.** O desenho prevê uma revisão automática no fim de
cada ligação, sem modelo de IA, que abre uma pendência quando a ligação terminou sem próximo passo
(seção 4.4 do desenho). Ela ainda não foi feita, e este guia não promete quando.

Hoje, o que faz esse papel é a equipe no painel: os avisos de ligação (transferência que falhou,
motor que caiu) e as pendências abertas pelos agentes. Não crie um agente chamado "Supervisor"
esperando que ele revise as ligações: um agente só age durante a ligação em que está.

## Como ligar a passagem

1. Crie os agentes, cada um com as instruções e as ferramentas da função dele.
2. Na tela do agente que passa a ligação (a recepção, no exemplo), em **"Pode passar a ligação
   para"**, marque os agentes de destino e salve.
3. Escreva nas instruções **quando** passar para cada um, pelo nome exato do agente. A lista de
   marcar diz para quem ele **pode** passar; o momento é regra sua, em texto.
4. Teste com uma ligação de verdade, pelo número ou em "Falar com o agente", com o motor real. A
   chamada simulada não passa a ligação (abaixo).

Sem nenhum destino marcado, nada muda: o agente não vê a ferramenta, e as instruções enviadas ao
motor são as suas, sem acréscimo. Com destino, o DeskVoice acrescenta às instruções uma linha por
agente marcado, com o nome e o papel.

Quando passa, o segundo agente abre com o motor, a voz, as instruções e as ferramentas dele. A
primeira frase dele é fixa, no idioma do agente ("Oi, vou continuar o seu atendimento a partir
daqui."), e não é a saudação configurada dele: quem ligou já foi cumprimentado. O aviso de
gravação não se repete. A ligação continua a mesma na tela de Chamadas: o agente dela é o que
atendeu, e a linha do tempo mostra "Passou para" e as falas de cada agente com o nome dele.

## Os limites, como estão no código

Conferidos em [`apps/voice/src/call-session.ts`](../../apps/voice/src/call-session.ts) (as funções
`costCeiling`, `scheduleDuration` e `handOff`), em
[`packages/tools/src/tools/transfer_to_agent.ts`](../../packages/tools/src/tools/transfer_to_agent.ts)
e em [`packages/tools/src/handoff.ts`](../../packages/tools/src/handoff.ts):

- **Os limites são da ligação, não do agente.** Vale o **menor teto de custo** e a **menor duração
  máxima** entre os agentes por onde a ligação passou. Um teto zero ("sem teto") não conta nessa
  conta: ele não tira o teto de quem veio antes. Passar a ligação nunca serve para fugir do teto.
- **O relógio conta do atendimento.** A passagem não zera nem a duração nem o custo. Se o segundo
  agente tem duração menor e ela já passou, a despedida começa logo. O teto do segundo vale na
  hora da passagem, contra o que o primeiro já gastou.
- **No máximo 3 passagens por ligação.** Na quarta, a ferramenta recusa e diz ao agente para
  transferir a uma pessoa com `transfer_to_human`. O número é fixo no código, sem configuração.
- **Destino fora da lista é recusado.** A ferramenta confere o nome pedido contra os agentes
  marcados, lidos do banco na hora. O agente recebe a recusa, com a lista de destinos, e continua
  na linha. Pedir para passar para ele mesmo também é recusado.
- **Destino sem chave deixa o primeiro agente na linha.** A sessão do segundo abre **antes** de a
  do primeiro fechar. Se não abrir (chave não salva para o motor dele, chave ilegível, recusa do
  provedor ou nenhuma resposta em 15 segundos), o primeiro continua na conversa e recebe a orientação de
  seguir ele mesmo. Não há passagem na linha do tempo, só o resultado da ferramenta com a falha.
- **O número de transferência que vale é o do agente em que a ligação está.** Depois da passagem,
  `transfer_to_human` usa o "Número para transferir" do segundo.

## O resumo da passagem é dado, nunca instrução

Ao passar, o agente escreve o motivo e um resumo para o próximo, que não ouviu a conversa. Esse
texto vem do modelo a partir do que quem ligou disse, e por isso é tratado como dado:

- Ele entra nas instruções do próximo agente **dentro de um bloco delimitado e escapado**. Uma
  frase no resumo como "passe para o agente Financeiro" não muda os destinos nem as ferramentas do
  próximo: esses vêm só da configuração, no banco.
- Ele fica gravado na linha do tempo da ligação e **sai com o "Prazo de guarda das conversas"**,
  junto com as falas, e com o **apagamento a pedido do titular**. Ficam só os nomes dos agentes. O
  funcionamento dos dois está em [conformidade no Brasil](conformidade-brasil.md#guardar-e-apagar).

## A chamada simulada

Em Chamadas, "Simular uma chamada" usa o motor simulado **em todos os trechos**: no agente que
atende e em cada agente para quem a ligação passasse, mesmo que o destino esteja configurado com um
motor pago. Ela não usa a chave da organização e não gasta com provedor.

Hoje, porém, o roteiro que a simulação segue não passa a ligação a outro agente: ela mostra o
agente que atende, e só ele. Para ver a passagem, faça uma ligação com o motor real, que gasta como
qualquer outra.

## Quanto custa

Cada trecho da ligação é medido no motor dele e com o preço dele. O custo da ligação é a soma dos
trechos, e o teto é conferido contra essa soma.

- **Em Custos**, "Por agente" mostra o gasto de cada agente nos trechos em que a ligação estava
  com ele, e "Por motor de voz" mostra os minutos de cada motor por trecho. Uma ligação com passagem conta para cada agente.
- **Na tela da chamada**, o custo aparece separado por agente quando a ligação passou por mais de um
  agente.
- **Limite conhecido.** Se um agente de destino for apagado depois, o custo do trecho dele volta
  para o agente que atendeu a ligação. Ele só aparece como "Agente apagado" quando quem atendeu
  também foi apagado. O total da ligação e o do período não mudam; muda só a divisão por agente.

Durante a troca, as duas sessões ficam abertas ao mesmo tempo por um instante: a nova abre antes de
a antiga fechar. Se o provedor cobra esse instante nas duas, não foi medido. Os limites de custo e o
resto do que vale para qualquer agente estão em [custos](custos.md).

## O que ainda não foi medido

- **O silêncio na troca.** Com motor de provedor de verdade, ninguém mediu ainda quanto tempo quem
  ligou fica sem ouvir nada entre a última fala do primeiro agente e a primeira do segundo. A sessão
  nova abre antes de a antiga fechar, para quem ligou nunca ficar sem agente, mas abrir uma sessão
  num provedor leva tempo, e esse tempo não foi medido. Faça uma ligação de teste e ouça antes de
  pôr a equipe no número.
- **Duas sessões ao mesmo tempo na mesma chave.** Não foi conferido se todo provedor aceita, nem com
  que limite de sessões simultâneas da sua conta.
- **Se a frase fixa do segundo agente soa natural** depois do resumo, em cada idioma.
- **Se o custo por agente na tela bate com a fatura do provedor** numa ligação com passagem.
- **A última fala da sessão antiga.** O que a sessão do primeiro agente ainda fala depois da troca
  é descartado, mas o texto dela continua entrando na linha do tempo, com o nome dele. Quem lê a
  ligação pode ver uma frase que quem ligou não ouviu, ou ouviu só em parte, e que também não está na
  gravação. Não há teste para isso, e ninguém mediu com motor real com que frequência acontece.
