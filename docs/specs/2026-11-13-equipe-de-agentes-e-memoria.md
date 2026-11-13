# Equipe de agentes, memória entre chamadas e pendências com dono

- **Estado:** desenho. Nenhum código de produto foi escrito. A seção 8 traz os pedidos de decisão,
  no formato do [`GOVERNANCE.md`](../../GOVERNANCE.md), e diz que fatia espera qual.
- **Data:** 2026-11-13
- **Quem pediu:** o dono, com quatro frentes: equipe de agentes com funções (recepcionista,
  qualificador, agendador, supervisor), regras e escalonamento entre agentes, memória entre chamadas,
  tarefas pendentes e rotinas pós-ligação.
- **Relação com o roadmap:** toca "Transferência assistida", "URA por voz" e "Painel de supervisão
  ao vivo" ([`ROADMAP.md`](../../ROADMAP.md)), sem substituir nenhuma. O construtor visual de
  fluxos continua fora do horizonte, e nada aqui o reintroduz.

## 0. Em uma página

A tese do projeto é que a ligação é o começo de um trabalho ([`VISION.md`](../../VISION.md)). Hoje o
DeskVoice faz bem a primeira metade: atende, usa ferramentas, chama o humano, transfere. A segunda
metade, cumprir o combinado depois que a pessoa desliga, ainda depende de alguém lembrar. A
pendência criada na ligação (`create_task`) vira um aviso no sino do painel, sem dono, sem prazo
cobrado e sem fecho: quando alguém marca como lido, não fica dito se o retorno foi feito.

Por isso este desenho começa pelo fim do trabalho, e não pela equipe de agentes:

1. **Pendência com dono, prazo e fecho**, nascida da ligação e fechada por uma pessoa, com o fecho
   na linha do tempo da chamada.
2. **Memória do número para a equipe**: quem atende, quem recebe a transferência e quem abre a
   pendência vê que aquele número já ligou, o que ficou aberto e o que o agente anotou.
3. **Notas que o agente grava durante a conversa**, com prazo, exportação e apagamento pela tela.
4. **Passagem da ligação entre agentes**, com regras simples configuradas na tela do agente.
5. **Supervisor de regras fixas** depois da ligação: nenhuma chamada termina sem próximo passo.
6. **Memória dentro do contexto do agente**, por último e só se o dono decidir, porque é onde o
   número forjado vira vazamento.

As quatro funções pedidas (recepcionista, qualificador, agendador, supervisor) **não viram tipos no
núcleo**. São agentes configurados por instruções e ferramentas, como já são hoje (a coluna
`agents.role_label` já existe e aparece no painel como "Papel"). O núcleo ganha só o que toda
instalação usa: passar a ligação a outro agente, lembrar de um número e cobrar uma pendência.

## 1. O que cada peça resolve para quem opera

| Peça | Para quem opera, em uma frase | Ligação com a tese |
|---|---|---|
| Pendência com dono e prazo | O retorno prometido ao telefone tem um nome responsável, uma hora e um "feito" que todo mundo vê. | "Cumprir o combinado" deixa de depender de memória humana. |
| Memória para a equipe | Quem pega o caso sabe que a pessoa ligou ontem e o que ficou aberto, sem perguntar de novo. | Onde a IA termina, o humano continua com contexto. |
| Notas do agente | O que a pessoa contou e importa para a próxima vez fica escrito, com prazo para sair. | O trabalho continua entre ligações, e não só dentro de uma. |
| Passagem entre agentes | Cada agente fica curto e bom no que faz, e a ligação chega a quem resolve sem um humano no meio. | O agente que atende não precisa saber tudo para o assunto ter desfecho. |
| Supervisor de regras fixas | Ligação que caiu, transferência que não aconteceu ou aprovação que expirou viram pendência, e não um aviso perdido. | Nada termina em silêncio, nem depois que a pessoa desliga. |
| Memória no contexto do agente | O agente retoma o assunto sem a pessoa repetir tudo. | O mesmo, com o risco da seção 2.5. |

## 2. Memória entre chamadas

### 2.1 O que já existe e serve de base

- Toda chamada guarda `from_e164` e `to_e164` normalizados (`toE164`, em
  [`apps/voice/src/inbound.ts`](../../apps/voice/src/inbound.ts), linha 48).
- Toda chamada recebe um resumo extrativo, sem modelo de IA e sem custo: desfecho, até três falas do
  começo e três do fim, cada uma cortada em 200 caracteres, e as ferramentas usadas
  ([`summarize_call.ts`](../../apps/routines/src/routines/summarize_call.ts)).
- A exportação da 0014 já busca tudo o que a organização guarda sobre um telefone
  ([`privacy/export/route.ts`](../../apps/panel/src/app/api/v1/privacy/export/route.ts)).
- O agente **não recebe** hoje nada sobre quem ligou: a sessão do motor é aberta só com as instruções
  do agente ([`call-session.ts`](../../apps/voice/src/call-session.ts), linha 360).

### 2.2 O que é lembrado, de quem, com que chave

A chave é **(organização, telefone em E.164)**. O telefone é o `from_e164` na ligação recebida e o
`to_e164` na que o sistema fez. Ligação sem número (o tronco não informou, chamada pelo navegador, ou
`@lid` no WhatsApp, seção 5.3 do [desenho do WhatsApp](2026-11-12-ligacao-pelo-whatsapp.md)) não
lembra nem é lembrada. A regra das duas grafias do nono dígito, que o desenho do WhatsApp põe ao lado
de `toE164`, vale aqui também quando chegar.

O que entra na memória, em três tipos:

| Tipo | Onde mora | Quem escreve | Novo? |
|---|---|---|---|
| Ligações anteriores (data, agente, desfecho, resumo) | `calls` | o processo de voz e `summarize_call` | Não. É leitura do que existe |
| Pendências abertas do número | `follow_ups` (seção 3) | `create_task`, o supervisor, a tela | Sim |
| Notas do agente | `caller_notes` | a ferramenta `remember_caller_note`, durante a conversa | Sim |

**Fatos extraídos por modelo de IA depois da ligação não entram nesta versão.** O resumo de hoje é
determinístico e não gasta nada; extrair fatos por modelo seria um gasto novo por chamada, fora do
teto da chamada (que fecha quando ela fecha). A nota escrita pelo próprio agente durante a conversa
entrega o mesmo resultado sem chamada a mais: o modelo já está rodando, e a nota custa os poucos
tokens dos argumentos da ferramenta, dentro do teto da chamada. O ponto de extensão para um resumo
por modelo continua onde está, em `summarize_call.ts`.

`caller_notes` tem `organization_id`, `call_id` (a ligação em que a nota nasceu, com chave composta e
`on delete cascade`), `caller_e164`, `text` (até 300 caracteres) e `created_at`. A cascata só serve
para a ligação apagada não deixar nota órfã; ela **não** é o que aplica o prazo, porque o prazo de
guarda nunca apaga a ligação: `purgeTranscripts` só troca o texto das falas pelo marcador, e a linha
de `calls` fica ([`purge_transcripts.ts`](../../apps/routines/src/routines/purge_transcripts.ts)).
Quem apaga a nota vencida é a própria rotina do prazo, explicitamente (seção 2.4).

### 2.3 Como a equipe vê e apaga

- **Na tela da chamada:** um bloco "Este número" com as ligações anteriores (data, agente, desfecho,
  link), as pendências abertas e as notas, cada nota com o link da ligação em que nasceu.
- **Na transferência e no aviso:** `transfer_to_human` e `notify_human` acrescentam ao aviso de
  painel uma linha como "Este número já ligou 3 vezes; 1 pendência aberta: Retornar sobre o
  orçamento". Nunca o texto das notas. **No WhatsApp, só a contagem** ("Este número já ligou 3
  vezes; 2 pendências abertas"), nunca o título: ele é texto livre escrito pelo modelo, e o WhatsApp
  é um canal fora da instalação. Hoje `notifyHumans` escreve o mesmo texto para todos os canais
  ([`notify.ts`](../../packages/tools/src/notify.ts)); a cópia do WhatsApp passa a ter texto próprio.
- **Apagar uma nota:** botão na nota, com confirmação. Grava `caller_notes_deleted` em
  `organization_events` com quem apagou e a contagem.
- **Esquecer este número:** em Configurações, junto da exportação, por dono ou administrador. Apaga
  as notas do número e pede confirmação nomeando o número
  ([`destrutivo-pede-confirmacao.md`](../doctrine/destrutivo-pede-confirmacao.md)). Apaga também as
  pendências **fechadas** do número (feitas ou canceladas): são histórico, e não obrigação. A tela
  diz o que não sai: as ligações e as falas seguem o prazo de guarda da transcrição, e as pendências
  **abertas** continuam, porque são obrigação da empresa com a pessoa. Grava `caller_notes_deleted`
  com o telefone e as duas contagens, como `caller_data_exported` já grava o telefone.

### 2.4 Prazo de guarda e exportação (0014)

- **Prazo da nota.** A nota é o que a pessoa disse, da mesma natureza da fala. Ela sai com o prazo
  de guarda da transcrição ([`0014`](../decisions/0014-direitos-de-quem-ligou-pela-tela.md)): a
  rotina `purge_transcripts`, na mesma passagem em que troca as falas, chama
  `purgeCallerNotes(q, before)` e **apaga** as notas criadas antes do mesmo limite. A nota é apagada,
  e não trocada por marcador, porque ela não tem lugar numa linha do tempo que precise continuar
  legível. Sem prazo de guarda, a nota fica, como a fala fica. A contagem entra no
  `transcripts_purged` que a rotina já grava (`notes`, ao lado de `count` e `recordings`).
- **Prazo próprio da memória**, só se o pedido de decisão 2 escolher A: uma rotina
  `purge_caller_notes`, que se reagenda uma vez por dia pela fila (`run_at`) como
  `purge_transcripts`, apaga as notas mais velhas que o prazo da memória e grava
  `caller_notes_purged`. Com B, essa rotina não existe.
- **Prazo da pendência.** Pendência aberta nunca sai pelo prazo: é trabalho em curso, e a tela marca
  a que está aberta há mais tempo que o prazo de guarda. Pendência fechada (feita ou cancelada) sai
  com o prazo de guarda da transcrição, contado do fechamento (`closed_at`), na mesma passagem de
  `purge_transcripts`, e a contagem entra no mesmo `transcripts_purged` (`followUps`). Sem prazo de
  guarda, fica, como a fala.
- **Nenhum texto livre em evento.** `follow_up_created`, `follow_up_assigned` e `follow_up_closed`
  levam só o id da pendência, o dono, o prazo e o estado. Título, detalhes e `closing_note` moram só
  em `follow_ups`, que o prazo alcança; num evento, escapariam dele. Na linha do tempo, a tela lê o
  título da pendência pelo id e, se ela já saiu pelo prazo, diz "pendência apagada pelo prazo de
  guarda".
- **Exportação.** A consulta de `POST /privacy/export` ganha a linha `follow_up` na fatia 1, que é
  quando a pendência nasce, e a linha `note` na fatia 3, quando a nota nasce. O operador que atende um
  pedido de titular entrega tudo o que a memória sabe, no mesmo arquivo.
- **Lacuna que já existe e pesa mais com memória.** O resumo extrativo copia falas (as três primeiras
  e as três últimas), e a 0014 diz que o resumo não sai com o prazo. Ou seja: hoje parte da fala
  sobrevive ao expurgo dentro de `calls.summary`. Este desenho **não** põe o resumo no contexto do
  agente (seção 2.6) para não alargar a lacuna, mas a tela da equipe mostra o resumo, como já
  mostra. Corrigir a lacuna é revisão da 0014, e está em riscos (seção 6).

### 2.5 O número exibido pode ser forjado

O produto já trata o número de quem liga como não confiável. `send_whatsapp` pede a confirmação de
uma pessoa antes de escrever para o número exibido numa ligação recebida, a menos que a organização
declare em Configurações que confia nele
([`send_whatsapp.ts`](../../packages/tools/src/tools/send_whatsapp.ts), linhas 128 a 136, e a chave
`whatsapp.trust_caller_id` em [`settings.ts`](../../apps/panel/src/server/settings.ts)). O motivo
escrito no código: "alguém liga fingindo o número de outra pessoa e faz o agente escrever para ela".

Com memória, o mesmo ataque fica pior: alguém liga com o número de uma paciente e pergunta "o que eu
combinei da última vez?". Se o agente tem as notas no contexto, ele pode ler para o impostor o que a
paciente contou. Instrução ao modelo ("não revele as notas") **não é uma barreira**: quem liga pode
insistir, enganar ou pedir que o agente repita o que sabe, e nenhum teste prova que o modelo resiste.

Por isso a memória tem dois níveis, e o desenho trata cada um de um jeito:

| Nível | Quem vê | Risco de número forjado | Como liga |
|---|---|---|---|
| **Equipe** | Pessoas no painel, na transferência e nos avisos | Nenhum para quem liga: o impostor não ouve nada que não ouviria hoje | Pedido de decisão 1 |
| **Agente** | O modelo, durante a conversa | O de cima | Pedido de decisão 4. Fatia 6, a última |

No nível agente, se o dono decidir que entra:

- Liga por organização, só por dono ou administrador, com o aviso de que o número exibido pode ser
  forjado e de que o agente pode repetir o que sabe para quem fingir ser a pessoa. Grava
  `caller_memory_changed`.
- Na ligação que o próprio sistema discou (`direction = 'outbound'`), o número não foi informado por
  quem está do outro lado, e o risco não existe; o mesmo raciocínio que `send_whatsapp` já usa.
- O bloco que o agente recebe nunca traz o resumo nem as falas: só as notas e os títulos das
  pendências abertas.

### 2.6 Como entra no contexto do agente sem estourar custo

Só vale no nível agente (seção 2.5). O processo de voz, ao abrir a sessão, monta um bloco curto e o
acrescenta às instruções:

- até 10 notas, as mais novas, e até 5 títulos de pendência aberta;
- teto de 1 500 caracteres no bloco inteiro, cortando as notas mais antigas primeiro;
- uma frase fixa antes do bloco: as notas vêm do número exibido, e o agente não as lê para quem
  ligou.

**Conta, a partir da tabela de preços do próprio repositório, não medida em ligação:** 1 500
caracteres em português são algo como 400 a 500 tokens de texto (estimativa grosseira). No OpenAI
Realtime, cada resposta reconta a conversa inteira como entrada, quase toda em cache
([`openai-realtime.ts`](../../packages/voice-engine/src/engines/openai-realtime.ts), preço conferido
em 12/11/2026): 450 tokens a US$ 4 por milhão na primeira vez, e a US$ 0,40 nas seguintes, dão menos
de 1 centavo de dólar numa ligação de 30 respostas. No Gemini Live a tabela cobra tudo como áudio
(US$ 3 por milhão, conferido em 10/11/2026); se ele também recontar a cada resposta, o que não foi
conferido, são cerca de 4 centavos de dólar na mesma ligação. O teto de fábrica por chamada é de
500 centavos. O custo entra no medidor da chamada como qualquer outro token: não há conta nova.

`memory_loaded` entra na linha do tempo com o que foi carregado: os ids das notas e das pendências e
o tamanho do bloco, **nunca o texto**. `call_events` não sai com o prazo de guarda, a não ser as
falas; texto de nota dentro de um evento escaparia do prazo.

## 3. Pendências e rotinas pós-ligação

### 3.1 O que já existe

| Peça | O que faz hoje | Arquivo |
|---|---|---|
| `summarize_call` | Resumo extrativo de toda ligação, enfileirado no fim dela | [`summarize_call.ts`](../../apps/routines/src/routines/summarize_call.ts), enfileirado em `call-session.ts` linha 167 |
| `create_task` | O agente agenda uma pendência com título, detalhes e daqui a quantos minutos (até 30 dias) | [`create_task.ts`](../../packages/tools/src/tools/create_task.ts) |
| `follow_up` | Na hora marcada, cria um aviso de painel "Pendência: título", já entregue | [`follow_up.ts`](../../apps/routines/src/routines/follow_up.ts) |
| `deliver_notification` | Entrega aviso por painel, WhatsApp ou webhook, com tentativas | [`deliver_notification.ts`](../../apps/routines/src/routines/deliver_notification.ts) |
| `expire_approval` | Vence o pedido de aprovação e aplica a resposta padrão | `apps/routines/src/routines/expire_approval.ts` |
| Sino de avisos | Os 50 avisos de painel mais recentes, não lidos primeiro; "marcar como lido" | [`notifications/route.ts`](../../apps/panel/src/app/api/v1/notifications/route.ts) |

### 3.2 O que falta

A pendência de hoje é um aviso. Ela não tem dono (aparece para todo mundo, então para ninguém), não
tem fecho (ler não é fazer), some do sino depois de 50 avisos mais novos e não diz na linha do tempo
da chamada se o combinado foi cumprido.

O que entra:

- **Tabela `follow_ups`**: `organization_id`, `id`, `call_id` (de onde nasceu), `caller_e164`,
  `title`, `details`, `owner_user_id` (nulo é "a equipe"), `due_at`, `status` (`open`, `done`,
  `canceled`), `closed_by`, `closed_at`, `closing_note`, `created_at`. Chaves compostas, como toda a
  fundação.
- **`create_task` passa a criar a pendência.** O nome da ferramenta não muda: ele está gravado em
  `agents.tools` de quem já instalou. O dono vem da configuração do agente ("Dono das pendências
  deste agente", na tela do agente), nunca do modelo: o modelo não escolhe pessoa da equipe por nome.
  Sem dono configurado, a pendência é da equipe.
- **Lembrete e vencimento pela fila.** `follow_up` recebe o id da pendência e, na hora marcada, avisa
  o dono pelo painel e, se ele cadastrou WhatsApp e há conector, por WhatsApp. O aviso de painel traz
  o título; o de WhatsApp, só "Você tem 1 pendência vencendo agora no painel do DeskVoice", sem
  título nem detalhes, pela mesma razão da seção 2.3. Se a pendência ainda
  estiver aberta um dia depois do prazo, avisa de novo uma única vez como vencida. Tarefa `follow_up`
  que já estava na fila antes da atualização (payload só com título e detalhes) continua criando o
  aviso de antes: quem atualiza não perde pendência.
- **Tela "Pendências"**: abertas, minhas, vencidas; trocar o dono; fechar com uma nota curta
  ("Retornei, consulta marcada para 14/11") ou cancelar com motivo. Operador fecha as próprias e as
  da equipe; dono e administrador fecham qualquer uma.
- **O fecho aparece na chamada.** `follow_up_created`, `follow_up_assigned` e `follow_up_closed`
  entram em `call_events` da ligação de origem, por `recordEvent` (o mesmo caminho que o
  `task_finished` já usa depois que a ligação acabou). Quem abre a ligação de terça vê, na linha do
  tempo, que o retorno foi feito na quarta e por quem. Os eventos não levam título nem nota de
  fechamento (seção 2.4): a tela os lê da pendência.
- **É dado pessoal novo, e entra com prazo e exportação.** O título, os detalhes e a nota de
  fechamento são texto sobre a pessoa. Até hoje o título e os detalhes viviam só no payload da tarefa
  da fila, que o consumidor apaga 7 dias depois de feita; em `follow_ups` eles ficam. Por isso a
  pendência fechada sai com o prazo de guarda, e a exportação a traz, já na fatia 1 (seção 2.4).
- **Dono que sai da equipe**: pendência de usuário desativado volta para a equipe, e a tela diz.

O que **não** entra: a pendência não liga para ninguém. Retornar a ligação é trabalho de uma pessoa,
ou de uma ligação de saída que passa por `checkOutboundAllowed` e pela política desligada de fábrica
([`ligacoes-de-saida.md`](../doctrine/ligacoes-de-saida.md)). Nada aqui origina chamada.

## 4. Equipe de agentes

### 4.1 Funções são configuração, não código

| Função | O que é, no DeskVoice | O que já dá para fazer hoje | O que falta |
|---|---|---|---|
| Recepcionista | Agente do número: entende o assunto e passa a quem resolve | Instruções e `role_label` | Passar a ligação a outro agente (4.2) |
| Qualificador | Agente que faz as perguntas certas e registra as respostas | Instruções, `create_task`, `call_webhook` | Notas (2.2) e passagem (4.2) |
| Agendador | Agente que marca e remarca | Hoje só anota a pendência para uma pessoa marcar | A ferramenta de agenda, frente própria do roadmap |
| Supervisor | Revisão depois da ligação, que transforma o que ficou sem desfecho em pendência para uma pessoa | Os avisos de painel existentes | A rotina `review_call` (4.4) |

Nenhuma dessas palavras entra em `packages/core` ou `apps/voice`. Regra de nicho, roteiro de
qualificação ou pergunta de triagem mora nas instruções do agente
([`GOVERNANCE.md`](../../GOVERNANCE.md), regras 1 e 2). Um guia com exemplos de instruções para as
quatro funções entra na fatia 4, em `docs/guides/`.

### 4.2 Como um agente passa a ligação para outro

Uma ferramenta nova, `transfer_to_agent`, com `agent` (o nome de um agente permitido), `reason` e
`summary` (para o próximo agente, que não ouviu a conversa: a mesma ideia do `summary` de
`transfer_to_human`).

O que acontece:

1. O agente avisa quem ligou ("vou passar para quem cuida da agenda") e chama a ferramenta. A
   descrição da ferramenta diz quando usar e quando não usar, como as outras.
2. A ferramenta confere o destino contra a lista do agente atual e os limites (abaixo). Recusa com
   mensagem clara ao modelo: o agente continua a conversa.
3. O processo de voz **abre a sessão do próximo agente antes de fechar a atual**, com as instruções,
   as ferramentas, a voz e o motor dele, mais o resumo da passagem. Se a abertura falhar (chave
   ausente, provedor sem resposta em 15 s), o agente atual continua na linha e recebe
   `ok: false` com o que dizer. Quem ligou nunca fica entre dois agentes em silêncio.
4. Aberta a nova sessão, a antiga é fechada (a última medição de uso entra no custo da chamada) e o
   áudio passa a ir para a nova. O transporte, a gravação e a linha de `calls` são os mesmos.
5. O próximo agente fala primeiro, a partir do resumo.

**Regras simples, sem construtor de fluxo:**

- Na tela do agente, "Pode passar a ligação para": uma lista de marcar, com os outros agentes da
  organização. Sem marcar ninguém, a ferramenta não aparece para o modelo. A regra de **quando**
  passar mora nas instruções, em texto, como tudo o que é de nicho.
- O processo de voz acrescenta às instruções uma linha por destino permitido, com nome e papel
  (`role_label`): é assim que o modelo sabe para quem pode passar, já que os parâmetros de uma
  ferramenta são fixos.
- **Os limites são da ligação, não do agente.** Passar não zera o relógio nem o custo. Vale o menor
  teto de custo e a menor duração máxima entre os agentes por onde a ligação passou: passar a
  ligação nunca serve para fugir do teto.
- No máximo 3 passagens por ligação. Na quarta, a ferramenta recusa e indica `transfer_to_human`.
  Constante no código, sem configuração: ninguém pediu outro valor.
- O número de transferência para humano que vale é o do agente em que a ligação está.
- Passar para um humano continua sendo `transfer_to_human`, `notify_human` ou `request_approval`.
  Nenhum agente decide uma aprovação no lugar de uma pessoa ("Humano no comando, no meio da
  ligação", [`VISION.md`](../../VISION.md), crença 2).

### 4.3 Como aparece na linha do tempo

- `agent_handoff`, com o agente de origem, o de destino, o motivo e o resumo. A tela mostra "Passou
  para Agendamento: quer marcar retorno", e as falas seguintes levam o nome do novo agente.
- A recusa e a falha da passagem já aparecem como `tool_result` com `ok: false` e o motivo.
- Se o motor do novo agente cair no meio, vale o caminho de hoje (`engine_failed`, sinal para quem
  está na linha, transferência ou fim).
- **Custo por agente.** A tela de custos agrupa por `calls.agent_id`, que é o agente que atendeu.
  Com passagem, o custo da ligação inteira iria para o primeiro. `usage_ledger` ganha `agent_id`, e
  cada medição leva o agente em que a ligação estava: o custo por agente continua verdadeiro.

### 4.4 O supervisor: regras fixas depois da ligação

Rotina `review_call`, enfileirada no fim de toda ligação junto com `summarize_call`. Não usa modelo
de IA, não gasta e aplica uma lista fixa de casos em que a ligação terminou sem próximo passo:

- o motor caiu (`engine_failed`) ou a ligação foi recusada por motor não configurado, e quem ligou
  tinha número;
- `transfer_to_human` respondeu `ok: false` e nenhuma pendência ou aviso foi criado depois;
- quem ligou desligou com uma aprovação pendente ou uma ferramenta em curso;
- `send_whatsapp` foi recusado ou não confirmado e nenhuma pendência foi criada depois.

Em cada caso, abre **uma** pendência "Retornar para +55…: <o caso em uma frase>", da equipe ou do
dono configurado no agente, com o link da ligação, e grava `follow_up_created` na ligação. No máximo
uma pendência de supervisor por ligação. O que ele não faz: avaliar a qualidade da conversa,
aprovar pedido, ligar para alguém. Revisão por modelo é pedido de decisão (5).

O supervisor humano ao vivo continua sendo a frente "Painel de supervisão ao vivo" do roadmap.

## 5. Onde cada peça mora

| Peça | Arquivo | Convenções |
|---|---|---|
| Tabelas | `db/migrations/<carimbo>_follow_ups.sql`, `<carimbo>_caller_notes.sql`, `<carimbo>_agent_handoffs.sql` (tabela `agent_handoff_targets`, coluna `agents.follow_up_owner_user_id`, coluna `usage_ledger.agent_id`) | Um caminho de schema; `organization_id` em tudo; chaves compostas; RLS como em `organization_events`; o teste de isolamento gerado as cobre sozinho |
| Ponto de escrita das pendências | `packages/core/src/follow-ups.ts` (`createFollowUp`, `assignFollowUp`, `closeFollowUp`) | Um ponto de escrita por entidade, dentro de `withOrg` |
| Ponto de escrita e leitura da memória | `packages/core/src/caller-memory.ts` (`saveCallerNote`, `loadCallerMemory` com o teto de caracteres, `forgetCaller`, `purgeCallerNotes`) | Idem; `purgeCallerNotes` recusa rodar fora de `withOrg`, como `purgeTranscripts` |
| Vocabulário | `packages/core/src/types.ts`: em `CALL_EVENT_KINDS`, `follow_up_created`, `follow_up_assigned`, `follow_up_closed`, `agent_handoff`, `memory_loaded`; em `ORG_EVENT_KINDS`, `caller_memory_changed`, `caller_notes_deleted` e, só com o pedido 2 em A, `caller_notes_purged` | Vocabulário fechado; cada tipo tem tela na linha do tempo |
| Ferramentas | `packages/tools/src/tools/remember_caller_note.ts` (nova, até 10 notas por ligação), `transfer_to_agent.ts` (nova), `create_task.ts` (muda) | Um arquivo por peça; argumento validado com zod; organização vem do contexto, nunca do modelo |
| Telefonia | `apps/voice/src/call-session.ts`: troca de sessão na passagem, limites da ligação, bloco de memória | É capacidade de telefonia (transferir), núcleo pela regra 1 do `GOVERNANCE.md` |
| Rotinas | `apps/routines/src/routines/follow_up.ts` (muda), `purge_transcripts.ts` (muda: apaga as notas e as pendências fechadas vencidas), `review_call.ts` (nova), `purge_caller_notes.ts` (nova, só com o pedido 2 em A) | Um arquivo por rotina; fila por notificação, com `run_at` como relógio |
| Painel | Página `apps/panel/src/app/(app)/follow-ups/`; bloco "Este número" na tela da chamada; "Pode passar para" e "Dono das pendências" na tela do agente; bloco "Memória entre chamadas" e "Esquecer este número" em Configurações, junto da privacidade; dicionários em pt-BR, inglês e espanhol | Configuração pela tela; nenhum texto fora de dicionário; destrutivo pede confirmação nomeando o alvo |
| Exportação | `apps/panel/src/app/api/v1/privacy/export/route.ts`: linha `follow_up` na fatia 1, linha `note` na fatia 3 | 0014 |

Nenhuma peça usa `withSystem`: a memória é lida dentro da organização da chamada, e a fila já tem o
acesso dela. Nenhuma variável de ambiente nova.

**Teto e falha, peça por peça:**

| Peça | Teto | Se falhar, quem ligou ouve | E o painel mostra |
|---|---|---|---|
| Pendência | Uma de supervisor por ligação; `create_task` com o limite de 30 dias que já tem | Nada muda na ligação: a ferramenta devolve ao agente o que dizer | `tool_result` com o erro; lembrete que falhou aparece como `task_finished` falho, e a pendência continua aberta na lista |
| Memória para a equipe | Leitura, sem custo | Nada: não está na ligação | O bloco diz que não pôde carregar |
| Notas | 10 por ligação, 300 caracteres cada | O agente segue sem anotar, com a fala que a ferramenta devolve | `tool_result` com o erro |
| Passagem | 3 por ligação; menor teto de custo e de duração | O agente atual continua e explica | `tool_result` com `ok: false`; `engine_failed` se cair depois |
| Supervisor | Sem custo; uma pendência por ligação | Já desligou | `task_finished` falho; tenta de novo pela fila |
| Memória no agente | 1 500 caracteres; dentro do teto da chamada | A ligação segue sem memória | `memory_loaded` com o erro |

## 6. Riscos e o que não se sabe

- **Número forjado com memória no agente.** É o risco maior, e não há teste que o feche: o
  comportamento do modelo sob insistência não é garantido. Por isso o nível agente é a última fatia e
  depende de decisão.
- **Trecho de fala no resumo, fora do prazo.** O resumo extrativo copia falas, e não sai com o prazo
  de guarda (0014). Não é criado por este desenho, mas a memória para a equipe o deixa mais à vista.
  Caminho provável: o expurgo também trocar o resumo pelo marcador, numa revisão da 0014.
- **Resumo da passagem dentro do evento.** `agent_handoff` guarda o resumo escrito pelo modelo, como
  `transfer_started` já guarda hoje, e esse texto não sai com o prazo. Mesma lacuna dos argumentos de
  ferramenta, já descrita na 0014.
- **Silêncio na passagem.** A nova sessão precisa conectar antes de falar. Quanto tempo isso leva em
  cada motor não foi medido; o prazo de conexão de hoje é 15 s. A fatia 4 mede e decide se o agente
  atual precisa de uma frase de espera.
- **Troca de instruções sem nova sessão.** Não foi conferido se os motores aceitam trocar instruções
  e ferramentas no meio de uma sessão aberta. O desenho usa sessão nova porque funciona em qualquer
  motor, inclusive no simulado.
- **Recontagem de tokens no Gemini Live.** O custo da seção 2.6 para o Gemini supõe o pior caso. Não
  conferido.
- **Confiança no número do WhatsApp.** O número vem da conta do WhatsApp, e não de um campo que o
  tronco repassa. Pode ser mais difícil de forjar, mas não foi medido, e este desenho o trata como
  qualquer número exibido.
- **Uso real.** Não se sabe quantas pendências e notas uma instalação típica cria, nem se a tela de
  pendências vira o lugar de trabalho da recepção ou mais uma aba esquecida. A fatia 1 é a que mede.
- **Mudança de comportamento para quem já instalou.** `create_task` passa a criar uma pendência com
  tela própria. O aviso no sino continua; a nota de versão diz o que mudou
  ([`versionamento.md`](../doctrine/versionamento.md)).

## 7. Fatias de entrega

Cada fatia é um PR verificável sozinho, revisado por uma sessão distinta da que escreveu. A ordem
segue um critério: primeiro o que mais muda o dia de quem opera e não cria dado pessoal novo nem
mexe na ligação ao vivo; por último o que pode vazar dado.

### Fatia 1: a pendência tem dono, prazo e fecho

`follow_ups`, `packages/core/src/follow-ups.ts`, `create_task` criando a pendência, `follow_up` com
lembrete e vencimento, compatibilidade com a tarefa antiga na fila, "Dono das pendências" na tela do
agente, página Pendências, os três eventos na linha do tempo, a linha `follow_up` na exportação, e a
pendência fechada saindo com o prazo de guarda em `purge_transcripts`.

**Por que primeiro:** é a promessa feita ao telefone que hoje mais se perde, e o conserto não toca no
áudio nem chama provedor. O dado novo que ela guarda (a pendência que dura além dos 7 dias da tarefa
da fila, e a nota de fechamento) entra com prazo e exportação no mesmo PR.

**Prova:** `pnpm verify` e `pnpm test:db`: pendência criada numa chamada simulada nasce com o dono do
agente; com relógio injetado, o lembrete sai na hora e o aviso de vencida sai uma vez; o aviso de
WhatsApp não traz o título; fechar grava `follow_up_closed` na linha do tempo da ligação de origem,
sem título nem nota no payload; tarefa `follow_up` com o payload antigo ainda cria o aviso; dono
desativado devolve a pendência à equipe; com prazo de guarda, a pendência fechada antes do limite
sai e a aberta fica, e `transcripts_purged` conta as que saíram; a exportação de um número traz as
pendências dele e só da organização de quem pede; o teste de isolamento gerado cobre `follow_ups`.
Teste de tela: simular uma chamada cujo roteiro chama `create_task`, ver a pendência em "Minhas",
fechar com uma nota e ver o fecho na tela da chamada.

### Fatia 2: a memória do número para a equipe

Bloco "Este número" na tela da chamada (ligações anteriores, pendências abertas) e a linha de
contexto em `transfer_to_human` e `notify_human`. Só leitura do que já existe.

**Por que segunda:** dá à recepção o contexto de quem ligou sem guardar nada novo e sem o modelo
ver nada, então o número forjado não muda de risco.

**Prova:** testes de banco: o mesmo número em duas organizações nunca mostra a ligação da outra;
ligação sem número não mostra bloco; o aviso de painel traz contagem e títulos; o aviso de
`notify_human` que sai por WhatsApp (o da transferência só vai ao painel) traz só a contagem, sem
título, nota nem resumo. Teste de tela: duas chamadas simuladas do mesmo número, e a segunda mostra a
primeira.

**Depende de:** o pedido de decisão 1. A fatia pode ser escrita e revisada antes da resposta, mas só
entra depois que ela chegar ou o prazo dela vencer (vale A).

### Fatia 3: as notas do agente, com prazo, exportação e esquecimento

`caller_notes`, `remember_caller_note`, `purgeCallerNotes` chamada por `purge_transcripts`, bloco
"Memória entre chamadas" em Configurações, apagar nota, "Esquecer este número", a linha `note` na
exportação, os eventos da organização. Com o pedido 2 em A, também a rotina `purge_caller_notes` e o
campo de prazo da memória; em B, nenhum dos dois.

**Por que terceira:** é o dado pessoal novo de maior volume, e entra com prazo, exportação e
apagamento no mesmo PR, nunca depois.

**Prova:** testes de banco: a ferramenta recusa a 11ª nota; com relógio injetado, `purge_transcripts`
apaga as notas anteriores ao limite e conta `notes` em `transcripts_purged`, e sem prazo de guarda
não apaga nada; `purgeCallerNotes` recusa rodar fora de `withOrg`; a exportação de um número traz as
notas dele e só da organização de quem pede; esquecer um número apaga as notas e as pendências
fechadas dele, deixa as abertas e grava o evento com as contagens. Com A, a nota sai com o prazo que
vencer antes, e a nota anterior à escolha de um prazo não é apagada na atualização (pedido 2).
Teste de tela: a confirmação de "Esquecer" nomeia o número e diz que as pendências abertas ficam.

### Fatia 4: a ligação passa de um agente para outro

`transfer_to_agent`, `agent_handoff_targets`, a troca de sessão em `call-session.ts`, limites da
ligação, `usage_ledger.agent_id`, `agent_handoff` na tela, "Pode passar para" na tela do agente, o
guia das quatro funções.

**Por que quarta:** é a mudança dentro da ligação ao vivo, o caminho mais delicado do sistema; entra
depois que as pendências e a memória para a equipe já dão ao humano o contexto quando algo der
errado.

**Prova:** testes com o motor simulado: dois agentes, o roteiro do primeiro passa ao segundo, e a
linha do tempo mostra `agent_handoff` e as falas do segundo; o segundo sem chave deixa o primeiro na
linha com `ok: false`; o teto de custo vale o menor dos dois e o relógio não zera; a quarta passagem
é recusada; destino fora da lista é recusado; o custo de cada parte fica no agente certo. Numa VPS,
com motor real: uma ligação de verdade passando da recepção para outro agente, com uma pessoa
escrevendo quanto tempo ouviu de silêncio na troca.

### Fatia 5: o supervisor de regras fixas

`review_call` enfileirada no fim de toda ligação, com os quatro casos da seção 4.4.

**Por que quinta:** depende das pendências (fatia 1) e fica mais útil com a passagem já existindo,
mas não depende dela.

**Prova:** um teste de banco por caso, com a chamada montada por eventos; uma ligação sem nenhum
caso não abre pendência; a mesma ligação revista duas vezes (nova tentativa da fila) não abre duas.

### Fatia 6: a memória no contexto do agente, só se o pedido 4 decidir que entra

`loadCallerMemory` com o teto, o bloco nas instruções, `memory_loaded`, o interruptor com o aviso em
Configurações, a regra da ligação de saída.

**Prova:** testes de banco: o bloco nunca passa de 1 500 caracteres e corta as notas mais antigas;
nunca traz resumo nem fala; nota de outra organização com o mesmo número nunca entra; com o
interruptor desligado, nada entra numa ligação recebida; `memory_loaded` não leva texto. O que
nenhum teste prova, e o PR diz: que o modelo não lê as notas para quem insiste.

## 8. Pedidos de decisão ao dono

Pedidos de decisão no formato do [`GOVERNANCE.md`](../../GOVERNANCE.md). A fatia 1 não espera
nenhum deles. As fatias 2 e 3 podem ser escritas e revisadas já, mas só entram depois da resposta ao
pedido 1, ou do prazo dele (a fatia 3 também espera o pedido 2). A ordem das fatias 2 a 4 é o pedido
3; a fatia 6 é o pedido 4.

### Decisão: a memória vem ligada ou desligada de fábrica?

**Quem decide:** dono do projeto
**O que está parado esperando:** a entrada das fatias 2 e 3 (as duas podem ser escritas antes)

#### Opções
- **A.** Memória para a equipe ligada; notas só gravadas por agente que tiver `remember_caller_note`
  marcada na tela; memória no agente desligada. Custo: a recepção passa a ver, na tela da chamada,
  ligações anteriores do número, que hoje ela já acha na lista de Chamadas. Nenhum dado novo é
  guardado sem alguém ligar a ferramenta.
- **B.** Tudo desligado até alguém ligar em Configurações. Custo: a capacidade que mais ajuda quem
  opera fica escondida de quem não procura, e mais um interruptor para explicar.
- **C.** Tudo ligado, inclusive no agente. Custo: toda instalação que atualizar passa a expor notas
  ao número exibido sem ninguém decidir, contra a regra 7 do `GOVERNANCE.md` e o raciocínio da
  [`0016`](../decisions/0016-gravacao-desligada-de-fabrica.md).

#### Recomendação
A, porque mostra à equipe o que ela já tem direito de ver, e deixa cada dado novo atrás de uma
escolha feita na tela.

#### Se ninguém responder em 14 dias, vale: A

A é reversível: a memória para a equipe é leitura, e desligá-la não apaga nada.

#### Não medido
Se a recepção quer ver as ligações anteriores dentro da tela da chamada ou prefere a lista de
Chamadas filtrada por número. Ninguém operou ainda.

### Decisão: por quanto tempo a memória dura?

**Quem decide:** dono do projeto
**O que está parado esperando:** fatia 3

#### Opções
- **A.** 90 dias de fábrica, ajustável entre 30 e 365 na tela, e nunca mais que o prazo de guarda da
  transcrição, quando houver um. Custo: uma rotina diária a mais; e apagar é irreversível.
- **B.** O prazo de guarda da transcrição, e nada além dele (vazio guarda para sempre, como hoje).
  Custo: na instalação que nunca preencheu o prazo, as notas ficam para sempre, e é dado que a pessoa
  contou ao telefone.
- **C.** 30 dias fixos. Custo: perde o retorno de quem liga a cada estação (revisão de seis meses,
  renovação anual), e mais uma regra sem tela.

#### Recomendação
A, porque memória de atendimento serve ao próximo contato, e guardar para sempre o que a pessoa
contou não serve a ela.

#### Se ninguém responder em 14 dias, vale: B

A apaga dado, e o padrão de um pedido sem resposta tem que ser o caminho reversível. B não apaga nada
além do que a organização já escolheu no prazo de guarda. A fatia 3 entra com B e muda para A no
dia em que o dono responder.

**B só é aceitável como padrão porque nenhuma nota nasce sozinha.** Ela só existe quando o agente
chama `remember_caller_note`, e o agente só a tem quando alguém a marca na tela dele. Na instalação
que nunca marcou a ferramenta, B guarda para sempre zero notas. Se algum dia a nota passar a nascer
sem essa escolha (extraída depois da ligação, por exemplo), B deixa de servir como padrão, e este
pedido volta a ser aberto.

**A troca de B para A não apaga, na atualização, as notas de quem nunca escolheu um prazo.** Quem
atualiza não é surpreendido ([`GOVERNANCE.md`](../../GOVERNANCE.md), regra 7), e mudança de padrão
não apaga dado de quem já o tem (o mesmo raciocínio da
[`0016`](../decisions/0016-gravacao-desligada-de-fabrica.md), em que ligar ou desligar a gravação não
apaga nada). Na versão que traz A, a organização que já tem notas e nunca gravou um prazo de memória
fica sem prazo de memória até alguém escolher um na tela, e a tela e a nota de versão dizem isso. Os
90 dias de fábrica valem para a organização que ainda não tem nota nenhuma.

#### Não medido
Em quanto tempo uma pessoa costuma ligar de novo para o mesmo negócio. Nenhuma instalação tem
volume que mostre isso.

### Decisão: a equipe de agentes entra antes ou depois da memória?

**Quem decide:** dono do projeto
**O que está parado esperando:** a ordem das fatias 2 a 4

#### Opções
- **A.** Depois: pendências, memória para a equipe, notas, passagem entre agentes, supervisor,
  memória no agente (a ordem da seção 7). Custo: quem quer recepcionista e agendador separados espera
  três PRs.
- **B.** Antes: pendências, passagem entre agentes, e só então a memória. Custo: a primeira mudança
  na ligação ao vivo chega antes de a equipe ter o contexto do número quando algo der errado, e a
  passagem sem memória ainda faz a pessoa repetir o assunto para cada agente numa segunda ligação.
- **C.** A passagem entre agentes não entra; o encaminhamento espera a frente "URA por voz". Custo:
  cada agente precisa saber tudo, e as instruções crescem até o modelo errar.

#### Recomendação
A, porque as duas primeiras fatias mudam o dia da recepção sem tocar no áudio, e a passagem é a
mudança mais delicada do desenho.

#### Se ninguém responder em 7 dias, vale: A

#### Não medido
Quantas instalações já usam mais de um agente por número de hoje, contornando com instruções longas.

### Decisão: o agente pode receber a memória do número exibido?

**Quem decide:** dono do projeto
**O que está parado esperando:** só a fatia 6

#### Opções
- **A.** Não nesta versão. A memória é da equipe; o agente não a recebe. Custo: quem liga repete o
  assunto para o agente, e o agente não retoma o que ficou aberto.
- **B.** Sim, ligado pela tela, por organização, só por dono ou administrador, com o aviso de que o
  número pode ser forjado; e sempre na ligação que o próprio sistema discou. O bloco nunca traz
  resumo nem fala. Custo: numa ligação forjada, o agente pode repetir as notas para quem finge ser a
  pessoa; a instrução contra isso não é garantia.
- **C.** Sim, sempre ligado. Custo: o de B, em toda instalação, sem ninguém ter escolhido.

#### Recomendação
B, porque o mesmo padrão já vale para `send_whatsapp` (`whatsapp.trust_caller_id`) e deixa a escolha
com quem responde pelo dado, que é cada empresa.

#### Se ninguém responder em 14 dias, vale: A

A não guarda nem expõe nada, e é reversível.

#### Não medido
Como os modelos em uso (gpt-realtime e Gemini Live) se comportam quando quem liga insiste em ouvir
o que o agente sabe. Não há como medir isso de forma que prove ausência de vazamento.

### Decisão: o supervisor usa modelo de IA?

**Quem decide:** dono do projeto
**O que está parado esperando:** nada nas fatias 1 a 6; um PR futuro de revisão por modelo

#### Opções
- **A.** Só regras fixas, sem modelo (seção 4.4). Custo: não pega a promessa dita em voz e não
  anotada ("vou pedir para te ligarem") quando nenhuma ferramenta foi chamada.
- **B.** Regras fixas e, depois, revisão por modelo de cada ligação, com teto de gasto mensal da
  organização na tela e evento por revisão. Custo: um gasto por ligação que hoje não existe, fora do
  teto da chamada, e um texto a mais com dado pessoal a cuidar no prazo de guarda.
- **C.** Sem supervisor. Custo: ligação que caiu e não tinha transferência fica só num aviso no sino.

#### Recomendação
A agora, porque cobre os casos que o sistema já sabe que deram errado, sem custo; B só com pedido
próprio, quando houver medida de quantas promessas ficam sem pendência.

#### Se ninguém responder em 14 dias, vale: A

#### Não medido
Quantas ligações terminam com promessa feita em voz e nenhuma pendência. Medir pede ler transcrições
de instalações reais, o que nenhuma sessão deste desenho fez.

## 9. Fora deste desenho

Construtor visual de fluxos; agente que decide aprovação no lugar de uma pessoa; pendência que liga
para alguém; extração de fatos por modelo depois da ligação; memória compartilhada entre
organizações; ferramenta de agenda (frente própria do roadmap); painel de supervisão ao vivo (frente
própria do roadmap).
