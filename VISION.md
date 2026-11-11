# Visão do DeskVoice

> **Central telefônica open source operada por agentes de IA, instalada na VPS de quem usa.**
> Este documento é a fonte do posicionamento do projeto. Tudo o que for público (README, site,
> descrições, vídeos) deriva daqui.

## A tese

**A ligação não é o produto. É o começo de um trabalho.**

Quando alguém liga para uma empresa, quer que algo aconteça: marcar, remarcar, saber onde está
o pedido, falar com a pessoa certa. A conversa por voz é só a parte audível. O trabalho de
verdade é o que acontece durante e depois: consultar um sistema, avisar alguém, pedir uma
autorização, registrar o que foi combinado, cumprir o combinado.

Um robô que atende bem e não faz nada é uma secretária eletrônica cara. O DeskVoice existe para
o resto: o agente atende, executa ferramentas no meio da conversa, chama um humano quando
precisa, transfere quando é o caso e deixa tarefas rodando depois que a pessoa desliga.

## O nome

**Desk** é a mesa de trabalho, a mesma do DeskcommCRM. **Voice** é o canal. A ideia que o nome
carrega: a voz chega a uma mesa onde pessoas e agentes trabalham juntos, e sai de lá com o
assunto encaminhado.

## A palavra central: autonomia

Autonomia, aqui, tem definição. É um sistema com **elementos**, **conexões** e um **propósito**,
em que agentes agem sozinhos **dentro de limites** e chamam o humano quando precisam.

Cada parte da frase tem uma peça correspondente no código:

| Na frase | No sistema |
|---|---|
| Agem sozinhos | O agente atende, decide que ferramenta usar e conduz a conversa |
| Dentro de limites | Teto de custo e de duração por chamada, lista de ferramentas por agente, política de ligações de saída |
| Chamam o humano | Aviso, pedido de aprovação com prazo, transferência |
| Propósito | Toda chamada termina com um desfecho registrado e, se for o caso, tarefas na fila |

Autonomia sem limite é risco. Limite sem autonomia é um menu de opções com voz. O projeto vive
no meio.

## Sistema vivo

O DeskVoice herda do DeskcommCRM a doutrina do sistema vivo, nas palavras de quem o criou:

- **Tudo tem um porquê.** Nenhuma peça entra porque "pode ser útil".
- **Nenhuma peça é ilha.** Toda peça se conecta a pelo menos duas outras.
- **Tudo tem log.** O que aconteceu numa chamada está na linha do tempo, e a linha do tempo está
  na tela.
- **Onde a IA termina, o humano continua com contexto. E vice-versa.** Quem recebe uma
  transferência sabe o que já foi dito. Quando o humano decide algo, o agente recebe a decisão
  e segue.

A versão verificável dessas frases, com as perguntas que um PR precisa responder, está em
[`docs/doctrine/sistema-vivo.md`](docs/doctrine/sistema-vivo.md).

## O que acreditamos

1. **Agente que trabalha, não voz que enfeita.** A medida de uma chamada é o que ficou feito
   quando ela acabou.
2. **Humano no comando, no meio da ligação.** O agente pergunta "posso dar este desconto?" a uma
   pessoa de verdade enquanto o cliente espera na linha, e a resposta volta para a conversa.
   Se ninguém responder no prazo, vale a resposta padrão que o dono definiu.
3. **Silêncio é defeito.** Se o modelo de IA cai, quem ligou ouve um pedido de desculpa e é
   transferido ou a chamada é encerrada. A tela mostra o que houve. O agente nunca fica mudo
   sem que alguém saiba.
4. **Custo à vista.** Cada chamada mostra quanto custou, e há teto. Conta de IA não pode ser
   surpresa de fim de mês.
5. **O telefone é um canal regulado.** Ligar para as pessoas tem regra, e o sistema nasce do
   lado de quem respeita a regra. Ligações de saída vêm desligadas, e o projeto não aceita nada
   que facilite disparo em massa.
6. **Configurar é pela tela.** Se um recurso exige SSH para ser ligado, ele não está pronto.

## Para quem

- **Negócios que atendem por telefone** e perdem ligação fora do horário, na hora do almoço ou
  quando a recepção está ocupada: clínicas, escritórios, imobiliárias, oficinas, prestadores de
  serviço.
- **Implementadores**: quem instala, configura e mantém o sistema para esses negócios, e cobra
  por esse serviço.
- **Quem desenvolve**: gente que quer contribuir com um projeto de voz e IA em que uma
  ferramenta nova é um arquivo, e não uma semana de leitura de código.

## Modelo do projeto, sem letra miúda

- **100% open source, licença MIT.** Não existe versão paga. Não existe recurso travado.
- **Você paga a sua infraestrutura:** a VPS, as suas chaves de IA e a sua telefonia. Nada disso
  passa pelo projeto.
- **Parceria de infraestrutura declarada.** A HostGator é a parceira do projeto, e a VPS dela é
  a recomendação conveniente. O link de parceria aparece identificado como tal.
- **O caminho genérico nunca é sabotado.** Docker em qualquer VPS, pelo mesmo comando, com o
  mesmo resultado. A recomendação é um atalho, nunca um pedágio.
- **Sem telemetria.** A instalação não envia dados de uso a ninguém.
- **Quem instala pode cobrar.** Implementar e manter o DeskVoice para clientes é um negócio
  legítimo, e o projeto não pede parte dele.

## Relação com o DeskcommCRM

O DeskcommCRM já tem telefonia com IA, como módulo. Esse módulo continua existindo. O DeskVoice
é um sistema independente em que a telefonia é o centro, e não uma função de outro produto.
Mais adiante, o módulo do Deskcomm vira um conector para o DeskVoice.

Os dois projetos compartilham criador, doutrina e fábrica de contribuição. Não compartilham
banco, instalação nem dependência: cada um funciona sozinho.

## O que seria fracasso

Mesmo funcionando, o projeto teria falhado se:

- o agente ficasse mudo sem avisar ninguém na tela;
- alguma capacidade exigisse SSH para ser ligada;
- a instalação dissesse "pronto" com a ligação muda;
- o custo de uma chamada não aparecesse ou não respeitasse teto;
- o sistema facilitasse disparo em massa.

## Como falamos

1. **Palavra-chave primeiro, jargão depois.** "Central telefônica", "agente de IA", "open
   source", "na sua VPS" antes de qualquer nome interno.
2. **Mostrar, não descrever.** Uma chamada simulada rodando vale mais que um parágrafo. Por isso
   o motor simulado existe.
3. **Estado real.** Pronto, experimental e roadmap nunca se misturam na mesma lista.
4. **Português profissional e calmo.** Sem adjetivo vazio, sem promessa de data, sem exagero.
5. **O teste da troca.** Se uma frase continuar verdadeira trocando "DeskVoice" pelo nome de
   outro produto, ela é genérica e sai.

## Norte

Que uma pequena empresa brasileira consiga ter, na própria VPS e sem mensalidade de software,
um atendimento telefônico que resolve o assunto de quem ligou. E que haja uma comunidade de
implementadores e contribuidores vivendo disso e melhorando o sistema em público.

---

*Última revisão: 2026-11-10, na fundação do projeto.*
