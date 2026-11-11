# Doutrina de operação de agentes

> Lei sobre **como agentes de código trabalham neste repositório**: Claude Code, Codex, Cursor,
> Antigravity ou qualquer outro, operados por mantenedor ou por contribuidor. Ela não trata do
> agente de voz que atende ligações. Trata do agente que escreve o código.

## Por que existe

O DeskcommCRM foi construído, em boa parte, por agentes de código operando em paralelo. Isso
funcionou e deixou lições caras. A mais cara: **um agente apagou o checkout principal.** O
comando estava certo para a pasta em que o agente achava que estava. Ele estava em outra.

As regras abaixo vêm de erros desse tipo. Nenhuma é teórica.

## O princípio-raiz

> **Um agente erra com a mesma confiança com que acerta. O ambiente precisa tornar o erro
> barato.**

Não se pede ao agente que nunca erre. Arruma-se o trabalho para que o erro caia numa cópia
descartável, seja visto por outro par de olhos e não leve junto o trabalho de ninguém.

## As leis

### 1. Agente trabalha em worktree descartável, nunca no checkout principal

Cada tarefa de um agente acontece num worktree próprio do git, criado para ela e apagado ao fim.
O checkout principal é de quem opera a máquina e não é lugar de trabalho de agente.

- Um erro num worktree custa o worktree.
- Dois agentes em worktrees diferentes não pisam um no outro.
- O que está no checkout principal, incluindo trabalho não commitado de uma pessoa, fica fora do
  alcance.

### 2. Comando destrutivo, só com caminho absoluto conferido

Antes de qualquer comando que apague, sobrescreva ou reescreva histórico:

1. O alvo é escrito com **caminho absoluto**. Nunca `.`, `..`, `~` ou uma variável que possa
   estar vazia.
2. O agente **confere onde está e o que é o alvo**: lista o conteúdo, confirma que é o worktree
   da tarefa e não o checkout principal.
3. Só então executa.

Comandos que entram nesta lei: apagar pasta ou arquivo de forma recursiva, limpar arquivos não
rastreados, descartar mudanças locais, forçar envio, reescrever histórico, apagar ramo, apagar
volume ou banco.

Uma variável vazia transforma "apague a pasta temporária" em "apague a raiz". O caminho absoluto
conferido é o que impede isso.

### 3. Trabalho não fica só no disco

Trabalho que existe apenas num disco local não existe. Um worktree some, uma máquina reinicia,
um agente é interrompido.

- Ao fim de cada etapa que vale a pena guardar, o agente faz commit.
- Ao fim da tarefa, o trabalho está num ramo enviado ou num PR, conforme a permissão que o
  operador deu.
- O relatório final diz **onde** o trabalho está: ramo, commit, PR.

Enviar para o remoto continua dependendo de autorização de quem opera. A lei não é "envie
sempre". É "não declare terminado o que só existe no seu disco".

### 4. Quem implementa não verifica

O agente que escreveu o código não é quem atesta que ele funciona. O autor confere o que
pretendia fazer, e não o que fez.

- A verificação é feita por outro agente ou por uma pessoa, **sem o contexto do autor**: recebe
  o código e o que ele deveria fazer, e não a explicação de por que está certo.
- Vale para PR de contribuidor e para PR de mantenedor.
- "Rodei os testes que eu mesmo escrevi" é implementação, e não verificação.

### 5. O verificador mede sozinho

O verificador não aceita a medida do autor. Ele roda os comandos de novo, lê a saída e conclui
por conta própria.

- "Os testes passam", vindo do autor, é uma afirmação a conferir.
- O verificador diz o que rodou, o que viu e o que **não** conseguiu medir.
- Se a verificação falhar por problema do ambiente, o achado não se perde: fica registrado como
  "não verificado", e não como "verificado" nem como "descartado".

### 6. Há sempre um papel adversário

Em toda entrega relevante, alguém tem a tarefa explícita de **tentar provar que está errado**.
Não de revisar com boa vontade: de procurar o caso que quebra.

O papel adversário pergunta: qual é o caso de fronteira que o autor não testou? O que acontece
se a chamada cair exatamente aqui? O que acontece se dois processos fizerem isto ao mesmo tempo?
O teste falharia se o código estivesse errado?

Sem esse papel, vários agentes concordando entre si produzem confiança, e não evidência.

### 7. Prova por sabotagem, só em cópia descartável

A melhor forma de saber se um teste protege alguma coisa é quebrar o código de propósito e ver
se o teste reprova. Isso se chama prova por sabotagem, e é bem-vinda.

Ela acontece **somente** numa cópia descartável: um worktree criado para isso e apagado depois.
Nunca no ramo de trabalho, nunca no checkout principal. Uma sabotagem esquecida num ramo de
trabalho é um defeito plantado com cara de código normal.

O relatório de uma prova por sabotagem diz o que foi quebrado, que teste reprovou e que a cópia
foi apagada.

## O que mais vale para um agente

- **Não inventar.** Capacidade, estado, decisão e fato externo se conferem na fonte. É a regra
  final do [`AGENTS.md`](../../AGENTS.md).
- **Decisão de produto não é do agente.** Faltou regra? Pedido de decisão, no formato do
  [`GOVERNANCE.md`](../../GOVERNANCE.md), com o padrão que vale sem resposta.
- **Segredo e dado pessoal não entram** em código, teste, log ou mensagem de commit.
- **O relatório expõe os erros.** Todo relatório final tem quatro partes: o que foi feito, o que
  foi feito sem ter sido pedido, os erros cometidos no caminho e o que ficou em aberto.

## Para quem opera agentes

| Antes de soltar um agente | Por quê |
|---|---|
| Ele está num worktree, e não no checkout principal? | Lei 1 |
| O que ele não pode fazer sem perguntar está escrito na tarefa? | Envio, merge, apagar, gastar |
| Há outro agente ou uma pessoa para verificar? | Leis 4 e 5 |
| Alguém tem o papel adversário? | Lei 6 |
| Você sabe onde o trabalho vai ficar guardado? | Lei 3 |

## Verificação

Parte desta doutrina é cobrada por máquina: a varredura de segredo no CI e no hook, e a fila de
merge, que impede envio direto à `main`. O resto é disciplina de quem opera, e é por isso que
está escrito.
