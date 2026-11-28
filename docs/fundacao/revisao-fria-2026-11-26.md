# Revisão fria do DeskVoice v0.50.0

Revisor sem participação na construção e sem o contexto de quem constrói: um agente novo, chamado
pela sessão que mantém o projeto, com o pedido do método da Fábrica (fase 7) e o roteiro da
`conformidade.md`. Cópia lida: uma cópia limpa da etiqueta `v0.50.0`, commit `b11dea1b`
(`chore(release): 0.50.0`). Data: 26/11/2026. Nada foi editado, nada foi para servidor, nenhum
Docker subiu.

**Três achados de segurança ficaram fora deste arquivo.** Pela política de
[`SECURITY.md`](../../SECURITY.md), eles foram para o relato privado do GitHub, com evidência e
passos: dois importantes e uma suspeita. A numeração abaixo foi refeita sem eles, e as contagens
desta página não os incluem. O texto abaixo é o parecer como o revisor o entregou,
sem esses três itens.

## 1. Veredito

**Lançaria com ressalvas.** Não achei nenhum bloqueador pelos critérios pedidos:

- a instalação padrão de uma linha funciona;
- não vi vazamento de dado entre organizações;
- o teto do mês vale nas quatro portas e falha fechado;
- não há caminho que ligue para alguém sem passar pela política.

As ressalvas são de três tipos.

- **Um controle legal mais fraco do que o texto diz.** O aviso de gravação é falado pelo modelo e
  pode ser cortado. Mesmo assim, o evento que serve de prova é gravado sempre.
- **Lacunas de auditoria em ações sensíveis.** Tirar número da lista de não ligar não deixa
  registro. Quem fez a ligação de saída também não fica gravado.
- **Gastos e procedimentos de servidor mais frouxos do que a documentação promete.** O trabalho
  depois da ligação não respeita o teto do mês. Uma transcrição não é medida. O backup não é
  agendado. A troca de servidor entre versões falha no fim.

O item mais perto de bloquear é o 3.1, se a operação ligar as ligações de saída.

## 2. Bloqueadores

Nenhum.

Um item chegou perto, e por isso abre a lista dos importantes: o aviso de gravação (3.1). Ele não
bloqueia porque o aviso é tentado em toda ligação, as ligações de saída nascem desligadas e o
recebimento por operadora ainda está marcado como "aguardando prova real". Ele passa a bloquear
se a divulgação disser que o aviso é garantido, ou se a operação usar ligação de saída.

## 3. Importantes

### 3.1 O aviso de gravação pode não chegar a quem ligou, e o evento que o prova é gravado sempre

**O que está errado**

O aviso é pedido ao modelo de voz como instrução. Ele pode ser interrompido pela fala de quem
atende. Mesmo assim, o evento `recording_notice` é gravado na hora do atendimento,
independentemente do que tocou.

A doutrina e o guia de conformidade prometem mais que isso:

- `docs/doctrine/ligacoes-de-saida.md:58-61`: "A chamada começa com o aviso de que a conversa é
  registrada. O aviso é um evento na linha do tempo [...] o que permite conferir depois que ele
  foi dado."
- `docs/guides/conformidade-brasil.md:147`: "Aviso de gravação | Informa, no início, que a
  conversa é registrada | Sempre".
- `.agents/skills/deskvoice-operar/SKILL.md:97`: "`recording_notice` | O aviso de gravação foi
  falado".

**Evidência**

- `apps/voice/src/call-session.ts:2091`: `event("recording_notice", { text: recordingNotice })`.
  Está no mesmo `Promise.all` do atendimento, antes de qualquer áudio do aviso.
- Na saída, `apps/voice/src/call-session.ts:2099-2102` chama `session.say(recordingNotice)` logo
  depois de atender.
- No OpenAI Realtime, `say` é um pedido ao modelo:
  `packages/voice-engine/src/engines/openai-realtime.ts:551-554`, ``instructions: `Say exactly
  the following to the caller, in ${config.language}, without adding anything: "${text}"` ``.
  Esse texto é traduzido para o idioma do agente.
- A mesma sessão interrompe a resposta quando a pessoa fala: `openai-realtime.ts:143`,
  `turn_detection: { type: "semantic_vad", ..., interrupt_response: true }`.
- No Gemini Live, `say` também passa pelo modelo: `gemini-live.ts:591-592`,
  `realtimeInput: { text: literalSpeech(...) }`.
- A gravação abre antes do aviso: `call-session.ts:1999`, `openRecording`. Por isso o "alô" de
  quem atende já fica gravado antes de ele ouvir o aviso.

**Quem é afetado**

Toda organização que grava, sobretudo nas ligações de saída. Nelas quem atende diz "alô" no exato
momento em que o aviso começa. Na auditoria, a linha do tempo mostra "aviso dado" mesmo quando a
pessoa não ouviu.

**Como conferir**

Ler as linhas acima. Para reproduzir: numa ligação real de saída pelo OpenAI Realtime, falar
"alô, quem é?" por cima do início. A transcrição do agente (`transcript_agent`) não terá o aviso
inteiro, e a linha do tempo terá `recording_notice` assim mesmo.

### 3.2 Tirar um número da lista de não ligar não deixa registro, e quem fez a ligação de saída também não

**O que está errado**

A lista de não ligar é o controle que a doutrina chama de "quem pediu para não ser chamado não é
chamado". Hoje:

- tirar um número da lista apaga a linha sem nenhum registro;
- a sessão de suporte da instalação tem permissão para isso;
- a ligação de saída feita pelo painel não guarda quem a pediu.

Somados, os três deixam alguém remover o pedido de uma pessoa e ligar para ela sem que nada mostre
quem fez.

**Evidência**

- `apps/panel/src/app/api/v1/do-not-call/route.ts:23-24`:
  `if ((await q.exec("delete from do_not_call where e164 = $1", [body.number])) === 0) throw notFound();`.
  Não há `recordOrgEvent` nem no `DELETE` nem no `POST`.
- `fences/support-session-routes.ts:110`:
  `allow("do-not-call", "DELETE", "tira número da lista de não ligar")`. A linha 106 também
  permite `calls/outbound`.
- `apps/voice/src/internal-api.ts:54`: o corpo da ligação de saída é
  `z.strictObject({ organizationId, agentId, toE164 })`. Não leva `userId`, ao contrário das
  ligações pelo navegador e da pausa de gravação.
- Nem o `insert` da chamada nem o `call_refused` guardam quem pediu: `apps/voice/src/outbound.ts:50-56`.

**Quem é afetado**

O dono da organização e quem responde pela lista diante de uma reclamação. Pesa mais numa
instalação com vários clientes e sessão de suporte.

**Como conferir**

Tirar um número da lista pela tela. Depois procurar em `organization_events` e na auditoria da
instalação: não há linha. Pedir duas ligações de saída com usuários diferentes: as linhas em
`calls` ficam iguais.

### 3.3 O trabalho pago depois da ligação ignora o teto de gasto do mês

**O que está errado**

O teto do mês recusa a chamada nova nas quatro portas. Mas classificar o desfecho, fazer a análise
e transcrever (a automática e o botão "Transcrever") só conferem o teto por ligação do agente.
Assim, uma organização que bateu o teto continua gastando.

Isso contraria a frase da tela da instalação. `apps/panel/src/i18n/pt-BR/installation.ts:68` diz
"No teto, toda ligação nova é recusada". Quem lê essa frase entende que o mês ficou fechado para
gasto novo.

**Evidência**

Nenhum destes caminhos chama `spendCapReached`:

- desfecho e análise: `apps/routines/src/routines/classify_call_outcome.ts:290` e `:343`;
- transcrição automática: `apps/routines/src/routines/transcribe_call.ts:138`;
- o botão da tela: `apps/panel/src/app/api/v1/calls/[id]/transcription/route.ts:176`.

`spendCapReached` só aparece nas portas de entrada, nos testes do agente e na religação.

**Quem é afetado**

Quem usa o teto do mês para fechar o orçamento de um cliente.

**Como conferir**

Pôr o teto em zero. Depois apertar "Transcrever" numa chamada gravada e sem texto, abaixo do teto
do agente. O pedido sai e o custo entra no extrato.

### 3.4 A transcrição de quem ligou no motor OpenAI Realtime não é medida

**O que está errado**

Toda sessão do OpenAI Realtime pede ao provedor uma transcrição à parte, com o modelo
`gpt-4o-mini-transcribe`. Esse consumo não entra no extrato, no teto por ligação nem no teto do
mês. É o motor que o README chama de provado numa instalação real.

**Evidência**

- O modelo é pedido em `packages/voice-engine/src/engines/openai-realtime.ts:517-518`, com
  `transcription: { model: TRANSCRIBE_MODEL, ...`. A constante está na linha 135.
- O evento que traria o consumo é lido sem `usage`. Linha 208:
  `z.object({ type: z.literal("conversation.item.input_audio_transcription.completed"), transcript: z.string() })`.
  Nas linhas 444-445 ele só emite o texto.
- Só o `response.done` vai ao medidor (linhas 465-467).
- O preço certo já está no mesmo arquivo, `TRANSCRIBE_PRICING`, nas linhas 152-158. Hoje ele só é
  usado na transcrição de gravação.
- O desenho do próprio projeto conta essa transcrição a "US$ 0,003/min [...] (é o que roda hoje)":
  `docs/specs/2026-11-14-transcricao-pura.md:124`.

**Quem é afetado**

Toda ligação pelo OpenAI Realtime. O valor é pequeno, mas quebra a regra "todo custo é medido"
(antipadrão 14 do `AGENTS.md`). Ele também some da conferência contra a fatura.

**Como conferir**

Procurar `input_audio_transcription.completed` no arquivo: nenhum consumo é lido.

**Ressalva**

Que a OpenAI cobra essa transcrição à parte é a leitura do próprio desenho do projeto. Não
reconferi a página de preços.

### 3.5 Teto de custo por ligação igual a zero quer dizer "sem teto", e nenhuma tela diz isso

**O que está errado**

O formulário do agente aceita zero, e a sessão trata zero como "sem teto". A tela diz só "Teto de
custo, em dólares" e "Ao atingir um dos limites, o agente avisa quem está na linha e encerra". Quem
digita 0, ou 0,004, que vira 0 no arredondamento, espera o contrário.

O guia de custos diz que "O pior caso de gasto simultâneo passa a ser o teto por chamada vezes esse
limite". Essa conta não vale para o agente com zero.

**Evidência**

- `apps/panel/src/server/shapes.ts:58`: `costCeilingCents: z.number().int().min(0)`.
- `apps/voice/src/call-session.ts:692-695`: "Zero é \"sem teto\"".
- `apps/panel/src/i18n/pt-BR/agents.ts:148,152`.
- `docs/guides/custos.md:146`.

O padrão de agente novo é seguro (US$ 5): `db/migrations/20261110T230000_foundation.sql:100`.

**Quem é afetado**

Quem zera o campo achando que trava o gasto. A duração máxima continua limitando, até 2 horas.

**Como conferir**

Salvar um agente com teto 0. A ligação segue até a duração máxima, sem o fim por custo.

### 3.6 O backup não é agendado, e agendá-lo exige editar um arquivo por SSH

**O que está errado**

O instalador agenda o agente de atualização, mas não o backup. O único caminho é `crontab -e`, à
mão. A saúde também não avisa quando não há backup recente.

Isso contraria três frases:

- o README diz que "Nenhum recurso exige SSH para ser ligado" (`README.md:69`);
- o `AGENTS.md` diz que "Nada que exija editar arquivo à mão na VPS entra";
- a conformidade 11.2 diz que nenhum passo pede editar arquivo.

Quem instala e nunca lê o `install/README.md` só tem os backups que a atualização faz.

**Evidência**

- `install/backup.sh:16`: "Agendar todo dia às 3h: crontab -e → 0 3 * * * ...".
- `install/README.md:65` e `:341-342`.
- Não há `backup` no agendamento do instalador: `install/_common.sh:804-876` agenda só o
  `deskvoice-agent`.
- `install/healthcheck.sh` só menciona backup na linha de disco (`:356-357`).

**Quem é afetado**

Toda instalação nova.

**Como conferir**

Depois de instalar, `ls /etc/cron.d` e `systemctl list-timers`: só aparece o agente.

### 3.7 Trocar de servidor com um backup de versão anterior falha na última conferência, já depois da troca, e deixa os serviços parados

**O que está errado**

Com `--with-config`, `restore.sh` roda as migrations antes da contagem final. Se o backup é de uma
versão anterior ao código instalado, as migrations acrescentam linhas em `schema_migrations`, que
entra na contagem. Pode acrescentar em outras tabelas também. A contagem final diverge, e o script
morre com "Depois da troca, o banco não bate com o backup". O banco já foi trocado, e ninguém
religa painel, voz e rotinas.

Não se perde dado: o banco restaurado está no lugar, e o anterior fica guardado. Mas a mensagem
manda parar e pedir ajuda, com tudo fora do ar.

**Evidência**

- `install/restore.sh:114-117`: `&& dc run --rm migrate`.
- A contagem vem depois, em `:121-127`.
- `install/_common.sh:776`: a contagem pega toda tabela base do esquema `public`.
- `packages/core/src/migrate.ts:52`: `insert into schema_migrations`.

**Quem é afetado**

Quem segue o passo a passo de "Trocando de VPS" (`install/README.md:336`): instala a versão mais
nova na máquina nova e restaura um backup antigo. O README, na linha 176, diz que esse caminho não
foi provado, mas o guia manda fazê-lo.

**Como conferir**

Ler `restore.sh:102-127`. Reproduz com Postgres de verdade; os testes do kit usam Docker simulado e
não mostram isso.

### 3.8 "Se as imagens não baixam, nada foi alterado" só vale para as três imagens do DeskVoice

**O que está errado**

`update.sh` baixa antes só as imagens do DeskVoice, e as do WhatsApp quando ligadas. Se a versão
nova muda o resumo fixo do Postgres, do Asterisk ou do Caddy, essa imagem só é baixada no `up`.
Isso acontece depois das migrations. Uma falha de rede nesse ponto vira a volta completa, com o
banco restaurado do backup. Contraria duas frases do `install/README.md`:

- linha 87: "Se as imagens não baixam, para sem alterar nada";
- linha 459: "nada foi alterado [...] com o banco intocado".

**Evidência**

- `install/update.sh:257`: `dc pull -q $APP_SERVICES`. As linhas 268 e 275 cuidam de waha e
  wacalls.
- `:293`: `dc run --rm migrate`.
- `:297`: `dc up -d --remove-orphans || roll_back ...`.
- `install.sh:535` baixa tudo antes; `update.sh` não.

**Quem é afetado**

A atualização que troca uma imagem de terceiros.

**Como conferir**

`grep -n pull install/update.sh`: Postgres, Asterisk e Caddy não aparecem.

## 4. Menores

1. **O segundo comando de instalação do README para numa clonagem normal.**
   - `README.md:60` diz "O mesmo resultado, passo a passo: git clone ... && cd DeskVoice && bash
     install/install.sh". O clone fica na `main`.
   - `install/install.sh:246-250` para se o código não for o da última etiqueta.
   - A mensagem dá o `git checkout` certo e o `get.sh` faz isso sozinho, mas o comando escrito
     não é "o mesmo resultado" sempre que a `main` andou depois da versão.
2. **O pipeline da 0.50.0 é anunciado como "Pronto nesta organização", mas não há caminho
   documentado para escolher as peças.**
   - A escolha é "gravada pela API do agente, no campo `pipeline`" (`README.md:157`).
   - Não existe token de API: a única autorização com `Bearer` é a do agente de atualização, em
     `apps/panel/src/server/update.ts:124-125`.
   - Nenhum guia ou skill diz como fazer essa chamada: `docs/guides/voz.md` não fala dela.
   - O próprio roteiro admite que um nome de campo errado devolve "ok" sem gravar nada
     (`ROADMAP.md:26-27`).
   - O texto do painel está em `apps/panel/src/i18n/pt-BR/agents.ts:61`.
3. **O guia de custos não fala do teto de gasto do mês nem dos custos que não são da voz.**
   - "Como o DeskVoice limita" (`docs/guides/custos.md:130-153`) lista só os limites por agente,
     os simultâneos e o teto diário de saída.
   - Nenhum guia em `docs/guides/` menciona o teto do mês.
   - Também faltam os cérebros, a ElevenLabs, a TypeSafe, a análise, a transcrição e os testes do
     agente. Fere a conformidade 2.8.
4. **`SECURITY.md:98-99` contradiz o README.** Ele diz "Nenhuma atualização pela tela rodou de
   ponta a ponta numa instalação real". O `README.md:178` e o
   `docs/fundacao/instalacao-real.md:156` e `:213` registram duas.
5. **O `ARCHITECTURE.md:45` está velho sobre o WaCalls.** Diz "Nesta versão só conecta o número:
   o atendimento chega na fatia seguinte" e põe o bloco em "Configurações → Ligação pelo
   WhatsApp". O atendimento está provado (`README.md:160`), e o bloco foi para "Linha telefônica"
   na 0.46.0.
6. **O `ROADMAP.md` está velho em três pontos.**
   - Linha 25: "Aviso de gravação antes da saudação (hoje sai logo depois)". O código já põe o
     aviso na frente: `apps/voice/src/session-config.ts:28`.
   - Linhas 31-32 e 38 tratam o pipeline e a ligação pelo WhatsApp como futuro.
   - `README.md:195` diz que "várias empresas na mesma tela" não existe, ao lado de uma área da
     instalação com Visão geral de várias organizações.
7. **A lista "contatos com fora" do README está incompleta.**
   - `README.md:290-314` não cita a imagem do WaCalls, baixada do `ghcr.io` pelo agente ao instalar
     a ligação pelo WhatsApp.
   - Também não cita os cérebros (Anthropic, DeepSeek, OpenRouter, Gemini), que leem a transcrição
     quando escolhidos para a análise ou para o pipeline.
   - Nem cita a TypeSafe e a ElevenLabs.
   - Relacionado: a transcrição e a voz de fora pedem confirmação nomeando o fornecedor
     (`apps/voice/src/call-session.ts:1393-1400`), e o filtro e os analistas também pedem. O
     cérebro que recebe a conversa inteira no pipeline não pede: não há `consent` para `brain`.
     Não é promessa quebrada, porque não achei doutrina que exija isso, mas o tratamento é
     desigual.
8. **A organização criada por `create-owner` nasce sem a trava de saída da instalação.**
   - `packages/core/src/limits.ts:268-270`: só `addOrganization` copia os padrões. Sem linha de
     limites, vale `outboundAllowed: true` (`:47`).
   - O `README.md:179` diz que a nova "nasce [...] com a saída bloqueada".
   - A política da própria organização continua desligada, então não liga sozinha.
9. **A cerca de saída guarda menos do que o desenho diz.**
   - `fences/outbound-requires-policy.test.ts:13-14` só procura `.originate(` num arquivo que não
     cita `checkOutboundAllowed`.
   - Escapam `const { originate } = ari`, `ari["originate"]`, um `fetch` direto ao ARI e o plano
     de discagem em `deploy/asterisk/`.
   - O cabeçalho da cerca admite parte disso. O `docs/specs/2026-11-10-fundacao-design.md:67` diz
     que ela prova "quem origina chamada passa por `checkOutboundAllowed`".
   - Hoje o único `originate` real fica atrás da checagem: `apps/voice/src/outbound.ts:48` e `:68`.
10. **A lei diz "sem SQL fora de `packages/core`", e a cerca não cobra isso.**
    - `docs/doctrine/isolamento.md:38` e `AGENTS.md:199` dizem a regra.
    - `fences/no-raw-sql-outside-core.test.ts` só barra importar `pg` e chamar `.query(`. Há
      centenas de `q.one/many/exec` com SQL em `apps/`.
    - O isolamento se sustenta pelo RLS, mas o texto e a cerca divergem.
11. **O comentário da migration de fundação promete mais que o `SECURITY.md`.**
    - `db/migrations/20261110T230000_foundation.sql:9-11` diz que SQL injetado numa consulta de
      organização não alcança as outras.
    - O `SECURITY.md:72-76` admite o contrário: com injeção, `set_config('app.organization_id', ...)`
      troca de organização.
    - Também: `app.env` leva a conexão do papel de sistema, que atravessa organizações, aos três
      processos (`install/_common.sh:232-233`).
12. **O "O que o CI reprova" do `AGENTS.md` diz mais do que os jobs fazem.**
    - "Instalação nova e atualização a partir da última versão" é só um teste de migrations
      (`.github/workflows/ci.yml:141-158`), sobre um banco com uma linha em `organizations`
      (`.github/scripts/upgrade-from-last-release.ts:26`).
    - O job de instalação usa `--build` (`ci.yml:314`). Por isso o CI nunca exercita o caminho
      padrão: escolher a versão pela etiqueta, baixar as imagens publicadas, `update.sh`, a volta,
      e backup e restauração com Postgres de verdade.
    - `SECURITY.md:94-99` e o antipadrão 8 admitem parte disso.
13. **O `install/README.md` não lista todas as peças essenciais da saúde.**
    - "Módulos SIP" é essencial: `install/healthcheck.sh:107` e `:120`. Dá código 1 e pode
      provocar a volta de uma atualização, mas não está na lista em `install/README.md:83` e
      `:322-323`.
    - A lista do código 2 também não cita "Ligação pelo WhatsApp" (`healthcheck.sh:302-310`).
14. **O registro do suporte não aparece na tabela de capacidades do README.** O suporte da
    instalação existe por API (`apps/panel/src/app/api/v1/installation/organizations/[id]/support/route.ts`)
    e fica registrado nas duas pontas, mas o README não o cita.
15. **Os dados gravados durante a atualização se perdem na volta.** O backup é feito em
    `install/update.sh:111`, e as aplicações seguem atendendo até `:292`, depois de baixar as
    imagens. Está dito ("Nada se perdeu além do que entrou durante a tentativa", `:165`), mas a
    janela inclui o download.

## 5. Suspeitas não confirmadas

Todas vêm de leitura de código, sem execução.

- **O aviso de gravação pode sair depois da primeira resposta do agente.** Na saída pelo OpenAI, se
  a detecção de voz responder ao "alô" antes, o `say` vai para a fila (`openai-realtime.ts:389-396`).
- **A transcrição do pipeline pode deixar consumo fora do extrato** (`packages/voice-engine/src/transcribers/openai.ts`):
  - item `.failed` não emite consumo (`:165-171`);
  - item sem `usage` e sem marcas de fala não é medido (`:216-221`);
  - itens pendentes no fechamento são descartados (`:224-233`).
- **A classificação pode passar do teto por ligação**, porque confere o gasto feito e não o
  próximo pedido (o código admite em `classify_call_outcome.ts:340-342`). No pipeline, a conferência
  antes de cada pedido cobre só o cérebro, não a voz (`pipeline.ts:628-640`).
- **A mensagem de WhatsApp da ligação que caiu não reconfere a lista de não ligar na hora do envio**
  (`apps/routines/src/routines/deliver_notification.ts:70-104`). Só confere na revisão.
- **O teto diário por linha pode zerar com a troca do número da linha.** Ele conta por
  `from_e164` (`apps/voice/src/outbound-policy.ts:76`), e o número é editável na tela da linha
  (`apps/panel/src/app/api/v1/trunks/[id]/route.ts:55`).
- **Não há trava comum entre `update.sh`, `restore.sh` e `install.sh`.** Só `agent.sh` e
  `backup.sh` travam. Uma atualização pelo terminal pode cruzar com uma pedida pela tela.
- **A senha do dono vinda de `--answers` fica exportada no ambiente** de processos filhos até
  `install.sh:388`: o script do Docker e a descoberta do IP. Nunca vai em argumento, como o README
  diz.
- **A cópia dos arquivos do Asterisk no backup engole falha:** `install/backup.sh:84`, com `|| true`.

## 6. O que li e o que não li

**Li inteiros**

- `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `install/README.md`;
- `conformidade.md` e a seção 7 do método;
- `CHANGELOG.md` das versões 0.45.0 a 0.50.0;
- `SECURITY.md` ("Limites conhecidos"), o `ROADMAP.md` até "A seguir" e
  `docs/doctrine/ligacoes-de-saida.md` (trecho);
- `docs/guides/conformidade-brasil.md` (trecho), `docs/guides/custos.md` (limites e IA de voz).

**Li no código**

- abertura da sessão de chamada, aviso de gravação, teto por ligação e pipeline:
  `call-session.ts` em trechos, `session-config.ts`, `pipeline-choice.ts`, `server/pipeline.ts`;
- os `say` dos motores OpenAI e Gemini;
- `outbound.ts` e a consulta do teto diário em `outbound-policy.ts`;
- `erasures.ts` (o apagamento cobre os tipos de evento com texto, inclusive os da 0.50.0);
- a rota de configurações e o armazenamento das chaves;
- a aprovação padrão, que falha fechada;
- a porta do WhatsApp com o teto do mês;
- `restore.sh` (troca e conferência), `update.sh` (baixar, migrar, subir), o portão de versão do
  `install.sh`, `table_counts`;
- as cercas de saída, de colunas de segredo e de escritor único de eventos;
- o job de instalação do CI.

**Por quatro revisores paralelos**, com escopo estreito e sem receber as minhas hipóteses:

- custos e tetos;
- ligações de saída;
- isolamento entre organizações;
- kit de instalação.

Conferi pessoalmente, no código, cada achado deles que entrou nas seções 3 e 4. O que não consegui
conferir ficou na seção 5.

**Testes rodados pelos revisores**

- `fences/outbound-requires-policy.test.ts`: 2/2 verdes.
- `system-access-is-allowlisted`, `no-raw-sql-outside-core` e `every-table-has-organization-id`:
  7/7 verdes.
- `install/test/run.sh` com os filtros backup (68), update (220), get (24), version (159) e
  install-entry (65): todos verdes.

Nenhum `*.db.test.ts` rodou, porque pedem Docker.

**Não li**

- as telas do painel (só os dicionários citados);
- o motor Gemini Live por inteiro;
- as ferramentas em `packages/tools` além da aprovação;
- as rotinas além das citadas;
- o conector do DeskcommCRM (0.49.0);
- o Laya;
- os desenhos em `docs/specs` (só os trechos citados);
- os READMEs em inglês e espanhol (só a linha do pipeline);
- a skill de instalar por inteiro;
- os testes de tela, linha a linha.

Da coluna de prova do README, conferi por amostra que cada "teste de tela do CI" citado tem um
arquivo em `apps/panel/test/e2e/`: pipeline, várias organizações, faixa sobreposta, queda com
religação e com WhatsApp, área da instalação, vocabulário, ambiente, menu, esquecer o número,
notas e histórico. Não achei divergência entre o nível declarado e os testes. Uma exceção: a
"sonda de dois casos" dos testes do agente (`README.md:170`) não está no repositório e não se
reproduz a partir dele.

**Não fiz**

- não abri o painel num navegador;
- não rodei o instalador;
- não fiz ligação de nenhum tipo.

Nada aqui substitui a instalação real e o uso pelo dono.
