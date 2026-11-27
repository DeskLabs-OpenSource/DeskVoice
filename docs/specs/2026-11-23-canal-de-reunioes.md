# Canal de reuniões: o agente entra no Google Meet, no Teams ou no Zoom (R15)

- **Estado:** o dono decidiu os pedidos 1 e 2 da seção 9 em 24/11/2026, às 09h21 (DESA-62), com a
  recomendação deles (**1A e 2A**: o Meet primeiro, só com a peça própria e sem serviço de
  terceiros). Decidiu o pedido 3 em 26/11/2026, às 14h30 (DESA-441), também com a recomendação
  (**3A**: a sonda roda uma vez, numa reunião nossa, com ele como anfitrião). Essas três respostas
  não aprovam o resto do desenho (fatias, limite de uma reunião por organização, aviso fixo), que
  segue com a revisão.
- **Data:** 2026-11-23
- **Quem pediu:** o dono, em 16/11/2026 (DESA-62): os agentes atuam como consultor, suporte ou
  vendedor dentro de uma reunião do Meet, do Teams ou do Zoom, com o mesmo motor das ligações.
  Duas formas de entrar: agendada, com a conta conectada, e manual, pelo link.
- **Base medida:** `origin/main` em `12447e0`. Arquivos e nomes citados foram conferidos nesse
  commit, salvo os marcados como **novo**. A pesquisa das plataformas foi feita em 23/11/2026. Na
  seção 2, **[L]** marca o que foi lido na página citada, **[B]** o que só apareceu no resumo de
  uma busca e **[I]** a inferência nossa.

## 1. Problema

O agente hoje conversa por quatro canais (`calls.channel`: `phone`, `web`, `whatsapp`,
`simulated`, migration `20261114T014000_canal_da_chamada.sql`). Todos são conversas de um para um,
que começam quando alguém liga ou quando o agente liga.

Uma reunião é diferente em três pontos:

1. **O agente é convidado de uma sala que não é nossa.** Quem decide se ele entra é a plataforma
   (Google, Microsoft, Zoom) e o anfitrião, e não o DeskVoice.
2. **Há várias pessoas, e nem todas escolheram falar com uma IA.** O aviso e a gravação precisam
   valer para todos os presentes, inclusive quem entrou depois.
3. **Falar com todo mundo o tempo todo é o defeito, e não a função.** Numa ligação, toda fala de
   quem ligou pede resposta. Numa reunião, a maior parte da fala é entre as pessoas.

O que já existe e serve sem mudança:

- O contrato `CallTransport` (`apps/voice/src/transport.ts`). A conversa (`call-session.ts`) roda
  sobre qualquer coisa que entregue e receba PCM16 mono 8 kHz em quadros de 20 ms. O navegador
  (`web-transport.ts`) e o WhatsApp (`whatsapp-transport.ts`) são exemplos que não transferem nem
  mandam tom. Uma reunião é mais um.
- O custo e os limites: o teto do mês (`spendCapReached`, `packages/core/src/limits.ts`), o teto
  por chamada do agente (`cost_ceiling_cents`) e a duração máxima (`max_call_seconds`).
- O aviso (`DEFAULT_RECORDING_NOTICE`, `call-session.ts:242`), a gravação (`CALL_RECORDING_SETTING`),
  a linha do tempo (`recordEvent`), a memória e a análise.
- A peça opcional que se liga pela tela: perfil do Compose subido pelo agente do kit
  (`install/agent.sh`), como o WaCalls (`profiles: ["whatsapp-calls"]`, `deploy/docker-compose.yml`).
- A cifra por organização (`encryptSecret`, `packages/core/src/secrets.ts`).

## 2. Como cada plataforma deixa um participante automatizado entrar (lido em 23/11/2026)

### 2.1 O caminho oficial

| | Zoom | Microsoft Teams | Google Meet |
|---|---|---|---|
| Bot que ouve e fala | **Meeting SDK:** as páginas do SDK para Linux e para web dizem *"The Meeting SDK is designed for human use cases and does not support bots or AI notetakers"* e mandam usar o RTMS [L]. A página do token OBF diz o contrário: *"Bots and other non-human users can use the Meeting SDK to join meetings with an OBF token"* [L]. A própria Zoom se contradiz. | **Bot de mídia hospedado na aplicação (Graph Communications):** só em C#/.NET (*"C++ and Node.js APIs don't support access to real-time media"*). Em produção roda em *"Windows Server... in Azure"*, numa VM com IP público e pelo menos 2 núcleos [L]. Esse bot ouve e fala [L]. A plataforma está em *developer preview* [L]. | **Não há caminho oficial para falar.** A página lista só a REST API, que gerencia espaços e conferências, e o SDK de complementos (*add-ons*), que é um app embutido na tela [L]. |
| Só receber o áudio | **RTMS:** *"access to live audio, video, and transcript"* [L]. Se ele deixa enviar áudio, a página não diz [L]. Um moderador do fórum escreveu que enviar *"is not supported at the moment"* [B]. | O mesmo bot recebe e envia [L]. | **Meet Media API:** *"discontinued and will not proceed to General Availability"*, *"New signups are now closed"*, endereços desligados em **15/01/2027** (release note de 28/10/2026) [L]. |
| Reunião de outra conta | Desde 2/03/2026, entrar em reunião de outra conta exige token OBF, ZAK ou RTMS, e *"All apps must go through app review"* [L]. O bot só entra depois que quem autorizou está na reunião, e sai quando essa pessoa sai [L]. | `Calls.JoinGroupCall.All` vale para *"meetings in your organization"* [L]. Sobre reunião de outro tenant, a página não diz. Lemos que o administrador de cada tenant teria de consentir [I]. | — |
| Aviso de gravação | A página não diz se o anfitrião precisa liberar a gravação local ou os dados brutos [L]. | Antes de gravar ou guardar mídia (ou dado tirado dela), o bot é obrigado a chamar `updateRecordingStatus` e receber sucesso [L]. | — |

**Uma alternativa oficial no Teams: o participante do Azure Communication Services (ACS) entrando
pelo link** [L]
- Ele entra como *"anonymous external user"*, marcado como externo.
- Precisa que a entrada anônima esteja permitida no tenant (é o padrão) e que já haja alguém do
  Teams na reunião. Depois espera no lobby até ser admitido.
- Não pode iniciar gravação nem transcrição. Não funciona com o Teams pessoal.
- Custa **US$ 0,004 por participante por minuto** (cerca de US$ 0,24/h), cobrado também no lobby,
  numa conta Azure de quem instala.
- Obriga a avisar o usuário em tempo real quando a reunião está sendo gravada.
- Se o SDK do ACS entrega o áudio bruto em Node, a página não diz.

### 2.2 O navegador automatizado

É o caminho que todos os serviços de terceiros usam por baixo. Um Chromium sem tela entra pelo
link, como convidado, e o áudio passa pelo WebRTC da página. Sobre o Meet, o README do Attendee
diz que a plataforma *"doesn't provide any support at all, so you need to run a full instance of
Google Meet in Chrome"* [L].

| Projeto aberto | Licença | Fala na reunião? |
|---|---|---|
| Attendee (`attendee-labs/attendee`) | **Elastic License 2.0**, que não é aprovada pela OSI e proíbe oferecer o software a terceiros como serviço hospedado [L] | Sim: entrada e saída de áudio por websocket, já entregue segundo o roadmap. Atende Zoom (com OBF/ZAK), Meet, Teams e Webex [L] |
| Vexa | Apache-2.0 [L] | Ainda não: `POST /bots/{…}/speak` *"return 404 today"* na versão aberta (v0.12) [L] |
| MeetingBot | LGPL-3.0 [L] | O README só fala em gravar [L] |
| `Meeting-BaaS/speaking-meeting-bot` | MIT [L] | Sim, mas depende da API hospedada (paga) da MeetingBaaS [L] |

**Os termos do Meet foram lidos em 24/11/2026 (seção 2.4). Os da Microsoft e do Zoom não foram
lidos.** A única regra oficial do Zoom lida contra bots é a do Meeting SDK, e ela trata do SDK, não
do cliente web.

### 2.3 Serviços de terceiros

| Serviço | Preço publicado (23/11) | O bot fala | Roda na VPS de quem instala |
|---|---|---|---|
| Recall.ai | US$ 0,50/h, 5 h grátis. Áudio de saída costuma pedir bot de 4 núcleos (+US$ 0,10/h) [L] | Sim [L] | a página não diz |
| MeetingBaaS | a partir de US$ 0,35/h, planos de US$ 0 a US$ 299/mês [L] | Sim [L] | a página não diz |
| Attendee hospedado | US$ 0,50/h depois de 5 h grátis, até US$ 0,35/h com volume [L] | Sim [L] | Sim (o projeto da 2.2). O suporte pago é à parte [L] |
| Skribby | US$ 0,35/h mais transcrição [L] | a página não diz | a página não diz |

### 2.4 Os termos do Meet sobre bots (lidos em 24/11/2026)

O dono pediu esta leitura antes da sonda (DESA-62, 24/11). Ela foi feita na DESA-440.

1. **Termos de Serviço do Google:** https://policies.google.com/terms, em vigor desde 30/07/2026.
   Proíbem *"using automated means to access content from any of our services in violation of the
   machine-readable instructions on our web pages (for example, robots.txt files that disallow
   crawling, training, or other activities)"* e *"bypassing our systems or protective measures"*
   [L].
2. **`robots.txt` do Meet:** https://meet.google.com/robots.txt, lido em 24/11/2026: `User-agent: *`
   e `Disallow: /`. Ficam liberados só `/`, `/about`, `/intl/*/about`, `/landing`, `/_meet`, `/_meet/` e
   `/sitemap.xml`. **O
   endereço de uma reunião (`/abc-defg-hij`) fica bloqueado** [L].
3. **Política de Uso Aceitável do Meet:** https://support.google.com/meet/answer/9847091,
   atualizada em 11/09/2025. Não fala de bot nem de gravação. Tem *"Do not impersonate a person or
   organization or misrepresent yourself"* [L], e o aviso fixo da seção 6 atende a isso.
4. **Bots on Demand API:** https://developers.google.com/bots-on-demand: *"Only allowlisted vendors
   may access the Bots on Demand API"*. A API serve para teste de carga, e não é um caminho para nós
   [L].
5. **Contexto (não é um termo):** há relato de que o Google nega sozinho o pedido de entrada de
   *"automated bots"* e de identidade não verificada, salvo se o anfitrião aceitar (uctoday.com,
   docs.recall.ai/docs/google-meet-faq) [B].

**Leitura nossa, que não é parecer jurídico [I]:** nenhum texto proíbe com todas as letras um
participante automatizado que se identifica como IA. Mas os itens 1 e 2, juntos, dão ao Google base
para dizer que um Chromium automatizado no endereço da reunião viola os Termos ("or other
activities"). O risco recai sobre a conta ou o IP de quem instala. Os serviços pagos da seção 2.3
correm o mesmo risco. Por isso a sonda esperou o pedido 3 da seção 9, decidido A em 26/11/2026:
roda uma vez, numa reunião nossa, com o dono como anfitrião. Se o canal for oferecido a quem
instala, a tela da peça diz isso a quem a liga, antes de ligar.

### 2.5 O que exige conta, aprovação ou pagamento

| | Caminho oficial | Navegador automatizado na VPS |
|---|---|---|
| Zoom | App no Marketplace, revisão da Zoom para reunião de outra conta, operador presente na reunião. O RTMS consome créditos pagos, de preço não lido [L] | Nenhuma conta nossa. O convidado entra pelo cliente web, se o anfitrião permitir entrar pelo navegador. Os termos não foram lidos |
| Teams | Conta Azure, registro de bot, consentimento do administrador do tenant, Windows no Azure. O ACS é pago por minuto [L] | Nenhuma conta, se o tenant permite convidado anônimo (padrão). Passa pelo lobby |
| Meet | Não há | Convidado sem conta pede para entrar e o anfitrião admite [I, a conferir na fatia 1]. Uma organização do Workspace pode bloquear convidado de fora |

## 3. O caminho escolhido

**Uma peça opcional própria, `meeting-bot` (novo), que roda na VPS de quem instala: um Chromium
sem tela com Playwright, entrando pelo link como convidado.** Ela é ligada pela tela, como o WaCalls,
e o mesmo contêiner serve às três plataformas (um arquivo por plataforma dentro dele).

Por que este caminho, e não os outros:

- **O oficial não cabe.** O Teams exige .NET em Windows no Azure, o Meet não deixa falar e o Zoom
  se contradiz sobre bots e exige revisão do app. Nenhum dos três roda numa VPS Linux genérica
  sem conta e aprovação de quem instala.
- **Um terceiro como obrigação fere a regra "Sem recurso pago, sem telemetria"** do
  `GOVERNANCE.md`, que diz "Nenhuma capacidade depende de licença, chave do projeto ou serviço do
  projeto". Um terceiro com a chave do operador não é serviço do projeto, mas obriga quem instala a
  pagar por hora para ter o canal, e é o recurso pago que pesa contra ele. Ele pode
  existir depois como peça opcional, com a chave do operador e o custo à vista (pedido 2, seção 9).
- **O Attendee resolveria mais rápido, mas a licença dele não é aberta** (ELv2), e licença é
  decisão do dono (`GOVERNANCE.md`). Fica como opção do pedido 2. Não copiamos código dele.

O que este caminho **não** promete, escrito com honestidade:

- **Depende da página web de cada plataforma.** Quando o Google, a Microsoft ou o Zoom mudam a
  tela, a entrada quebra até o conserto. Por isso a peça tem uma sonda que roda na tela de
  Configurações e diz "a entrada no Meet funciona hoje" ou "parou de funcionar".
- **A plataforma pode proibir.** Os do Meet foram lidos (seção 2.4), e o `robots.txt` bloqueia o
  endereço da reunião. Os do Teams e do Zoom não foram lidos. Se algum termo proibir com todas as
  letras, a plataforma sai do canal, sem exceção.
- **O anfitrião sempre pode negar.** O convidado espera no lobby, e isso é desejável: admitir
  "Nome (IA)" é o primeiro consentimento.
- **Organizações fechadas não entram.** Workspace ou tenant que bloqueiam convidado de fora ficam
  sem o canal. A tela diz o motivo, se a plataforma disser.

## 4. O caminho do áudio

```
Reunião (WebRTC)  ⇄  meeting-bot (Chromium + Playwright, contêiner opcional)
                         │  PCM16 mono 8 kHz, quadros de 20 ms, WebSocket na rede interna
                         ▼
apps/voice: meeting-transport.ts (novo, implementa CallTransport)
                         ▼
startCallSession (call-session.ts, sem mudança de contrato) → VoiceEngine, ferramentas, memória, análise
```

- **Na página,** um script injetado troca o microfone por uma faixa de áudio (WebAudio) alimentada
  pela fala do agente, e mistura numa só as faixas de áudio que chegam dos outros participantes.
- **A conversão 48 kHz ⇄ 8 kHz** acontece dentro do `meeting-bot`. A voz recebe o mesmo formato de
  sempre. Se a medida da fatia 1 mostrar que 8 kHz piora o ouvido numa sala com várias vozes, a
  taxa sobe num item à parte, e não neste canal.
- **O `meeting-transport.ts`** segue o molde do `web-transport.ts`: `canTransfer: false`, sem
  `sendDtmf` e `onDtmf`, e `onHangup` quando a reunião acaba, o agente é removido ou fica sozinho
  na sala.
- **A linha do tempo:** a reunião é uma linha em `calls` com `channel = 'meeting'` (migration
  nova, que amplia o `check`), `direction = 'outbound'` e `to_e164` nulo. O `call_started` leva
  `{ channel: "meeting", platform, joinedBy: "link" | "schedule", userId }`. O link da reunião é
  guardado cifrado, porque ele dá acesso à sala.
- **O custo:** o motor mede como numa ligação. Antes de entrar, o canal confere `spendCapReached`.
  Durante a reunião valem `cost_ceiling_cents` e `max_call_seconds` do agente. Uma reunião de uma
  hora com um motor de voz ao vivo custa o mesmo que uma ligação de uma hora, e a tela de entrada
  mostra o teto do agente antes do clique.
- **Quantas ao mesmo tempo:** uma reunião por organização na primeira entrega. O limite da
  instalação sobe depois de medir CPU e memória de um Chromium por reunião (fatia 1).

### 4.1 A conversa em grupo

O motor responde a toda fala. Numa sala, o padrão é outro: **o agente fala quando é chamado pelo
nome ou quando lhe fazem uma pergunta direta, e fica calado no resto.** A fatia 3 decide como:

- pelo próprio motor, com instrução de ficar em silêncio, o que é barato mas não garantido;
- ou por uma porta antes do motor, que só deixa a vez passar quando a transcrição contém o nome do
  agente, o que é garantido mas mais lento.

A escolha sai de uma medida em sala simulada, e não de opinião. Até a fatia 3, a fatia 2 só serve
a reunião de duas pessoas (o operador e o cliente), onde o comportamento de ligação já serve.

## 5. As duas formas de entrar

1. **Pelo link, agora (fatia 2).** Na tela de Reuniões, o operador cola o link, escolhe o agente e
   clica em "Entrar". A plataforma é reconhecida pelo endereço: `meet.google.com`,
   `teams.microsoft.com`/`teams.live.com` e `*.zoom.us`. Link de outro endereço é recusado antes de
   qualquer navegação: o Chromium só abre esses três domínios, o que também impede usar a peça para
   abrir qualquer página.
2. **Agendada, primeiro sem conta conectada (fatia 6).** O operador cola o link e a hora. A rotina
   (`apps/routines`) dispara a entrada na hora marcada. Nenhuma conta de plataforma é necessária.
3. **Agendada com a conta conectada (fatia 7).** O operador conecta a agenda (Google Calendar,
   Microsoft Graph ou Zoom) e marca, reunião por reunião, onde o agente vai.
   - **Cada instalação registra o próprio app OAuth** (regra 5: não há app nem chave do projeto).
     A tela guia o passo a passo e guarda o segredo com `encryptSecret`, por organização.
   - O Google limita o app não verificado a 100 usuários de teste e mostra a tela de "app não
     verificado". Isso não foi lido para este documento (seção 10).
   - **O agente nunca entra sozinho numa reunião que o operador não marcou.** Conectar a agenda
     não liga a entrada automática em tudo.

Regra 3 (disparo em massa): não há importação de lista de links, e cada entrada é um ato do
operador (um clique ou uma reunião marcada). O agente só entra numa sala para a qual foi
convidado, onde as pessoas o admitem.

## 6. O aviso a quem está na reunião

O fracasso que o dono nomeou: **agente que entra sem se identificar.** Por isso o aviso é imposto
pelo código, e não fica como configuração que se desliga.

1. **O nome de exibição sempre termina com "(IA)"** (por exemplo, "Lia (IA)"). O operador escolhe
   o nome, mas o sufixo é fixo e não sai.
2. **Ao entrar, o agente fala o aviso** antes de qualquer outra coisa, em toda reunião, mesmo que
   ninguém fale com ele. Hoje o aviso só é falado em ligação recebida (`call-session.ts:1561`); o
   canal de reunião fala sempre.
3. **Ao entrar, escreve o mesmo aviso no chat da reunião**, onde a plataforma deixar. Quem chega
   depois lê o chat e vê o nome. A fatia 3 decide se o aviso é repetido quando entra alguém novo.
4. **Gravação e transcrição.** A gravação segue a chave da organização (`CALL_RECORDING_SETTING`,
   desligada de fábrica). Ligada, o aviso diz isso com todas as letras: "esta reunião está sendo
   gravada e transcrita pela assistente". O texto do aviso é do operador, mas a frase da gravação
   não pode faltar quando grava.
5. **Qualquer participante pode pedir que a IA saia.** O agente tem a ferramenta `leave_meeting`
   (nova) sempre disponível no canal, e sai sem discutir. Se a pessoa tirar o agente da sala pela
   plataforma, a reunião acaba para ele, com o motivo `removed_by_host`.

## 7. As fatias

Cada fatia cabe numa revisão de uma sentada. A ordem vai da mais barata de provar para a mais cara.

| # | O que entrega | O que uma pessoa consegue fazer | Fracasso mesmo funcionando |
|---|---|---|---|
| 1 | **Sonda** `scripts/sonda-reuniao/` (nova; sem produto, sem tela, no molde de `scripts/sonda-sip/`). Playwright entra num Meet pelo link como convidado, toca 10 s de fala gravada, grava 30 s do que ouve, sai. Mede a admissão, CPU, memória e a qualidade do áudio. **Pedido 3 decidido A (26/11/2026):** roda uma vez, numa reunião nossa, com o dono como anfitrião; o dia e a hora o orquestrador combina com ele. A fatia 2a só sai depois de ele ver o resultado | O mantenedor roda a sonda contra uma reunião de teste e vê que o convidado entra, é ouvido e ouve | A sonda "passa" sem que um humano tenha ouvido o áudio dos dois lados |
| 2a | Lado da voz: migration `channel = 'meeting'`, `meeting-transport.ts`, a API interna "entre neste link", o aviso fixo (seção 6), `leave_meeting`, o limite de uma por organização. Contêiner `meeting-bot` no perfil `meetings`, só com o Meet | — (entra junto com a 2b; regra 4) | Uma reunião sem `spendCapReached` conferido antes de entrar, ou com o aviso desligável |
| 2b | Tela: ligar a peça em Configurações (pelo agente do kit, como o WaCalls), página Reuniões com "colar link e entrar", estado ao vivo ("no lobby", "na reunião", "saiu: motivo"), linha do tempo da reunião | O operador cola um link do Meet, o agente pede para entrar, é admitido, se apresenta como IA e conversa com uma pessoa | Agente que fica falando sozinho numa sala vazia (a reunião acaba quando o agente fica só) |
| 3 | Conversa em grupo (4.1), medida em sala simulada, e a repetição do aviso para quem chega depois | Numa reunião com três pessoas, o agente só fala quando chamado | Agente que interrompe a conversa entre as pessoas |
| 4 | Teams pelo navegador (convidado anônimo, lobby) | O mesmo da 2b, num link do Teams | — |
| 5 | Zoom pelo cliente web, só se os termos lidos permitirem | O mesmo da 2b, num link do Zoom | Entrar contra uma proibição escrita da plataforma |
| 6 | Agendada sem conta: link e hora, disparo pela rotina | O operador marca para as 15 h e o agente entra às 15 h | Entrada atrasada sem aviso ao operador |
| 7 | Agenda conectada (um provedor por PR, o Google primeiro), app OAuth da própria instalação, segredo cifrado | O operador conecta a agenda e escolhe as reuniões em que o agente vai | Agente que entra numa reunião que o operador não escolheu |

As plataformas de 4 e 5 podem trocar de ordem conforme o pedido 1. A peça de terceiros (pedido 2,
opção B) seria uma fatia à parte, depois da 3.

## 8. Fora deste item

- Vídeo do agente (avatar ou câmera). O agente entra sem câmera.
- Transcrição da reunião inteira como produto de "anotador". A transcrição existe só para a
  conversa, como numa ligação.
- O bot oficial do Teams (.NET/Azure), o RTMS do Zoom e qualquer app no Marketplace da Zoom em nome
  do projeto.
- Webex e outras plataformas.
- Compartilhar tela.

## 9. Pedidos de decisão (vão à pasta do Rafael)

### Pedido 1. Decisão: qual plataforma entra primeiro?

**Quem decide:** dono do projeto
**O que está parado esperando:** a fatia 1 (a sonda) e a 2.

- **A. Google Meet.** É a de entrada mais simples para um convidado (pede para entrar e o
  anfitrião admite) e é a mais usada nas pequenas empresas brasileiras [I]. Custo: o Meet não tem
  nenhum caminho oficial, então dependemos só da página web.
- **B. Microsoft Teams.** Tem a entrada anônima documentada e o lobby. Custo: o Teams pessoal fica
  de fora, e o público que usa Teams tende a estar em organização fechada.
- **C. Zoom.** Custo: a própria Zoom diz que o SDK não aceita bot, e os termos do cliente web não
  foram lidos. É a de maior risco de proibição.

**Recomendação:** A, porque é a que o operador de pequena empresa mais deve usar e a mais barata
de provar sem conta nenhuma.

**Decidido: A, pelo Rafael em 24/11/2026, 09h21 (DESA-62).**

**Não medido:** a fatia de mercado de cada plataforma entre quem instala o DeskVoice; os termos de
uso das três plataformas; se o Meet admite convidado sem conta Google em reunião de conta pessoal.

### Pedido 2. Decisão: o canal usa um serviço de terceiros ou a peça própria?

**Quem decide:** dono do projeto (envolve gasto do operador e licença)
**O que está parado esperando:** a fatia 2a.

- **A. Peça própria (`meeting-bot`) na VPS, sem serviço de terceiros.** Custo: construir e manter a
  entrada em cada plataforma. A página muda e a peça quebra até o conserto. Gasto do operador:
  só o motor de voz e a CPU da VPS.
- **B. A peça própria e, depois, uma peça opcional para um terceiro (Recall.ai ou MeetingBaaS),
  com a chave do próprio operador.** A tela mostra o preço por hora (US$ 0,35 a 0,50, mais o
  motor) antes de ligar. Custo: um adaptador a mais para manter. O operador paga a um terceiro, e
  o áudio da reunião passa por ele.
- **C. Usar o Attendee (ELv2) como contêiner opcional, em vez de construir a peça.** Custo: a
  licença não é aberta e impede oferecer como serviço hospedado. Quem instala para clientes pode
  estar fora da licença. Mudar de licença é decisão do dono.
- **D. Não fazer o canal.** Custo: o pedido de 16/11 fica sem resposta.

**Recomendação:** A agora, e B só se a fatia 1 mostrar que a entrada própria não se sustenta,
porque é o único caminho que roda na VPS de quem instala sem conta, sem pagamento e sem mandar o
áudio da reunião para fora.

**Decidido: A, pelo Rafael em 24/11/2026, 09h21 (DESA-62).**

**Não medido:** quanto tempo a entrada própria resiste entre uma mudança e outra da página das
plataformas; o custo real dos terceiros com áudio de saída (a página da Recall fala em bot maior,
mas não lemos a fatura); se o Attendee aberto fala de fato (lemos só o roadmap).

### Pedido 3. Decisão: a sonda do Meet roda, mesmo com o `robots.txt` bloqueando a reunião?

Aberto em 24/11/2026 no Paperclip (DESA-441) e posto na pasta do dono pelo maestro em 26/11/2026
("2026-11-26 — a sonda do Meet com o robots.txt bloqueando").
- **A (recomendada):** a sonda roda uma vez, numa reunião nossa, com o dono como anfitrião. A
  fatia 2a só sai depois de ele ver o resultado. O risco aparece na tela da peça.
- **B:** a R15 para até haver uma leitura jurídica.
- **C:** trocar o Meet pelo Teams (o ACS, que é pago).
- **Decidido: A, pelo Rafael em 26/11/2026, 14h30, no chat do maestro ("pode seguir com sua
  recomendação nos docs que me esperam").** É só a sonda, uma vez. Oferecer o canal a quem instala
  volta à pasta do dono, com o resultado da sonda.

## 10. Não medido

- **Os termos de uso do Teams e do Zoom** sobre a automação do cliente web não foram lidos. A
  fatia 5 (Zoom) não anda sem eles, e a fatia 4 lê os do Teams antes do PR. Os do Meet foram lidos
  (seção 2.4), mas sem leitura jurídica.
- **Nada da seção 4 foi rodado.** A entrada do convidado, o lobby, a troca do microfone e a mistura
  das faixas são o que a fatia 1 vai provar, ou não.
- **CPU e memória de um Chromium por reunião** não foram medidos. O limite de uma por organização é
  uma trava, não uma medida.
- **Se 8 kHz basta** para ouvir uma sala com várias vozes.
- **Se o Meet admite convidado sem conta Google**, e se o Workspace bloqueia isso por padrão.
- **A tela de "app não verificado" do Google** e o limite de 100 usuários de teste (fatia 7).
- **As páginas que não abriram:** a visão geral da Meet Media API e o FAQ do OBF da Zoom (404), e
  o fórum da Zoom, visto só pelo resumo da busca.
- **A regra de consentimento na LGPD** para gravar participantes que não são clientes do operador.
  O aviso falado e escrito é o mínimo do desenho. Se ele basta juridicamente, não está medido, e o
  guia `docs/guides/conformidade-brasil.md` não foi relido para este documento.
- **O preço por crédito do RTMS** do Zoom não estava na página de preços lida.
