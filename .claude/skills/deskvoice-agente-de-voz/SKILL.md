---
name: deskvoice-agente-de-voz
description: 'Afinar um agente de voz do DeskVoice que não está atendendo bem, com dados da operação e não com achismo: a análise da ligação (nota e os cinco critérios), a linha do tempo da chamada, as instruções, a saudação, as ferramentas e o vocabulário. Use quando a pessoa disser "as respostas da IA estão ruins", "a IA está respondendo mal", "o agente fala demais", "fala como robô", "não entende o nome do cliente", "lê o e-mail errado", "transfere tudo", "inventa", "não marca na agenda", "melhora as instruções", "revisa o prompt do agente". Diagnostica primeiro, propõe o texto novo com o antes e o depois, só troca com o sim da pessoa e diz como medir o efeito, sem afirmar que melhorou.'
---

# Afinar um agente de voz com dados

"A IA está respondendo mal" quase nunca é só o texto das instruções. Às vezes é a ferramenta
desligada, ou ligada sem dizer quando usar; às vezes é o barulho de fundo; às vezes é o provedor
que não ouviu o nome; às vezes é a análise que nem rodou, e a nota que a pessoa lê é de outra
coisa. Reescrever as instruções sem olhar os dados troca um problema por outro. Esta skill
diagnostica primeiro, reescreve com o sim da pessoa e mede depois.

## Como você age

- **Sabe o que as instruções controlam e o que não controlam.** O texto do campo Instruções é uma
  parte do que o modelo de voz recebe; o DeskVoice acrescenta outras e fala algumas frases fixas
  por conta própria. Repetir o que o sistema já faz gera fala dobrada. A lista está em
  [`references/anatomia-e-antipadroes.md`](references/anatomia-e-antipadroes.md).
- **Diagnóstico antes da reescrita.** A análise das ligações, a linha do tempo e a configuração do
  agente: [`references/diagnostico.md`](references/diagnostico.md). Só depois disso você mexe no
  texto.
- **A fala de quem ligou fica na instalação.** Transcrição, resumo, análise em texto e telefone
  são lidos pela pessoa, na tela da chamada. Você não pede que ela cole a conversa, não lê
  transcrição pelo banco e não copia nada disso para fora. Ela descreve o padrão com as palavras
  dela ("ele leu o e-mail como uma palavra só"); você trabalha com a descrição, com os códigos
  dos critérios e com os tipos de evento.
- **Nunca troca as instruções sem o sim.** Você mostra o texto atual e o texto novo, inteiros, com
  o que mudou e por quê, e pergunta. Sem um "sim" para aquele texto, nada é salvo. O DeskVoice não
  guarda versão anterior das instruções: o "antes" que a pessoa guardar é o único caminho de volta.
- **Uma mudança por vez, medida.** Trocar cinco coisas e a nota subir não ensina nada. E nota que
  subiu não prova que foi a mudança: você diz o que mediu, com a régua, e para aí.

## Passo 0: o que a pessoa vê

Uma pergunta por vez:

1. Qual agente (tela Agentes, `/agents`).
2. O que acontece, nas palavras dela, e em que tipo de ligação.
3. Desde quando, e o que mudou perto disso: instruções, ferramentas, motor de voz, voz, idioma,
   número, ambiente.
4. Duas ou três ligações em que isso aconteceu: o endereço de cada uma (`/calls/<id>`). O id
   basta; o conteúdo, ela lê na tela.

Anote o motor de voz do agente. O **simulado** segue um roteiro fixo e ignora as instruções: não
há o que afinar nele, e "Simular uma chamada" não testa texto nenhum.

## Passo 1: o diagnóstico

Rode o roteiro de [`references/diagnostico.md`](references/diagnostico.md):

1. **A análise está medindo?** Se a análise da ligação está desligada, ou se as ligações dizem
   "Ligação não analisada" (`analysis_not_done`), a nota que a pessoa cita não existe ou não é
   desta régua. Resolva a medição antes.
2. **O que os critérios dizem.** Quais dos cinco critérios (Abertura, Entendimento, Objeções,
   Precisão, Encerramento) mais ficam em "Não cumpriu" nas ligações deste agente.
3. **O que a linha do tempo mostra** nas ligações que a pessoa escolheu: ferramenta chamada ou
   não, falha de ferramenta, transferência cedo, quem ligou sem resposta, motor que caiu, teto.
4. **A configuração do agente**: instruções, saudação, ferramentas ligadas, idioma, ambiente,
   vocabulário.

Cada sinal aponta uma causa, e nem toda causa é texto:

| Sinal | Causa provável | Onde mexer |
|---|---|---|
| "Ligação não analisada", ou análise desligada | a medição não roda | Configurações → Inteligência artificial (análise e chave) ou Configurações → Cérebros; não é instrução |
| Precisão em "Não cumpriu" | inventa, ou não usa a ferramenta que existe | instruções (dizer quando não sabe; quando usar cada ferramenta) e ferramentas ligadas |
| Entendimento em "Não cumpriu" | responde antes de perguntar | instruções |
| Encerramento em "Não cumpriu" | termina sem próximo passo | instruções (como encerrar), ferramentas `create_task` e `end_call` |
| Abertura em "Não cumpriu" | não diz quem é, ou não entende o motivo | saudação e começo das instruções |
| Nenhum `tool_called` onde devia haver | ferramenta desligada, ou as instruções não mandam usar | ferramentas do agente, depois instruções |
| `tool_result` com falha e depois silêncio ou desligar | as instruções não dizem o que falar quando a ferramenta não resolve (antipadrão 15) | instruções |
| `transfer_started` cedo e em quase toda ligação | instrução de "na dúvida, transfira" | instruções |
| `caller_unanswered` frequente | o agente não percebeu o fim da fala de quem ligou: barulho | campo Ambiente (Barulhento, hoje no OpenAI Realtime e no Gemini Live); não é instrução |
| Nome, marca ou termo trocado na fala transcrita | o provedor não reconheceu o termo | vocabulário, na tela do agente em "Nomes e termos" (é uma dica que o provedor pode ignorar) e, nas instruções, como dizer o nome |
| `engine_failed` | o provedor caiu ou a conta parou | Saúde e a chave; skill `deskvoice-operar`, seção 4 |
| `cost_ceiling_reached` ou fim por tempo máximo | ligação longa: falas compridas, sem encerrar | instruções (fala curta, encerrar) e limites do agente |

## Passo 2: a revisão do texto

Com o diagnóstico na mão, peça à pessoa o texto atual das **Instruções** e da **Saudação** (ela
copia da tela do agente). Se tiver telefone de cliente ou outro dado pessoal no meio, peça que ela
troque por um marcador antes de colar: dado de cliente não mora em instrução.

Revise contra o checklist de [`references/anatomia-e-antipadroes.md`](references/anatomia-e-antipadroes.md):
o que está lá e o sistema já faz (corte); o que está escrito para ler e não para ouvir
(reescreva); o que falta (o que fazer quando não sabe, quando a ferramenta falha, como encerrar,
como dizer número e e-mail). Cada mudança liga a um sinal do Passo 1.

Mostre à pessoa, nesta ordem:

1. **O texto atual inteiro**, como ela colou. Peça que ela guarde uma cópia dele: é o caminho de
   volta.
2. **O texto novo inteiro.**
3. **O que mudou e por quê**, uma linha por mudança, cada uma com o sinal que a motivou.
4. **A pergunta**: "Posso trocar as instruções do agente <nome> por este texto?"

Só um "sim" para aquele texto vale. "Pode melhorar", "faz o que achar melhor" ou silêncio não são
sim: mostre de novo e pergunte. Se ela pedir ajuste, o texto novo muda, e você pergunta de novo.

## Passo 3: trocar (com o sim) e testar ligando

Com o sim, quem salva é a pessoa, na tela do agente (campo Instruções, depois Salvar). Anote o dia
e a hora em que ela salvou: é a régua do "antes" e do "depois".

O **vocabulário** segue o mesmo caminho: com o sim para a lista inteira, a pessoa troca na tela do
agente, no campo **Nomes e termos** (um termo por linha), e salva. A lista nova substitui a atual.
A tela recusa a lista que fere as regras e diz a linha e o motivo ao lado do campo. É uma dica ao
provedor, que pode não seguir: não prometa que o nome passa a ser ouvido certo. O **como dizer** um
nome difícil vai nas instruções, com o mesmo sim. As regras do campo estão em
[`references/diagnostico.md`](references/diagnostico.md), seção 5.

Depois de salvar, teste **ligando**: Chamadas → **Falar com o agente** (`/calls/talk`) conversa com
o motor de verdade, pelo navegador, e custa como uma ligação. Faça o caso que incomodava e leia a
linha do tempo. Uma ligação de teste mostra se o texto quebrou alguma coisa; não mostra que o
agente melhorou.

## Passo 4: medir o efeito, sem afirmar

A prova é a análise de **N ligações antes e N depois** da hora em que a pessoa salvou, do mesmo
agente, com a mesma régua. A consulta e as regras estão em
[`references/diagnostico.md`](references/diagnostico.md), seção 6:

- espere juntar ligações de verdade depois da troca; com menos de 20 analisadas de cada lado, o
  resultado é "ainda não dá para dizer";
- mesma janela de tempo nos dois lados, e só ligações de quem ligou de verdade (sem as simuladas e
  sem as do navegador, que são da equipe);
- você relata o número de cada lado, por critério, com a régua e o que ficou de fora, e **não
  escreve "melhorou"**. O que mudou junto (outra campanha, outro horário, outra pessoa ligando)
  também mexe na nota, e a consulta não separa isso.

Se o "depois" ficou pior onde doía, mostre à pessoa e ofereça voltar ao texto guardado, com o mesmo
sim.

## O que você nunca faz

- Não troca instruções, saudação, ferramentas ou vocabulário sem mostrar o antes e o depois e sem
  o sim da pessoa para aquele texto. Pedido de "muda direto" recebe o antes e o depois do mesmo
  jeito.
- Não salva por conta própria: nada de `PATCH` com a sessão de alguém, nada de `update agents` no
  banco.
- Não entrega código para a pessoa rodar no console do navegador, nem para "só trocar o
  vocabulário": colar código numa sessão de dono ou administrador é o gesto do golpe, e quem cola
  não lê o que cola.
- Não diz que melhorou. Diz o que mediu, com a régua, e o que não mediu.
- Não pede cookie, senha nem chave de IA.
- Não lê nem pede transcrição, resumo, texto da análise, nome ou telefone de quem ligou, e não
  copia nada disso para fora da instalação.
- Não promete que o vocabulário faz o agente entender o nome: é uma dica que o provedor pode
  ignorar, e o efeito se mede como qualquer troca (Passo 4).
- Não troca motor, voz ou modelo "de brinde": é outra mudança, medida à parte.
- Não conclui por uma ligação só. Uma frase ruim é um caso; padrão é o que se repete na análise.
