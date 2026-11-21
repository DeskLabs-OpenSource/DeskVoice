# O que o modelo de voz recebe, e os antipadrões de instrução para voz

As instruções do agente são escritas para ouvir, não para ler. Quem liga não relê, não rola a
tela e não vê negrito: ouve uma frase de cada vez e pode interromper. E o texto do campo
Instruções não chega sozinho ao modelo.

## O que o DeskVoice monta a cada ligação

**As instruções que o motor recebe**, nesta ordem (`composeInstructions`, em
`apps/voice/src/call-session.ts`, e `instructionsWithVocabulary`, em
`packages/voice-engine/src/vocabulary.ts`):

1. O campo **Instruções** do agente, byte a byte (até 20.000 caracteres).
2. Se o agente pode passar a ligação a outros ("Pode passar a ligação para"): a lista desses
   agentes, com nome e papel, para a ferramenta `transfer_to_agent`.
3. Se o número de quem ligou tem notas ou pendências abertas: o bloco delimitado com a memória do
   número (as notas que o agente guardou e as pendências abertas), que é dado e nunca instrução.
   Vale para toda ligação desse número, com ou sem passagem: não escreva "lembre o que o cliente
   pediu da última vez" nas instruções, e não estranhe o agente citar uma pendência.
4. Se a ligação veio de outro agente: uma frase dizendo quem passou, e o motivo e o resumo da
   passagem acrescentados ao mesmo bloco do item 3.
5. Se o agente tem vocabulário: a frase "Names and terms that may come up in this call, spelled as
   written: …", com os termos.
6. "Speak only in <idioma>", com o idioma da conversa do agente.

**As ferramentas** chegam ao modelo com a descrição que mora no arquivo de cada uma, em
`packages/tools/src/tools/`. A descrição já diz como usar (a `agenda_horarios_livres`, por
exemplo, já manda ler até três opções em voz alta). As instruções dizem **quando**, em termos do
negócio: "se a pessoa quiser remarcar, veja os horários livres". Só ferramenta ligada no agente
chega ao modelo.

**O que o sistema fala sozinho**, sem passar pelas instruções (`apps/voice/src/call-session.ts`):

| Quando | O que é dito |
|---|---|
| Ligação recebida, ao atender | o aviso de gravação e a **Saudação** do agente, juntos, como a primeira fala |
| Ligação de saída, ao atender | o aviso de gravação |
| Chegou à duração máxima | uma despedida fixa, e a ligação encerra |
| Chegou ao teto de custo | uma despedida fixa (ou o aviso de transferência, se houver número de transferência) |
| Uma ferramenta quebrou | o modelo recebe a ordem de dizer que não foi possível agora e oferecer outra forma de ajudar |
| Quem ligou falou e ficou sem resposta | a guarda de silêncio pede ao modelo que responda e, se ele seguir calado, que peça para repetir (`caller_unanswered`) |

**Depois da ligação**, a análise lê as falas transcritas e os nomes das ferramentas chamadas
(`classify_call_outcome`), e não as instruções. A nota mede a conversa, não o texto.

## O que as instruções controlam

Quem o agente é e para quem fala; o que ele resolve sozinho e o que não resolve; o que perguntar
antes de responder; o que dizer nas situações comuns do negócio; quando usar cada ferramenta, pelo
que ela faz; quando e para quem passar a ligação; o que falar quando não sabe ou quando uma
ferramenta não resolve; como dizer número, e-mail, valor e data; como encerrar com um próximo
passo; o tamanho de cada fala.

## Antipadrões de instrução para voz

Nenhum destes foi contado em ligações do DeskVoice. Vêm do que o código monta (acima), da tabela
de antipadrões do `AGENTS.md` (o 15) e do que a fala impõe. Quando um aparecer no diagnóstico, a
medida é a do Passo 4.

| Antipadrão | O que tende a acontecer | O conserto |
|---|---|---|
| Instrução escrita para tela: tópicos, negrito, tabela, emoji, link | o modelo imita o formato e fala lista, símbolo ou endereço que ninguém anota | frases corridas, como se dita a alguém; "nunca use listas, símbolos ou links na fala" |
| Fala comprida: parágrafo inteiro, três perguntas de uma vez | quem liga se perde, interrompe, e a ligação alonga (custo e teto) | "no máximo duas frases por vez; uma pergunta por vez; espere a resposta" |
| Telefone, e-mail, endereço, valor e data escritos como no papel, sem dizer como falar | o número sai como um valor inteiro, o e-mail como uma palavra só | "diga telefone em grupos de dois ou três dígitos; e-mail com 'arroba' e 'ponto'; valor e data por extenso"; e "repita de volta o que anotou e peça confirmação" |
| A falha sem fala (antipadrão 15): nada sobre o que dizer quando não sabe ou quando a ferramenta devolve que não deu | silêncio, invenção (Precisão em "Não cumpriu") ou a pessoa desliga | "se não souber, diga que não sabe e ofereça [anotar o pedido / passar para a equipe]"; "se não houver horário, diga isso e ofereça outro dia" |
| "Na dúvida, transfira" | transfere quase tudo, cedo | nomeie as situações que vão para pessoa; no resto, perguntar e resolver |
| Ferramenta ligada sem instrução de quando usar | é chamada na hora errada (skill `deskvoice-operar`, seção 1) | uma frase por ferramenta ligada, pelo que ela faz no negócio |
| Instrução que manda fazer o que nenhuma ferramenta ligada faz ("marque na agenda" sem as de agenda) | o agente promete o que não cumpre | ligue a ferramenta, ou troque por "anote o pedido para a equipe" (`create_task`) |
| Repetir o que o sistema já fala: aviso de gravação, saudação, despedida por tempo ou teto, "fale em português" | a fala sai dobrada (o aviso duas vezes, a saudação duas vezes) | corte; a saudação mora no campo Saudação, o aviso em Configurações → Privacidade e dados ("Aviso de gravação"), o idioma no campo do agente |
| Negar que é uma IA, ou mandar fingir ser pessoa | conflita com o aviso de gravação e com o guia de conformidade | não mande negar; a saudação pode dizer que é uma assistente virtual ([`conformidade-brasil.md`](../../../../docs/guides/conformidade-brasil.md)) |
| Marcadores como `{{nome}}` ou `[cliente]` esperando ser trocados | o DeskVoice não substitui nada nas instruções; o modelo fala o marcador ou se confunde | texto direto |
| Dado de cliente, telefone pessoal ou senha no texto | vai ao provedor em toda ligação e não sai com o prazo de guarda | tire; o número de transferência tem campo próprio |
| Lista de nomes difíceis no meio das instruções, esperando que o agente passe a ouvir certo | não muda a transcrição; o campo para isso é o vocabulário | os nomes no vocabulário (dica que o provedor pode ignorar); **como dizer** um nome difícil, nas instruções, por extenso |
| Instruções enormes, com todo caso possível | mais texto para o provedor a cada sessão e mais chance de o modelo se perder (Custos: skill `deskvoice-operar`, seção 5) | o essencial em uma tela; o que for raro vira "anote e a equipe retorna" |

## Checklist de revisão (marque cada linha com o trecho das instruções)

1. Quem é, em uma frase: nome, de onde, para quem atende.
2. O que resolve sozinho, e o que não resolve.
3. Antes de responder: o que perguntar, uma pergunta por vez.
4. As três a cinco situações mais comuns do negócio: "se X, faça Y".
5. Cada ferramenta ligada: quando usar, pelo que ela faz. Nenhuma instrução para ferramenta
   desligada.
6. Quando passar para uma pessoa ou para outro agente: por situação, nunca "na dúvida".
7. O que falar quando não sabe, e quando uma ferramenta não resolve (antipadrão 15).
8. Como dizer e como confirmar número, e-mail, valor e data.
9. Como encerrar: um próximo passo combinado, e então `end_call`, se estiver ligada.
10. Tamanho da fala: curta, sem lista, sem símbolo.
11. Nada que o sistema já faz (aviso, saudação, idioma, despedidas), nada de marcador, nada de dado
    de cliente.
12. Cabe em uma tela? Se não, o que sai?
