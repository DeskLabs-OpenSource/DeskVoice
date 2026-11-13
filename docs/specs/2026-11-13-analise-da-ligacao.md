# Análise da ligação no fim: nota com régua, temperatura e objeções

- **Estado:** desenho. Nenhum código de produto foi escrito.
- **Data:** 2026-11-13
- **Quem pediu:** o dono, no roteiro de novembro (item R1). Ele quer que um analista de IA
  "traga uma análise completa" de cada ligação no fim. A análise ao vivo é outro item (R6), e a
  entrega ao Deskcomm é a R7.
- **Base medida:** `origin/main` em `92d76be`. Os nomes de função, tabela, chave e evento citados
  abaixo foram conferidos nesse commit, salvo os marcados como **novo**.

## 1. Problema

Hoje uma ligação terminada recebe duas coisas depois que desliga:

- o resumo extrativo de `summarize_call` (`calls.summary`), sem provedor e sem custo;
- o desfecho comercial de `classify_call_outcome` (`calls.outcome`, com confiança e a fala que o
  sustenta), desligado de fábrica pela chave `calls.outcome_enabled`, com custo medido no
  `usage_ledger` e em `calls.cost_cents`, respeitando o teto do agente.

Falta o que o dono pediu: saber **como** foi a conversa. Quem lê o dia não tem como dizer se o agente
atendeu bem, onde a pessoa esfriou, que objeção apareceu e o que fazer em seguida.

## 2. A decisão de forma: uma chamada paga só

A análise **estende a chamada paga que já existe**, em vez de virar uma rotina irmã.

- A transcrição enviada é a mesma, e o provedor, a chave, o teto e o caminho do custo também. Duas
  rotinas mandariam a mesma transcrição duas vezes e pagariam a entrada duas vezes: é o fracasso
  "duas chamadas pagas quando uma bastava".
- A rotina continua sendo `classify_call_outcome`, no mesmo arquivo e com o mesmo `kind`. Trocar o
  nome deixaria órfãs as tarefas que estiverem na fila de quem atualiza.
- **Uma chave nova, `calls.analysis_enabled`**, desligada de fábrica, ligada pela tela. Com ela
  ligada, o pedido ao provedor é o pedido completo (desfecho e análise), e o desfecho é gravado
  junto mesmo que `calls.outcome_enabled` esteja desligado: já foi pago, vem da mesma leitura e não
  manda nada a mais ao provedor. A tela diz isso no texto do interruptor.
- Só `calls.outcome_enabled` ligado: o pedido continua exatamente o de hoje, curto e barato. Quem
  usa só o desfecho não passa a pagar pela análise.

Existem então dois formatos de pedido, e nenhum terceiro: **só desfecho** e **desfecho com análise**.

## 3. Contrato

### 3.1 Banco (fatia 1)

Uma migration nova, `db/migrations/<carimbo>_a_analise_da_ligacao.sql`, só para frente, sem padrão
nas colunas (`null` é "não analisada"; nenhuma linha antiga é reescrita):

```sql
alter table calls
  add column analysis jsonb,
  add column analysis_score smallint check (analysis_score is null or (analysis_score between 0 and 10)),
  add column analyzed_at timestamptz;
```

- `analysis_score` mora fora do `jsonb` porque a lista de chamadas mostra e ordena por ele.
- `analysis` guarda a forma da seção 3.2, validada com zod na escrita e na leitura.
- Fica `null` a ligação com a análise desligada, sem fala, sem chave, no teto ou cujo provedor
  falhou. O motivo vai para a linha do tempo (seção 3.5), não para cá.

### 3.2 A forma guardada (fatia 1, `packages/core/src/analysis.ts`, **novo**)

Mora em `packages/core` porque três lugares a leem sem poder importar o motor de voz: o expurgo
(`purgeTranscripts`, em `core`), o painel e, depois, a R7.

```ts
type Temperature = "cold" | "warm" | "hot" | "unknown";   // frio, morno, quente, sem fala do cliente nesse trecho
type CriterionStatus = "met" | "partial" | "missed";

interface CallAnalysis {
  rubricVersion: 1;
  model: string;                          // o modelo de texto que leu, como em `ClassifyResult.model`
  criteria: { id: RubricCriterionId; status: CriterionStatus; evidence: string }[];  // um por critério da régua, na ordem dela
  temperature: { start: Temperature; middle: Temperature; end: Temperature };
  objections: { objection: string; quote: string; response: string; handled: "addressed" | "partial" | "ignored" }[];
  strengths: string[];                    // até 3, até 200 caracteres cada
  weaknesses: string[];                   // até 3, até 200 caracteres cada
  nextStep: string;                       // até 280 caracteres; vazio quando a conversa não pede nada
  droppedObjections: number;              // objeções que o provedor deu e a checagem da seção 3.4 recusou
}

interface PurgedCallAnalysis {            // o que sobra depois do prazo de guarda (seção 3.6)
  rubricVersion: 1;
  model: string;
  criteria: { id: RubricCriterionId; status: CriterionStatus }[];
  temperature: { start: Temperature; middle: Temperature; end: Temperature };
  objectionCount: number;
  purged: true;
}
```

O schema zod de leitura aceita as duas formas (união discriminada por `purged`). Exportar o schema e
o tipo é o que deixa a análise **disponível** para o aviso de fim de ligação e para o webhook da R7,
sem esta fatia construir entrega nenhuma.

### 3.3 A régua (fatia 1, no mesmo arquivo)

A nota **não vem do modelo**. O modelo diz, critério por critério, se o agente cumpriu, cumpriu em
parte ou não cumpriu, com a fala que mostra isso. O código soma: `met` vale 2, `partial` vale 1,
`missed` vale 0. Cinco critérios, nota de 0 a 10. Assim não existe número solto: toda nota é a soma
de uma régua que a tela mostra inteira.

| `id` | O que soma 2 pontos | O que tira |
|---|---|---|
| `opening` | Abriu se identificando e entendeu o motivo do contato | Não disse quem é, ou seguiu sem entender o que a pessoa queria |
| `discovery` | Perguntou antes de oferecer ou responder, e confirmou o que entendeu | Respondeu no escuro, ou empurrou uma oferta sem perguntar |
| `objections` | Respondeu cada objeção com informação, sem ignorar nem pressionar. Sem objeção na conversa, conta como cumprido | Ignorou a objeção, insistiu sem responder, ou pressionou |
| `accuracy` | Só afirmou o que sabia, usou a ferramenta quando ela existia para isso, e disse quando não sabia | Inventou informação, prometeu o que não pode cumprir, ou deixou de usar a ferramenta disponível |
| `closing` | Encerrou com um próximo passo claro e combinado com a pessoa | Encerrou sem combinar nada, ou deixou a pessoa sem saber o que acontece agora |

- `RUBRIC` é uma constante exportada com `id` e `points` (2). Os textos da tabela são frase de tela:
  moram nos três dicionários, um par "soma" e "tira" por `id`.
- `scoreOf(criteria)` é função pura, com teste de unidade, e é a única fonte de `analysis_score`.
- `rubricVersion` existe para o dia em que a régua mudar: nota de régua diferente não se compara, e a
  tela diz qual régua deu a nota.
- A régua é de atendimento em geral, não de um ramo de negócio. Régua configurável pelo operador fica
  de fora (seção 6). A régua acima é o padrão do pedido de decisão da seção 7.

### 3.4 O pedido ao provedor e a checagem da resposta (fatia 2)

Em `packages/voice-engine`:

- `ClassifyInput` ganha `analyze?: boolean`. O método continua sendo `classifyOutcome`: renomear
  mexeria nos três motores e na rotina sem mudar comportamento. Com `analyze`, os motores Gemini e
  OpenAI pedem o formato completo; sem ele, o pedido é byte a byte o de hoje (um teste prova isso).
- `analysisPrompt(input)` (**novo**, em `src/analysis.ts`): o pedido do desfecho mais a régua, com os
  critérios escritos para o modelo, e as regras: baseie-se só nas falas; em `quote`, copie a fala do
  CLIENTE literalmente; temperatura `unknown` quando o trecho não tem fala do cliente; sem objeção,
  lista vazia.
- O schema da resposta segue o padrão de hoje, com duas versões: a do OpenAI (`strict`, com
  `additionalProperties: false` em todo nível e todo campo em `required`) e a do Google (sem
  `additionalProperties`). A resposta é lida com zod (`readAnalysisGuess`), e o que vier fora da
  forma é `unexpected_response`, como hoje: o desfecho também não é gravado, porque veio na mesma
  resposta.
- `ClassifyResult` com `ok: true` ganha `analysis?: AnalysisGuess` (a resposta já validada, antes da
  checagem abaixo).
- O motor simulado não declara análise: ele não lê conversa, e inventar uma análise seria inventar
  sobre o cliente (o mesmo motivo do desfecho `unknown` dele).
- O prazo do pedido completo sobe de 10 s para 30 s (`timeoutMs`): a resposta é maior. Não medido:
  quanto tempo os dois provedores levam de fato para essa resposta.
- A transcrição do pedido completo vai até 24 000 caracteres (o desfecho usa as últimas 6 000).
  Acima disso, vão as primeiras 8 000 e as últimas 16 000, com a linha `[… falas omitidas …]` no
  meio, e a temperatura do meio tende a sair `unknown`. É um limite de custo, escrito como
  `ponytail:` no código.

**A checagem contra a transcrição (o fracasso "objeção que não está na transcrição"):** antes de
gravar, a rotina confere cada `objections[].quote` contra as falas do cliente enviadas, com
comparação normalizada (minúsculas, sem acento, sem pontuação, espaços colapsados) e por inclusão.
Objeção cuja citação não aparece numa fala do cliente **é descartada** e conta em
`droppedObjections`. Vale o mesmo para `criteria[].evidence`: evidência que não aparece na
transcrição é apagada (vira `""`), e o status fica. A função `verifyAgainstTranscript` é pura, mora
em `packages/core/src/analysis.ts` e tem teste com citação literal, citação com acento ou pontuação
diferente e citação inventada.

### 3.5 A rotina e a linha do tempo (fatia 2)

`classify_call_outcome` passa a:

1. ler as duas chaves; nenhuma ligada, sai sem gastar;
2. sair sem gastar quando já não há nada a fazer: desfecho já gravado (ou não pedido) **e** análise
   já gravada (ou não pedida). É a proteção de hoje contra pagar duas vezes no reprocessamento;
3. com a análise pedida, registrar **`analysis_not_done`** (**novo**) e sair, quando não der para
   pedir: `reason` `no_speech` (nenhuma fala), `no_key` (o motor do agente sem chave),
   `engine_cannot_analyze` (motor sem análise, como o simulado) ou `cost_ceiling` (com
   `costCents` e `ceilingCents`, a mesma conta de hoje). O comportamento do desfecho sozinho nesses
   casos não muda;
4. fazer **uma** chamada ao provedor, e gravar o custo uma vez no `usage_ledger` e em
   `calls.cost_cents`, como hoje;
5. falha do provedor: com a análise pedida, `analysis_not_done` com `reason` no vocabulário de
   `ClassifyFailure`, `engine`, `model`, `status` e `costCents`, sem a chave e sem o corpo; com o
   desfecho pedido, o `outcome_not_classified` de hoje também. São dois eventos porque são duas
   funções que o dono liga em separado; cada um diz o que não aconteceu;
6. sucesso: grava o desfecho como hoje (`settleOutcome`, só se ainda `null`), passa a análise pela
   checagem da seção 3.4, calcula a nota com `scoreOf` e grava `analysis`, `analysis_score` e
   `analyzed_at` com `where analysis is null`, e registra **`call_analyzed`** (**novo**) com
   `score`, `rubricVersion`, `model`, `costCents` e `droppedObjections`.

`summarize_call` enfileira a rotina quando **qualquer** das duas chaves está ligada.

Os dois tipos novos entram em `CALL_EVENT_KINDS`, e a linha do tempo ganha frase para eles nos três
dicionários: "Ligação analisada: nota 7 de 10" e "Ligação não analisada: <motivo legível>". O
motivo `cost_ceiling` diz "o teto de custo do agente já tinha sido atingido".

`call_analyzed` é também o ponto onde a R7 vai pendurar a entrega ao Deskcomm: depois dele, a
análise está gravada e válida. Esta funcionalidade não enfileira entrega nenhuma.

O aviso de fim de ligação pelo WhatsApp (`notifyOwner`, em `summarize_call`) **não muda**: o corpo
continua fixo e sem fala, pela regra escrita em `OWNER_NOTICE_BODY`, e ele sai antes de a análise
existir. Quem quiser a análise nesse aviso decide na R7 se ela vai, e por qual canal.

### 3.6 Prazo de guarda e apagamento (fatia 1)

A análise é derivada da transcrição: as citações são fala da pessoa, e a objeção, os pontos fortes,
os fracos e o próximo passo são texto escrito sobre o que ela disse. Ela segue o prazo de guarda.

- `purgeTranscripts` (em `packages/core/src/events.ts`), no mesmo passo em que hoje apaga
  `outcome_evidence`, troca `calls.analysis` das chamadas começadas antes do prazo pela forma
  `PurgedCallAnalysis`: ficam a régua, o status de cada critério, a temperatura (vocabulário
  fechado, sem texto) e a contagem de objeções; sai todo texto. `analysis_score` fica: é a soma dos
  status que ficaram, e não é fala de ninguém.
- Análise já expurgada não é reescrita (`not (analysis ? 'purged')`), e rodar de novo não muda nada.
- O "apagamento pedido pela tela" é o prazo gravado em Configurações → Privacidade: a rota
  `privacy/retention` enfileira `purge_transcripts` na hora, e o mesmo `purgeTranscripts` passa pela
  análise. Não existe hoje apagamento de uma chamada só pela tela, e esta funcionalidade não cria um.
- A exportação por telefone (`privacy/export`) passa a levar `analysis` e `analysisScore` em cada
  chamada: é dado da pessoa, e a ficha diz tudo o que se guarda sobre ela.
- Teste de banco: análise antes do prazo vira a forma expurgada sem nenhum texto; depois do prazo
  fica inteira; organização vizinha não é tocada.

### 3.7 Tela (fatia 3)

- **Configurações:** um interruptor "Analisar cada ligação no fim", ao lado do do desfecho, no mesmo
  padrão de `OutcomeSetting` (chave registrada em `apps/panel/src/server/settings.ts` com
  `fallback: false`). O texto diz que cada ligação analisada é uma chamada paga ao provedor do
  agente, com a transcrição; que inclui o desfecho; e que o custo entra no teto do agente.
- **Detalhe da chamada:** uma seção "Análise" abaixo do desfecho, com a nota, a régua inteira (cada
  critério com os pontos ganhos de 2, o "soma" ou o "tira" correspondente e a evidência entre aspas),
  a temperatura em três passos, as objeções com a citação e a resposta, o que foi bem, o que foi mal e
  o próximo passo. A análise expurgada mostra a régua e a temperatura, e diz "o texto saiu com o prazo
  de guarda". Ligação com a análise ligada e sem análise mostra o motivo, lido do último
  `analysis_not_done`.
- **Linha do tempo:** as frases da seção 3.5.
- **Lista de chamadas:** uma coluna "Nota" com `7/10`, ou um traço quando não há análise.
  `CALL_COLUMNS` ganha `analysis_score as "analysisScore"`, e o detalhe ganha `analysis`.
- Frase nova só nos três dicionários (`pt-BR`, `en`, `es`), cor só por token.

## 4. Fatias

Cada fatia é um PR de rascunho contra `main`, com fragmento em `.changes/`, revisável de uma sentada.
A ordem importa: cada uma depende da anterior já mesclada.

| Fatia | O que entra | Prova |
|---|---|---|
| **1. Contrato e guarda** | Migration; `packages/core/src/analysis.ts` (forma guardada, `RUBRIC`, `scoreOf`, `verifyAgainstTranscript`); `call_analyzed` e `analysis_not_done` em `CALL_EVENT_KINDS`; `purgeTranscripts` estendido; exportação por telefone; a seção de contratos do plano da fundação atualizada | Testes de unidade da nota e da checagem; teste de banco do expurgo e do isolamento; `pnpm verify` e `pnpm test:db` |
| **2. O pedido e a rotina** | `analyze` em `ClassifyInput`; prompt e schemas de análise; Gemini e OpenAI; rotina e `summarize_call`; chave `calls.analysis_enabled` lida pela rotina | Testes com `fetch` falso para os dois motores (pedido só desfecho idêntico ao de hoje; pedido completo; resposta fora da forma); teste de banco da rotina: desligada, sem fala, sem chave, no teto, provedor falhando, sucesso, reprocessamento sem pagar de novo, objeção inventada descartada |
| **3. Tela** | Interruptor, seção no detalhe, linha do tempo, coluna na lista, dicionários | Teste da tela onde o painel já testa; a prova manual da seção 5 registrada no PR |

A fatia 1 sozinha ainda não tem quem a alimente; ela entra mesmo assim porque o expurgo precisa
existir antes do primeiro texto gravado, e não depois.

## 5. Critério de aceite

**O que uma pessoa consegue fazer quando terminar:**

- O operador liga "Analisar cada ligação no fim" na tela, num agente com motor Gemini ou OpenAI e
  chave guardada, faz uma chamada simulada pela tela e, em seguida, vê no detalhe da chamada a nota
  com a régua inteira, a temperatura, as objeções com citação, o que foi bem e mal e o próximo
  passo; vê "Ligação analisada: nota N de 10" na linha do tempo; e vê a nota na lista.
  (A chamada simulada conversa com o motor simulado, mas a análise usa o motor e a chave do agente,
  como o desfecho hoje.)
- Com o provedor falhando (chave recusada, fora do ar), a linha do tempo diz "Ligação não analisada"
  com o motivo.
- Num agente com teto de custo já atingido na ligação, a linha do tempo e o detalhe dizem que ela
  não foi analisada por causa do teto, e nada é cobrado.
- Com a análise desligada (o de fábrica), nada muda para quem atualiza: nenhum pedido, nenhum custo,
  nenhuma coluna preenchida.
- Depois do prazo de guarda, a análise perde todo texto e mantém nota, régua e temperatura.
- `pnpm verify` e `pnpm test:db` verdes em cada fatia.

**O que seria fracasso mesmo funcionando:**

- Nota que não é a soma da régua mostrada, ou régua que a tela não mostra.
- Objeção na tela cuja citação não está na transcrição.
- Duas chamadas pagas por ligação, ou o pedido "só desfecho" ficando mais caro do que hoje.
- Texto da análise sobrevivendo ao prazo de guarda, ou indo no corpo do aviso do WhatsApp.
- Falha do provedor ou teto que não aparece na linha do tempo.

**A lista "O que o CI não vê" do `AGENTS.md` vale inteira.** Pontos dela que esta funcionalidade
toca de perto: duas conexões (a rotina é alimentada por `summarize_call` e alimenta tela, exportação
e o ponto da R7); custo medido e teto; nenhum caminho de erro em silêncio; tela para ligar; quem já
instalou não precisa fazer nada (as colunas nascem `null` e a chave nasce desligada).

## 6. Fora do escopo

- A análise ao vivo, durante a ligação (R6).
- Escolher outro modelo para a análise (R4). Nada de abstração de "modelo de análise" agora: o
  modelo é o `OUTCOME_MODEL` de cada motor.
- Levar a análise ao Deskcomm ou a qualquer webhook (R7). Aqui ela só fica gravada, validada e
  marcada por `call_analyzed`.
- Régua configurável pelo operador, critérios por ramo de negócio, peso diferente por critério.
- Analisar de novo ligações antigas, ou analisar de novo uma ligação já analisada.
- Apagar a análise de uma chamada só, pela tela.
- Limite de tokens de saída para conter o custo antes do pedido (o `ponytail:` do teto, que já
  existe no desfecho, continua valendo e fica maior).

## 7. Pedido de decisão

Registrado na tarefa DESA-9 para o lote diário do Líder. Nenhuma fatia espera por ele: a fatia 1
nasce com o padrão.

- **A régua da nota** (seção 3.3): cinco critérios de 2 pontos, de atendimento em geral. Padrão sem
  resposta: a régua da seção 3.3, versão 1.

## 8. Não medido

- Se o `responseSchema` do Gemini aceita o schema aninhado da análise (listas de objetos), e se o
  modo `strict` do OpenAI aceita o schema inteiro. Não conferi a documentação dos dois hoje; a fatia 2
  confere e cita a fonte com data no comentário do motor, como o desfecho já faz.
- Quanto custa e quanto demora a análise de uma ligação típica em `gemini-3.5-flash-lite` e
  `gpt-5-nano`. Os preços em código foram conferidos em 2026-11-13 por quem escreveu o desfecho; eu
  não os conferi de novo.
- Se `gpt-5-nano` gasta parte da saída em raciocínio a ponto de cortar a resposta maior.
- A qualidade da análise: se o modelo barato julga bem a régua. Nenhuma ligação real foi analisada.
- Quantas objeções legítimas a checagem por inclusão descarta quando o modelo parafraseia. O
  `droppedObjections` em `call_analyzed` existe para medir isso depois.
- Não li o desenho da equipe de agentes (`2026-11-13-equipe-de-agentes-e-memoria.md`) inteiro. Ele
  prevê um supervisor que exige próximo passo; se ele andar, o `nextStep` daqui é candidato a
  alimentá-lo, e os dois não devem gravar o mesmo dado em dois lugares.
