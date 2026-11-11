# Doutrina do sistema vivo

> Lei de arquitetura. Não é aspiração: é critério de aceite. Todo PR que acrescenta uma peça
> responde às perguntas deste documento antes do merge.

## O princípio-raiz

O DeskVoice é um sistema vivo, não um atendedor de chamadas com telas. A missão dele cabe em uma
frase:

> **Chegou uma ligação. O sistema é responsável por ela até o assunto ter um desfecho
> registrado, e não só até a pessoa desligar.**

Nas palavras do criador do projeto: tudo tem um porquê, nenhuma peça é ilha, toda peça se
conecta a pelo menos duas outras, tudo tem log, e onde a IA termina o humano continua com
contexto, e vice-versa.

A palavra que organiza tudo é **autonomia**: um sistema com elementos, conexões e um propósito,
em que agentes agem sozinhos dentro de limites e chamam o humano quando precisam.

## Os sete invariantes

Cada invariante é uma pergunta que a peça responde antes do merge. Se não responde, ela ainda
não está viva.

### 1. Tudo tem um porquê

Toda peça existe por uma necessidade de quem liga, de quem atende ou de quem opera. "Pode ser
útil" não é um porquê.

- **Pergunta:** quem sente falta se esta peça sumir amanhã?
- **Onde fica escrito:** na descrição do PR. Se a peça muda a arquitetura, num registro em
  `docs/decisions/`.

### 2. Regra das duas conexões: nenhuma peça é ilha

Toda peça tem ao menos uma entrada e uma saída reais no sistema. Alguém a aciona, e ela alimenta
alguma coisa.

- **Vivo:** a ferramenta `request_approval` é acionada pelo modelo durante a chamada, cria o
  pedido, gera o aviso no painel, grava eventos na linha do tempo e devolve ao agente o que
  dizer.
- **Morto:** uma rota de API que nenhuma tela chama. Uma ferramenta que executa e não registra
  nada. Uma tabela que só recebe escrita.
- **Pergunta:** o que aciona esta peça, e o que ela alimenta? Cite os dois.

### 3. Tudo tem log, e o log tem tela

O que acontece numa chamada vira um evento em `call_events`, com um tipo do vocabulário fechado.
Essa tabela é a linha do tempo da chamada **e** a fonte da tela. Log que só existe no banco é
log morto.

- **Pergunta:** que evento esta mudança grava, e em que tela ele é lido?
- **Consequência:** um acontecimento novo pede um tipo novo no vocabulário, e não um texto solto
  dentro de outro evento.

### 4. Continuidade nas duas direções

- **IA → humano.** Quando o agente para (transfere, avisa, pede aprovação), o humano recebe
  contexto pronto: a pergunta, o que já foi dito, o que está em jogo. Não a conversa crua para
  ele decifrar.
- **Humano → IA.** Quando o humano decide, a decisão volta para a chamada em forma que o agente
  entende, com o que ele deve dizer a quem está na linha.
- **Ninguém respondeu.** O pedido expira no prazo, vale a resposta padrão que o dono definiu, e
  o agente é informado e segue.
- **Pergunta:** quando esta peça passa o bastão, o que quem recebe sabe?

### 5. Nada termina em silêncio

Ao telefone, silêncio é o pior defeito: quem ligou não tem tela para ver o erro. Todo caminho de
falha tem duas saídas obrigatórias: um sinal para quem está na linha e um evento para o painel.

- **Motor de voz cai no meio da chamada:** a pessoa ouve um sinal de aviso (o motor caído não
  consegue falar; uma desculpa gravada está no roadmap), a chamada é transferida ou encerrada, e a linha do tempo mostra `engine_failed`.
- **Chave de IA ausente ou inválida:** a chamada é recusada com motivo, e o painel avisa.
- **Ferramenta sem conector configurado:** devolve erro claro ao agente. Nunca finge que deu
  certo.
- **Pergunta:** se isto falhar, quem ligou ouve o quê, e o operador vê o quê?

### 6. A ligação termina, o trabalho não

O que precisa acontecer depois da chamada vira tarefa na fila: resumo, aviso, webhook. Tarefa
tem tentativas, erro registrado e evento de desfecho. Promessa feita ao telefone não depende de
alguém lembrar.

- **Pergunta:** o que esta chamada deixou combinado, e que tarefa cumpre o combinado?

### 7. Autonomia com limite visível

O agente age sozinho dentro de limites que o dono da instalação enxerga e ajusta pela tela: as
ferramentas que cada agente pode usar, a duração máxima, o teto de custo por chamada, a política
de ligações de saída.

- **Pergunta:** qual é o limite desta capacidade, e em que tela o dono o ajusta?
- **Consequência:** capacidade que gasta ou que age para fora do sistema, sem limite
  configurável, não entra.

## A lista do PR

Copie para a descrição do PR quando a mudança acrescenta uma peça:

```markdown
- [ ] Porquê: quem sente falta se isto sumir
- [ ] Duas conexões: o que aciona, o que é alimentado
- [ ] Evento gravado e tela onde é lido
- [ ] Passagem de bastão: o que quem recebe sabe
- [ ] Falha: o que quem ligou ouve, o que o painel mostra
- [ ] Depois da chamada: tarefa que cumpre o combinado (se houver)
- [ ] Limite: qual é, e onde se ajusta
```

Item que não se aplica se marca com "não se aplica" e o motivo. Não se deixa em branco.

## O que esta doutrina não é

Não é pedido de mais código. Na maior parte das vezes, cumprir os invariantes significa ligar a
peça ao que já existe (`recordEvent`, `enqueueTask`, uma tela que já lê eventos), e não criar
estrutura nova. Uma peça que precisa de muita estrutura para ficar viva costuma estar no lugar
errado.

## Documentos relacionados

- [`um-arquivo-por-peca.md`](um-arquivo-por-peca.md): onde cada peça mora.
- [`isolamento.md`](isolamento.md): de quem é cada dado.
- [`ligacoes-de-saida.md`](ligacoes-de-saida.md): o limite mais sensível do sistema.
