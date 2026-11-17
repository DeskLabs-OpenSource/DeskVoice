# Filtro de fala

O filtro de fala lê o texto do que a pessoa fala na ligação e faz duas coisas:

- **marca** a fala que pode ser de fundo (TV, rádio, outra pessoa na sala), com a confiança;
- **sugere** a leitura provável de um termo do vocabulário do agente, quando a transcrição pode ter
  escrito errado um nome ("meu gasto" no lugar de "Melgaço"). A sugestão só aparece com confiança
  de 0,8 ou mais.

**Ele só marca e sugere.** Nenhuma decisão apaga fala nem troca o que a pessoa disse: o texto
ouvido continua na linha do tempo, e a marca e a sugestão aparecem ao lado dele. A ligação nunca
espera o filtro. Uma decisão que chega depois do turno, ou que não chega no prazo de 1 s, fica na
linha do tempo como observação e não muda nada.

O filtro vem **desligado**. Quem já instalou não vê diferença até alguém ligá-lo. Desligado, a
ligação é a mesma de antes: nenhum pedido sai, e nenhuma linha nova aparece na linha do tempo.

O desenho completo está em `docs/specs/2026-11-14-transcricao-pura.md`, na parte 3 (ainda no PR
#198, fora da `main`).

## Ligar

Em **Configurações → Filtro de fala**. Só dono ou administrador muda; os outros papéis veem.

1. Em **Chaves dos modelos**, cole a chave do Jev e clique em **Salvar e testar**. A chave fica
   cifrada no banco e nunca volta para a tela. O teste pede a lista de modelos da conta, sem custo
   de token, e diz o resultado (aceita, recusada, sem crédito, e assim por diante).
2. Em **Modelo de decisão**, escolha **Jev (TypeSafe)**.
3. Leia o aviso **Para onde vai o texto** e marque a confirmação: "O texto da ligação vai para a
   TypeSafe." O que vai, em detalhe, está em "O que sai do servidor", logo abaixo.
4. Clique em **Salvar**. A tela passa a mostrar quem confirmou o envio e quando.

Sem a confirmação, o Jev não salva. Cada confirmação nova deixa um recibo em **Configurações →
Privacidade**, no registro: quem confirmou, quando e para qual fornecedor vai o texto. Desligar
(escolher **Nenhum**) ou trocar de modelo tira a confirmação vigente, e ligar de novo pede outra; o
recibo fica no registro.

## O que sai do servidor

O Jev é da TypeSafe AI e roda fora deste servidor. A cada fala de quem ligou, vai um pedido com:

- a fala de quem ligou, como a transcrição a escreveu;
- a última fala do agente, quando houver;
- as perguntas do filtro, que são fixas, e, quando o agente tem vocabulário, até quatro termos dele
  parecidos com a fala.

O custo de cada pedido entra no custo da chamada, pelo preço do arquivo do modelo (US$ 0,042 por
milhão de tokens de entrada, saída grátis, conferido em 16/11/2026). Quando o pedido sai e o consumo
não volta (atrasado, sem rede, resposta fora da forma), o custo é estimado pela entrada enviada,
marcado como estimado, e conta no teto da chamada.

## O que a TypeSafe diz que faz com o texto

Fonte: a política de privacidade da TypeSafe,
<https://typesafe.ai/legal/privacy-policy> ("Last updated Nov 19, 2025"), lida em 16/11/2026.

- **Retenção:** a TypeSafe guarda os dados pessoais que recebe, como esse texto, pelo tempo que for
  razoavelmente necessário para prestar o serviço ou para os fins comerciais dela. A política não
  define prazo.
- **Exclusão:** a pedido, ela apaga esses dados ou os guarda de um jeito que não identifique a
  pessoa, quando eles não forem mais razoavelmente necessários, salvo se a lei a obrigar a
  guardá-los por mais tempo.
- **Lugar:** o serviço é hospedado nos Estados Unidos.

O projeto não leu o contrato da TypeSafe nem as páginas que pedem login.

## Pedir a exclusão à TypeSafe

A página não traz um canal próprio para o pedido de exclusão. O contato que ela dá para dúvidas
sobre o tratamento dos dados é **privacy@typesafe.ai**. Escreva para esse endereço a partir da
conta da TypeSafe da sua organização (a dona da chave), diga quais dados quer apagados (por exemplo,
os enviados entre duas datas) e guarde a resposta. Pela política, a exclusão depende de duas
condições: os dados não serem mais razoavelmente necessários para a TypeSafe, e nenhuma lei a
obrigar a guardá-los por mais tempo. Ela não promete prazo para atender.

Desligar o filtro não apaga o que já foi enviado: só para os envios novos. O apagamento do
DeskVoice (prazo de guarda e pedido de quem ligou) também não alcança a TypeSafe.

## Na linha do tempo

- **Pode ser fala de fundo (confiança 0,82):** embaixo da fala, que continua inteira.
- **Leitura provável: Melgaço (confiança 0,91):** embaixo da fala, que continua como foi ouvida.
- **Observação do filtro de fala:** a decisão que chegou depois do turno, como "a pessoa tinha
  terminado o pensamento". Ela não mudou nada.
- **O filtro de fala não respondeu no prazo**, ou **não leu esta fala** (com o motivo, como a chave
  ausente): a ligação seguiu sem ele.
