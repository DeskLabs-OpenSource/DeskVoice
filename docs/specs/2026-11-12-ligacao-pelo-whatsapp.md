# Ligação pelo WhatsApp, atendida pelo agente (WaCalls)

- **Estado:** desenho. Nenhum código de produto foi escrito. Antes da primeira fatia, os pedidos de
  decisão da seção 10 viram issues.
- **Data:** 2026-11-12
- **Frente do roadmap:** "Ligação pelo WhatsApp" ([`ROADMAP.md`](../../ROADMAP.md)), tamanho G.
- **Quem decidiu fazer:** o dono. O que ainda é dele está na seção 10, cada item com o padrão que vale
  sem resposta. O resto são escolhas de construtor, abertas à revisão.

## 1. Em uma página

Quem liga para a empresa pelo WhatsApp é atendido pelo mesmo agente que atende o telefone: mesma
conversa, ferramentas, aviso de gravação, aprovação humana, teto de custo e de duração, linha do
tempo e resumo. Só o transporte muda, como na chamada pelo navegador
([registro 0008](../decisions/0008-chamada-pelo-navegador.md)).

O WaCalls é um serviço em Go que se conecta ao número como mais um aparelho vinculado (QR Code) e
entrega o áudio da ligação a um par WebRTC, por um canal de dados chamado `pcm`, em PCM16 mono a
16 kHz. No WaCalls esse par é o navegador de uma pessoa. Aqui, o par é o processo de voz
(`apps/voice`): ele abre a conexão WebRTC dentro da rede interna do Docker, converte 16 kHz para os
8 kHz do resto do sistema e entrega o áudio a `startCallSession`, como faz com o AudioSocket e com o
WebSocket do navegador.

O que torna isso viável sem porta nova na internet: o par WebRTC está na mesma rede interna que o
WaCalls, e a perna até o WhatsApp é de saída. O DeskcommCRM publica uma porta UDP porque o par dele é
o navegador de quem opera; aqui não há navegador no caminho do áudio. **Isso é leitura de código, não
medição** (seção 4.2).

O que pode impedir o recurso, em ordem de gravidade, está na seção 9: a imagem publicada do WaCalls é
de julho e só existe no canal `develop`; há relatos abertos de chamada cortada aos 20 segundos e de
chamada sem áudio de volta; e o número pode ser bloqueado, porque o WaCalls usa um protocolo do
WhatsApp obtido por engenharia reversa. A primeira fatia existe para medir isso antes de qualquer
promessa.

## 2. O que o WaCalls faz de fato

Lido em 12/11/2026, num clone só de leitura de <https://github.com/JotaDev66/WaCalls>, sem executar
nada. Há dois estados muito diferentes do projeto, e quase tudo o que importa está no segundo:

| Ramo | Commit | Data | O que tem |
|---|---|---|---|
| `main` (e a etiqueta `v1.0.0`) | `edeb31f` | 25/06/2026 | API **sem autenticação** (o README diz "run it only on a trusted LAN"), sem imagem Docker, binários na release `v1.0.0` |
| `develop` | `d16a076` | 27/07/2026 | Login obrigatório, token para automação, webhooks, Postgres opcional, imagem Docker publicada, 407 commits |

### 2.1 Lido no código (`develop`, `d16a076`)

| Pergunta | Resposta | Onde |
|---|---|---|
| Como pareia | QR Code, como aparelho vinculado, pela biblioteca `whatsmeow`. `POST /api/sessions` cria a conta e já inicia o pareamento; o código sai no SSE (`auth-state` com `state: "qr"` e o código) | `internal/app/session/session.go:212-238` |
| Formato do áudio | PCM16 LE mono, 16 kHz, nos dois sentidos, num canal de dados WebRTC de rótulo `pcm`, que o par cria. Por dentro, o WaCalls codifica em MLow (quadros de 960 amostras, 60 ms) e manda por SRTP aos relays do WhatsApp | `internal/app/session/bridge.go:12-14, 37-47`; `internal/voip/codec/mlow/codec_test.go:15` |
| Cadência | O WaCalls guarda no máximo 4 quadros (240 ms) do áudio recebido do par e **descarta o mais antigo** acima disso. Quem manda áudio mais rápido que o tempo real perde fala | `internal/voip/extension/audio/audio.go:71-81` |
| Rede do par WebRTC | Com `WACALLS_WEBRTC_UDP_PORT`, abre um mux UDP só na interface da rota padrão; com `WACALLS_PUBLIC_IP`, reescreve o candidato. Sem a porta, usa portas efêmeras e o endereço das interfaces | `internal/app/webrtc.go:11-39` |
| Uma perna por chamada | Uma nova troca de SDP para a mesma chamada substitui e fecha a anterior | `internal/app/session/session.go:274-290` |
| Par que cai | A chamada fica de pé 30 s esperando o par voltar; depois é encerrada | `session.go:55-57, 296-305` |
| Eventos | SSE em `GET /api/events`: `session-list`, `session-qr`, `auth-state`, `incoming`, `incoming-claimed`, `call-status` (`starting`, `ringing`, `connected`, `reconnecting`, `ended`), `call-ended` (com `reason`), `call-list` (retrato ao conectar), `call-quality`, `call-mark`, `call-relay`, `call-peer-mute`, `ping` | `internal/app/events/broker.go:118-180, 203, 222`; `callregistry.go:16-20, 63, 139, 198` |
| Motivos de fim | `user_ended`, `declined`, `timeout`, `busy`, `cancelled`, `failed`, `do_not_disturb`, `unknown` | `internal/voip/core/types.go:32-39` |
| Prazos | Toque e atendimento 60 s, mídia 30 s para conectar, 5 s sem mídia do outro lado derruba, 75 s para reconectar, 4 h no máximo | `internal/voip/call/callmanager_timeout.go:20-25, 71-78` |
| Autenticação | Não sobe sem administrador (`WACALLS_ADMIN_USER` e `WACALLS_ADMIN_PASSWORD` semeiam o primeiro). Toda rota `/api` exige cookie de login ou `Authorization: Bearer <WACALLS_API_TOKEN>`, comparado em tempo constante. `/healthz` é aberta. O token também é aceito em `?access_token=` | `internal/app/server.go:76-91`; `internal/app/auth.go:17-53`; `internal/app/routes.go:60-64` |
| Dono da chamada | `X-Client-Id` vira o dono; um dono só segura uma chamada ativa (`409 operator already on a call`) | `internal/app/handlers_call.go:107-128` |
| Atender | `POST .../calls/{id}/accept`. Não há atendimento automático | `handlers_call.go:107-128` |
| Saída | `POST /api/sessions/{sid}/calls` com `{ phone }`. O destino é montado com os dígitos, sem consulta (`types.NewJID`) | `internal/app/session/commands.go:27-42` |
| Quem ligou | O peer chega como JID. Se vier como `@lid` (número oculto), o WaCalls tenta achar o telefone no próprio cadastro; se não achar, fica o `@lid` | `internal/app/session/contacts.go:54-63` |
| Teto | `-max-calls-per-session`, padrão 8 | `cmd/server/main.go:26` |
| Re-parear | `POST /sessions/{sid}/pair` troca o cliente do WhatsApp, mas o subsistema de chamadas continua preso ao cliente antigo (o defeito que o DeskcommCRM mediu, seção 7) | `session.go:335-340` |

### 2.2 O que só o README afirma

- "Stable": chamadas de entrada e saída chegam a `ACTIVE` com áudio nos dois sentidos.
- A imagem tem cerca de 30 MB. (Medido no registro: 18,5 MB comprimidos em amd64. Em disco, não
  medido.)
- Imagens em `ghcr.io/jotadev66/wacalls` com as etiquetas `:latest`, `:develop`, `:vX.Y.Z` e as
  variantes `-pure`. **No registro, em 12/11/2026, só existem `develop`, `develop-pure` e etiquetas
  `sha-*`.** Não há `latest` nem `v1.0.0`.
- Webhooks assinados (`call.ringing`, `call.active`, `call.ended`), fila em memória que descarta sob
  falha.

### 2.3 Imagem, licença, atividade

| Item | Medido | Como |
|---|---|---|
| Imagem | `ghcr.io/jotadev66/wacalls:develop`, índice `sha256:9ff52ef9455cf42125a911c38bb8c855f0cc205516cada2054e5c05546909022`, amd64 e arm64, criada em 27/07/2026 do commit `d16a076` (rótulo `org.opencontainers.image.revision`). Variante com codificador nativo (cgo). `develop-pure`: `sha256:a71693da089968950c574a8c80a99220df496de27a4cfda4f29c2457e29bb29a` | API do registro, sem baixar a imagem |
| É a mesma do DeskcommCRM | Sim, o mesmo resumo, hoje, na `main` do DeskcommCRM (`docker-compose.prod.yml`, serviço `wacalls`) | `gh api` no arquivo |
| Licença | MIT. O codec MLow embutido traz a licença MIT de origem | `LICENSE`; `internal/voip/codec/mlow/LICENSE` |
| Quem mantém | JotaDev66 (dono) e Joseph Fernandes (`jobasfernandes`), que escreveu a maior parte do `develop` | `git log` |
| Atividade | Último commit de código no `develop`: 27/07/2026. Depois disso, só PRs do Dependabot (o último push no repositório é de 07/10/2026). 316 estrelas, 150 forks, 9 issues abertas | API do GitHub |
| Dependência central | `whatsmeow` (MPL-2.0), cujo README lista chamadas entre o que **não** implementa: a camada de chamada do WaCalls é dele | README do `whatsmeow` |

### 2.4 Issues abertas que pesam

- **#38** (14/07): em `v1.0.0`, o WhatsApp encerra a chamada sozinho entre 20 e 22 s, com áudio nos
  dois sentidos. Sem resposta. Não se sabe se o `develop` corrige.
- **#59** (aberta hoje, 12/11): chamada de saída em `ACTIVE`, o áudio sai, nenhum áudio do outro
  lado chega. Relata também que, com a versão do `whatsmeow` fixada na `main`, parear falha com
  "Client outdated (405)". A única resposta do dono: "Utilize a branch develop".
- **#31** (02/07): pede atualizar o `whatsmeow` por causa do pareamento com chave de acesso
  (passkey). O `develop` usa uma versão de 13/07, posterior ao ajuste citado; se ela ainda pareia
  hoje, **não foi medido**.

## 3. O caminho de uma ligação

Entre parênteses, o evento que já existe em `call_events`. Nenhum tipo novo de evento é preciso.

1. **Toque.** Alguém liga para o número pelo WhatsApp. Tocam o celular principal, os aparelhos
   vinculados e o WaCalls. O WaCalls emite `incoming` e `call-status: ringing`.
2. **Entrada.** O processo de voz, que mantém uma conexão SSE com o WaCalls, recebe `incoming`. A
   sessão do WaCalls aponta para a organização; a organização tem um agente escolhido para atender o
   WhatsApp. Na mesma transação da entrada por tronco (`inbound.ts:57-83`), confere agente ligado e
   teto de recebidas, e cria a linha em `calls` com `direction = 'inbound'`, `from_e164` = quem ligou
   (normalizado, seção 5.3) e `to_e164` = o número conectado.
3. **Não atender.** Agente ausente ou desligado, ou teto atingido: grava `call_refused` e o aviso no
   painel, **e não atende nem recusa no WhatsApp**. A ligação continua tocando no celular e nos
   aparelhos de quem trabalha; ninguém do outro lado ouve silêncio de máquina. (Recusar pelo aparelho
   vinculado pode encerrar a ligação em todos; não medido. Na dúvida, não mexer é o lado seguro.)
4. **Atendimento.** O processo de voz abre o par WebRTC (`POST .../calls/{id}/webrtc`, com um
   `X-Client-Id` próprio da chamada), depois atende (`POST .../accept`). A troca de SDP antes do
   atendimento é o que o cliente do WaCalls e o DeskcommCRM fazem (spec 18, §5.3).
5. **Conversa.** `startCallSession` com o transporte do WhatsApp: aviso de gravação e saudação
   (`call_started`, `call_answered`, `recording_notice`), falas (`transcript_user`,
   `transcript_agent`), ferramentas, aprovação, custo (`tool_called`, `tool_result`,
   `approval_requested`, `approval_decided`, `cost_ceiling_reached`). `call_started` leva
   `channel: "whatsapp"`, como a chamada pelo navegador leva `channel: "web"`.
6. **Áudio.** Do WhatsApp: 16 kHz → `resample` → 8 kHz → motor. Do motor: 8 kHz → `resample` →
   16 kHz, na cadência real de 20 ms por pedaço (o WaCalls descarta o que passar de 240 ms, seção
   2.1). `clearAudio` esvazia a fila local quando quem ligou fala por cima.
7. **Fim.** Quem ligou desliga (`call-ended` do WaCalls → `onHangup`), o agente encerra
   (`end_call`, teto, tempo máximo → `DELETE .../calls/{id}`), o motor cai (bipe, depois encerra) ou a
   perna WebRTC cai (o WaCalls segura 30 s e encerra). Grava `call_ended` e enfileira o resumo
   (`task_queued`).
8. **Tela.** A chamada aparece em Chamadas como qualquer outra, com o canal "WhatsApp" e o número de
   quem ligou.

## 4. Onde cada peça mora

### 4.1 Peças

| Peça | Arquivo | O que faz |
|---|---|---|
| Serviço | `deploy/docker-compose.yml`, serviço `wacalls` no perfil `whatsapp-calls` | Imagem fixada por resumo, rede `internal`, **nenhuma porta publicada**, volume `wacalls-data:/data`, `mem_limit` a medir na fatia 1 |
| Chaves | `install/_common.sh`, uma função `ensure_wacalls` como `ensure_waha` | Gera em `deploy/.env` `WACALLS_API_TOKEN` e o par usuário e senha do administrador do WaCalls, aleatórios e nunca mostrados (ninguém entra na tela dele). Só o serviço `wacalls` e o `voice` os recebem |
| Ligar e desligar o serviço | `install/agent.sh`, `converge_whatsapp_calls`; terceiro campo na resposta da rota do agente | Igual ao WAHA (seção 6) |
| Banco | Uma migration: tabela `whatsapp_call_sessions` | `organization_id`, `service_wanted`, `session_name`, `wacalls_session_id`, `status`, `failure`, `phone_e164`, `connected_at`, `agent_id`, `updated_at`; RLS e índice único por organização, como `whatsapp_sessions`. Mais as colunas do estado do serviço em `update_agent_status` |
| Cliente do WaCalls | `apps/voice/src/wacalls-client.ts` | HTTP com Bearer e SSE com reconexão e espera crescente. Toda resposta validada com zod. Só o processo de voz fala com o WaCalls |
| Entrada e saída do canal | `apps/voice/src/whatsapp-calls.ts` | Lê o SSE, resolve a sessão, cria a chamada, atende, abre o par e inicia a conversa; guarda o QR Code em memória para a tela; reconcilia com o `call-list` a cada reconexão |
| Transporte | `apps/voice/src/whatsapp-transport.ts` | `CallTransport` sobre o canal `pcm`, com conversão de taxa |
| Cadência | `apps/voice/src/pacer.ts`, extraída de `web-transport.ts` | A fila de saída em 20 ms hoje vive dentro do transporte do navegador (`web-transport.ts:58-98`). O segundo usuário é o motivo para extraí-la, em vez de copiar |
| API interna | `apps/voice/src/internal-api.ts`, rotas novas | Estado, QR Code, conectar, desconectar e o resultado da saúde, para o painel |
| Painel | `apps/panel/src/server/whatsapp-calls.ts`, rotas em `apps/panel/src/app/api/v1/whatsapp-calls/`, bloco em Configurações, dicionários `whatsapp-calls` em pt-BR, en e es | O painel fala com o processo de voz, nunca com o WaCalls |
| Saúde | `apps/panel/src/server/health.ts`, linha `whatsapp_calls` em `HEALTH_ORDER` | Seção 5.5 |

O cliente mora em `apps/voice`, e não ao lado do WAHA em `packages/tools/src/connectors/`, porque
ninguém mais precisa dele: nenhuma ferramenta fala com o WaCalls, e o QR Code chega pelo mesmo SSE que
o processo de voz já mantém aberto. O token fica num processo só.

### 4.2 Convenções do `AGENTS.md`

| Convenção | Como fica |
|---|---|
| Um arquivo por peça | Não é ferramenta nem motor; é um transporte e uma entrada, um arquivo cada. Nenhuma lista central muda |
| Configuração pela tela | Instalar o serviço, conectar o número, escolher o agente e desligar: tudo em Configurações. Nenhum passo por SSH |
| Variável de ambiente | Só as três que o instalador gera. Nenhuma liga o recurso; o que liga é o pedido na tela |
| Tudo tem log | O vocabulário de `call_events` basta. Conectar e cair viram `notifications`, como no WAHA ([registro 0012](../decisions/0012-whatsapp-por-qr-code.md), "Alternativas descartadas") |
| `withOrg` | A entrada resolve a organização pela sessão do WaCalls e grava dentro de `withOrg`. A busca da sessão pelo id do WaCalls atravessa organizações: vira uma função em `packages/core/src/routing.ts`, ao lado de `resolveInboundRoute`, que faz o mesmo para o tronco. Nenhum arquivo novo entra na lista de `withSystem` |
| Opcional, desligado de fábrica | Perfil do Compose que só existe onde foi pedido; sem pedido, nada é baixado |
| Entrada externa com zod | Eventos do SSE e respostas HTTP do WaCalls |
| Segredo cifrado | Nenhum segredo do operador vai ao banco: o token e a senha do WaCalls ficam em `deploy/.env`, gerados pelo instalador, como a chave do WAHA |
| Relógio e porta em teste | Teste com WaCalls falso em porta `0` e `Clock` injetado |

### 4.3 Rede, sem porta nova (a confirmar)

Pelo código (seção 2.1): sem `WACALLS_WEBRTC_UDP_PORT` e sem `WACALLS_PUBLIC_IP`, o WaCalls anuncia o
endereço das interfaces do contêiner, que na rede `internal` é alcançável pelo contêiner `voice`. A
perna até os relays do WhatsApp é de saída, e a rede `internal` do Compose tem saída. Por isso o
desenho não publica porta nenhuma. A fatia 2 prova isso; se não valer, a alternativa é fixar
`WACALLS_WEBRTC_UDP_PORT` sem publicá-la.

### 4.4 O par WebRTC no Node

O processo de voz precisa de uma biblioteca que fale WebRTC com canal de dados. Duas candidatas,
conferidas no npm em 12/11/2026:

| Biblioteca | Versão | Licença | Observação |
|---|---|---|---|
| `werift` | 0.27.0 | MIT | TypeScript puro; pede Node 22 ou mais, que é o do projeto |
| `node-datachannel` | 0.33.6 | MPL-2.0 | Liga a `libdatachannel`, nativa. A imagem base é Alpine (musl); se há binário pronto para ela, não foi conferido |

Recomendação: `werift`, por não trazer código nativo para a imagem. Nenhuma das duas foi testada
contra o WaCalls. O teste de contrato da fatia 2 é que decide.

## 5. Ligação com o que já existe

### 5.1 Teto de simultâneas e de custo

- **Recebidas ao mesmo tempo:** a ligação pelo WhatsApp conta no mesmo teto das recebidas pela
  operadora (`inbound.max_concurrent_calls`), na mesma trava por organização. Para quem atende, uma
  ligação recebida é uma ligação recebida, e o gasto com o motor é o mesmo. A consulta de
  `inbound.ts:78-81` já conta linhas com `to_e164` preenchido; o comentário dela e o texto da tela
  passam a dizer "pela operadora e pelo WhatsApp".
- **No WaCalls:** `-max-calls-per-session=50`, o máximo que a tela aceita para o teto
  (`inboundLimitSchema`, de 1 a 50). Quem limita é o DeskVoice; o do WaCalls fica como segunda trava.
- **Custo e duração por chamada:** vêm de `call-session.ts` sem mudança. O WhatsApp não cobra por
  minuto; o único custo é o do motor, medido como sempre.

### 5.2 O agente que atende

Um agente por número conectado, escolhido no bloco de Configurações (`whatsapp_call_sessions.agent_id`).
Sem agente escolhido, o serviço pode estar de pé e o número conectado, mas nada é atendido: a tela diz
isso, e a linha de saúde fica em aviso.

### 5.3 Quem ligou, e a lista de não ligar

- O telefone de quem ligou vem do JID (`55319…@s.whatsapp.net`) e passa por `toE164`. Muitos celulares
  brasileiros estão registrados no WhatsApp **sem o nono dígito** (medido pelo DeskcommCRM, spec 18,
  §4.1). O número gravado é o que o WhatsApp informa; a comparação com a lista de não ligar e com
  contatos considera as duas grafias. A regra fica num lugar só, em `packages/core`, junto de
  `toE164`.
- Se vier só o `@lid`, `from_e164` fica nulo e a linha do tempo diz que o WhatsApp não informou o
  número. Ferramentas que escrevem para "o número da ligação" respondem ao modelo que não há número.
- **Lista de não ligar:** não se aplica a quem liga. Ela impede o DeskVoice de ligar para alguém, não
  impede alguém de ser atendido. Vale integralmente na saída (5.6).

### 5.4 Transferência para humano

Não há para onde transferir. A ligação do WhatsApp não passa pelo Asterisk, e o WaCalls não tem
transferência. A primeira entrega fica assim:

- O transporte declara que não transfere. `call-session.ts` passa a ler isso num ponto só: o
  `transferTo` de teto de custo e de motor caído vira nulo, e o desfecho é encerrar com a fala de
  despedida.
- `transfer_to_human` recebe no contexto que o canal não transfere e responde ao modelo: "nesta
  ligação não há como transferir; ofereça deixar um recado (notify_human)". Sem registrar
  `transfer_started`, que seria falso.

A chamada pelo navegador hoje registra uma transferência que não acontece (`web-transport.ts:26-29`).
O mesmo ajuste corrige isso, mas fica fora daqui: é outra decisão.

Transferir de verdade, ligando para o `transfer_to_e164` pelo tronco e cruzando o áudio das duas
pernas no processo de voz, é possível e vira pedido de decisão (seção 10, item 6).

### 5.5 Saúde

Uma linha nova, `whatsapp_calls`, no mesmo estilo de `whatsappLine` (`health.ts:149-158`):

| Estado | Linha |
|---|---|
| Serviço não pedido | ok: não instalado |
| Pedido, preparando | ok: preparando |
| O agente do servidor não conseguiu subir | aviso, com o motivo |
| De pé, o processo de voz não alcança o SSE | aviso: serviço fora do ar |
| De pé, sem número | aviso: sem número |
| Número conectado, sem agente escolhido | aviso: ninguém atende |
| Número caiu (`auth-state` `logged_out`) | aviso: desconectado, com a dica dos 14 dias abaixo |
| Número conectado e agente escolhido | ok |

O WhatsApp desconecta os aparelhos vinculados se o celular principal ficar mais de 14 dias sem uso
([central de ajuda](https://faq.whatsapp.com/378279804439436/?cms_platform=android), conferida em
12/11/2026). A tela diz isso quando o número cai.

### 5.6 A ligação de saída

Fica fora das quatro primeiras fatias. Se o dono decidir que entra (seção 10, item 1), ela nasce
desligada e passa por `checkOutboundAllowed` com `lineE164` igual ao número conectado: política
ligada, janela, lista de não ligar, teto diário e tentativas por contato. A cerca
`outbound-requires-policy` já reprova outro caminho. O destino precisa ser o endereço que o WhatsApp
registrou (o nono dígito de novo); onde o WAHA estiver conectado, a consulta `check-exists` dele
resolve isso, como no DeskcommCRM.

## 6. Instalação pela tela

Igual ao WAHA, pelo mesmo caminho ([registro 0010](../decisions/0010-atualizar-pela-tela.md),
[registro 0012](../decisions/0012-whatsapp-por-qr-code.md)):

1. Configurações → "Ligação pelo WhatsApp": "Serviço não instalado", o custo medido e o risco de
   bloqueio, com o botão "Instalar o serviço de ligação pelo WhatsApp" (dono e administrador).
2. O painel grava `service_wanted`. A resposta da rota do agente ganha um **terceiro campo**, com nome
   próprio: `whatsappCalls`. Ele cumpre as quatro condições do registro 0010:
   (a) é estado desejado; (b) a ação inteira está no kit, com a imagem que o Compose fixa;
   (c) é reversível e não apaga dado (o volume com o pareamento fica); (d) o agente confere disco e
   memória antes. O registro 0010 ganha uma linha, como ganhou com o WAHA.
3. O agente sobe o perfil `whatsapp-calls`, marca `DESKVOICE_WHATSAPP_CALLS=on` em `deploy/.env` e
   conta o estado na fala seguinte, com os mesmos códigos do WAHA.
4. Com o serviço de pé, "Conectar número": o painel pede ao processo de voz, que cria a sessão no
   WaCalls (`POST /api/sessions` com o nome derivado do id da organização). O QR Code chega pelo SSE
   e a tela o mostra, consultando a cada 5 s só enquanto espera a leitura. A pessoa lê com
   WhatsApp → Aparelhos conectados.
5. Escolher o agente que atende.
6. "Desconectar": `logout` e depois `DELETE` da sessão no WaCalls. Remover o serviço só sem número
   conectado, com confirmação nomeando o número.

**Quanto pesa.** Imagem de 18,5 MB comprimida (registro, 12/11/2026). Memória parado e com número
conectado, e espaço em disco: **não medidos**; a fatia 1 mede, e o registro e a tela passam a dizer o
número medido, como fizeram com o WAHA. O DeskcommCRM usa `mem_limit: 256m`, que é teto escolhido, não
medição.

**Backup.** O volume `wacalls-data` não entra, pelo mesmo motivo do `waha-sessions`: é a credencial
viva de um aparelho.

## 7. WaCalls e WAHA no mesmo número

**Podem, pelo limite do WhatsApp.** O WhatsApp aceita até quatro aparelhos vinculados ao celular
principal, e as contas com até quatro recebem ligação em todos
([central de ajuda, aparelhos vinculados](https://faq.whatsapp.com/378279804439436/?cms_platform=android);
[central de ajuda, multiatendimento](https://faq.whatsapp.com/395911122612120/?cms_platform=android),
conferidas em 12/11/2026). WAHA e WaCalls ocupam dois desses quatro. Com mais de quatro (Meta Verified
ou Meta One), **a ligação só toca no celular principal**, e o WaCalls deixa de receber: a tela precisa
dizer isso.

**O DeskcommCRM roda os dois no mesmo número** por decisão de produto, com o risco aceito (spec 18,
§1.2, item 1), e mediu ligações numa VPS em 15/09/2026 com o WAHA da mesma organização de pé
(spec 18, §4.1). Não há medição publicada de bloqueio por isso.

**O custo é concentrar o risco:** se o número for bloqueado, param juntos as mensagens e as ligações.
O que a tela diz quando os dois estão no mesmo número (o painel compara `whatsapp_sessions.phone_e164`
com o número que o WaCalls informa):

> Este número também está conectado para mensagens. São dois aparelhos conectados ao mesmo WhatsApp.
> Se o número for bloqueado, as mensagens e as ligações param juntas. O WhatsApp aceita até quatro
> aparelhos conectados; com mais que isso, as ligações tocam só no celular.

Se o dono decidir que não podem (seção 10, item 2), a tela recusa conectar o mesmo número e diz qual
dos dois serviços já o usa.

## 8. O que vem do DeskcommCRM

Checkout lido: `~/DeskcommCRM-curso`, commit `07238b65c8` de 26/10/2026. Conferido na `main` do
DeskcommCRM em 12/11/2026: o resumo da imagem é o mesmo, e `lib/wacalls/` só mudou depois disso em
`a2eb56fb6f` (29/10, telefone extra do contato).

**O DeskcommCRM não tem ligação atendida por IA pelo WaCalls.** Lá, quem atende é uma pessoa, no
navegador. A ponte com IA foi tentada no PR #1544 (navegador entre o canal `pcm` e o OpenAI Realtime)
e fechado sem merge em 23/09/2026. O DeskVoice seria o primeiro a fazer isso no servidor.

### Lições, sem código

| Lição | Fonte |
|---|---|
| Nunca chamar `POST /sessions/{sid}/pair`: ele troca o cliente e deixa o discador preso ao antigo; só reiniciar o contêiner resolvia. Parear de novo é apagar e criar | `lib/wacalls/client.ts:218-249`; spec 18, linha 157 |
| O primeiro QR Code sai no SSE antes de a criação devolver o id: reconhecer a sessão pelo **nome**, com o uuid inteiro da organização | `lib/wacalls/nome-da-sessao.ts:1-20`; spec 18, linhas 176-189 |
| `call-status` não traz o sentido; só o `call-list` traz. O retrato do `call-list` a cada reconexão é o que recupera ligação que começou com a ponte caída; a que terminou nesse intervalo se perde | `lib/wacalls/events-bridge.ts:254-278, 534-585` |
| `auth-state` com `logged_out` é aparelho desvinculado; `paired: false` com `state: "qr"` não é | `events-bridge.ts:169-232` |
| Um dono por chamada (`X-Client-Id`): mandar um id próprio por chamada, ou a segunda ligação simultânea recebe 409 | `client.ts:116-133`; spec 18, linha 170 |
| Uma perna de áudio por chamada: a troca de SDP mais recente fecha a anterior sem aviso | spec 18, linha 237 |
| Nono dígito: o WhatsApp registra muito celular sem ele; discar com ele manda a oferta para um endereço inexistente | spec 18, linha 159 |
| O histórico mudou de envelope (`{rows}` → `{calls, nextCursor}`) quando entrou a autenticação | `client.ts:26-31, 169-189` |
| "websocket not connected" de dentro do `whatsmeow` era o defeito do `/pair`, não queda de rede | `client.ts:218-249` |

### Código que pode vir, com crédito em `CREDITS.md`

- A tradução dos motivos de fim para frases (`lib/wacalls/motivo-da-chamada.ts:19-39`, MIT), adaptada
  ao dicionário da tela em três idiomas.

### O que não serve

- A tela de discar e atender no navegador, a conexão WebRTC do navegador e a regra de "uma aba com
  áudio": aqui não há navegador no caminho.
- Publicar a porta UDP e `WACALLS_PUBLIC_IP`: necessários lá porque o par é o navegador.
- `voice_calls`, atividade no funil, Supabase Realtime e silenciar a IA da conversa durante a ligação:
  são do CRM.

`CREDITS.md` ganha, na mesma mudança da fatia 1: o WaCalls na tabela de software à parte (MIT,
imagem referenciada e nunca republicada, não afiliado ao WhatsApp), e as lições acima no bloco do
DeskcommCRM.

## 9. Riscos e o que não se sabe

| Risco | O que se sabe | O que fazer |
|---|---|---|
| **Bloqueio do número** | Os termos do WhatsApp proíbem acessar o serviço por meios automatizados e fazer engenharia reversa, e preveem suspender a conta ([termos](https://www.whatsapp.com/legal/terms-of-service), seção "Acceptable Use Of Our Services", lidos em 12/11/2026). O WaCalls porta o codec da Meta e implementa a sinalização de chamada sem API oficial. Nenhuma medição de taxa de bloqueio | Desligado de fábrica, aviso na tela e no guia antes de instalar, `SECURITY.md`. Nada de ligação em massa (regra 3 do `GOVERNANCE.md`) |
| **Imagem parada em julho, canal `develop`** | Só `develop` tem autenticação e imagem; não há versão publicada. Se a Meta exigir cliente mais novo, o pareamento para (issue #59 relata isso na `main`) | Fixar por resumo. Se a fatia 1 não parear, o caminho é o item 5 da seção 10 |
| **Ligação cortada aos 20 s** | Issue #38, na `v1.0.0`. No `develop`, não se sabe | A fatia 2 exige conversa de mais de 2 minutos para passar |
| **Sem áudio de volta** | Issue #59, chamada de saída, na `main` | A fatia 2 exige áudio nos dois sentidos, ouvido por uma pessoa |
| **O par WebRTC no Node** | Nenhuma biblioteca testada contra o WaCalls | Teste de contrato na fatia 2 |
| **Rede sem porta publicada** | Leitura de código (seção 4.3) | Prova na fatia 2 |
| **Cadência** | O WaCalls descarta acima de 240 ms guardados | Cadência de 20 ms no transporte; teste com relógio injetado |
| **Atender antes de uma pessoa** | O agente atende em menos de um segundo; o celular da empresa toca e para | Seção 10, item 4 |
| **Recusar pelo aparelho vinculado** | Se encerra a ligação em todos os aparelhos, não se sabe | O desenho nunca recusa (seção 3, passo 3) |
| **Áudio em 8 kHz** | O WhatsApp entrega 16 kHz; o DeskVoice inteiro é 8 kHz. A voz fica com qualidade de telefone fixo | Aceito nesta capacidade. Mudar o formato da `VoiceEngine` é outra frente |
| **Memória e disco** | Não medidos | Fatia 1 |
| **Volume do pareamento ao restaurar** | Fora do backup, como o WAHA | A tela pede o QR Code de novo |
| **Mais de quatro aparelhos** | As ligações tocam só no celular principal | A tela diz |
| **14 dias sem usar o celular** | Os aparelhos vinculados desconectam | Linha de saúde e aviso |
| **Quem ligou com número oculto (`@lid`)** | Sem telefone, sem lista de não ligar, sem mensagem de retorno | Seção 5.3 |

**Não foi medido nada do WaCalls em execução.** Tudo acima é leitura de código, de documentação e do
registro de imagens.

## 10. Pedidos de decisão ao dono

Cada um vira uma issue no formato do `GOVERNANCE.md`. O trabalho das fatias 1 a 3 não espera nenhum
deles, exceto onde está dito.

### Decisão: a ligação de saída pelo WhatsApp entra?

**Quem decide:** dono do projeto
**O que está parado esperando:** só a fatia 4

#### Opções
- **A.** Entra, desligada de fábrica, pela mesma política de saída, com o número conectado como
  linha. Custo: a conferência do endereço do WhatsApp antes de discar e mais um caminho de saída para
  manter. O número fica mais exposto: ligar para quem nunca falou com ele é o padrão que mais leva a
  bloqueio num cliente não oficial (a mesma razão da decisão 3 do registro 0012).
- **B.** Entra só para retornar a quem ligou pelo WhatsApp nos últimos N dias. Custo: uma regra a
  mais na política, que precisa de tela e de teste.
- **C.** Não entra agora. Custo: quem quer o agente ligando de volta usa o tronco, ou espera.

#### Recomendação
C, porque o pedido que motivou a capacidade é atender quem liga, e a saída é a parte que mais arrisca
o número de quem usa.

#### Se ninguém responder em 14 dias, vale: C

#### Não medido
O comportamento da chamada de saída do WaCalls no `develop` (a issue #59 relata saída sem áudio de
volta na `main`). Taxa de bloqueio de qualquer tipo.

### Decisão: o mesmo número pode estar no WaCalls e no WAHA ao mesmo tempo?

**Quem decide:** dono do projeto
**O que está parado esperando:** o texto da tela na fatia 1

#### Opções
- **A.** Pode, com o aviso da seção 7 na tela. Custo: o risco de bloqueio fica concentrado; se cair,
  param mensagens e ligações juntas.
- **B.** Não pode: a tela recusa conectar o número que o outro serviço já usa. Custo: quem tem um
  número só (a maioria dos pequenos negócios) escolhe entre mensagem e ligação.
- **C.** Não fazer a conferência. Custo: a pessoa não fica sabendo que concentrou o risco.

#### Recomendação
A, porque o número que a clientela conhece é um só, e é por ele que ela liga. É o que o DeskcommCRM
faz.

#### Se ninguém responder em 14 dias, vale: A

#### Não medido
Se dois aparelhos não oficiais no mesmo número aumentam o risco de bloqueio em relação a um.

### Decisão: o aviso de gravação vale também na ligação pelo WhatsApp?

**Quem decide:** dono do projeto
**O que está parado esperando:** nada; o padrão já é o comportamento do código

#### Opções
- **A.** Vale, igual ao telefone: o aviso sai antes da saudação, com o texto de Configurações.
  Custo: dois a quatro segundos a mais no começo de toda ligação.
- **B.** Configurável por canal, podendo desligar no WhatsApp. Custo: uma configuração a mais, e a
  conversa passa a ficar registrada sem aviso.
- **C.** Não vale no WhatsApp. Custo: o mesmo de B, para todos.

#### Recomendação
A, porque a conversa fica registrada do mesmo jeito, e `call-session.ts` já faz isso em toda chamada
(`call-session.ts:280-282, 317`). Não há código a escrever.

#### Se ninguém responder em 7 dias, vale: A

#### Não medido
Nada; o comportamento foi conferido no código.

### Decisão: o agente atende na hora, ou deixa tocar antes no celular?

**Quem decide:** dono do projeto
**O que está parado esperando:** nada na fatia 2; o padrão é atender na hora

#### Opções
- **A.** Atende na hora. Custo: quem está com o celular na mão não consegue atender antes do agente.
- **B.** Deixa tocar por um tempo configurável (por exemplo, 10 s) e só então atende. Custo: uma
  configuração e uma espera a mais para quem ligou; e o prazo do WaCalls para atender é 60 s.
- **C.** Só atende fora de um horário. Custo: depende da frente "Filas e horário de atendimento",
  que não existe ainda.

#### Recomendação
A, porque o pedido é que o agente atenda; B é reversível e pode entrar depois sem mudar nada do resto.

#### Se ninguém responder em 14 dias, vale: A

#### Não medido
O que acontece no celular quando um aparelho vinculado atende (o `develop` diz parar o toque dos
outros, `48d04ac`; não foi visto).

### Decisão: de qual imagem do WaCalls o DeskVoice depende?

**Quem decide:** dono do projeto
**O que está parado esperando:** a fatia 1, só se o pareamento falhar com a imagem de julho

#### Opções
- **A.** A imagem dos autores, canal `develop`, fixada por resumo (a mesma do DeskcommCRM). Custo:
  depende de um canal de testes parado desde 27/07; atualizar é trocar o resumo quando os autores
  publicarem.
- **B.** Construir e publicar uma imagem do DeskVoice a partir de um commit fixado do WaCalls (MIT
  permite), com o `whatsmeow` atualizado quando preciso. Custo: o projeto passa a manter a construção
  de um programa em Go, e cada mudança do WhatsApp vira trabalho nosso.
- **C.** Esperar uma versão publicada pelos autores. Custo: a capacidade fica parada sem prazo.

#### Recomendação
A enquanto parear e falar; B só se a fatia 1 provar que a imagem de julho não pareia mais.

#### Se ninguém responder em 14 dias, vale: A

#### Não medido
Se a imagem de julho ainda pareia um número hoje.

### Decisão: transferir a ligação do WhatsApp para uma pessoa, pelo tronco?

**Quem decide:** dono do projeto
**O que está parado esperando:** nada nas fatias 1 a 4

#### Opções
- **A.** Sem transferência neste canal: o agente oferece deixar recado (`notify_human`), e a tela diz
  isso no bloco do WhatsApp. Custo: quem pediu "quero falar com alguém" espera o retorno.
- **B.** Ponte pelo tronco: o processo de voz liga para o `transfer_to_e164` pelo Asterisk e cruza o
  áudio das duas pernas. Custo: exige tronco configurado, uma ligação de saída paga à operadora e uma
  peça de mistura de áudio que hoje não existe.
- **C.** Ponte para alguém conectado ao painel pelo navegador. Custo: depende do "Painel de
  supervisão ao vivo", que não existe ainda.

#### Recomendação
A agora, porque é verdadeiro e não custa nada; B como frente própria depois que a ligação pelo
WhatsApp tiver quilometragem.

#### Se ninguém responder em 14 dias, vale: A

#### Não medido
Se a perna até a pessoa da equipe deve passar pela política de saída. Hoje a transferência de uma
ligação do tronco é do dialplan do Asterisk (`deskvoice-transfer`, comentário de
`apps/voice/src/asterisk-transport.ts`), e não passa por `checkOutboundAllowed`.

## 11. Fatias de entrega

Cada fatia é um PR, verificável sozinho, revisado por uma sessão distinta da que escreveu.

### Fatia 1: o serviço sobe e pareia

Perfil `whatsapp-calls` no Compose, chaves no instalador, terceiro campo do agente, migration,
cliente HTTP e SSE no processo de voz, rotas internas, bloco em Configurações, linha de saúde,
`CREDITS.md`, `SECURITY.md`, guia `docs/guides/ligacao-pelo-whatsapp.md`, fragmento em `.changes`.
Nenhuma ligação é atendida ainda: a tela diz "o atendimento chega na próxima versão".

**Prova:** `pnpm verify` e `pnpm test:db`; teste do cliente contra um WaCalls falso que repete os
formatos lidos na seção 2.1 (inclusive o QR Code antes do id); teste do kit para o terceiro campo.
Numa VPS: instalar o serviço pela tela, ler o QR Code com um celular de verdade, ver o aparelho em
"Aparelhos conectados", desconectar pelo celular e ver a linha de saúde mudar, remover o serviço e ver
memória e disco voltarem. **Medir** memória parado, memória com número conectado e disco, e escrever
os números no registro e na tela.

### Fatia 2: a ligação recebida chega ao agente, com áudio

Par WebRTC no processo de voz, `whatsapp-transport.ts`, `pacer.ts` extraído do transporte do
navegador, entrada com agente, teto e atendimento, transferência declarada como indisponível.

**Prova:** teste de contrato com um par WebRTC falso no papel do WaCalls (canal `pcm`, 16 kHz),
conferindo conversão de taxa, cadência de 20 ms com relógio injetado e o `clear`. Numa VPS, com uma
chave de motor real: ligar de outro celular pelo WhatsApp, ouvir aviso e saudação, conversar **mais
de 2 minutos** (issue #38), desligar dos dois lados, e repetir com chave inválida (quem ligou ouve o
bipe; o painel recebe o aviso) e com o teto de recebidas em 1 e duas ligações (a segunda segue
tocando no celular). Uma pessoa escreve o que ouviu.

### Fatia 3: linha do tempo, custo e o que acontece fora da conversa

Canal "WhatsApp" na lista e na linha do tempo, número de quem ligou com as duas grafias do nono
dígito, `@lid` sem número, motivo de fim em frase, reconciliação pelo `call-list`, chamada órfã depois
de reiniciar o processo de voz, a ligação que tocou e ninguém do DeskVoice atendeu.

**Prova:** testes de banco para a entrada (organização certa, teto, agente desligado, `@lid`) e para
a reconciliação; uma chamada pelo WhatsApp com teto de custo baixo, que encerra com a despedida e
mostra o custo; reiniciar o contêiner `voice` no meio de uma ligação e ver a linha fechar com motivo.

### Fatia 4: a ligação de saída, só se o dono decidir que entra

Pela política de saída, com o número conectado como linha, e o endereço conferido antes de discar.

**Prova:** a cerca `outbound-requires-policy` e testes de banco para cada recusa da política; numa
VPS, uma ligação de saída com áudio nos dois sentidos (issue #59).

## 12. Fora desta capacidade

Gravação de áudio, chamada de vídeo, ligação em grupo, URA, vários números por organização e qualquer
coisa que facilite ligação em massa.
