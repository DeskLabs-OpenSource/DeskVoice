# Doutrina de ligações de saída

> Lei sobre **a ligação que o agente faz**: o recurso existe, vem desligado, e só funciona
> dentro de limites que o código impõe. O DeskVoice não é uma ferramenta de disparo em massa e
> não aceita mudança que o aproxime disso.

## O princípio-raiz

Receber uma ligação e fazer uma ligação não são operações simétricas. Quem liga para uma
empresa escolheu ligar. Quem recebe uma ligação de um robô não escolheu nada.

> **Uma ligação de saída interrompe uma pessoa que não pediu. O sistema parte do lado dela.**

Daí vem a regra de desenho: tudo o que protege quem recebe é imposto pelo código, e não deixado
como recomendação.

## Por que o recurso vem desligado

Três motivos, do mais prático ao mais amplo:

1. **A linha de quem usa pode ser bloqueada.** No Brasil, a Anatel bloqueia linhas com padrão de
   chamadas curtas em massa. Uma instalação mal configurada pode custar ao dono o número da
   empresa.
2. **A regra está mudando.** A regulamentação de telemarketing no país está em mudança. O que o
   projeto sabe sobre isso, e com que grau de certeza, está no guia de
   [conformidade no Brasil](../guides/conformidade-brasil.md).
3. **Um padrão ligado decide por quem não leu.** Se o recurso viesse ativo, cada instalação
   seria capaz de discar antes de o dono saber que existem regras.

Desligado de fábrica significa: ligar é um ato consciente, com finalidade declarada e data.

## A lei

### 1. Desligado até o dono ligar, com finalidade declarada

A política de saída de cada organização nasce desativada. Para ativar, o dono da instalação
declara, pela tela, **a finalidade** das ligações e **a base legal** em que se apoia. Sem as
duas declarações, o recurso não liga.

A declaração não é burocracia. É o momento em que a pessoa responsável lê o que está assumindo.

### 2. Cinco limites, sempre conferidos

Toda tentativa de ligação de saída passa por uma checagem única, antes de discar. Ela recusa,
cada recusa com código próprio, quando:

| Limite | O que protege | Valor inicial |
|---|---|---|
| Política desligada | Ninguém liga sem a declaração | Desligada |
| Janela de horário | A pessoa não é chamada fora de hora | Das 9h às 20h, no fuso da organização |
| Lista de não ligar | Quem pediu para não ser chamado não é chamado | Vazia |
| Teto diário por linha | A linha não assume padrão de disparo | 200 chamadas por dia |
| Tentativas por pessoa | Ninguém é perseguido | 3 tentativas |

Os valores iniciais são conservadores e ajustáveis pela tela. **Conservador não quer dizer
conforme.** O valor certo para a sua operação depende da regra aplicável ao seu caso.

### 3. Aviso de gravação

A chamada começa com o aviso de que a conversa é registrada. O aviso é um evento na linha do
tempo, como qualquer outro, o que permite conferir depois que ele foi dado.

### 4. Número se compara normalizado

Um número na lista de não ligar bloqueia a chamada em qualquer formato em que seja digitado. A
comparação é feita depois de converter tudo para o padrão internacional. "(31) 99999-8888" e
"+55 31 99999 8888" são o mesmo número.

### 5. Um caminho só

Só existe uma forma de originar chamada, e ela passa pela checagem. Não se cria um segundo
caminho, nem para teste, nem para "uso interno", nem em ferramenta.

## O que não entra no projeto

Estas mudanças são recusadas na triagem, sem pedido de decisão, pela regra de produto 3 do
[`GOVERNANCE.md`](../../GOVERNANCE.md):

- importação de lista de números para discagem;
- discador automático, preditivo ou progressivo;
- remoção de qualquer um dos cinco limites, ou opção para desativá-los;
- valor inicial mais frouxo que o atual;
- rotação de números de origem para escapar de bloqueio;
- chamada sem identificação do número de origem;
- qualquer caminho que origine chamada sem passar pela checagem.

O argumento "meu caso de uso é legítimo" não muda a resposta. Lembrete de consulta, confirmação
de entrega e retorno de contato pedido cabem dentro dos limites. O que não cabe é volume, e
volume é exatamente o que os limites existem para impedir.

## O que o projeto não faz por você

- **Não interpreta a lei.** O DeskVoice entrega controles. Qual base legal vale para a sua
  operação, e se ela precisa de consentimento prévio, é assunto para quem conhece o seu caso.
- **Não garante que a linha não será bloqueada.** A operadora e a Anatel aplicam critérios
  próprios, que mudam.
- **Não responde pelo uso.** Quem opera a instalação responde pelas ligações que ela faz.

## Verificação

- Um teste cobre cada recusa: política desligada, fora da janela, número na lista de não ligar,
  teto diário atingido, tentativas esgotadas. Cada uma com o seu código.
- Um teste cobre a normalização de números em formato livre antes da comparação com a lista.
- Na revisão: todo PR que toca em origem de chamada mostra que passa pela checagem.

## Documentos relacionados

- [Decisão 0004](../decisions/0004-ligacoes-de-saida-desligadas.md): alternativas descartadas.
- [Conformidade no Brasil](../guides/conformidade-brasil.md): o que conferir antes de ligar o recurso.
