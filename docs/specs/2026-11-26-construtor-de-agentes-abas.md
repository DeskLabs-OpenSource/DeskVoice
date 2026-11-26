# A tela do agente em abas, com os cartões Ouvido, Cérebro e Voz e um painel lateral por peça

- **Estado:** desenho. Nenhum código antes do de acordo da revisora neste PR e da resposta do dono
  às escolhas de cada fatia (seção 8).
- **Data:** 2026-11-26
- **Quem pediu:** o dono, em 26/11, na sessão do orquestrador. Ele pediu que a tela do agente, que
  hoje é uma página só com tudo junto, passe a ter abas organizadas por função, e que a transcrição,
  o cérebro e a voz virem três peças separadas, cada uma configurada num painel lateral que abre ao
  clicar.
- **Base medida:** `origin/main` em `8b56c79` (o #578, a pilha do pipeline até a 5c). Arquivos,
  linhas e nomes citados foram conferidos nesse commit, salvo os marcados como **novo**.
- **A referência:** capturas de tela do construtor de assistentes de outro produto, guardadas
  só na máquina de testes. Elas não entram no repositório. O que serviu delas está descrito em
  palavras na seção 2. Daqui só se aproveita a **organização**. A aparência, os nomes, os ícones e
  os textos seguem a [direção do painel](../design/direcao-do-painel.md).

## 0. Duas partes, dois caminhos

Este desenho separa duas coisas, porque elas seguem caminhos diferentes (combinado com o maestro
em 26/11):

- **O que já existe e só muda de lugar.** Segue com a revisora, neste PR. É o inventário (seção
  1), a mecânica das abas (4.2 a 4.4), a regra de só mostrar número medido (5.2, que vem do
  `AGENTS.md` e não é escolha), o componente do painel lateral e a acessibilidade dele (5.3), a
  confirmação da 9.1 só mostrada (5.3, que vem da R5), as fatias (6) e os testes (6.2).
- **As escolhas de tela que o dono não fez.** Cada uma é um pedido de decisão na seção 8, no
  formato do `GOVERNANCE.md`, com a recomendação e o padrão sem resposta. O maestro leva os
  pedidos para a pasta do dono. São quatro:
  - **D1.** Quais abas, e em qual aba fica cada campo (a tabela 4.1).
  - **D2.** O que cada cartão mostra, nos motores diretos e no pipeline (5.1 e 5.2).
  - **D3.** O que sai da tela de hoje (o bloco Pipeline, "Cérebros deste agente", a página e o
    link dos testes, a âncora `#pipeline`).
  - **D4.** Se o painel lateral tem um Salvar próprio (5.3).

Nas seções 4 e 5, o que depende de uma escolha está marcado com o número dela, e o texto descreve
a **recomendação**. **Nenhuma fatia de código começa antes da resposta da escolha de que ela
depende** (tabela da seção 6).

## 1. Problema

A tela do agente (`apps/panel/src/app/(app)/agents/[id]/page.tsx`, 629 linhas) empilha **doze
painéis** num formulário só, com um botão Salvar no rodapé. Quem quer trocar a voz passa pela
identidade, pela conversa e pelo vocabulário. Quem quer mudar o que acontece quando a ligação cai
desce a página inteira. As três peças de uma ligação (ouvir, pensar e falar) aparecem misturadas
em painéis com outros nomes: "Voz" (motor, voz, idioma e ambiente de escuta), "Vocabulário",
"Pipeline" e "Cérebros deste agente". Os testes do agente moram em outra página, com um link no
topo.

### 1.1 O que existe na tela hoje, na ordem em que aparece

| # | Painel (rótulo do dicionário) | Campos e avisos | De onde vem |
|---|---|---|---|
| 0 | Cabeçalho | voltar, nome do agente, aviso de só leitura, link "Testes do agente" (só agente salvo) | `page.tsx:260-271` |
| 1 | Identidade (`t.identity`) | nome (obrigatório), função, chave "ligado" | `page.tsx:274-287` |
| 2 | Conversa (`t.conversation`) | saudação, instruções | `page.tsx:289-298` |
| 3 | Vocabulário (`t.vocabulary`) | um termo por linha, contador, erro ao lado e foco no erro ao salvar | `page.tsx:300-313` |
| 4 | Voz (`t.voice`) | motor (`EngineField`: os diretos e o Pipeline desligado, com o motivo), voz (`VoiceField`: grupo provedor e motor, Ouvir, linha da ElevenLabs com âncora `#pipeline`), idioma (obrigatório), ambiente de escuta (só nos motores provados, com o aviso e o "voltar para Normal"), aviso de motor sem chave, linha do motor simulado | `page.tsx:315-376` |
| 5 | Pipeline (`t.pipeline`) | só para ver e ouvir, fora do salvar: latência p50 medida (com e sem ferramenta, aviso acima da meta), transcrição que falta, aviso da 9.1, cérebro com `chat` e chave aceita, modelo com preço, vozes da ElevenLabs com Ouvir e o aviso da 9.1 por voz | `pipeline-block.tsx` |
| 6 | Cérebros deste agente (`t.brains`) | quem conversa (o motor, sem seletor), quem lê a ligação (organização, motor ou cérebro e modelo, com busca e avisos), linha do analista ao vivo | `brains.tsx` |
| 7 | Analista ao vivo (`t.analyst`) | escolha do analista, aviso do motor sem `guide`, link | `page.tsx:395-417` |
| 8 | Ferramentas (`t.tools`) | caixas, uma por ferramenta de `/tools` | `page.tsx:419-440` |
| 9 | Transferência (`t.transfer`) | número, "volta para o agente" | `page.tsx:443-451` |
| 10 | Limites (`t.limits`) | minutos (obrigatório), teto de custo (obrigatório), "ainda está aí?" | `page.tsx:452-465` |
| 11 | Passar a ligação (`t.handoff`) | outros agentes, três linhas de regra | `page.tsx:468-494` |
| 12 | Pendências (`t.followUps`) | dono das pendências, quando a ligação cai (com os motivos de indisponível e os links), mensagem do WhatsApp | `page.tsx:496-594` |
| — | Rodapé | Salvar fixo, Apagar com a confirmação que nomeia quem perde o destino | `page.tsx:597-626` |

Os testes do agente ficam em `/agents/[id]/tests` (`tests/page.tsx`, 260 linhas, fatia 7c).

### 1.2 O que a pilha do pipeline pôs e o que ela **não** pôs

- **Pôs:** o campo do motor com o Pipeline desligado, e o motivo (`no_live_transcriber`). O bloco
  Pipeline só para ver e ouvir. A p50 da latência por agente
  (`GET /api/v1/agents/[id]/pipeline-latency`, só turnos do pipeline, o turno inteiro).
- **Custo por peça:** existe **por ligação**, no detalhe da chamada (`calls/[id]/piece-costs.tsx`,
  campo `costByPiece`), e somado em Custos. **Não existe por agente.** A latência também **não
  existe por peça**: o `pipeline_turn_latency` mede o turno inteiro.
- **Não pôs:** gravar o pipeline pela tela. Até a fatia 6, nada do bloco entra no salvar, e o motor
  continua desligado.

### 1.3 O que a tela não tem, e que as abas sugeridas citam

- **As ligações deste agente:** `GET /api/v1/calls` filtra só por status (`calls/route.ts:6`). Não
  há filtro por agente.
- **Voz e transcrição reserva:** não existem.
- **Privacidade, aviso de gravação e webhook:** existem, mas valem para a organização inteira, e não
  por agente (`settings/privacy`, `settings/recording-notice-panel.tsx`, `settings/integrations`,
  `webhooks.allowed`).
- **MCP:** a tela dos servidores (#563) e a aprovação por ferramenta (#565) ainda são rascunho. Não
  conferi se as ferramentas MCP já aparecem em `/tools`.
- **Abas e painel lateral no kit:** o `kit.tsx` não tem nenhum dos dois, e nenhuma tela do painel
  usa `role="tablist"` ou `role="dialog"`.

## 2. A referência, descrita em palavras

- **A tela principal** tem uma faixa no topo com o custo por minuto e a latência somados, e uma
  barra colorida por peça. Embaixo ficam três cartões lado a lado (transcrição, modelo e voz). Cada
  cartão traz o provedor, a latência, o custo e uma nota própria da peça (taxa de erro, um índice de
  inteligência, uma nota de naturalidade), e um lápis de editar. Por último vem o prompt de sistema.
- **O clique no cartão** abre um painel encostado na direita. A página continua visível à esquerda,
  e o cartão aberto fica marcado. No painel da voz há o modelo de voz, a voz com etiquetas, a
  velocidade, o som de fundo, um dicionário de pronúncia e uma seção avançada fechada.
- **As outras abas** são: as chamadas do assistente, com filtros; a divisão de tráfego entre
  versões; as ferramentas, com extração estruturada e nota da conversa; as simulações; e uma aba
  avançada (reservas, privacidade, webhook).

**O que vale aproveitar:** uma aba por função; as três peças como três cartões de mesmo peso; o
cartão como resumo e o painel como lugar de editar, sem sair da página.

**O que não se aproveita:** os números da faixa e dos cartões. Na referência, eles aparecem antes de
qualquer chamada, e o DeskVoice não tem de onde tirá-los (seção 5.2). A regra final do `AGENTS.md`
proíbe número que não foi medido.

## 3. As regras de produto (conferidas em `GOVERNANCE.md` de `origin/main`)

| Regra | Esta mudança |
|---|---|
| Núcleo ou peça opcional | Núcleo: é a tela do agente. Nenhum provedor novo e nenhum código de nicho |
| Disparo em massa | Não facilita. A aba Ligações só lista as ligações, sem ação em lote e sem discar |
| SSH para ligar recurso | Não pede |
| Recurso pago, telemetria | Nenhum |
| Quem já instalou não é surpreendido | Nenhum dado muda, nenhuma configuração nova, e todo endereço antigo continua abrindo (seção 4.4). **Mas os campos mudam de lugar.** O fragmento traz a tabela "onde estava → onde está", e os pedidos D1 e D3 da seção 8 decidem a casa de cada campo e o que sai |

## 4. As abas

### 4.1 A proposta (escolha D1)

Esta tabela é a recomendação do pedido D1. A mecânica das seções 4.2 a 4.4 vale para qualquer
lista de abas que o dono escolher.

Seis abas, cada uma com uma função. A sugestão da tarefa tinha cinco. Separei **Depois da ligação**
de Ferramentas porque o painel já usa esse nome: Configurações tem a área "Depois da ligação"
(`settings/after-call`). Ferramentas fica sendo só o que o agente faz **durante** a ligação.

| Aba | Função | O que vai nela (só o que existe) |
|---|---|---|
| **Agente** | quem é e como conversa | Identidade (nome, função, ligado, **idioma**); a linha do motor; os três cartões **Ouvido, Cérebro e Voz** (na fatia 2); Conversa (saudação e instruções) |
| **Ligações** | o que aconteceu | as ligações deste agente, com o filtro de status que a lista geral já tem, e o link para cada uma. **Novo:** filtro `agentId` em `GET /calls` (fatia 5) |
| **Ferramentas** | o que ele faz durante a ligação | ferramentas; transferência (número e volta); passar a ligação para outro agente; analista ao vivo |
| **Depois da ligação** | o que fica | quem lê a ligação (a escolha que hoje está em "Cérebros deste agente"); dono das pendências; quando a ligação cai, e a mensagem do WhatsApp |
| **Testes** | conferir antes de pôr no ar | a tela dos testes do agente de hoje (`tests/page.tsx`), sem mudar nada |
| **Avançado** | limites e o que vale para a organização | limites (minutos, teto de custo, "ainda está aí?"); uma linha com link para cada configuração da organização que afeta o agente: privacidade, aviso de gravação e webhooks. Os três links já existem no menu, e nenhum campo novo entra |

**Por que o idioma vai para a Identidade:** ele vale para as três peças (o que se ouve, o que se
responde e a amostra da voz). Se ficasse dentro de um painel de peça, ficaria escondido.

**O agente novo** (`/agents/new`) mostra Agente, Ferramentas, Depois da ligação e Avançado.
Ligações e Testes aparecem depois de salvar, porque não existem sem id. Hoje o link dos testes
também só aparece com o agente salvo.

### 4.2 A mecânica: abas dentro da página, sem rota nova

- **Uma página, um formulário, um Salvar.** As abas Agente, Ferramentas, Depois da ligação e
  Avançado são pedaços do mesmo `<form>` de hoje. A aba fechada fica montada, com `hidden`. O
  rascunho (`Draft`) não muda, nada se perde ao trocar de aba, e o corpo do `PATCH` sai igual ao de
  hoje. Trocar de aba nunca salva nada.
- **O endereço da aba:** `?aba=<id>` (`agente`, `ligacoes`, `ferramentas`, `depois`, `testes`,
  `avancado`), trocado com `router.replace`. O link pode ser copiado, e o Voltar do navegador
  continua saindo da tela. Sem `aba`, ou com um valor desconhecido, abre Agente. Por isso todo
  `page.goto("/agents/<id>")` dos testes de hoje cai no mesmo lugar.
- **Ligações e Testes** montam só na primeira vez que a aba abre: elas leem dados que as outras
  não usam.
- **O Salvar do rodapé** aparece nas quatro abas do formulário. Em Ligações e Testes ele some, e a
  tela dos testes tem os botões dela: dois "Salvar" na mesma tela confundiriam. Se o rascunho tem
  mudança não salva, essas duas abas mostram uma linha "Há mudanças não salvas" com o botão de
  voltar para a aba onde a mudança está.
- **Campo obrigatório em aba fechada.** Hoje o navegador barra o envio e põe o foco no campo
  inválido. Com o campo dentro de um `hidden`, ele barra o envio **sem dizer nada**, porque não
  consegue pôr o foco num campo escondido. Por isso o `<form>` ganha um `onInvalidCapture`: ele acha
  o `tabpanel` do campo, abre a aba dele, põe o foco no campo e chama `reportValidity()`. Isso vale
  para os quatro obrigatórios de hoje: nome e idioma (Agente), minutos e teto (Avançado). Vale
  também para o modelo obrigatório de quem lê a ligação (Depois da ligação). O foco no erro do
  vocabulário (`page.tsx:212`) passa a abrir a aba do campo antes. Na fatia 2, o campo vai para o
  painel do Ouvido, que abre antes.

### 4.3 Acessibilidade das abas

O padrão de abas da ARIA (Authoring Practices, "Tabs with automatic activation"):

- `role="tablist"` com `aria-label` (o nome do agente); cada aba é um `<button role="tab">` com
  `aria-selected` e `aria-controls`; cada painel é `role="tabpanel"`, com `aria-labelledby` e
  `tabIndex={0}`.
- Só a aba ativa entra no Tab (`tabIndex` 0, as outras -1). As setas esquerda e direita trocam de
  aba, e Home e End vão para a primeira e a última.
- A aba ativa é marcada por um traço embaixo, na cor do texto (`border-ink`), como o filtro ativo
  da lista de ligações. **Não é cobre:** pela direção, o cobre fica com o que está vivo e com a ação
  principal. O contorno de foco é o de sempre.
- Em tela estreita, a lista de abas rola na horizontal, sem quebrar em duas linhas, e a aba ativa
  rola para a vista.
- O movimento entre abas é instantâneo, e por isso não precisa de caminho de movimento reduzido.

### 4.4 Endereços antigos

- `/agents/[id]` abre a aba Agente.
- `/agents/[id]/tests` passa a redirecionar para `/agents/[id]?aba=testes`, no cliente, com
  `router.replace`, sem quebrar o favorito de ninguém.
- A âncora `#pipeline` (a linha da ElevenLabs no campo Voz, `voice-field.tsx:572`) continua
  funcionando na fatia 1. Na fatia 3, ela deixa de ser âncora: a linha vira um botão que abre o
  painel da Voz.

## 5. Os cartões Ouvido, Cérebro e Voz (aba Agente)

### 5.1 A forma (escolha D2)

Logo abaixo da Identidade vem a linha do **motor** (o `EngineField` de hoje, sem mudança), e embaixo
dela, três cartões de mesmo peso, lado a lado em tela larga e empilhados no celular:

- **Ouvido:** o que transcreve a fala de quem ligou.
- **Cérebro:** o que decide a resposta.
- **Voz:** o que fala.

Cada cartão é um `<button type="button">` inteiro, com `aria-haspopup="dialog"`. O nome acessível é
o título do cartão, e o resumo entra como `aria-describedby`. Por dentro, o cartão segue o `Panel`
do kit (borda `line`, raio `md`, sem sombra, borda `muted` no hover, como o link dos testes de
hoje). O ícone sai do Phosphor, `duotone`: um ouvido, um cérebro e um alto-falante (ou o ícone mais
próximo que a biblioteca tiver). Não há lápis: o cartão inteiro é o botão, e a última linha diz
"Configurar". Quando o rascunho mudou alguma coisa da peça, aparece um selo neutro "não salvo".

Embaixo dos cartões vem **Conversa** (saudação e instruções), sem mudança.

### 5.2 Os números: só os medidos

A faixa de resumo e os cartões só mostram o que existe medido no banco. Fora disso, aparece a
palavra **"não medido"**. Nunca um traço solto, nunca um zero, nunca uma estimativa de tabela de
preço feita na tela.

| Número | De onde vem | Onde aparece | Sem dado |
|---|---|---|---|
| Resposta, p50, sem ferramenta | `GET /agents/[id]/pipeline-latency` (existe, 5c), o turno inteiro | Faixa de resumo, com o número de turnos e de ligações, como hoje no bloco. Aviso quando passa da meta | "sem medida ainda" (o texto da 5c) |
| Resposta, p50, com ferramenta | a mesma rota | Faixa, linha menor | some, como hoje |
| Custo deste agente, por peça | **novo** `GET /agents/[id]/costs?days=30`, a mesma leitura do extrato que o detalhe da chamada e Custos já usam (`costByPiece`, `Amount` com `unmeasuredCount` e `estimatedCount`), filtrada pelo agente | No cartão da peça: o total nos últimos 30 dias e quantas ligações | "não medido" quando a peça não tem linha. "estimado" quando o `Amount` já diz isso |
| Custo deste agente, total | a mesma rota nova | Faixa de resumo | "não medido" |
| Latência por peça | **não existe**: o `pipeline_turn_latency` mede o turno inteiro | Não aparece no cartão | — |
| Nota própria da peça (erro da transcrição, inteligência, naturalidade) | não existe | Não aparece | — |
| Custo por minuto | não existe por agente. Daria para calcular a partir das durações, mas é conta nova, sem desenho | Não aparece. Vai para "O que fica de fora" | — |

**Nos motores diretos** (escolha D2) (Gemini Live, OpenAI Realtime e o simulado), uma sessão só
faz as três coisas. A recomendação mantém os três cartões, porque cada um tem o que configurar de verdade: o Ouvido
tem o vocabulário e o ambiente de escuta, a Voz tem a voz e o Ouvir, e o Cérebro tem as instruções.
O que muda:

- a primeira linha de cada cartão diz "No motor {nome do motor}" (por exemplo, "O motor Gemini Live
  ouve, pensa e fala nesta ligação"), no Ouvido e no Cérebro, e o nome da voz, na Voz;
- **o custo não é dividido em três.** O extrato do motor direto não separa as peças, e reparti-lo
  seria inventar. Os três cartões dizem "no custo do motor", e o total do agente fica na faixa de
  resumo, pela mesma rota nova (soma das linhas do motor deste agente);
- **a latência** é "não medido" na faixa: o motor direto não grava o `pipeline_turn_latency`.

**No pipeline** (desligado até a fatia 6), os cartões mostram a escolha das peças. Ela vive só na
tela até a fatia 6, como o bloco de hoje. O custo por peça vem da rota nova, e na prática é "não
medido" até haver ligação gravada com o pipeline.

### 5.3 O painel lateral

**O componente** (**novo**, `SidePanel` no `kit.tsx`) é um `<dialog>` nativo aberto com
`showModal()`:

- ele encosta na direita, com até 28rem de largura em tela larga e a tela inteira no celular;
- tem sombra (ele flutua; a direção permite), e um fundo atrás feito por um token **novo**
  `--dv-scrim`, com a ponte no `globals.css` e o contraste conferido por quem o cria, nos dois
  temas;
- entra deslizando em 200 ms; com `prefers-reduced-motion`, aparece sem movimento;
- a página atrás fica inerte (efeito do `showModal`: Tab não sai do painel, e o leitor de tela não
  lê o fundo).

**Acessibilidade:**

- `aria-labelledby` no título (`h2`) e `aria-describedby` na linha que explica a peça;
- ao abrir, o foco vai para o primeiro campo ou, se não houver campo, para o título (`tabIndex={-1}`);
- **Esc fecha** (o `cancel` do `<dialog>`), e o botão "Fechar" no topo também; ao fechar, o foco
  volta para o cartão que abriu o painel. O navegador já faz isso no `<dialog>`, e o teste confere;
- o cartão aberto mostra `aria-expanded="true"` enquanto o painel está aberto;
- o `<dialog>` é renderizado **dentro** do `<fieldset disabled={!canConfigure}>` e do `<form>`. Os
  campos dele continuam no formulário e no rascunho, e quem só lê vê os campos desligados, como hoje.

**Editar e salvar (escolha D4):** na recomendação, o painel edita o mesmo rascunho. Ele não tem
Salvar próprio, porque não pode
existir um segundo jeito de gravar. "Fechar" fecha, a mudança fica no rascunho, e o cartão mostra
"não salvo". O Salvar do rodapé grava tudo, como hoje. Os botões do painel são `type="button"`, para
não enviar o formulário.

**O que cada painel configura, só com o que existe hoje:**

| Painel | Motor direto | Pipeline (só ver e ouvir até a fatia 6) |
|---|---|---|
| **Ouvido** | ambiente de escuta, com as regras de hoje (só nos motores provados, o aviso e o "voltar para Normal", o aviso de não salvo); vocabulário (contador, erro ao lado, foco no erro) | a transcrição que falta neste servidor (`no_live_transcriber`); **o aviso da 9.1**, com "não confirmado" até a R12 trazer a confirmação da transcrição. Vocabulário e ambiente também aparecem aqui |
| **Cérebro** | a linha "quem conversa é o motor {nome}" (a de `brains.tsx`) e o link para trocar de motor na linha do motor | cérebro (com `chat` e chave aceita) e modelo com preço, o `BrainPart` de hoje; sem cérebro, o link para Configurações › Cérebros |
| **Voz** | a voz do motor, o **Ouvir** com a amostra no idioma do agente (o `VoiceField` e o `Listen` de hoje, com `preload="none"` e o erro dito em `role="alert"`) | as vozes da ElevenLabs com o rótulo do fornecedor e o **Ouvir** do `previewUrl` (o `VoiceRows` de hoje); sem chave, o link para Configurações › Voz; **o aviso da 9.1** por voz que sai do servidor, com quem confirmou e quando |

**A confirmação da 9.1 no painel:** o painel **mostra** o estado, com quem confirmou e quando, ou
"não confirmado", ao lado da peça cujo `processingLocation` não é `this-server`. Ele **não** grava
a confirmação: ela continua sendo feita só ao gravar a chave, em Configurações › Voz, e o painel
leva para lá. Quando a fatia 6 ligar o salvar do pipeline, a recusa 422 do servidor
(`pipeline_piece_unconfirmed`, com a peça no `detail`) aparece no painel da peça, além do status do
rodapé. Esta tela não ganha um caminho novo de confirmar.

**O que sai dos painéis de hoje (escolha D3):** na recomendação, o painel "Pipeline" deixa de
existir como bloco, e o conteúdo
dele vai para os três painéis. A faixa de latência sobe para a faixa de resumo. "Cérebros deste
agente" se divide: quem conversa vai para o Cérebro, quem lê a ligação vai para Depois da ligação,
e a linha do analista ao vivo vai para Ferramentas, ao lado do campo do analista.

## 6. As fatias

Cada fatia tem até ~400 linhas (fora testes e textos dos dicionários) e sai da `main` **depois** que
a anterior entrar, sem empilhar (regra do maestro de 26/11). Os números de linhas são estimativas
deste desenho, e não medidas.

| Ordem | Fatia | O que entrega | Linhas (estim.) | Espera a resposta de |
|---|---|---|---|---|
| 1 | **As abas, com o conteúdo de hoje redistribuído** | componente `Tabs` no kit; `page.tsx` agrupa os painéis de hoje **inteiros** nas abas Agente, Ferramentas, Depois da ligação, Testes e Avançado (a tabela 4.1, menos os cartões e menos Ligações); o idioma passa para a Identidade; `?aba=`; o `onInvalidCapture`; os testes viram aba (o corpo de `tests/page.tsx` vira componente, e a rota antiga redireciona); os três links da organização em Avançado; fragmento com a tabela "onde estava → onde está". Nesta fatia, "Cérebros deste agente" e o bloco Pipeline ficam inteiros na aba Agente | ~350 | D1, D3 (os testes viram aba) |
| 2 | **Os cartões e o painel lateral, motores diretos** | `SidePanel` no kit e o token `--dv-scrim`; os três cartões; o painel do Ouvido (vocabulário e ambiente saem do formulário solto e vão para ele) e o da Voz (o `VoiceField`); o Cérebro com a linha do motor; "Cérebros deste agente" se divide (quem lê vai para Depois da ligação, e o analista, para Ferramentas). Os cartões ainda sem número de custo: a faixa mostra só a latência que já existe | ~400 | D2, D3, D4 |
| 3 | **O pipeline nos cartões** | o conteúdo do bloco Pipeline vai para os três painéis (transcrição e 9.1 no Ouvido, cérebro e modelo no Cérebro, vozes da ElevenLabs, Ouvir e 9.1 na Voz); o bloco e a âncora `#pipeline` saem; a linha da ElevenLabs no campo Voz vira o botão que abre o painel. Continua só ver e ouvir | ~250 | D3 |
| 4 | **O custo medido nos cartões e na faixa** | **novo** `GET /agents/[id]/costs?days=30` (total e por peça, a mesma leitura do extrato de Custos, isolada por organização) e os números da seção 5.2, com "não medido" e "estimado" | ~250 | D2 |
| 5 | **A aba Ligações** | filtro `agentId` em `GET /calls` (validado como uuid, dentro da organização da sessão); a lista da tela de Ligações vira componente reaproveitado; a aba, com o filtro de status | ~300 | D1 |

A coluna da direita manda: a fatia só começa depois da resposta do dono às escolhas dela. Se a
resposta mudar a escolha, a fatia segue a resposta, e o desenho ganha um commit antes do código.

A ordem segue o pedido: a fatia 1 vale sozinha, e os cartões com o painel vêm logo depois.
Ligações vai por último porque é a única que mexe numa rota que outra tela usa.

### 6.1 O aceite de cada fatia

- **1.** Uma pessoa abre o agente e acha cada campo na aba da tabela 4.1. Troca de aba, muda campos
  em três abas, salva uma vez, e o `PATCH` leva tudo. Recarregar com `?aba=depois` abre Depois da
  ligação. Salvar com o teto vazio abre Avançado, com o foco no campo e a mensagem do navegador.
  `/agents/<id>/tests` abre a aba Testes. Só com o teclado se percorre e se troca de aba.
  **Seria fracasso mesmo funcionando:** um campo some, uma mudança se perde ao trocar de aba, ou o
  Salvar não faz nada sem dizer por quê.
- **2.** Clicar (ou Enter/Espaço) no cartão da Voz abre o painel com o foco no campo da voz. O Ouvir
  toca. Esc fecha, e o foco volta ao cartão, que mostra "não salvo". O Salvar do rodapé grava a voz.
  Quem só lê abre o painel e vê os campos desligados. **Fracasso:** um número no cartão sem origem
  medida, o foco perdido depois de fechar, ou um Salvar dentro do painel.
- **3.** No painel da Voz aparecem as vozes da ElevenLabs com o Ouvir e o aviso da 9.1, com quem e
  quando. Salvar o agente continua **sem** `pipeline` no `PATCH`. **Fracasso:** o painel deixa
  gravar o pipeline antes da fatia 6, ou confirma a 9.1 fora de Configurações › Voz.
- **4.** Um agente com ligações mostra o custo de cada peça igual à soma do detalhe dessas ligações.
  Um agente sem ligação mostra "não medido". **Fracasso:** um zero onde não houve medida, ou o custo
  de outra organização na conta.
- **5.** A aba Ligações lista só as ligações deste agente, e o filtro de status funciona.
  `agentId` de outra organização devolve lista vazia. **Fracasso:** a lista geral muda de
  comportamento, ou aparecem ligações de outro agente.

### 6.2 Os testes de tela (e2e, `apps/panel/test/e2e`) que cada fatia atualiza

Hoje, dez specs abrem `/agents/<id>` e procuram campos na página única.

| Spec | Campo que usa | Fatia que o atualiza |
|---|---|---|
| `forget-caller.spec.ts`, `caller-notes.spec.ts` | caixa da ferramenta `remember_caller_note` | **1** (abrir Ferramentas antes) |
| `handoff-targets.spec.ts` | lista "Passar a ligação" | **1** (Ferramentas) |
| `follow-up.spec.ts` | dono das pendências | **1** (Depois da ligação) |
| `drop-follow-up-whatsapp.spec.ts`, `drop-follow-up-call-back.spec.ts` | quando a ligação cai | **1** (Depois da ligação) |
| `vocabulary.spec.ts`, `listening-environment.spec.ts` | vocabulário, ambiente de escuta | **2** (abrir o painel do Ouvido); `listening-environment` também confere a voz do Gemini, na **2** (painel da Voz) |
| `voice-sample.spec.ts` | campo Voz e Ouvir | **2** (painel da Voz) |
| `settings.spec.ts:505-517` | aviso de motor sem chave e link | nenhuma: o aviso fica na linha do motor, na aba Agente |
| `pipeline-block.spec.ts` | `#pipeline`, Ouvir da ElevenLabs, modelo, salvar sem `pipeline` | **3** (painéis da Voz e do Cérebro) |
| **novo** `agent-tabs.spec.ts` | teclado nas abas, `?aba=`, obrigatório em aba fechada, `/tests` redireciona | **1** |
| **novo** `agent-side-panel.spec.ts` | abrir pelo teclado, Esc, foco de volta, "não salvo", salvar pelo rodapé | **2** |
| **novo** `agent-calls.spec.ts` | simular uma ligação deste agente e vê-la na aba | **5** |

**A prova de primeira impressão do CI** (`simulated-call.spec.ts`, "primeira ação útil", na lista
de Ligações, e o caminho simulado do pipeline em `apps/voice/src/simulated-call.db.test.ts:422`)
não abre a tela do agente, e **nenhuma fatia a muda**. A fatia 5 mexe na lista de Ligações (o
componente reaproveitado), e por isso a prova precisa passar sem mudança nessa fatia. Esse é o
aceite.

**Testes de unidade:** as abas (setas, Home/End, valor desconhecido de `aba`) e a escolha da aba do
campo inválido, na fatia 1; o painel (abre, fecha, devolve o foco), na fatia 2. O jsdom não tem
`showModal`, e o teste precisa de um substituto pequeno, com a prova real no e2e. Na fatia 4, a
regra "sem linha = não medido, nunca zero" ganha teste puro, e a rota ganha teste de banco com duas
organizações. Na fatia 5, o filtro ganha teste de banco de isolamento.

## 7. O que fica de fora

Do que a referência tem e o DeskVoice não tem, nada entra aqui. Se algum vier, vem com desenho
próprio:

- divisão de tráfego entre versões, e versões do agente;
- um assistente que escreve o agente por conversa;
- nota da conversa (scorecard) e extração estruturada como recurso da aba Ferramentas;
- predefinições de modelo ("equilibrado", "mais rápido"...);
- nota própria de cada peça (taxa de erro da transcrição, índice de inteligência, naturalidade);
- latência por peça (pede medir cada peça, e não só o turno);
- custo por minuto;
- voz e transcrição reserva;
- privacidade e webhook **por agente** (hoje valem para a organização; Avançado só leva até lá);
- velocidade da voz, som de fundo e dicionário de pronúncia no painel da Voz: nenhum existe hoje no
  DeskVoice;
- conformidade de saúde dos EUA;
- editor de instruções com variáveis e formatação;
- gravar o pipeline pela tela: continua na fatia 6 da R5, com a medida dela.

## 8. Pedidos de decisão

Quatro pedidos, um por escolha. Os quatro são reversíveis: mudam a tela, sem tocar em dado, rota
gravada ou configuração de quem já instalou. O pedido único que eu tinha aberto antes (a casa de
cada campo) virou o D1.

---

Dono do pedido: Arquiteto.

## Decisão: D1. Quais abas a tela do agente tem, e em qual aba fica cada campo?

**Quem decide:** dono do projeto
**O que está parado esperando:** as fatias 1 (as abas) e 5 (a aba Ligações).

### Opções
- **A.** Seis abas, a tabela 4.1: Agente, Ligações, Ferramentas, Depois da ligação, Testes e
  Avançado. "Depois da ligação" fica separada de Ferramentas, o idioma vai para a Identidade, e os
  limites vão para Avançado. Custo: quem já instalou procura os campos em outro lugar uma vez (o
  fragmento traz a tabela "onde estava → onde está"), e a aba Ligações pede um filtro novo na rota
  das ligações.
- **B.** Cinco abas, como na sugestão da tarefa: "Depois da ligação" dentro de Ferramentas. Custo: a
  aba Ferramentas mistura o que o agente faz durante a ligação com o que acontece depois, e fica com
  um nome diferente da área de Configurações que trata do mesmo assunto.
- **C.** Não fazer: a página única continua. Custo: o pedido de 26/11 não é atendido, e a tela segue
  crescendo a cada recurso.

### Recomendação
A, porque quem configura acha o que acontece depois da ligação pelo mesmo nome que já vê em
Configurações, e a aba Ferramentas fica só com o que o agente faz enquanto fala.

### Se ninguém responder em 3 dias, vale: A

### Não medido
Ninguém que opera o painel viu as abas. Não sei quantos campos cada operador costuma mexer, nem em
que ordem, e isso poderia mudar quais campos ficam na aba Agente.

---

Dono do pedido: Arquiteto.

## Decisão: D2. O que os cartões Ouvido, Cérebro e Voz mostram?

**Quem decide:** dono do projeto
**O que está parado esperando:** as fatias 2 (cartões nos motores diretos) e 4 (custo nos cartões).

### Opções
- **A.** Três cartões em todo motor. Cada um mostra a escolha da peça e o custo medido deste agente
  nos últimos 30 dias, ou "não medido". Nos motores diretos, que não separam as peças, os três
  cartões dizem "no custo do motor", e o total vai na faixa de cima, com a latência p50 que já
  existe (só no pipeline). Nenhum número sem medida. Custo: uma rota nova de custo por agente
  (fatia 4), e três cartões que, no motor direto, apontam para uma sessão só.
- **B.** Três cartões só no pipeline. Nos motores diretos, um cartão só, "Motor", com a voz, o
  ambiente de escuta e o vocabulário dentro. Custo: a tela muda de forma quando se troca de motor, e
  quem compara dois agentes vê telas diferentes.
- **C.** Cartões sem número: só a escolha de cada peça. O custo continua no detalhe da ligação e em
  Custos. Custo: o cartão não ajuda a comparar o que cada peça custa, e a fatia 4 sai do plano.
- **D.** Não fazer cartões: os campos ficam soltos na aba Agente. Custo: a divisão em três peças que
  o pedido de 26/11 chamou de "perfeita" não aparece.

### Recomendação
A, porque quem configura vê as mesmas três peças em qualquer motor, e cada número que aparece veio
de uma ligação de verdade.

### Se ninguém responder em 3 dias, vale: A

### Não medido
Não medi a consulta da rota de custo por agente, nem quanto tempo ela leva com muitas ligações. Não
sei se o operador lê "no custo do motor" como "de graça".

---

Dono do pedido: Arquiteto.

## Decisão: D3. O que sai da tela do agente de hoje?

**Quem decide:** dono do projeto
**O que está parado esperando:** as fatias 1 (só a parte dos testes virarem aba), 2 e 3.

### Opções
- **A.** Saem como bloco: o painel "Pipeline" (o conteúdo vai para os três painéis laterais),
  "Cérebros deste agente" (quem conversa vai para o Cérebro, quem lê a ligação vai para Depois da
  ligação, e a linha do analista vai para Ferramentas), a página separada dos testes (vira a aba
  Testes, e o endereço antigo redireciona), o link "Testes do agente" do topo e a âncora
  `#pipeline` (vira um botão que abre o painel da Voz). Nenhum campo some: todos mudam de lugar.
  Custo: quem já instalou não acha mais os blocos pelo nome antigo.
- **B.** Os cartões entram, mas o bloco Pipeline e "Cérebros deste agente" ficam inteiros na aba
  Agente, embaixo dos cartões. Custo: a mesma escolha aparece em dois lugares (no cartão e no bloco),
  e a tela volta a ficar comprida.
- **C.** Não tirar nada: as abas só agrupam os painéis de hoje, e os testes continuam na página
  deles. Custo: os cartões não têm o que abrir, e o pedido do painel lateral não é atendido.

### Recomendação
A, porque cada coisa fica num lugar só, e todo endereço antigo continua abrindo.

### Se ninguém responder em 3 dias, vale: A

### Não medido
Não sei quantos operadores usam o link do topo dos testes nem a âncora `#pipeline`.

---

Dono do pedido: Arquiteto.

## Decisão: D4. O painel lateral de cada peça tem um botão Salvar próprio?

**Quem decide:** dono do projeto
**O que está parado esperando:** a fatia 2.

### Opções
- **A.** Não. O painel edita o rascunho da tela, "Fechar" guarda a mudança no rascunho, o cartão
  mostra "não salvo", e o Salvar do rodapé grava tudo, como hoje. Custo: quem fecha o painel e sai
  da tela sem salvar perde a mudança, como já acontece hoje com qualquer campo.
- **B.** Sim. O painel tem um Salvar que grava só aquela peça. Custo: dois jeitos de gravar o mesmo
  agente, e o rodapé pode gravar uma mudança de outra aba que a pessoa não pretendia gravar ainda.
- **C.** Não fazer painel: o cartão abre os campos no lugar, embaixo dele. Custo: o painel lateral
  do pedido de 26/11 não é atendido.

### Recomendação
A, porque existe um jeito só de gravar o agente, e o "não salvo" no cartão diz o que falta.

### Se ninguém responder em 3 dias, vale: A

### Não medido
Não testei com operador se o "não salvo" no cartão basta para lembrar de salvar.

## 9. Não medido

- As estimativas de linhas por fatia saíram da leitura do código, e não de um protótipo.
- Não conferi se as ferramentas MCP já aparecem em `/tools`, nem como o #563 e o #565 mudam a aba
  Ferramentas quando entrarem.
- Não medi a rota nova de custo por agente: a consulta e o índice que ela usa ficam para a fatia 4.
- Não conferi em leitor de tela real (NVDA, VoiceOver) o `<dialog>` com `showModal` dentro de um
  `<form>`. O que está na seção 5.3 é o que a especificação do HTML e o padrão da ARIA dizem. A
  prova da fatia 2 é o e2e no Chromium.
- Não conferi o contraste do token `--dv-scrim`, que ainda não existe.
- Não conferi o comportamento do `onInvalidCapture` fora do Chromium (Firefox e Safari).
- A referência foi lida a partir de capturas, sem uso do produto.
