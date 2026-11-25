# Changelog

O que muda em cada versão do DeskVoice, na voz de quem opera a instalação.
Este arquivo é montado a partir de `.changes/`; não edite à mão.

## [0.48.0] - 2026-11-25

### Adicionado

- **O teste do agente roda no OpenAI Realtime, em texto, e o custo dele entra no extrato e no teto do mês** O teste escrito de um agente agora pode rodar contra o próprio motor OpenAI Realtime do agente, com a chave da organização: o que quem liga diz vai como texto, o agente responde em texto, com as mesmas instruções e ferramentas da ligação, e nenhuma ferramenta roda de verdade. O teste abre como uma ligação recebida: o agente fala primeiro o aviso de gravação e a saudação, e essa resposta também conta no custo. A ligação de verdade segue montando a sessão como antes, agora pelo mesmo arquivo do teste. O custo de cada resposta vai ao extrato com a fonte "teste", sem ligação, entra na soma do mês, na visão da instalação e no teto de gasto, e a rodada para se passar do teto de custo por ligação do agente. A rodada é recusada, sem gastar nada, quando o teto do mês já foi alcançado, quando já há outro teste rodando na organização, quando o motor do agente ainda não roda testes ou quando falta a chave dele; uma rodada que ficou presa por mais de 7 minutos é fechada como erro e não trava as outras. Apagar um teste ou uma rodada não apaga o custo do extrato, porque o dinheiro foi gasto. O Gemini Live ainda não roda testes. Fora o link da tela do agente, quem já instalou não vê mudança nenhuma até rodar um teste. Crédito: @melgarafael.
- **A tela dos testes do agente, para conferir pelo painel o que o agente decide antes de pôr no ar** A página de cada agente ganha o link "Testes do agente". Lá, quem pode editar o agente escreve uma conversa num formulário, sem JSON: o que quem liga diz em cada turno, as ferramentas que o agente tem de chamar, os campos conferidos de cada uma, a resposta que ela devolve no teste e os trechos que a fala do agente precisa ter ou não pode ter. O botão "Rodar" roda um teste, e "Rodar todos" roda os testes do agente um por vez. A tela mostra "passou" ou "reprovou" e a conversa turno a turno, com as ferramentas pedidas e, em cada reprovação, o esperado ao lado do que veio. O resultado sempre lembra que o teste confere o que o agente decide, e não como ele ouve e fala. Antes do primeiro clique, a tela avisa que cada rodada usa o motor do agente com a chave da organização e entra no custo do mês, e que nenhuma ferramenta roda de verdade. Quando as instruções, as ferramentas, o motor ou o idioma do agente mudam depois da última rodada, o teste aparece como "não rodado com a configuração atual". Nada roda sozinho. Quem só vê o agente vê os testes e os resultados, mas não cria, não edita e não roda. Num motor que ainda não roda testes (o Gemini Live, por enquanto), o botão vem desligado, com o motivo. A tela de Custos mostra o gasto dos testes numa linha própria, "Testes", separada das ligações. Fora o link, quem já instalou não vê mudança até criar um teste. Crédito: @melgarafael.

### Alterado

- **Na tela do agente, o campo Voz mostra de qual provedor são as vozes e ganha o botão Ouvir** Em Agentes, no campo Voz, as vozes aparecem agrupadas com o nome do provedor e do motor (por exemplo "Google · Gemini Live" ou "OpenAI · OpenAI Realtime"), e o texto de ajuda diz de qual provedor elas são. Ao lado fica o botão Ouvir, que toca a amostra da voz selecionada, inclusive a do padrão do motor, no idioma do agente; se a voz não tem a amostra desse idioma, toca a de português e avisa. Nada é baixado antes de alguém apertar o botão. **Nesta versão nenhuma voz tem amostra**: o botão fica desligado e a tela diz "Esta voz ainda não tem amostra. Teste numa ligação.". Uma linha abaixo do campo diz que as vozes da ElevenLabs não são faladas pelos motores de hoje, com o link para Configurações → Voz, onde dá para ouvir as da sua conta; por isso a lista do agente não mostra vozes da ElevenLabs. Quem já instalou não precisa fazer nada: a voz salva em cada agente continua a mesma, inclusive a que está fora da lista do motor. Crédito: @melgarafael.

## [0.47.0] - 2026-11-23

### Alterado

- **Quando quem ligou fica calado, o agente pergunta se a pessoa ainda está na linha e encerra a ligação em cerca de 30 segundos** Antes, se o agente terminava de falar e quem ligou ficava calado (o telefone esquecido, a ligação aberta no bolso, a secretária eletrônica que terminou), a ligação ficava aberta até a duração máxima do agente, 10 minutos de fábrica, e o motor de voz era pago esse tempo todo. Agora, 10 segundos depois de o agente terminar de falar sem nenhum som de quem ligou, ele pergunta "Você ainda está aí?"; mais 10 segundos depois do lembrete, diz "Se ainda estiver na linha, é só falar."; e mais 8 segundos depois, se despede e encerra a ligação. As frases vão em português ao motor de voz, do mesmo jeito que o pedido para repetir; num agente de outro idioma, ainda não foi conferido se ele as diz no idioma dele. Qualquer som de quem ligou volta a contagem ao zero, e ela não corre enquanto o agente fala, enquanto uma ferramenta está em curso (uma aprovação pedida ao painel inclusive) nem enquanto a ligação está sendo transferida. Vale no telefone, no WhatsApp e no navegador, e não para o menu por teclas nem para o recado. Cada pergunta e o encerramento aparecem na linha do tempo da ligação, e o motivo do fim aparece como "Quem ligou ficou em silêncio". Esse fim não abre pendência de retorno sozinho. Os prazos não são configuráveis nesta versão. **Quem já instalou: a guarda vem ligada para todos os agentes, os novos e os que já existem.** Para manter o comportamento de antes, desligue "Encerrar a ligação quando quem ligou ficar em silêncio" na tela do agente, em Limites por chamada. Desligada, o agente não pergunta nem encerra, e a ligação calada fica aberta até a duração máxima, como antes. Crédito: @melgarafael.
- **Sai o aviso "mudou para…" de WhatsApp e de Regras das ligações** Na 0.46.0, a ligação pelo WhatsApp passou para "Linha telefônica" e o aviso de gravação para "Privacidade e dados", e os lugares antigos mostraram por uma versão um aviso de que o bloco tinha mudado de tela. Esse aviso saiu. Os dois blocos continuam onde estavam na 0.46.0. Nada a fazer ao atualizar. Crédito: @melgarafael.

### Corrigido

- **Os avisos da ligação pelo WhatsApp apontam para "Linha telefônica"** Os avisos do sino sobre a ligação pelo WhatsApp mandavam a "Configurações → WhatsApp" ou a "Configurações", onde o bloco Ligação pelo WhatsApp não fica mais. Agora eles mandam a "Linha telefônica", onde se conecta o número e se escolhe o agente que atende. Isso vale para o aviso de instalação do serviço, ou de falha ao instalá-lo ou removê-lo; para o de número conectado sem agente escolhido e o de número desconectado; para os dois de QR Code que não terminou a conexão; e para o de ligação pelo WhatsApp que o agente não atendeu porque nenhum agente atende o número ou porque o agente está desligado. Os avisos do WhatsApp de mensagens continuam apontando para "Configurações → WhatsApp". Os avisos que já estavam no sino não mudam. Nada a fazer ao atualizar. Crédito: @melgarafael.

## [0.46.0] - 2026-11-23

### Adicionado

- **O pnpm demo termina rodando um teste do agente no motor simulado** Depois da ligação simulada de sempre, o `pnpm demo` roda um teste escrito da Lia: duas falas de quem liga, em texto, e o que se espera dela em cada uma (qual ferramenta pedir, com que argumentos, e o que dizer ou não dizer). No fim, imprime "Teste da Lia: passou" ou "reprovou", e cada reprovação vem com o esperado e o que veio, lado a lado. Num teste, nenhuma ferramenta roda: o teste devolve ao agente a resposta escrita nele, e nenhum webhook, aviso, pendência ou transferência sai. A rodada fica guardada no banco da própria instalação, com um retrato da configuração do agente, e cada teste guarda as 20 rodadas mais novas; se o processo de voz reiniciar no meio de uma rodada, ela é fechada como erro na partida. Esta é só a base: por enquanto o teste roda apenas no motor simulado, que segue um roteiro e não interpreta as instruções, então ele prova a tubulação e o juiz, e não o que um modelo de verdade faria. Ainda não há tela nem custo, e quem já instalou não vê mudança nenhuma. Crédito: @melgarafael.
- **Se ninguém atender a transferência, a ligação volta para o agente** Quando o agente passa a ligação para uma pessoa da equipe e ninguém atende (45 segundos tocando, número ocupado ou indisponível), quem ligou não fica mais com a linha caindo: volta a falar com o mesmo agente, que diz que ninguém conseguiu atender e oferece deixar um recado ou registrar um pedido de retorno. O agente não tenta transferir de novo. A linha do tempo da ligação mostra a transferência não atendida, a volta e o que o agente fez depois. O aviso "retorne a ligação" no painel só sai se o agente não deixou recado nem pendência. Se a ligação não conseguir voltar (a linha caiu antes, ou o áudio não voltou a tempo), ela fica como transferência não atendida, e o aviso "retorne a ligação" sai uma vez. Enquanto a linha toca, o motor de voz fica fechado e não cobra; o teto de custo e a duração máxima continuam valendo para a ligação inteira, com o trecho de volta. Quando a pessoa da equipe atende, a ligação termina para o DeskVoice no atendimento, como antes: sai do limite de ligações simultâneas e fica como transferida. A diferença é a hora gravada no fim: com a volta ligada, é a do atendimento (conta o tempo tocando, em que o motor fica fechado e não cobra); com ela desligada, segue sendo a do pedido da transferência. Vale só para ligações por telefone. **Quem já instalou: a volta vem ligada para todos os agentes, os novos e os que já existem.** Para manter o comportamento de antes (a ligação cai e o painel avisa), desligue "Se ninguém atender a transferência, voltar para o agente" na tela do agente, em Transferência. A atualização não muda o plano de discagem do Asterisk. Crédito: @melgarafael.

### Alterado

- **A ligação pelo WhatsApp passa para a tela "Linha telefônica", e o aviso de gravação para "Privacidade e dados"** O bloco "Ligação pelo WhatsApp" (instalar o serviço, conectar o número e escolher o agente que atende) sai de "Configurações → WhatsApp" e fica em "Linha telefônica", depois dos menus de atendimento. Quem não configura continua sem vê-lo, como antes. O "Aviso de gravação" sai de "Configurações → Ligações" (o cartão "Regras das ligações") e fica em "Configurações → Privacidade e dados", logo acima da gravação; quem não configura continua lendo o texto, sem editar. Nenhum valor salvo muda: o texto do aviso e o número conectado são os mesmos, gravados no mesmo lugar. Por uma versão, os dois lugares antigos mostram para onde o bloco foi, com o link até ele. Os guias da ligação pelo WhatsApp e de clínicas e consultórios passam a apontar para os lugares novos. Na Saúde, os avisos da ligação pelo WhatsApp (sem número, sem agente, número desconectado e falha do serviço) passam a mandar à "Linha telefônica", e em "Privacidade e dados" o texto da gravação aponta para o aviso logo acima. Nada a fazer ao atualizar. Crédito: @melgarafael.

## [0.45.0] - 2026-11-21

### Adicionado

- **A tela da ligação mostra quanto o agente demorou para responder** Nos motores OpenAI Realtime e Gemini Live, a linha do tempo de cada ligação ganha uma linha no fim: em quanto tempo o agente respondeu em metade dos turnos, quanto levou a resposta mais lenta e quantos turnos entraram na conta. A espera conta do aviso de fim de fala que o provedor manda (no Gemini Live, a transcrição, que chega um pouco depois do fim real) até o primeiro som do agente na linha. Ficam de fora os turnos em que uma ferramenta rodou (a espera ali é do sistema chamado, e não do motor), o turno em que o DeskVoice agiu porque o agente ficou calado (fechou a vez de quem ligou à força ou pediu para repetir) e as falas do próprio sistema, como o aviso de gravação e a despedida. Quando há turno tirado assim, a linha diz "o mais lento medido" e conta os turnos em que o DeskVoice agiu; se nenhum turno foi medido, ela mostra só essa contagem, para a ligação toda lenta não sumir. Quando o provedor já tinha visto o fim da fala e só demorou a responder, o turno conta normalmente. No Gemini Live, a linha diz que a medida é aproximada, porque o Google não avisa quando a fala termina e o marco é a transcrição. Em nenhum dos dois motores foi medido quanto o aviso de fim de fala se afasta do fim real. É um registro por ligação, guardado no banco da própria instalação, sem nada enviado para fora. Nada muda na conversa, e nada a fazer ao atualizar. Os números foram conferidos com motor de teste e servidor falso, não numa ligação real. Crédito: @melgarafael.

## [0.44.0] - 2026-11-21

### Adicionado

- **Cada webhook pode receber o relatório de cada ligação, desligado de fábrica** Em Configurações › Integrações, cada webhook permitido ganha a caixa "Receber o relatório de cada ligação", desmarcada de fábrica: quem já instalou não recebe nada novo sem marcar. Marcada, o webhook recebe, depois que a ligação termina e a leitura (desfecho e análise) roda, um `POST` com o evento `call.report`: a ligação, o agente, a direção, o início, o fim, a duração, o motivo do fim, o desfecho, o resumo e a análise com a nota. O relatório é montado na hora da entrega e nunca leva token, chave nem o telefone cadastrado de quem ligou; o sistema do outro lado liga o relatório à ligação pelo `callId`. Mas o resumo e a análise contam o que foi dito: se quem ligou disse o número ou outro dado em voz alta, ele vai junto. O que sai da instalação não é apagado no destino quando quem ligou pede o apagamento; a tela diz isso antes de a caixa ser marcada. Com o desfecho e a análise desligados, o relatório sai logo depois do resumo. Cada entrega vai com `Idempotency-Key` (a mesma em toda tentativa), sai uma vez por ligação e por webhook, tem três tentativas pela fila e aparece na linha do tempo da ligação como entregue ou não entregue, com o motivo (HTTP, sem resposta a tempo, endereço fora do ar). A falha na entrega não mexe na ligação nem nas outras rotinas. Ligação apagada a pedido de quem ligou não sai. Crédito: @melgarafael.

### Alterado

- **Quando uma integração não responde a tempo, o agente só promete retorno se houver quem confira** Quando uma integração cadastrada não responde dentro do prazo durante a ligação, o agente deixava de repetir o pedido e dizia à pessoa que ia verificar, mas ninguém verificava: nada era aberto e ninguém era avisado. Agora a frase que o agente recebe depende das ferramentas que ele tem na ligação. Com "Abrir uma pendência", ele abre uma pendência para a equipe conferir se a integração registrou o pedido e diz à pessoa que a equipe vai conferir e dar retorno. Sem ela, mas com "Avisar a equipe", ele avisa a equipe e diz que ela vai conferir. Sem nenhuma das duas, ele diz que não foi possível confirmar agora e que a pessoa pode ligar de novo mais tarde, sem prometer retorno. A linha do tempo mostra a frase escolhida no resultado da ferramenta. Nada a configurar: quem quiser o retorno marca uma dessas ferramentas no agente. Crédito: @melgarafael.
- **Cada webhook permitido ganha o seu prazo de resposta, de 1 a 30 segundos** Em Configurações › Integrações, cada webhook permitido ganha o campo "Prazo de resposta (segundos)": quanto o agente espera o sistema do outro lado responder, de 1 a 30 segundos. O padrão continua 10 segundos, o de antes, e a lista que já estava gravada segue valendo com 10 segundos sem ninguém mexer. O prazo vale para toda chamada a esse webhook, durante a ligação e nas entregas depois dela. Durante a ligação, a pessoa fica na linha esse tempo; sem resposta no prazo, o agente diz que vai verificar, como já fazia. A API recusa prazo fora de 1 a 30 e devolve sempre o prazo que vale. Crédito: @melgarafael.

### Corrigido

- **Um limite padrão gravado acima do teto não impede mais criar uma organização, e "Ela nasce com" fala 1 no singular** Se alguém gravou à mão, em `defaults.limits`, um número acima do teto que a tela aceita (1 milhão de linhas telefônicas ou de agentes, ou 2.147.483.647 centavos de teto do mês), a criação de uma organização falhava com um erro genérico. Agora esse campo volta ao valor de fábrica, "sem limite", como já volta um campo com tipo errado. Os outros campos da chave continuam valendo, e a seção "Padrões para organizações novas" mostra com o que a organização nasce de verdade. A tela e o núcleo passam a conferir o mesmo teto. A frase "Ela nasce com" agora diz "até 1 linha telefônica" e "até 1 agente" (e o mesmo em inglês e espanhol), em vez do plural, e a recusa de criar além do limite também ("já tem 1 linha telefônica", "já tem 1 agente"). Crédito: @melgarafael.

## [0.43.0] - 2026-11-21

### Adicionado

- **Uma organização nova já nasce no fuso e no idioma que a administração da instalação escolheu** Na área da instalação, em Organizações, a seção "Padrões para organizações novas" ganhou o fuso e o idioma com que cada organização nova nasce. O fuso, em nome IANA como America/Sao_Paulo, é o da janela de ligações e o do mês de custo da organização nova, que pode trocá-lo depois na política de saída; um fuso que não existe é recusado. O idioma (português, inglês ou espanhol) é o que o formulário de agente novo e o de menu novo dessa organização propõem: agentes e menus que já existem não mudam, e a língua da tela continua sendo a de cada navegador. Sem padrão escolhido, a organização nova nasce em America/Sao_Paulo e propõe português, como antes, e as que já existem também seguem assim. A organização nova recebe uma cópia: mudar o padrão depois não mexe no fuso, no mês de custo nem no idioma de nenhuma organização que já existe. A mudança do padrão aparece na Auditoria da instalação. Crédito: @melgarafael.

### Alterado

- **O aviso de atualização no sino diz quem pode seguir, e quem administra a instalação ganha o link "Ver a atualização"** O aviso de atualização continua chegando ao sino de toda organização, porque a atualização derruba o sistema de todas. O texto agora diz quem acompanha o resultado: "Quem administra a instalação … em Administrar a instalação → Atualização". Quem administra a instalação vê no aviso o link "Ver a atualização", que leva a `/installation/update`. Quem não administra lê o aviso sem link, e não cai mais numa tela que não abre. Os avisos já gravados ficam como estavam, sem link. Os avisos do serviço de WhatsApp não mudam. Nada a fazer ao atualizar. Crédito: @melgarafael.

### Corrigido

- **No Gemini Live, a ferramenta que o Google cancela não tem mais o resultado entregue ao modelo** Quando quem ligou fala por cima do agente enquanto uma ferramenta roda, o Gemini Live pode avisar que desistiu daquela chamada. Antes, o aviso era ignorado, e o resultado da ferramenta ia ao modelo assim mesmo, quando ele já não o esperava. Agora o resultado da chamada cancelada é descartado, e a linha do tempo da ligação mostra que o motor desistiu da ferramenta. O que a ferramenta já tinha feito continua feito e registrado: um webhook que já recebeu o pedido, por exemplo, não é desfeito. Isso foi conferido contra um servidor falso. Não se sabe com que frequência o aviso vem numa ligação real. Nada a fazer ao atualizar. Crédito: @melgarafael.

## [0.42.1] - 2026-11-21

### Corrigido

- **O ajuste de NAT das linhas passa a valer, e a checagem de saúde reprova quando um módulo SIP não carrega** Na imagem do Asterisk que o DeskVoice usa, com todos os módulos SIP dela ligados, o limite de módulos do PJSIP estourava na partida ("Too many modules registered") e o último módulo SIP a carregar ficava parado. Qual depende da máquina: numa delas era o `res_pjsip_nat`, e o `force_rport` e o `rewrite_contact` de toda linha não faziam efeito, e uma linha atrás de NAT ligava e ficava muda. O DeskVoice agora traz o próprio `modules.conf`, igual ao da imagem, mas sem três módulos SIP que ele não usa e que ocupam vaga nesse limite (SIP por WebSocket, mensagem de texto por SIP e o histórico de pacotes), e o `bash install/healthcheck.sh` ganha a linha essencial "Módulos SIP", que reprova se qualquer módulo SIP estiver parado ou se o log da partida tiver o estouro. A atualização reinicia o Asterisk **uma vez**, porque a montagem nova recria o contêiner, e as ligações em andamento nesse momento caem: vale atualizar fora do horário de ligações. Depois dela, uma linha atrás de NAT que "ligava e ficava muda" pode passar a ter áudio, sem nada a fazer. Quem troca a imagem por `ASTERISK_IMAGE`: se a imagem escolhida não carregar algum módulo SIP, a checagem de saúde reprova e a atualização volta para a versão anterior, e a linha "Módulos SIP" diz qual módulo falta. Crédito: @melgarafael.

## [0.42.0] - 2026-11-21

### Adicionado

- **Uma organização nova já nasce com os limites que a administração da instalação escolheu, e com a saída travada** Na área da instalação, em Organizações, a seção "Padrões para organizações novas" guarda os limites com que cada organização nova nasce: quantas linhas telefônicas, quantos agentes, o teto de gasto do mês e se ela pode ligar para fora. Os campos são os mesmos dos limites de uma organização. O formulário de nova organização diz, antes de criar, com o que ela nasce. Sem padrão escolhido, a organização nova nasce sem limite de linhas, de agentes e de gasto, e com as ligações de saída bloqueadas até alguém desbloquear nos limites dela. Antes, ela nascia sem trava nenhuma. A organização nova recebe uma cópia: mudar o padrão depois não mexe em nenhuma organização que já existe. A organização de quem instalou e as que já existem continuam como estão, sem limite. A mudança do padrão aparece na Auditoria da instalação. Crédito: @melgarafael.

### Alterado

- **A tela de atualizar mora só em "Administrar a instalação" › "Atualização", e /settings/system leva até ela** A tela de versão e atualização deixa de morar em Configurações, também na instalação com uma organização só: ela fica em "Administrar a instalação" › "Atualização" (`/installation/update`) para quem administra a instalação, com a lista de quem administra explícita ou não. O cartão "Sistema" sai da central de Configurações. O endereço antigo, `/settings/system`, continua valendo: leva quem administra a instalação à tela nova, e quem não administra de volta a Configurações. Quem não administra a instalação vê a versão na lateral sem link, como já via com a lista explícita. A atualização em si, a rota da API e quem pode pedir não mudam. Nada a fazer ao atualizar. Crédito: @melgarafael.
- **Desfecho, análise e transcrição saem da tela de inteligência artificial para a tela própria "Desfecho, análise e transcrição"** A tela de inteligência artificial de Configurações fica só com as chaves dos motores de voz e o motor padrão. Os três opcionais com custo, classificar o desfecho, analisar a ligação (com quem lê a ligação) e transcrever a gravação (com a transcrição automática), passam para `/settings/after-call`, que se abre pelo cartão "Desfecho, análise e transcrição" da central. Nenhum valor salvo muda: quem já tinha um opcional ligado o encontra ligado na tela nova, lido e gravado no mesmo lugar. O README e o aviso de transcrição desligada, na tela e na resposta da API, passam a mandar ligar esses opcionais em "Configurações → Desfecho, análise e transcrição"; o que fala da chave continua apontando para a tela de inteligência artificial. Nada a fazer ao atualizar. Crédito: @melgarafael.
- **A integração que não responde a tempo vira "não sei", e cada chamada leva uma chave de idempotência** Quando uma integração cadastrada não responde dentro do prazo durante a ligação, o agente deixa de tratar isso como erro: ele ouve que não se sabe se o pedido foi registrado, que não deve chamar de novo sem antes confirmar com a pessoa, e diz que vai verificar. A linha do tempo mostra a frase "não respondeu a tempo" no resultado da ferramenta. Erro HTTP e falha de rede seguem como antes. Toda chamada do agente a uma integração passa a levar o cabeçalho `Idempotency-Key`, igual para a mesma ligação, a mesma integração e os mesmos dados: o sistema do outro lado que respeita esse cabeçalho não registra o pedido duas vezes quando o agente repete; quem não o conhece simplesmente o ignora. Nada a configurar. Crédito: @melgarafael.

### Corrigido

- **No Gemini Live, o motor passa a retomar a sessão quando o Google troca a conexão** O Google fecha a conexão da Live API em cerca de 10 minutos, e o tempo máximo padrão de uma ligação é de 10 minutos: uma ligação longa com o motor Gemini Live podia cair perto desse ponto. Agora o motor pede ao Google um identificador para retomar a sessão e liga a compressão do contexto. Quando o Google avisa que vai fechar a conexão, ou quando ela cai depois de o motor ter recebido esse identificador, o motor abre outra conexão com ele, sem encerrar a ligação e sem fala a mais. A troca aparece na linha do tempo da chamada, e o consumo das duas conexões entra no custo. Se a retomada falhar depois do aviso do Google, a ligação segue pela conexão de antes até o Google fechá-la, e aí cai como antes, com o aviso de falha do motor; se falhar depois de uma queda, cai na hora, também como antes. Isso foi conferido contra um servidor falso. Uma ligação real de mais de 10 minutos ainda não foi feita, e não se sabe se quem está na linha percebe a troca. Nada a fazer ao atualizar. Crédito: @melgarafael.

## [0.41.6] - 2026-11-21

### Corrigido

- **No OpenAI Realtime, o motor passa a pedir o corte da fala interrompida no histórico** Quando quem ligou fala por cima do agente numa ligação pelo Asterisk com o motor OpenAI Realtime, o motor agora avisa o provedor até onde a fala foi enviada para a linha, para que o provedor corte o resto do histórico da conversa. Antes, o modelo seguia achando que tinha dito a frase inteira e podia dar por combinado algo que a pessoa nunca ouviu. O efeito numa ligação real ainda não foi conferido: se o provedor recusar o pedido, o erro vai para o registro, nada é cortado e a ligação segue como antes. O Gemini Live, a ligação pelo WhatsApp e a chamada de teste no navegador seguem como estavam. Nada a fazer ao atualizar. Crédito: @melgarafael.

## [0.41.5] - 2026-11-21

### Alterado

- **As telas de Configurações perdem a barra de abas e ganham "← Configurações"; "Minha conta" vai para o bloco da conta** As telas de Configurações não mostram mais a barra com as 11 abas. Cada uma traz o próprio nome como título e, acima dele, o link "← Configurações", que volta à central de cartões. A central é o caminho para todas elas. "Sua conta", onde se trocam o contato e a senha, saiu da barra e agora fica no bloco da conta, no fim do menu lateral (no celular, no fim da página), com o nome "Minha conta". Os endereços continuam os mesmos, inclusive `/settings/account`, e um favorito antigo abre a mesma tela. Nada a fazer ao atualizar. Crédito: @melgarafael.

## [0.41.4] - 2026-11-21

### Alterado

- **Configurações abre numa central de cartões, com o estado de cada área** Quem abre Configurações agora vê uma central de cartões em vez de cair direto na tela de inteligência artificial. Cada cartão diz em uma frase o que a área faz e abre a tela de sempre: Motores de voz, Cérebros, Voz e Filtro de fala; Analistas e Desfecho, análise e transcrição; WhatsApp e Webhooks; Regras das ligações, Privacidade e dados e Sistema. Alguns cartões mostram o estado da área: Motores de voz diz "Pronto" quando algum motor tem chave; o WhatsApp diz "Pronto" só com o número conectado, "Desligado" sem o serviço e "Falta algo" no resto, e só para quem configura; Webhooks diz "Desligado" sem nenhum endereço. Enquanto falta criar um agente, conectar a linha ou cadastrar a chave de um motor, o cartão "Primeiros passos" aparece no topo, com os mesmos passos da tela de Chamadas, e some quando os três estão feitos. A barra de seções continua no alto, e um favorito antigo para `/settings` abre a central, a um clique da tela de inteligência artificial. Nada a fazer ao atualizar. Crédito: @melgarafael.
- **Os ajustes técnicos de Configurações ficam num bloco "Avançado", fechado ao abrir a tela** Quatro ajustes técnicos passam para um bloco "Avançado", que começa fechado: o endereço, a chave e o modelo da classificação, na tela de inteligência artificial; o conector externo de WhatsApp e "Confiar no número exibido na ligação", na tela de WhatsApp; e exportar, esquecer e apagar os dados de um número, na tela de Privacidade. Nenhum valor salvo muda, e cada ajuste continua lendo e gravando o mesmo lugar. O aviso da tela do agente que pede para ligar "Confiar no número" agora leva à tela de WhatsApp com o "Avançado" já aberto; o aviso de WhatsApp não conectado continua levando à tela de WhatsApp, onde está a conexão. Crédito: @melgarafael.

## [0.41.3] - 2026-11-20

### Alterado

- **O operador vê o nome do cérebro que lê as ligações do agente e os avisos quando a escolha deixa de funcionar** Na tela do agente, quem tem o papel de operador passa a ver o nome do cérebro escolhido para ler as
  ligações, no lugar do código dele, e os mesmos avisos de quem configura: o cérebro sem chave aceita,
  o modelo que saiu da lista e o modelo sem preço conhecido. O aviso diz para pedir a um dono ou
  administrador que mude a escolha. O operador continua sem poder mudá-la, e nada da chave chega à tela
  dele. Nada a configurar. Crédito: @melgarafael.
- **O menu lateral do painel separa os itens em grupos** O menu lateral do painel passa a mostrar os itens em quatro grupos com título: Atendimento (Chamadas, Aprovações, Pendências), Montar (Agentes, Linha telefônica, Ligações de saída), Acompanhar (Custos) e Organização (Equipe, Configurações). Os itens, a ordem e os endereços continuam os mesmos, e os favoritos seguem funcionando. No celular, onde o menu é uma faixa que rola de lado, os grupos ficam separados por uma linha fina. O operador continua sem ver Equipe. Nada a fazer ao atualizar. Crédito: @melgarafael.
- **A tela de inteligência artificial de Configurações passa a morar em /settings/ai** As chaves dos motores, o desfecho, a análise e a transcrição continuam na mesma tela, com os mesmos valores salvos, mas o endereço dela agora é `/settings/ai`. Quem abre `/settings`, por um favorito ou por um link antigo, chega a ela direto, com a mesma query e o mesmo `#`. Os avisos de Chamadas, de "Falar com o agente" e da tela do agente que mandam cadastrar a chave apontam para o endereço novo. É o primeiro passo para Configurações virar uma central de cartões. Crédito: @melgarafael.

## [0.41.2] - 2026-11-20

### Alterado

- **A exclusão de organização também desfaz a ligação pelo WhatsApp** Por dentro, a exclusão de uma organização passa a desconectar também o número da ligação pelo WhatsApp: o processo de voz tira o aparelho vinculado do celular e apaga a sessão no serviço de ligações, e a rotina só apaga a organização depois disso. Se o serviço de ligações estiver fora do ar e nenhuma organização usar a ligação pelo WhatsApp, a exclusão segue sem ele. Quem ligar pelo WhatsApp para o número de uma organização já excluída ouve o aviso de indisponível, e a auditoria da instalação registra o fato, sem o número de quem ligou. Ainda não há botão nem rota para pedir a exclusão (vem na próxima fatia), então ninguém vê diferença. Crédito: @melgarafael.

### Corrigido

- **A Saúde só diz que a ligação pelo WhatsApp funciona depois que uma ligação chega** Com o número conectado e o agente escolhido, a linha da ligação pelo WhatsApp na Saúde dizia "funcionando" mesmo quando o WhatsApp entregava as ligações só ao celular. Agora ela fica em aviso até chegar uma ligação pelo WhatsApp depois da conexão, e então mostra a hora da última. A tela de conexão e o guia deixam de afirmar que até quatro aparelhos conectados recebem a ligação: num relato com quatro aparelhos, contando o DeskVoice, ela tocou só no celular. A recomendação passa a ser deixar no máximo dois outros aparelhos conectados ao número e fazer uma ligação de teste. Nada a fazer em instalações existentes; quem já tem o número conectado e nenhuma ligação recebida desde então passa a ver o aviso até a primeira ligação. Crédito: @aleflores35, pelo relato.
- **A chamada pelo navegador recusada pelo teto de gasto do mês aparece em Chamadas, com o motivo na linha do tempo** Quando a organização chega ao teto de gasto do mês, a tentativa de chamar um agente pelo navegador passa a ficar registrada em Chamadas como recusada, com "a organização chegou ao teto de gasto do mês" na linha do tempo, como já acontecia com a ligação pela linha telefônica e pelo WhatsApp. Antes, só quem clicou via a recusa, na própria tela. As outras recusas do navegador (agente desligado, motor sem chave) continuam aparecendo só na tela de quem clicou, e a recusa não ocupa vaga de chamadas ao mesmo tempo. A soma do mês que o teto confere a cada chamada também ficou mais leve: passa a ler só a fatia do período no extrato, e não o extrato inteiro da organização, com o mesmo total na tela de Custos, na visão geral da instalação e no teto. Nada a fazer para quem já instalou. Crédito: @melgarafael.

## [0.41.1] - 2026-11-19

### Corrigido

- **O agente de atualização volta a passar a cada minuto logo depois de reiniciar a máquina** Em máquina cujo relógio de hardware guarda a hora local, e não a universal, o sistema sobe horas adiantado e o acerto de hora volta o relógio logo depois. O timer do agente, que contava pela hora do calendário, ficava marcado para horas depois. Nesse tempo, o painel não ouvia o agente, a atualização pela tela não andava e a checagem de saúde avisava "não fala com o painel desde". Agora o timer conta o tempo decorrido, que não pula. A primeira passada vem um minuto depois de o timer ligar, e as seguintes, um minuto depois do começo da anterior, com o mesmo atraso aleatório de até 15 segundos. Quando a atualização roda com permissão de administrador (a pasta é do root, ou o dono tem sudo sem senha), ela regrava o timer sozinha; senão, a saída da atualização avisa e diz o comando: `sudo bash install/agent.sh --install`. Sem esse comando, nada quebra: o timer antigo continua, com o defeito de depois do reboot. Crédito: @melgarafael.

## [0.41.0] - 2026-11-19

### Adicionado

- **Antes de salvar uma linha cuja faixa cruza a de outra organização, a tela de Linhas avisa e pede confirmação** Quando a instalação tem mais de uma organização e alguém salva uma linha cujo endereço (o servidor do provedor e, na linha por IP, os endereços extras) cruza a faixa de uma linha de outra organização, de modo que alguma linha por IP sairia do ar, a tela de Linhas para antes de salvar e diz que existe uma linha de outra organização na mesma faixa e que, salvando, as linhas por IP das duas param de receber chamadas até uma delas mudar o endereço. Salvar mesmo assim grava como antes; Voltar não grava nada. O aviso não diz qual linha, de que organização nem em que endereço. A regra é a mesma que o processo de voz já usava para deixar essas linhas de fora do arquivo do Asterisk, agora num lugar só. Nada muda para quem tem uma organização só, e mudar só o nome de uma linha nunca pergunta. Quem usa a API recebe `409` com `trunk_overlap_unconfirmed` e confirma com `confirmOverlap: true` no corpo. Quando a tela pede essa confirmação, a tentativa aparece na Auditoria da instalação. Cada organização confere a faixa até 10 vezes por minuto; acima disso a API responde `429` com `too_many_attempts`, e a tela pede para esperar um minuto. Crédito: @melgarafael.
- **Quem administra a instalação pode pôr um teto de gasto do mês em cada organização** Na área da instalação, em Organizações › Limites, o campo Teto de gasto do mês (em dólares, a moeda do custo que o DeskVoice mede) mostra ao lado quanto a organização já gastou no mês, a mesma soma da tela de Custos. Quando a soma do mês, no fuso da organização, chega ao teto, toda chamada nova dela é recusada no começo, antes de abrir o motor de voz: a recebida pela linha telefônica e pelo WhatsApp ouve a fala de indisponível, sem caixa postal; a de saída, a religação e a chamada pelo navegador não saem, com o motivo na tela e na linha do tempo. O painel da organização recebe um aviso por janela de 10 minutos. A chamada em andamento não é cortada, e o teto de custo por chamada do agente continua valendo. O valor é aproximado: inclui custo estimado e não inclui o que não pôde ser medido. A organização vê o teto e o gasto do mês em Configurações › Limites, e a Visão geral da instalação ganha a coluna Teto do mês. A mudança fica registrada na Auditoria da instalação. Nada muda para quem já instalou: sem teto, nenhuma chamada é recusada e nada a mais é somado. Crédito: @melgarafael.

### Alterado

- **A exclusão de organização ganha a lápide e a rotina que termina a limpeza** Por dentro, a exclusão de uma organização suspensa passa a existir: ela fica marcada como "excluindo", não pode mais ser reativada, e a rotina de fundo desconecta o WhatsApp de mensagens dela (a ligação pelo WhatsApp é desfeita numa próxima versão), apaga as gravações, apaga tudo dela no banco, apaga as contas que ficaram sem nenhuma organização e deixa o registro na auditoria da instalação, com as contagens. Se o servidor reiniciar no meio, a rotina retoma de onde parou. A linha de telefone da organização sai do Asterisk em até 5 minutos. Ainda não há botão nem rota para pedir a exclusão (vem na próxima fatia), então ninguém vê diferença. Crédito: @melgarafael.

## [0.40.0] - 2026-11-19

### Adicionado

- **Quem administra a instalação pode bloquear as ligações de saída de uma organização** Na área da instalação, em Organizações › Limites, o campo Ligações de saída bloqueia as ligações de saída da organização: com o bloqueio, nenhuma ligação de saída dela nasce, por nenhum caminho, nem a religação de uma ligação que caiu. A tela de Ligações de saída da organização e Configurações › Limites dizem que a administração da instalação bloqueou, e uma religação que já estava agendada não sai e vira uma pendência que diz o mesmo motivo. O bloqueio não muda a escolha da organização: desbloquear devolve a saída como ela tinha deixado, ligada ou desligada, e a tela diz qual antes de salvar. A mudança fica registrada na Auditoria da instalação. Nada muda para quem já instalou: sem o bloqueio, nenhuma saída é bloqueada e nenhuma tela mostra o aviso. Crédito: @melgarafael.

### Alterado

- **Apagar uma organização no banco leva junto todas as linhas dela** Toda chave estrangeira para a organização passa a apagar em cascata, menos duas que ficam vazias de propósito: o registro da instalação guarda a própria exclusão, e a conta só deixa de lembrar o último vínculo. Ainda não há como excluir organização pelo painel; esta mudança só prepara o banco, e ninguém vê diferença. Um teste gerado do catálogo reprova a tabela nova que nascer sem cascata. Crédito: @melgarafael.

### Corrigido

- **A simulação do DOCKER-USER diz que o serviço ficaria ativo já, e não só no boot** O `bash install/docker-user.sh --dry-run apply <portas>` agora diz que gravaria o serviço `deskvoice-docker-user` e o ligaria agora e no boot, igual ao que o `apply` de verdade faz desde a versão anterior. Antes, a simulação dizia só "no boot". Muda apenas o texto; nada a fazer. Crédito: @webtecnica.
- **Na URA, a rota do anúncio recusa anúncio com menos de 200 ms, e a transferência que falha fica gravada como falha da URA** A rota que recebe o anúncio do menu por teclas passa a recusar o anúncio com menos de 200 ms (0,2 segundo), que tocaria como silêncio, com o código `ivr_prompt_too_short`: antes, só a tela recusava, e quem subia o WAV pela API conseguia salvar um anúncio mudo. A tela e a rota usam o mesmo limite. Quando o processo de voz não consegue transferir a ligação para a pessoa do menu, a chamada continua "Falhou", e o motivo gravado (`end_reason`, que a API devolve) passa a ser `ivr_failed`, em vez de `transferred`; a linha do tempo continua mostrando a transferência pedida, o fim da ligação e, depois, a frase "A transferência para a pessoa do menu não completou". Os anúncios já salvos não mudam. Nada a configurar. Crédito: @melgarafael.
- **Na URA, a duração da ligação passada à IA conta desde o atendimento do menu, e a rota do anúncio recusa 199,9 ms** Quando a URA passa a ligação para um agente de IA, a hora de atendimento da chamada (`answered_at`, que a API devolve como `answeredAt`) fica sendo a hora em que a URA atendeu, e não mais a hora em que a IA começou a falar. A duração mostrada no painel passa a incluir o tempo no menu, que é o tempo que a pessoa passou na linha. Os minutos de cada motor, em Custos, continuam contando desde que a IA atendeu: o tempo no menu não entra neles. A ligação sem URA não muda. As ligações já gravadas não mudam. A rota que recebe o anúncio do menu passava um áudio de 199,5 a 199,9 ms, porque arredondava a duração antes de comparar com o mínimo de 200 ms. Agora ela compara a duração medida, sem arredondar, e recusa esse áudio com `ivr_prompt_too_short`. O máximo de 60 s também: um áudio de 60 000,1 ms agora é recusado com `ivr_prompt_too_long`. Nada a configurar. Crédito: @melgarafael.

## [0.39.0] - 2026-11-19

### Adicionado

- **Quem administra a instalação pode limitar quantas linhas telefônicas e quantos agentes cada organização cria** Na área da instalação, em Organizações, o botão Limites de cada organização abre dois campos, Linhas telefônicas e Agentes, com quanto ela já usa ao lado. Com o limite atingido, criar mais uma linha ou mais um agente é recusado com uma frase que diz a contagem e o limite; baixar um limite não apaga nem desliga nada do que já existe, só impede criar mais. A organização vê os limites dela em Configurações, só para leitura, e a mudança fica registrada na Auditoria da instalação. Nada muda para quem já instalou: sem limite definido, nenhuma organização tem limite e nenhuma tela mostra o bloco. Crédito: @melgarafael.
- **Cada agente pode ter o seu cérebro para ler as ligações** Quem lê a ligação depois que ela termina (o desfecho e a análise) agora pode ser escolhido em cada agente. Na tela do agente, o bloco novo "Cérebros deste agente" mostra uma linha por trabalho: quem conversa (o próprio motor de voz), quem lê a ligação e, citado com o link, o analista que acompanha a ligação ao vivo. Para quem lê, há três opções: igual à organização, que é o padrão e mostra o que vale hoje; o motor de voz do próprio agente, mesmo com um cérebro escolhido em Configurações; ou um cérebro e um modelo da lista guardada, pela mesma busca de Configurações e com a mesma conferência (chave aceita, modelo na lista, modelo sem preço só depois do aviso, que diz também quando o agente está sem teto de custo). A mesma escolha está na API (`PATCH /api/v1/agents/<id>`, campo `analysisBrain`). Assim, Vendas pode ser lido por um modelo e Suporte por outro, e o extrato de cada ligação mostra o modelo e o custo do próprio agente; a linha do tempo diz "(escolha do agente)". A escolha do agente vale sozinha: se o cérebro dele sumir, a chave for removida ou o modelo sair da lista, a ligação não é lida e a linha do tempo diz por quê, sem passar para a escolha da organização nem para o motor. O teto de custo e o modelo sem preço seguem as regras de hoje, pelo teto do agente. Em Configurações, a seção da análise diz quais agentes usam escolha própria, e em Cérebros a confirmação de remover a chave diz de quais agentes a análise vai parar. Todo agente que já existe segue a organização, e nada muda sem você mexer. Crédito: @melgarafael.
- **O agente pode ligar de volta quando a ligação cai** O bloco "Quando a ligação cai", na tela do agente, ganha a quarta opção, "Ligar de volta": quando uma ligação recebida cai no meio da conversa, o sistema agenda uma única religação 30 minutos depois, dentro do horário das ligações de saída. A religação sai pela mesma conferência de toda ligação de saída, feita na hora de discar (política ligada, horário, teto do dia, tentativas por pessoa e lista de não ligar); o número na lista de não ligar nunca é discado. Os 30 minutos não são empurrados para a próxima janela: se caírem fora do horário, a religação não sai. Quando a religação não acontece, ou ninguém atende, abre a pendência para alguém retornar, menos quando o número está na lista de não ligar: aí nada é discado e nenhuma pendência é aberta. A religação nunca gera outra religação, e um mesmo número recebe no máximo um retorno a cada 24 horas. A opção só pode ser escolhida com as ligações de saída ligadas; sem elas, aparece desabilitada, diz por quê e leva a Ligações de saída, e o painel recusa o modo mesmo pedido direto. A linha do tempo da ligação que caiu mostra o agendamento, a tentativa, o resultado e o custo da religação, com o link para ela, e a religação diz no topo de qual ligação é o retorno. Para quem não escolhe a opção, o que acontece quando a ligação cai não muda, mas a linha do tempo ganha uma linha: a ligação que termina antes de o áudio conectar (a de saída que ninguém atende, ou a recebida de quem desiste antes) passa a mostrar "Tarefa deixada para depois da chamada: Revisão do supervisor", e essa revisão não abre pendência. A doutrina das ligações de saída passa a dizer por que essa religação não é discador. Crédito: @melgarafael.

### Corrigido

- **A regra do DOCKER-USER passa a valer também ao reiniciar o Docker logo depois do apply** O `bash install/docker-user.sh apply <portas>` agora deixa o serviço `deskvoice-docker-user` ligado e já ativo, e não só ligado para o próximo boot: assim, se o Docker for reiniciado antes de a máquina reiniciar, o serviço é chamado e confere a regra. O `apply` sem portas agora para o serviço antes de apagá-lo, e ele não fica na memória do systemd com o arquivo apagado. O texto do script e da documentação deixa de dizer que reiniciar o Docker esvazia a cadeia: o boot esvazia, e o reinício do Docker não esvaziou a cadeia no 29.9.3 (medido); outras versões não foram medidas, e o serviço repõe a regra nos dois casos. Quem já tem o serviço não precisa fazer nada: vale no próximo `apply`. Crédito: @webtecnica.
- **Na URA, a falha ao passar ao agente tem o motivo certo, e a ligação sempre é transferida ou desligada** Na URA, uma falha ao passar a ligação ao agente aparece com o motivo certo, e a ligação sempre é transferida ou desligada mesmo quando a fala falha. Quando o banco falha no momento em que quem ligou escolhe um agente, a linha do tempo agora diz que houve uma falha ao gravar a ligação, e não mais que o agente estava desligado. Se a fala de falha não sai, a ligação é transferida para a pessoa do menu (ou desligada) mesmo assim; se o processo de voz não consegue pedir a transferência, a ligação é desligada e aparece como falha, com a frase "A transferência para a pessoa do menu não completou". O anúncio com menos de 0,2 segundo, que tocaria como silêncio, é recusado na hora de subir, com a frase que sugere um MP3 ou um WAV. Nada a configurar. Crédito: @melgarafael.

## [0.38.0] - 2026-11-18

### Adicionado

- **A imagem e o serviço do Laya existem, desligados** O DeskVoice ganhou a imagem do Laya, o modelo de decisão de pesos abertos que pode rodar na própria
  VPS como opção do filtro da fala, e o serviço dele no Compose, num perfil que vem desligado. Quem já
  instalou não vê nada mudar: a atualização não baixa a imagem, o Compose não sobe o serviço, e a tela
  do filtro da fala ainda não oferece o Laya. Ligá-lo pela tela e pelo instalador vem numa versão
  seguinte, depois que a imagem passar a ser publicada. Nada a configurar. Crédito: @melgarafael.
- **O número pode atender por um menu por teclas** Em Linha telefônica, a nova seção Menus por teclas cria um menu de um nível: quem liga ouve um anúncio e aperta uma tecla, que leva a um agente de IA, a uma pessoa (transferência para um número) ou desliga. O anúncio é um arquivo de áudio que você já tem (WAV, MP3 ou M4A, até 60 segundos), convertido no navegador; o botão Ouvir toca o que ficou salvo. Todo menu precisa de ao menos uma tecla que leve a uma pessoa, e é para ela que a ligação vai quando quem liga não escolhe nada depois das tentativas (ou o menu avisa e desliga, se você preferir) e quando algo falha, com uma fala gravada no idioma do menu. Sem nenhuma tecla para um agente, o menu funciona sem chave de IA. No número, troque "Atende: IA" por "Menu por teclas" e escolha um menu que já tenha anúncio. A linha do tempo mostra a opção escolhida, o tempo até a escolha e as tentativas sem escolha; a sequência digitada nunca é gravada, só a tecla de uma opção que existe. O anúncio fica no banco: o prazo de guarda e o apagamento a pedido de quem ligou não o apagam, e a cópia de segurança do banco o leva. Todo número que já existe continua atendido pela IA até você mudar. A ligação pelo WhatsApp não passa pelo menu. Crédito: @webtecnica.

### Corrigido

- **O erro do fornecedor não aparece mais como falta de internet** Quando o fornecedor de voz, de cérebro, de motor ou do filtro de fala responde com erro do lado dele
  (um 5xx, como na queda da ElevenLabs de 18/11), o teste da chave agora diz que o fornecedor
  respondeu com erro do lado dele e que costuma passar sozinho, para tentar de novo em alguns minutos.
  A linha do tempo diz só que o fornecedor respondeu com erro do lado dele. Antes, a tela dizia que ele
  não foi alcançado e mandava conferir a internet do servidor. Quando de fato não há resposta, a frase
  de conferir a rede continua a mesma. Nada a fazer: os testes de chave já gravados mantêm a frase
  antiga até o próximo teste. Relatado pelo Rafael. Crédito: @melgarafael.
- **A ligação pelo WhatsApp diz quando o pareamento terminou antes do QR Code** Quando o WhatsApp encerrava a tentativa de conexão antes de mostrar o QR Code, a tela e o aviso diziam que o QR Code não tinha sido lido a tempo. Agora dizem que o WhatsApp encerrou a tentativa antes do QR Code, e sugerem tentar de novo e, se repetir, atualizar o DeskVoice. O texto de quando o serviço não tem mais a conexão passa a citar também o reinício com uma tentativa que não chegou a parear, além do backup restaurado, da troca de servidor e da reinstalação. Nada a configurar. Crédito: @melgarafael.

## [0.37.2] - 2026-11-18

### Adicionado

- **A base do acesso de suporte da instalação, ainda sem tela** Preparação interna para o acesso de suporte da administração da instalação. Nenhuma tela muda, e ninguém ganha acesso de suporte sem uma ação de quem administra a instalação. A atualização só acrescenta ao banco: uma tabela com os acessos de suporte de cada organização e uma coluna na sessão. Por trás, quem administra a instalação já pode entrar numa organização como suporte, sempre com motivo (de 10 a 500 caracteres) e prazo (15, 30 ou 60 minutos), com papel de administrador e nunca de dono, sem telefone e sem WhatsApp. O acesso não se renova: acaba quando a pessoa encerra ou quando o prazo vence, mesmo que ela não faça mais nada, e a sessão volta para a organização de onde a pessoa veio. O início e o fim ficam registrados nas duas pontas, no histórico da organização e na auditoria da instalação, com o motivo e o prazo. Durante o suporte, a sessão fica dentro da organização do cliente: não abre outro acesso, não troca de organização, não usa a área da instalação, e nenhuma leitura do painel traz dado de outra organização. Quem já é da equipe da organização entra pelo seletor, e não como suporte. Crédito: @melgarafael.

### Alterado

- **A senha recusada no aceite do convite tem uma mensagem só** Quando a senha não é aceita no convite, a página mostra uma mensagem só, que diz as duas saídas: quem já tem conta digita a senha dela, quem não tem escolhe uma senha nova com no mínimo 10 caracteres. Crédito: @melgarafael.

### Corrigido

- **A ligação pelo WhatsApp volta a mostrar o QR Code** O WhatsApp passou a recusar a versão do cliente que o serviço de ligação pelo WhatsApp (WaCalls) usava. Desde então, "Conectar" ficava em "preparando a conexão" sem nunca mostrar o QR Code, e um número já conectado que caísse não voltava. A imagem do WaCalls agora é a do fork da DeskLabs com o cliente atual, e a atualização a baixa sozinha em quem tem o serviço ligado. Se o pareamento terminar com erro de novo, a tela diz que falhou em vez de esperar para sempre. Depois de atualizar, quem ficou preso em "preparando a conexão" ou com o número desconectado clica em "Conectar de novo" em Configurações → WhatsApp e lê o QR Code. Crédito: @melgarafael.

## [0.37.1] - 2026-11-18

### Alterado

- **A página do convite não muda conforme o e-mail** A página do convite passa a ser a mesma para toda pessoa convidada: o nome, a senha e a repetição da senha, com uma dica só. Quem já tem conta no DeskVoice digita a senha que já usa; quem não tem escolhe uma senha nova, com no mínimo 10 caracteres. Depois do envio, se a senha não for aceita, a página diz o que fazer. A senha antiga de uma conta continua valendo no convite, mesmo curta, e a tentativa errada conta no mesmo limite da tela de entrada. Nada a configurar. Crédito: @melgarafael.

### Corrigido

- **A visão geral da instalação separa a linha que pede atenção da linha caída, e pinta o motor como a Saúde** Na Visão geral da área da instalação, a coluna Linha deixa de contar como caída a linha que só tem um aviso (por exemplo, carregada mas com o provedor ainda não conferido): ela aparece como ", N pedem atenção", e "caídas" passa a contar só as linhas de fato fora do ar. O selo do Motor passa a ter a mesma cor da linha do motor na Saúde da organização: com chave própria e o último teste da chave sem resposta conclusiva, ele fica amarelo, e não verde. Nada a configurar. Crédito: @melgarafael.

## [0.37.0] - 2026-11-18

### Adicionado

- **A checagem de saúde avisa quando a rede do proxy não está gravada** O `install/healthcheck.sh` ganhou a linha "Rede do proxy". Quando existe nesta máquina a rede de proxy de outro sistema (a `*_caddy-sites` de um CRM na mesma VPS) e ela não está gravada no arquivo de publicação, a linha avisa e traz o comando para gravá-la. É o caso de quem ligou o Caddy à rede à mão, antes da 0.11.0: essa ligação se perde quando o contêiner é recriado, e o domínio do painel passa a responder 502. A linha também avisa quando a rede gravada não existe mais. É só aviso: não muda o código de saída e não há nada a configurar em instalações que já têm a rede gravada. Crédito: @webtecnica.
- **A administração da instalação ganha uma visão geral das organizações** Na área da instalação, a seção nova "Visão geral" mostra uma linha por organização: se está ativa ou suspensa, as chamadas dos últimos 30 dias, o custo do mês (com as marcas "inclui estimativa" e "não medido", como em Custos), quantas linhas estão conectadas e quantas caídas, o estado da chave do motor e a fila (tarefas em atraso e com falha nas últimas 24 horas). Cada número é o mesmo que a tela da própria organização mostra em Custos e em Saúde. Quando o processo de voz não responde, a coluna Linha diz isso, em vez de mostrar zero linhas caídas. A sessão de suporte não abre esta seção. Nada a configurar. Crédito: @melgarafael.

### Alterado

- **O upgrade do WebSocket da chamada pela web confere o convite antes de abrir** O endereço da chamada pelo navegador passa a conferir o convite antes de abrir o WebSocket. Pedido sem convite, com convite errado ou já usado recebe uma resposta HTTP comum (401, ou 404 fora do caminho da chamada) e nenhum WebSocket abre. A exceção é o convite vencido, na primeira tentativa e até 30 minutos depois do prazo: ele abre e fecha logo, com o código 4401, para a tela dizer que venceu. Depois disso, ou na segunda tentativa, nem abre. Quem liga pelo painel não percebe diferença na conversa. Nada a configurar. Crédito: @melgarafael.

### Corrigido

- **A linha de telefonia da Saúde conta só as linhas da organização** Numa instalação com mais de uma organização, a linha de telefonia da tela Saúde contava as linhas de todas elas. Agora conta só as da organização em que a pessoa está. A checagem de saúde sem sessão, usada pelo instalador, continua olhando a instalação inteira. Nada a configurar. Crédito: @melgarafael.

## [0.36.1] - 2026-11-18

### Alterado

- **Dependências atualizadas no banco de dados e no serviço de voz** O banco de dados passa do Postgres 17.11 para o 17.12, na mesma linha 17, sem mudar o formato dos dados. O serviço de voz passa a usar a versão mais nova da biblioteca que mantém as conexões em tempo real. Nada a fazer: a atualização normal já baixa as imagens novas. Crédito: @dependabot.

## [0.36.0] - 2026-11-18

### Adicionado

- **O cérebro da Anthropic também conversa em pedaços, ainda sem ligação** Nada muda numa instalação em funcionamento: nenhuma ligação usa a conversa nova, e o pedido em JSON da Anthropic, o único caminho em uso, continua igual. O cérebro da Anthropic ganha a mesma conversa em pedaços que a OpenAI, o OpenRouter e a DeepSeek já têm: o texto chega assim que o modelo o gera, as ferramentas pedidas chegam montadas, o pedido pode ser interrompido no meio, e o consumo sempre vem com número, declarado ou estimado. Quem usa a Anthropic na análise das ligações terá o cérebro disponível no motor de voz em pipeline. Crédito: @melgarafael.
- **O cérebro da OpenAI, do OpenRouter e da DeepSeek conversa em pedaços, ainda sem ligação** Nada muda numa instalação em funcionamento: nenhuma ligação usa a conversa nova, e nenhum cérebro é chamado de outro jeito. Os cérebros da OpenAI, do OpenRouter e da DeepSeek ganham uma conversa em que o texto chega em pedaços, assim que o provedor o gera, as ferramentas pedidas pelo modelo chegam montadas, e o pedido pode ser interrompido no meio. É a peça que o motor de voz em pipeline vai usar. O consumo de cada pedido sempre vem com número: o que o provedor declarou ou, quando ele não declarou (interrupção, prazo), uma estimativa marcada como tal, pela entrada enviada e pela saída recebida. Crédito: @melgarafael.
- **O cérebro do Gemini também conversa em pedaços, ainda sem ligação** Nada muda numa instalação em funcionamento: nenhuma ligação usa a conversa nova, e o pedido em JSON do Gemini, o único caminho em uso, continua igual. O cérebro do Gemini ganha a mesma conversa em pedaços que a OpenAI, o OpenRouter, a DeepSeek e a Anthropic já têm: o texto chega assim que o modelo o gera, as ferramentas pedidas chegam montadas, o pedido pode ser interrompido no meio, e o consumo sempre vem com número, declarado ou estimado. A ferramenta pedida pelo Gemini traz a assinatura de raciocínio que ele exige de volta na volta seguinte, e quem conversa a devolve sem mexer nela. Quem usa o Gemini na análise das ligações terá o cérebro disponível no motor de voz em pipeline. Crédito: @melgarafael.
- **A regra do DOCKER-USER que fecha uma porta publicada pelo Docker passa a ter um serviço do systemd para repô-la** Nada muda numa instalação em funcionamento: nada é fechado sem ser pedido. A cadeia `DOCKER-USER` é a única que fecha uma porta publicada pelo Docker — nem o `ufw` nem o `firewalld` filtram essas portas —, e a regra escrita à mão sumia ao reiniciar a máquina, porque o Docker recria as cadeias dele vazias. O `install/docker-user.sh` escreve essa regra e deixa um serviço do systemd (`deskvoice-docker-user.service`, `After=docker.service`, `PartOf=docker.service`) feito para repô-la no boot e a cada reinício do Docker, um retorno ainda não medido numa máquina de verdade; rodar de novo não duplica regra, e a porta que sai da lista é reaberta. O instalador chama o script quando recebe `DESKVOICE_DOCKER_USER_DROP` (`5060/udp`, `10000:10200/udp`), e a mensagem do `firewalld` passa a apontar para ele. A janela de alguns segundos depois de `firewall-cmd --reload` continua: ela é do Docker refazendo as cadeias, não da regra. A regra só barra o que é roteado para dentro de uma ponte do Docker (`docker0`, `br-*`), venha pela interface que vier, e não a conexão que um contêiner abre para fora com destino à mesma porta (o SIP-TLS do Asterisk para a operadora, por exemplo). Medida numa VPS de teste em 18/11/2026, com o Docker de fábrica e o firewalld inativo: de fora, a porta fecha em TCP e em UDP; a conexão de saída do contêiner e a conversa entre contêineres da mesma rede continuam passando, em TCP; aplicar de novo não duplica. O script troca a regra no formato antigo pela nova onde a achar, avisando. Fechar uma porta carrega o módulo `br_netfilter`, que fica até reiniciar a máquina; numa máquina com outra ponte que não é do Docker (libvirt, LXD), o tráfego dela passa a cair no filtro do Docker e pode parar, um efeito ainda não medido. UDP de saída e entre contêineres, o reinício e o firewalld ativo seguem sem medição; IPv6 também, e fica fora do script. Crédito: @webtecnica.

### Alterado

- **O painel já sabe o que uma sessão de suporte da instalação não pode fazer** Preparação interna para o acesso de suporte da administração da instalação, que ainda não existe. A sessão do painel passa a saber se é de um vínculo de suporte, e as ações que convidam, mexem na equipe ou na conta, ou criam algo que dura mais que a sessão (convite, aceitar convite, papel e remoção de pessoas, senha, telefone e WhatsApp do perfil, link público da ligação, conector e ganchos, pareamento do WhatsApp, gravar chave de provedor, criar e editar tronco e atendente, a política de ligação de saída, e a área da instalação) respondem que a sessão de suporte não pode fazer isso, com a frase nos três idiomas. Hoje ninguém tem esse vínculo, então nenhuma tela nem rota muda para ninguém, e a atualização não mexe no banco. Toda rota de escrita do painel está numa tabela com a decisão e o motivo, e uma verificação nova no CI reprova a rota nova que não está nela, e a rota marcada como recusada que não recusa. Crédito: @melgarafael.
- **As escolhas de pessoa da organização consideram só quem é da equipe** Preparação interna para o acesso de suporte da administração da instalação, que ainda não existe. Toda consulta que escolhe, conta ou lista pessoas da organização para agir ou avisar passa a considerar só quem é da equipe: o resumo da ligação e os avisos pelo WhatsApp, os números que o agente aceita como "da equipe" no `send_whatsapp`, a escolha do responsável da pendência (na tela, no agente e no lembrete), a contagem de donos e a lista da tela Equipe. Hoje todo vínculo é da equipe, então nenhuma lista, aviso ou escolha muda para ninguém, e a atualização não mexe no banco. Uma verificação nova no CI reprova a consulta nova que lê as pessoas da organização sem esse filtro, a menos que ela esteja numa lista curta de exceções, cada uma com o motivo (mostrar o nome de quem agiu, ler a própria sessão). Crédito: @melgarafael.

### Corrigido

- **A checagem de saúde deixa de dizer que está tudo certo com o login do painel quebrado** A checagem de saúde passou a pedir o login de verdade, com uma credencial que não existe, e
  recusa dizer que está tudo bem quando a rota responde erro de servidor: uma volta de versão que
  quebrou a entrada do painel agora acusa na hora e provoca a volta da atualização, em vez de
  terminar "com todas as peças essenciais respondendo". Nada a configurar. Crédito: @webtecnica.

## [0.35.0] - 2026-11-17

### Adicionado

- **Suspender e reativar uma organização pela administração da instalação** Quem administra a instalação passa a suspender e reativar uma organização na tela Organizações da área da instalação. Quem tem uma organização só não vê nada novo: o botão "Suspender" não aparece para a única organização ativa, nem para a organização em que a pessoa está no momento. A suspensão pede um motivo (de 10 a 500 caracteres), e a confirmação nomeia a organização, diz quantas tarefas da fila serão canceladas e que nada do que for cancelado volta sozinho na reativação. Ao suspender, as tarefas que agem em nome da organização ou gastam (avisos, webhooks, transcrições, resumos e análises) são canceladas. As rotinas de guarda e de apagamento de dados de quem ligou e o vencimento de pedidos de aprovação continuam rodando, porque não gastam, não falam com ninguém de fora e cumprem prazos que não esperam a agência. Na reativação, o que entrou na fila durante a suspensão também é cancelado. Quem é só da organização suspensa vê a tela "Esta organização está suspensa", com o nome e o motivo, e quem tem outra organização troca para ela; quem administra a instalação continua chegando à área da instalação para reativar. A suspensão e a reativação ficam na auditoria da instalação e no histórico da própria organização. A atualização do banco só acrescenta o estado "cancelada" às tarefas, sem mudar nenhuma linha. Crédito: @melgarafael.

## [0.34.0] - 2026-11-17

### Adicionado

- **A chave e as vozes da ElevenLabs em Configurações → Voz** A seção nova **Voz**, ao lado de Cérebros, guarda a chave da ElevenLabs cifrada, testa a chave sem gastar caractere e mostra as vozes que a conta já tem, com o idioma e a amostra (as de português do Brasil vêm primeiro, e ouvir a amostra não gasta crédito). Salvar a chave pede a confirmação de que o texto que o agente fala na ligação vai para a ElevenLabs e pode repetir o que a pessoa disse, como nome, endereço e telefone; quem confirmou fica no Registro da seção Privacidade. O aviso diz o que as páginas da ElevenLabs dizem: o texto fica no histórico da conta até alguém apagar, mais 30 dias em cópia de segurança; os registros de depuração e moderação podem ficar guardados sem prazo declarado; o modo sem retenção é só do plano Enterprise; os dados ficam guardados nos Estados Unidos, e ela não declara onde processa. O agente ainda não fala por esta voz: escolher a voz no agente vem depois. Sem chave, nada muda. O guia está em `docs/guides/voz.md`. Crédito: @melgarafael.

## [0.33.0] - 2026-11-17

### Adicionado

- **A organização suspensa deixa de atender, de ligar e de rodar a fila** Nada muda numa instalação em funcionamento: nenhuma organização está suspensa, e nenhuma tela suspende ainda (o botão vem numa versão seguinte). Quando uma organização estiver suspensa, a ligação que chegar a um número dela, pela operadora ou pelo WhatsApp, é atendida e ouve "Este número está temporariamente indisponível. Por favor, tente mais tarde.", no idioma do agente do número (português, inglês ou espanhol), e desliga. Nenhum motor de voz é aberto, então não há custo, e a fala não diz o motivo. A chamada aparece como recusada, com a frase "A organização estava suspensa." na linha do tempo. A chamada pelo navegador, a simulada e a ligação de saída são recusadas. As tarefas agendadas dela ficam na fila sem rodar, e nada é cancelado. As linhas continuam registradas na central, e as outras organizações da instalação seguem normais. Crédito: @melgarafael.
- **Nomes e termos na tela do agente, como dica de reconhecimento ao provedor de voz** A tela do agente ganha o campo "Nomes e termos": nomes de pessoas, da empresa, de produtos e termos
  que quem liga costuma dizer, um por linha, com o contador "N de 50". A lista vai ao provedor de voz
  como dica para reconhecer essas palavras na transcrição, e o provedor pode não seguir a dica. A
  regra é a mesma da API (até 50 termos de até 60 caracteres, sem linha em branco, sem repetição e sem
  `<`, `>` ou caractere de controle), e o erro aparece ao lado do campo, sem salvar. Quem não
  preencher não vê diferença: o agente continua sem vocabulário.
  Crédito: @melgarafael.

## [0.32.0] - 2026-11-17

### Adicionado

- **A mesma pessoa em várias organizações, com troca pelo topo da tela** Uma pessoa pode estar em mais de uma organização com a mesma conta. Quando o convite chega para um e-mail que já tem conta, a página pede a senha que a pessoa já usa, e não uma senha nova. O nome e o papel valem só naquela organização. O convite do primeiro dono, gerado na área da instalação, também aceita um e-mail que já tem conta, inclusive o de quem administra. Quem tem vínculo ativo em mais de uma organização ganha um seletor no topo da tela, e a troca acontece sem sair do painel. Quem tem uma organização só não vê nada novo. O login volta para a última organização usada, ou para a mais antiga se a última tiver sido desativada. Cada vínculo é independente dos outros. Desativar a pessoa numa organização não mexe nas outras, e removê-la de uma organização mantém a conta enquanto ela estiver em outra. A troca de senha encerra as outras sessões da conta em todas as organizações. Uma conta que tenha ficado sem nenhuma organização é tratada como conta nova no próximo convite: a pessoa define uma senha nova, e nada da conta antiga passa para ela. Crédito: @melgarafael.

### Alterado

- **O ambiente Barulhento também aparece nos agentes do Gemini Live** Na tela do agente, a escolha do ambiente de quem liga (Normal ou Barulhento) passa a aparecer também no motor Gemini Live, além do OpenAI Realtime. O que foi provado, numa instalação real com a 0.28.0 e o modelo `gemini-3.8-live`, é que o Gemini aceita a sessão em Barulhento, sozinho e junto do vocabulário do agente: a sessão abre. O que não foi medido é o efeito do Barulhento no ruído, em qualquer motor, e a prova do Gemini foi feita sem áudio de entrada. Nada muda para quem já instalou: o agente continua no ambiente que tinha. Nos outros motores, como o simulado, o campo continua escondido, e um agente que já está em Barulhento ali continua vendo o aviso e o botão "Voltar para Normal". Crédito: @melgarafael.

## [0.31.0] - 2026-11-17

### Adicionado

- **O analista ao vivo ganha tela própria, campo no agente, linha separada em Custos e selo de temperatura** Nada muda para quem já instalou: nenhum agente tem analista, e o campo novo do agente nasce em "Nenhum". Em Configurações há uma seção nova, **Analistas**, onde o dono ou o administrador cria o analista, dá o nome, escolhe o modelo de decisão (só os que têm a chave salva, na tela do Filtro de fala), liga a temperatura e escreve as objeções, cada uma com o rótulo e a orientação que o agente recebe. Com o Jev, a tela mostra o mesmo aviso do filtro, só com o que a política de privacidade da TypeSafe diz, e pede a confirmação "O texto do que a pessoa fala na ligação vai para a TypeSafe."; sem ela, não salva, e a tela mostra quem confirmou e quando. Apagar um analista pede confirmação com o nome dele e dos agentes que ficam sem analista. Na tela do agente, o campo **Analista** liga o analista; com o motor Gemini Live, a tela avisa que este motor ainda não recebe orientação: o analista mede, mas não orienta. Na linha do tempo, a objeção aparece pelo rótulo do cadastro, e a orientação entregue aparece com o texto do cadastro atual (se ela foi editada depois, aparece o texto novo, e a tela diz isso); no motor sem orientação, a explicação aparece uma vez por chamada. O detalhe da chamada ganha um selo com a última temperatura lida, de 1 a 5. Em Custos, os pedidos do analista aparecem numa linha própria, separada do mesmo modelo usado pelo filtro de fala. Crédito: @melgarafael.
- **O filtro de fala ganha tela própria em Configurações, e as marcas aparecem na linha do tempo** Nada muda para quem já instalou: o filtro de fala nasce desligado, e desligado a ligação é a mesma de antes. Em Configurações há uma seção nova, **Filtro de fala**, onde o dono ou o administrador salva e testa a chave do Jev (da TypeSafe) e o liga. Ligar pede a confirmação "O texto da ligação vai para a TypeSafe.", depois de um aviso que diz só o que a política de privacidade da TypeSafe diz (lida em 16/11/2026): a TypeSafe guarda os dados pessoais que recebe, como esse texto, pelo tempo que for razoavelmente necessário para prestar o serviço ou para os fins comerciais dela, sem prazo definido na política; a pedido, apaga esses dados ou os guarda de um jeito que não identifique a pessoa, quando eles não forem mais razoavelmente necessários, salvo se a lei a obrigar a guardá-los por mais tempo; e o serviço é hospedado nos Estados Unidos. A tela mostra quem confirmou e quando, e cada confirmação nova deixa um recibo no Registro da privacidade, que fica mesmo depois de desligar; os outros papéis veem e não mudam. O filtro só marca e sugere: na linha do tempo, a marca "pode ser fala de fundo" e a "leitura provável" de um termo do vocabulário aparecem embaixo da fala, que continua como foi ouvida, e a decisão que chegou tarde aparece como observação. Como pedir a exclusão à TypeSafe está no guia `docs/guides/filtro-de-fala.md` (também em inglês e espanhol). Crédito: @melgarafael.

### Corrigido

- **A tela da linha diz o que a central faz com o filtro desligado** Na linha por registro com o filtro desligado, a caixa "Aceita ligações de" se contradizia. Com endereços na lista, ela dizia "Aceita ligações de" a lista e, logo abaixo, que a central aceitava de qualquer endereço: agora a lista aparece como "Com o filtro ligado, aceitaria só de". Com a lista vazia, ela dizia ao mesmo tempo "nenhum endereço" e "qualquer endereço": agora, se a linha está na central com um nome que ainda não resolveu, a tela diz que ela aceita de qualquer endereço e que, mesmo com o filtro ligado, continua aceitando até o nome resolver; se a linha ainda não foi aplicada ou ficou de fora, a tela diz que ela não aceita ligação por enquanto e que, quando for aplicada, vai aceitar de qualquer endereço. As três línguas dizem a mesma coisa, e os estados com o filtro ligado não mudam. Crédito: @melgarafael.

## [0.30.0] - 2026-11-17

### Adicionado

- **Área da instalação, para quem cuida de vários clientes num servidor só** Quem administra a instalação ganha "Administrar a instalação" no bloco da conta, ao lado do idioma e do botão de sair. A área tem três telas. Em Organizações, você lista, cria e renomeia organizações, e cada organização nova gera na hora o convite do primeiro dono. Esse convite guarda quem o gerou, fica na Auditoria e só vale enquanto essa conta administra a instalação. Em Administração, você vê quem administra a instalação e põe ou tira pessoas, mas a última pessoa da lista nunca sai. Em Auditoria fica registrado tudo o que foi feito ali, inclusive cada pedido de atualização. Quem tem um cliente só não vê nada novo na navegação principal. Numa instalação com uma organização, o dono e o administrador continuam administrando e atualizando como antes. Criar a segunda organização fixa a lista de quem administra a instalação, e isso não volta atrás. Antes de confirmar, a tela mostra os nomes de quem passa a administrar (os donos da primeira organização) e de quem deixa de administrar (os administradores dela), e você pode manter esses administradores na lista na mesma tela. A partir daí, a tela de atualização sai das Configurações e passa para a área da instalação. O dono de uma organização cliente não ganha a área da instalação. Crédito: @melgarafael.
- **A voz da ElevenLabs existe como peça do motor, ainda sem tela** Nada muda numa instalação em funcionamento: nenhum agente usa a voz nova, e nenhuma tela a oferece. A ElevenLabs entra como uma peça do motor de voz: recebe o texto aos pedaços e devolve o áudio no formato do telefone. O custo é contado pelos caracteres enviados, com o preço publicado pela ElevenLabs e a data em que ele foi conferido, e é sempre marcado como estimado, porque a ElevenLabs não informa o consumo na resposta. Uma fala interrompida cobra o que já tinha sido enviado. A função `prepareFixedSpeech` também fica disponível: ela sintetiza de uma vez um conjunto de falas fixas, guarda o áudio na memória, separado por organização, e trata qualquer falha, inclusive a chave recusada, como recusa de abertura. Crédito: @melgarafael.

## [0.29.0] - 2026-11-17

### Requer atenção

- **A central só aceita a ligação de uma linha que vem dos endereços dela** Nenhuma linha que já existe é cortada na atualização. A linha por IP passa a filtrar sem perder
  nada: ela já só era reconhecida pelo endereço do servidor e pelos endereços extras, que são a mesma
  lista do filtro. A linha por registro que já existe fica sem filtro, como antes, até alguém ligar
  na tela: a tela mostra "Filtro desligado nesta linha" e o botão "Ligar o filtro". A linha por
  registro cadastrada depois da atualização já nasce com o filtro ligado.

  Depois de atualizar, abra Linha telefônica e, em cada linha por registro, confira a lista "Aceita
  ligações de". Se a sua operadora registra a linha por um servidor e entrega as ligações por outro,
  inclua os endereços de entrega em "Endereços extras de onde as ligações chegam" e salve antes de
  ligar o filtro. Depois clique em "Ligar o filtro". Se as ligações de uma linha pararem de chegar
  depois de ligar o filtro, inclua o endereço que falta em Endereços extras ou use "Desligar o filtro".

### Adicionado

- **O analista acompanha a ligação, mede a temperatura, reconhece a objeção e orienta o agente** Nada muda numa instalação em funcionamento: nenhum agente tem analista, e quem não tem não faz nenhum pedido a mais. Com um analista no agente (por enquanto só pela API), a cada fala de quem ligou ele pergunta ao modelo de decisão a temperatura da conversa e qual das objeções cadastradas a pessoa levantou. A fala vai só como dado: as perguntas e as opções são fixas ou escritas pelo operador, e uma escolha fora da lista não orienta e não é guardada. Quando a objeção é reconhecida com confiança de 80% ou mais, o agente recebe a orientação que o operador escreveu para ela, uma vez por objeção em cada trecho da ligação, por um caminho que não vira fala. Nada na voz espera o analista: o pedido tem prazo de 1 segundo, e a resposta que chega depois de uma nova fala de quem ligou é descartada como velha. Se o analista falhar, a ligação segue igual, e a linha do tempo diz por quê. Se a fala do agente repetir seis palavras seguidas da orientação, a linha do tempo registra o vazamento. O custo de cada pedido entra no extrato marcado como do analista, soma no custo da ligação e conta no teto do agente, junto com a voz e o filtro da fala. O pedido sem consumo lido (atrasado, sem rede ou com resposta fora da forma) entra por estimativa, marcada. Uma resposta de sobrecarga do Jev (HTTP 529) é resposta, e não falta de rede: fica sem custo e não conta no teto. O motor Gemini Live ainda não recebe orientação: o analista mede, mas não orienta. Com o motor OpenAI Realtime, que o item de sistema sozinho nunca gere resposta, e que a orientação mude de fato a resposta do agente, ainda não foi medido numa ligação real. Crédito: @melgarafael.

### Alterado

- **A central só aceita a ligação de uma linha que vem dos endereços dela** A central de telefonia passa a filtrar a entrada linha por linha: cada linha só aceita ligações
  dos endereços que a tela mostra em "Aceita ligações de", e a ligação que se apresenta como aquela
  linha vinda de qualquer outro endereço é recusada. Na linha por IP, valem o endereço do servidor e
  os endereços extras; na linha por registro, o IP do servidor ou, quando ele é um nome, os endereços
  que o nome devolveu nas últimas 24 horas (até 16), mais os endereços extras. Juntar as respostas
  de 24 horas evita recusar uma ligação válida quando o DNS da operadora devolve só uma parte dos
  endereços a cada consulta. O endereço liberado para a linha de uma organização nunca entra na linha
  de outra. Se o nome da operadora deixar de resolver, a linha continua aceitando os endereços que o
  nome tinha, mas um endereço extra que você removeu deixa de ser aceito na hora. Enquanto o nome de
  uma linha por registro nunca tiver resolvido, o filtro dessa linha fica desligado, mesmo com
  endereços extras, e a tela diz isso. Na linha por registro, o filtro se liga e se desliga na tela,
  com os botões "Ligar o filtro" e "Desligar o filtro"; a linha por IP filtra sempre. A porta 5060
  continua publicada como antes, e nada muda no instalador nem no arquivo `.env`. Crédito:
  @webtecnica, pela medição numa instalação real que mostrou a central respondendo a qualquer origem.

## [0.28.0] - 2026-11-17

### Requer atenção

- **A senha passa a morar numa conta, separada da organização, e a atualização fica com quem administra a instalação** Depois desta versão, não dá para voltar só trocando a versão. `bash install/update.sh --to 0.27.0`
  termina dizendo que está tudo saudável, mas ninguém consegue fazer login no painel, porque a
  versão anterior procura a senha onde ela não está mais (quem já estava com o painel aberto
  continua). A volta é pelo backup que o atualizador fez na ida para esta versão. Ele é o backup
  mais recente cuja versão é a 0.27.0, e o comando abaixo, rodado na pasta do DeskVoice, mostra
  qual é. Anote o resultado antes de voltar:

      grep -l '^version=0.27.0$' backups/*/manifest.txt | sort | tail -n 1 | xargs dirname

  Para voltar, troque a versão e depois restaure esse backup, colando exatamente o que o comando
  mostrou (ele já começa com `backups/`):

      bash install/update.sh --to 0.27.0
      bash install/restore.sh <exatamente o que o comando mostrou>

  Não use `restore.sh latest` nem o backup que o `update.sh --to 0.27.0` mostra no fim como
  "Backup de antes da atualização": esse foi feito na volta, com o banco desta versão, e restaurá-lo
  não devolve o login. O backup da ida só fica guardado enquanto a rotação o mantiver, que guarda os
  14 mais recentes. A restauração devolve o banco ao momento desse backup: o que entrou depois de
  atualizar (ligações, pendências, mudanças feitas no painel) se perde.

### Adicionado

- **Os analistas ao vivo passam a existir no banco e na API** Nada muda numa instalação em funcionamento: nenhuma organização tem analista, nenhum agente usa um, e nenhuma tela os oferece ainda. A API passa a cadastrar analistas, cada um com um nome único na organização (sem diferença de maiúsculas: "Jev" e "jev" são o mesmo), o modelo de decisão que ele usa e até oito objeções com a orientação que o agente receberá, e o agente passa a aceitar um analista desta organização. Um modelo de decisão que manda o texto da ligação para fora do servidor, como o Jev da TypeSafe, só é aceito com a confirmação que nomeia o fornecedor; quem confirmou e quando ficam no analista, e a confirmação entra no Registro da privacidade com o nome da pessoa, que continua lá mesmo se ela sair da equipe. Apagar um analista deixa os agentes sem ele e diz quantos eram. Crédito: @melgarafael.
- **O motor de voz passa a aceitar uma orientação para o agente que não vira fala** Nada muda numa instalação em funcionamento: é a primeira peça dos analistas ao vivo, e ninguém a usa ainda. O motor OpenAI Realtime passa a aceitar um contexto para o agente durante a ligação, entregue como item de sistema, sem pedir resposta e sem passar pela fala; se o agente estiver falando, a orientação espera a fala acabar. O motor simulado guarda a orientação e ganha um passo de roteiro que fala uma versão ou outra conforme recebeu orientação, para o teste da ligação inteira. O Gemini Live ainda não recebe orientação, porque o caminho que a documentação oferece interromperia a fala do agente. Que o item de sistema sozinho nunca gere resposta no provedor real ainda não foi medido. Crédito: @melgarafael.

### Alterado

- **A senha passa a morar numa conta, separada da organização, e a atualização fica com quem administra a instalação** Quem entra no painel continua entrando com o mesmo e-mail e a mesma senha, na mesma organização e
  com o mesmo papel. Os aparelhos que já estavam conectados continuam conectados. Nada muda na tela e
  não há nada a fazer depois de atualizar. Por trás, a senha sai do cadastro da equipe e passa para
  uma conta que nenhuma tela presa a uma organização consegue ler. É o primeiro passo para uma mesma
  pessoa cuidar de vários clientes numa instalação só. Pedir a atualização pelo painel passa a ser de
  quem administra a instalação, e numa instalação com uma organização são as mesmas pessoas de
  antes: o dono e o administrador. A exceção é a instalação que já tinha mais de uma organização,
  criada direto no servidor: nela, só os donos ativos da organização mais antiga continuam pedindo a
  atualização, e o registro da instalação guarda isso. Se ninguém mais conseguir pedir, o comando
  `bash install/grant-installation-admin.sh <e-mail>`, rodado de dentro do servidor, devolve o papel a
  uma conta. Crédito: @melgarafael.

## [0.27.0] - 2026-11-17

### Adicionado

- **Para quem contribui, uma skill nova para afinar um agente de voz com dados da operação** Nada muda para quem opera uma instalação: isto é para quem clona o projeto e trabalha com um
  assistente de código. A skill `deskvoice-agente-de-voz` atende o "as respostas da IA estão ruins":
  diagnostica pela análise da ligação, pela linha do tempo e pela configuração do agente, sem tirar
  transcrição nem telefone da instalação; revisa as instruções para a fala (frases curtas, sem
  formatação, número e e-mail ditos, uma fala para quando algo falha); só troca o texto depois de
  mostrar o antes e o depois e receber o sim da pessoa; e ensina a medir o efeito pela análise das
  ligações antes e depois da troca, sem afirmar que melhorou. O vocabulário do agente, que ainda não
  tem campo na tela, é tratado como uma dica que o provedor pode ignorar, e a skill não o troca até a
  tela existir: registra a lista aprovada para aplicar depois. A skill de métricas passa a
  apontar para ela. Crédito: @melgarafael.
- **O agente pode mandar uma mensagem no WhatsApp para quem ligou quando a ligação cai** O bloco "Quando a ligação cai", na tela do agente, ganha a opção "Mandar uma mensagem no WhatsApp para quem ligou", com um campo para o texto, de até 300 caracteres. O texto é fixo, escrito por quem configura, e sai como está: nada da conversa entra nele, porque o número que ligou pode não ser de quem ligou. Vazio, vale um texto padrão na língua do agente, que começa dizendo o nome da organização. A tela avisa que a mensagem escreve primeiro para um número que pode nunca ter falado com o WhatsApp da central, o que pode levar a restrição ou bloqueio do número. A opção só funciona com o WhatsApp conectado e com "Confiar no número exibido na ligação" ligado, em Configurações → WhatsApp; sem isso, aparece desabilitada e diz por quê. Número na lista de não ligar não recebe a mensagem, e cada número recebe no máximo uma a cada 24 horas. Um teto de mensagens por organização protege o número: no máximo 3 por hora e 20 a cada 24 horas. A segunda queda do mesmo número nesse prazo, a mensagem acima do teto, ou a que não pôde sair, abre uma pendência para alguém retornar. A linha do tempo da ligação diz se a mensagem entrou na fila, saiu ou não saiu, e o apagamento a pedido do titular apaga também o número guardado na mensagem. A definição de queda na tela passa a citar o caso de quem ouve o agente pedir para repetir: "Conta como queda quando o sistema falha, quando quem ligou fica alguns segundos sem resposta e desliga, quando ouve o agente pedir para repetir e desliga sem voltar a falar, ou quando a linha cai durante uma ação do agente. Quem desliga depois de se despedir, ou enquanto o agente fala, não conta." Todo agente que já existe continua no modo que tinha, e nada muda para quem não escolher a opção nova. Crédito: @melgarafael.

## [0.26.0] - 2026-11-17

### Adicionado

- **Para quem contribui, o Claude Code implementa uma fatia de desenho com um verificador separado** Nada muda para quem opera uma instalação: isto é para quem clona o projeto e contribui. No Claude
  Code, `/deskvoice-fatia <desenho> <número>` lê a fatia de um desenho de `docs/specs/`, cria um
  worktree descartável, chama um implementador com o contrato e o aceite palavra por palavra e depois
  um verificador que não pode escrever e tenta derrubar a entrega, até ele aprovar ou até três
  voltas. O comando não envia nada ao GitHub: o ramo fica local, e abrir o PR é com a pessoa. O aviso
  de identidade do commit passa a olhar o e-mail que o commit vai gravar de fato, e não só o do
  `git config`: some o aviso falso de quem passa o e-mail certo pelo ambiente, e aparece o de quem
  recebe um `root@` de lá. Crédito: @melgarafael.
- **Para quem contribui, duas skills novas: ler as métricas com régua declarada e aplicar o sistema vivo a uma peça** Nada muda para quem opera uma instalação: isto é para quem clona o projeto e trabalha com um
  assistente de código. A skill `deskvoice-metricas` lê como está a operação (ligações, desfecho, nota
  da análise, custo, falhas, fila, ligações de saída) primeiro pelas telas e depois por consultas só
  de leitura, filtradas pela organização, sem transcrição, nome ou telefone; cada número sai com
  período, fuso e definição. A skill `deskvoice-sistema-vivo` percorre as perguntas da doutrina do
  sistema vivo para uma peça nova e diz onde conferir cada resposta no código, apontando para a lei
  em vez de copiá-la. A skill de contribuição passa a dizer que o aviso de identidade olha a
  identidade efetiva do commit, como o gancho já faz. Crédito: @melgarafael.
- **O agente pode abrir uma pendência quando a ligação cai no meio da conversa** A tela do agente ganha o bloco "Quando a ligação cai", com duas opções: "Não fazer nada", o
  padrão, e "Abrir uma pendência para alguém retornar". Conta como queda a ligação recebida e
  atendida em que o sistema falhou, em que quem ligou ficou alguns segundos sem resposta (além do
  prazo da guarda do silêncio) e desligou (inclusive quem ouviu o agente pedir para repetir e desligou
  sem voltar a falar), ou em que a linha caiu durante uma ação do agente. Quem desliga depois de se
  despedir, ou enquanto o agente fala, não conta; também não conta a ligação sem número nem aquela em
  que alguém já ficou com o próximo passo (transferência, recado, pendência, aviso ou WhatsApp
  enviado). Com a pendência escolhida, o supervisor
  abre uma por ligação, para o dono das pendências do agente, e a linha do tempo diz o que aconteceu;
  o motor de voz que caiu continua abrindo a pendência como hoje. Na ligação simulada, a linha do tempo
  diz o que teria acontecido, e nada é aberto. O fim da ligação passa a registrar se a vez estava
  aberta quando quem ligou desligou e, depois de um pedido para repetir, se quem ligou falou de novo.
  Todo agente que já existe fica em "Não fazer nada", e o comportamento de hoje não muda. Crédito:
  @melgarafael.

## [0.25.0] - 2026-11-16

### Adicionado

- **A lista de Chamadas e a tela de Custos dizem o que não foi medido e o que é estimativa** Na lista de Chamadas, a ligação em que nada pôde ser medido não aparece mais como R$ 0,00: ali
  está escrito "Não medido", e a ligação com uma parte sem medida mostra o valor com "+ parte não
  medida", como já fazia a tela de Custos. A linha do extrato com custo estimado agora aparece marcada
  com "inclui estimativa" na lista, no detalhe da chamada e em Custos (no total, no dia, no agente e
  no motor), e um aviso em Custos explica que a estimativa conta no total e no teto e é feita para
  ficar acima do real. Hoje a linha estimada só nasce do filtro da fala (um pedido cujo consumo não
  foi lido), e o filtro vem desligado: quem não o ligou não vê essa marca. O aviso do custo não
  medido deixa de culpar o provedor: ele diz que o consumo não pôde ser medido. Na API,
  `GET /api/v1/calls` ganha `unmeasuredCount` e `estimatedCount` em cada ligação;
  `GET /api/v1/calls/{id}` ganha `estimatedCount` no total e os dois campos em cada agente de
  `costByAgent`; e `GET /api/v1/system/costs` ganha `estimatedCount` no total e em cada dia, agente e
  motor. Os campos de antes não mudam. Nada a configurar em instalações existentes. Crédito:
  @melgarafael.

## [0.24.0] - 2026-11-16

### Adicionado

- **Quem lê a ligação se escolhe na tela, e o custo não medido aparece como não medido** Na seção da análise, em Configurações, "Quem lê a ligação" escolhe entre o motor do agente (o
  padrão, como antes) e um cérebro com chave aceita em Configurações → Cérebros, com um modelo da
  lista dele, buscável por nome. Ao escolher um modelo sem preço conhecido, um aviso diz, antes de
  salvar e depois de salvo, que o custo da análise não vai ser medido e que ela só roda nas ligações
  de agentes com teto de custo. Se o cérebro escolhido perde a chave, ou o modelo sai da lista, a tela
  diz que as ligações não estão sendo lidas. Remover a chave do cérebro escolhido avisa isso antes.
  Em Custos e na tela da chamada, a ligação lida por um modelo sem preço conhecido, ou cujo consumo não pôde ser medido, mostra "não medido", e nunca
  um custo zero como se fosse grátis. Na API, `GET /api/v1/system/costs` ganha `unmeasuredCount` no
  total e em cada dia, agente e motor, e `GET /api/v1/calls/{id}` ganha `unmeasuredCount` no total da
  chamada: quantas linhas do extrato não têm custo medido. Os campos de antes não mudam. A lista de modelos de um cérebro que falha ao ser relida
  continua a guardada, marcada como velha. Sem escolha, nada muda em instalações existentes. Crédito: @melgarafael.

### Corrigido

- **O pedido do filtro da fala que falha grava um custo estimado, e não zero** Quando o filtro da fala de quem liga pergunta ao Jev e a resposta chega atrasada, não chega por
  falta de rede ou chega fora da forma, o extrato de custo ganha uma linha com uma estimativa pelo
  texto enviado, marcada como estimada, e ela entra no total da ligação e no teto de custo do agente.
  Antes, esse pedido não deixava custo nenhum. O filtro continua nascendo desligado: quem não o
  ligou não vê nada diferente, e as linhas que já estão no extrato ficam como estão. Nada muda em
  instalações existentes. Crédito: @melgarafael.
- **O agente configurado como en-US ou es-MX fala inglês ou espanhol também na passagem e na agenda** Com o idioma do agente escrito com região (`en-US`, `es-MX`), a saudação da passagem entre agentes e as falas das ferramentas de agenda saíam em português, porque cada uma escolhia o idioma por um mapa de três valores e o que ficava fora dele caía no pt-BR. Agora as duas leem o idioma pelo prefixo, num único lugar: `en-US` fala inglês, `es-MX` fala espanhol, e `pt-BR`, `en` e `es` continuam exatamente como eram. Idioma que as falas não têm, campo vazio ou texto qualquer seguem no português, sem erro. O aviso da caixa postal continua no idioma escolhido em Configurações › Chamadas, sem mudança. Nada a configurar em instalações existentes. Achado na revisão do #344. Crédito: @webtecnica.

## [0.23.1] - 2026-11-16

### Corrigido

- **A memória do número chega ao agente sem o telefone no título da pendência e dentro do teto também na passagem** Com a memória do número ligada, a pendência que o supervisor abre ("Retornar para +55…: o caso") chegava ao agente com o telefone de quem ligou no título. Agora o agente recebe "Retornar para este número: o caso", e outro telefone que apareça no título vira "[número]". O título salvo não muda, e a tela das pendências continua mostrando o número. Na passagem entre agentes, o teto de 1 500 caracteres passa a valer para o bloco inteiro que o agente de destino recebe, com o motivo e o resumo da passagem: as notas mais velhas saem primeiro, o motivo e o resumo nunca são cortados, e a linha do tempo registra de novo o que o agente de destino recebeu, só com a contagem e o tamanho. Com a memória desligada, que é como ela vem, nada muda. Achado na revisão do #327. Crédito: @melgarafael.

## [0.23.0] - 2026-11-16

### Adicionado

- **O desfecho e a análise da ligação podem ser lidos por um cérebro escolhido** Com a chave de um cérebro salva em Configurações → Cérebros, a configuração `calls.analysis_brain`
  escolhe um cérebro e um modelo da lista dele para ler as ligações: o desfecho e a análise passam a
  sair desse modelo, na frente do motor de voz e do endpoint de classificação. O extrato de custo
  ganha o modelo cobrado e a marca de custo medido. Um modelo sem preço conhecido só é aceito com
  confirmação, só lê ligações de agentes com teto de custo, e a linha dele no extrato fica marcada
  como custo não medido; o total da ligação e o de Custos ainda contam esse custo como zero, e as telas não avisam. Se o cérebro escolhido ficar sem chave, sumir ou o modelo sair da
  lista, a ligação não é lida, a linha do tempo diz por quê, e nada vai ao motor de voz. A escolha ainda não tem tela; hoje é pela API do painel, com
  `PUT /api/v1/settings/calls.analysis_brain`. Sem escolha, tudo segue como antes. Nada muda em instalações
  existentes. Crédito: @melgarafael.

## [0.22.0] - 2026-11-16

### Adicionado

- **Cérebros, uma tela para as chaves e os modelos de texto de cada provedor** Em Configurações → Cérebros, quem configura a instalação cola a chave da Anthropic, da OpenAI, do
  Gemini, da DeepSeek ou do OpenRouter e vê na hora o resultado do teste e a lista de modelos de texto
  que aquela chave alcança, lida do provedor. Cada modelo mostra o preço de entrada e de saída por
  milhão de tokens, com a fonte e a data, ou a marca "sem preço conhecido"; os modelos da DeepSeek ficam sem preço, porque ela cobra conforme
  a hora do pedido. A chave fica cifrada no
  servidor e não volta à tela, e trocar ou remover a chave apaga a lista da anterior. A lista é relida
  pelo botão Atualizar lista e quando passa de um dia. A chave do cérebro é separada da chave do motor
  de voz. Ainda nenhum cérebro lê a ligação: a escolha para a análise vem numa próxima versão. Nada
  muda em instalações existentes. Crédito: @melgarafael.
- **A base do filtro da fala de quem liga, desligada de fábrica** O processo de voz ganhou o filtro que lê o texto do que a pessoa disse e o marca, sem nunca apagar nem trocar a fala: a marca "pode ser fala de fundo" e a sugestão de leitura de um nome do vocabulário do agente ("leitura provável: Melgaço") ficam ao lado do texto ouvido, e o custo de cada pedido entra no extrato da chamada. Ele nasce desligado, e ainda não há tela para ligá-lo: quem já instalou não vê diferença nenhuma, nenhum texto sai do servidor e nenhuma linha nova aparece na linha do tempo. A escolha do modelo, a chave e a confirmação do envio do texto ao fornecedor chegam com a tela, na próxima entrega. Crédito: @deskcomm-bot.

## [0.21.0] - 2026-11-16

### Adicionado

- **Base do catálogo de cérebros, com OpenAI e OpenRouter** O DeskVoice ganha a peça que lista os modelos de texto que uma chave da OpenAI ou do OpenRouter
  alcança, lida da API do provedor e nunca de uma lista fixa, com o preço de cada modelo, a fonte e a
  data, ou a marca de preço não conhecido. Ainda não há tela nem uso na ligação: os dois chegam nas
  próximas entregas do catálogo. Nada muda em instalações existentes. Crédito: @melgarafael.
- **Para quem contribui, o Claude Code ganha uma triagem de PR que só lê** Nada muda para quem opera uma instalação: isto é para quem clona o projeto e revisa PRs. No
  Claude Code, `/deskvoice-triagem-de-pr <número>` baixa o PR num worktree descartável, mede o diff
  contra a régua da `main` (o que o CI não vê, os antipadrões e as regras de produto), roda a suíte
  se a pessoa autorizar, passa o resultado por um cético e imprime um rascunho de parecer no formato
  do `GOVERNANCE.md`, com o que não foi medido. Ele não publica nada no GitHub: quem publica, se
  quiser, é a pessoa. PR que toca instalador, workflow, imagem, dependências, autenticação,
  isolamento ou atualização sai com "pede segunda leitura de um mantenedor". Crédito: @melgarafael.
- **O agente pode começar a ligação sabendo as notas e as pendências abertas do número** Em Configurações, no painel de privacidade, junto do prazo da memória, há uma chave nova: "Entregar
  ao agente a memória do número". Ligada, o agente começa cada ligação, recebida ou feita pelo
  sistema, com as notas guardadas sobre o número (até 10, dentro do prazo da memória) e os títulos
  das pendências abertas dele (até 5), num bloco de no máximo 1 500 caracteres, que ele recebe como
  dado e não como instrução. O resumo e as falas de ligações anteriores nunca entram, nem as notas e
  pendências de chamadas simuladas. A linha do tempo da chamada mostra quantas notas e pendências
  entraram, sem o texto. A tela avisa que o número exibido pode ser forjado e que o agente pode
  repetir o que sabe para quem fingir ser a pessoa. Só dono ou administrador muda a chave, e cada
  mudança fica no histórico de privacidade. Ela vem desligada: para quem já instalou, nada muda até
  alguém ligá-la. Crédito: @melgarafael.

## [0.20.0] - 2026-11-16

### Adicionado

- **A tela da linha mostra de quais endereços a central vai aceitar a ligação dela** Cada linha telefônica passa a mostrar "Vai aceitar ligações de: …", com os endereços de onde a
  central vai aceitar a ligação daquela operadora quando o filtro de entrada for ligado: na linha por
  IP, o endereço do servidor e os endereços extras; na linha por registro, o IP do servidor ou, quando
  ele é um nome, os endereços para os quais o nome resolve (com a hora da última atualização). O
  processo de voz recalcula a lista a cada vez que as linhas são aplicadas e de 5 em 5 minutos; se o
  nome deixar de resolver, a lista fica como estava e a linha pede atenção com o motivo. O campo de
  endereços extras aparece também na linha por registro, para a operadora que registra por um servidor
  e entrega a ligação por outro: na linha por registro ele só vai valer para a entrada, e a linha continua
  reconhecida pelo registro. Nada muda no que a central aceita: hoje ela ainda aceita ligações de
  qualquer endereço, e a tela diz isso; a lista é o que um filtro futuro vai liberar, mostrada antes
  de ele existir. Crédito: @melgarafael.

### Alterado

- **Os hooks de contribuição armados não mudam com o ramo em que você está** Nada muda para quem opera uma instalação: isto é para quem clona o projeto e contribui. O
  `arm-hooks.sh` da skill `deskvoice-contribuir` agora copia os hooks de git da `main` para dentro
  do `.git` do clone, e eles ficam iguais em qualquer ramo e em qualquer worktree; quando os hooks
  mudarem na `main`, rode `git fetch` e arme de novo. Se você já tinha armado os hooks, rode de novo
  `bash .agents/skills/deskvoice-contribuir/scripts/arm-hooks.sh`, e o lembrete de início de sessão
  avisa enquanto isso não for feito. Crédito: @melgarafael.

## [0.19.2] - 2026-11-16

### Corrigido

- **O motor de voz que não está disponível na instalação não manda mais cadastrar a chave** Quando o agente aponta para um motor de voz que a instalação não tem, a ligação recusada e a tela
  "Falar com o agente" agora dizem que o motor não está disponível nesta instalação e mandam escolher
  outro motor na tela do agente, em vez de mandar cadastrar a chave. Na linha do tempo, a recusa por
  motor que não está pronto deixa de afirmar "sem chave cadastrada" quando a chave existe e não pôde
  ser lida, e aponta para o aviso do painel, que traz o motivo. A ligação sem chave cadastrada continua
  com o aviso de antes. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **A passagem entre agentes aceita o destino escrito com o rótulo, como aparece nas instruções** As instruções do agente listam cada destino de passagem com o nome e, entre parênteses, o rótulo
  dele, como "Financeiro (Cobrança)". Numa ligação real, o agente pediu a passagem com a linha inteira
  e ela foi recusada na primeira tentativa; pela transcrição, o agente disse em seguida que ia
  ajustar o destino. Agora o nome com o rótulo, como listado, também passa a ligação. Destino fora da lista
  continua recusado. Nada a fazer em instalações existentes. Crédito: @melgarafael.

## [0.19.1] - 2026-11-16

### Adicionado

- **Para quem contribui, as skills aparecem no Codex e o guia de contribuição explica o pré-voo** Nada muda para quem opera uma instalação: isto é para quem clona o projeto e contribui. Cada skill
  de `.agents/skills/` ganhou `agents/openai.yaml`, o arquivo pelo qual o Codex mostra a skill e a
  carrega sozinho, e uma cerca reprova a skill nova que nascer sem ele. A skill `deskvoice-contribuir`
  ganhou duas referências: o pré-voo item a item (o que cada linha do `preflight.sh` quer dizer e o
  que fazer quando ela acusa) e a receita para rodar na própria máquina os testes de banco, a chamada
  simulada e os testes de tela. O hook `pre-commit` passa a avisar, sem bloquear, quando o commit vai
  sair com e-mail de máquina (`root@vps-…`), que não dá crédito a ninguém no GitHub. Crédito: @melgarafael.

### Corrigido

- **A ligação recusada pelo provedor de voz diz o motivo dele e não manda mais cadastrar uma chave que já existe** Quando o provedor de voz recusava a sessão com a chave cadastrada, por exemplo porque o crédito
  pré-pago acabou ou porque recusou a chave, ou quando a VPS não alcançava o provedor pela rede, a
  ligação era registrada como "motor de voz sem chave cadastrada", e o aviso no painel mandava
  cadastrar a chave sem dizer o que o provedor respondeu (no Gemini, ainda sugeria "chave ou modelo
  inválido?"). Agora esses casos têm motivo próprio na linha do tempo, "o provedor do motor de voz
  recusou a sessão ou não foi alcançado", e o aviso no painel traz o código e o motivo que o provedor
  ou a rede deu, como "Your prepayment credits are depleted" quando o crédito pré-pago do Google
  acabou, e manda conferir o crédito e os limites na conta do provedor, a chave e a rede da VPS. O
  mesmo motivo do provedor passa a aparecer no aviso quando o OpenAI Realtime fecha a conexão antes de
  confirmar a sessão. A ligação sem chave cadastrada continua com o aviso de antes. Nada a fazer em
  instalações existentes. Crédito: @melgarafael.

## [0.19.0] - 2026-11-16

### Adicionado

- **A ligação que termina sem próximo passo abre uma pendência sozinha** A partir desta versão, quatro tipos de ligação abrem sozinhos uma pendência "Retornar para +55…",
  com o caso numa frase, o link da ligação, dono, prazo e lembrete como qualquer pendência: o motor
  de voz caiu ou não estava pronto; a transferência para uma pessoa falhou e ninguém foi avisado; quem
  ligou desligou esperando uma aprovação; a mensagem de WhatsApp não saiu e ninguém abriu pendência. O
  dono é o configurado no agente que atendeu ("Dono das pendências"), ou a equipe. Quem faz isso é uma
  revisão por regras fixas, depois de cada ligação: não usa inteligência artificial, não gasta e não lê
  o que foi dito. Há no máximo uma pendência dessas por ligação, e ela não vem de ligação simulada, de
  recusa por regra da organização nem de ligação sem número. Não há interruptor: quem já instalou passa
  a ver essas pendências em Pendências sem configurar nada, e elas saem no apagamento a pedido do
  titular e na exportação como as outras. Crédito: @melgarafael.

## [0.18.0] - 2026-11-16

### Alterado

- **Custos e a tela da chamada mostram quanto cada agente gastou numa ligação com passagem** Numa ligação passada de um agente para outro, a tela de Custos põe o custo de cada trecho no agente
  em que a ligação estava, e não mais tudo no que atendeu. Se o agente de um trecho for apagado, o
  custo desse trecho volta para o agente que atendeu; só fica em "Agente apagado" quando o que atendeu
  também foi apagado. A tela da chamada segue a mesma regra. Uma ligação com passagem conta para cada
  agente na contagem de chamadas, e a tela diz isso. Os minutos de cada motor de voz também saem dos
  trechos: uma ligação que começou num motor e passou para um agente de outro motor divide a duração
  entre os dois. A tela da chamada mostra, abaixo do custo, quanto cada agente gastou, quando a
  ligação passou por mais de um. O total do período não muda. Quem nunca usou a passagem vê Custos
  igual a antes; a passagem gravada antes desta versão continua com os minutos inteiros no motor que
  atendeu, porque o evento dela não guardava o motor. Apagar dois agentes de uma vez não recusa mais a
  limpeza da lista "Pode passar a ligação para". Crédito: @melgarafael.

## [0.17.0] - 2026-11-16

### Adicionado

- **O agente passa a ligação para outro agente no meio da conversa** Na tela do agente, "Pode passar a ligação para" lista os outros agentes da organização, com nome e
  papel. Marcado um deles, o agente pode passar a ligação para ele no meio da conversa: a sessão do
  próximo abre antes de a atual fechar, e ele continua a partir de um resumo, com as instruções, as
  ferramentas, a voz e o motor dele. A regra de quando passar fica escrita nas instruções, são no
  máximo 3 passagens por ligação, passar não zera o tempo nem o custo (vale a menor duração e o menor
  teto entre os agentes por onde ela passou), e no extrato o custo de cada trecho fica com o agente em
  que ela estava. A linha do tempo mostra a passagem (de quem, para
  quem, o motivo e o resumo recolhido), e as falas seguintes levam o nome do novo agente. Apagar um
  agente o tira da lista dos outros, que continuam editáveis; a chamada simulada usa o motor simulado
  também no agente que recebe, sem custo de provedor; e quem desliga durante a troca tem a ligação
  solta na hora. A passagem foi provada só com o motor simulado, ainda não numa ligação com provedor
  de voz; se o provedor recusar a sessão do próximo agente, o agente atual continua na linha. A lista
  vem vazia, e quem não marcar nada não vê mudança no atendimento. Crédito: @melgarafael.

### Alterado

- **O aviso do instalador sobre o firewalld diz o que foi medido com a regra do DOCKER-USER** Com o `firewalld` ativo, o instalador já avisava que ele não filtra as portas publicadas pelo Docker, e dizia que a regra na cadeia `DOCKER-USER` tinha sido medida só com o `ufw`. Agora ela foi medida também com o `firewalld`, numa VPS AlmaLinux: fecha a porta TCP, mas some ao reiniciar a máquina e deixa a porta aberta por alguns segundos a cada `firewall-cmd --reload`. O aviso passa a dizer isso, e a medida está em `docs/fundacao/ufw-e-docker.md`. Nada muda numa instalação. Crédito: @melgarafael.

## [0.16.0] - 2026-11-16

### Adicionado

- **Bancada de voz prepara o antes e depois do ambiente barulhento contra o OpenAI e o Gemini** Uma medida manual nova na bancada de voz (`scripts/bancada-de-voz/ambiente-barulhento.ts`) toca
  para cada motor de hoje, no ritmo de uma ligação, frases sintéticas no meio de obra, música e
  conversa, nos modos "normal" e "barulhento", com e sem a guarda contra o silêncio. Ela mede o tempo
  até o agente responder, conta as interrupções falsas pelo evento do motor e confere que a guarda
  não fala por cima de uma frase longa. Exige um teto de gasto e, sem a chave do motor, não gera áudio
  nem abre sessão. Ainda não rodou contra o provedor: espera a chave. Nada muda numa instalação: não
  roda no CI e não entra na imagem. Crédito: @melgarafael.
- **Bancada de voz mede a redução de ruído por quadro, debaixo de ruído e em fluxo** A medida manual da redução de ruído na bancada de voz (`scripts/bancada-de-voz/`) passa a medir a
  fala baixa quadro a quadro (o quarto mais fraco dos quadros de 20 ms com fala, acima de 1 dB de
  perda média reprova), a mesma fala baixa debaixo de obra, música e conversa de fundo (só a parte da saída que é voz, sem o ruído que sobra), e a CPU com o
  áudio entregue em pedaços de 20 ms, um de cada vez, como a ponte manda. Só RNNoise e DeepFilterNet;
  o DeepFilterNet em fluxo usa o plugin de tempo real que o próprio projeto publica, baixado à parte.
  Nenhum deles entra no produto: não roda no CI, não entra na imagem e não muda nada numa instalação.
  Crédito: @melgarafael.
- **Apagar uma nota do agente e "Esquecer este número"** Cada nota do agente no bloco "Este número", na tela da chamada, ganha o botão "Apagar", que pede
  confirmação antes de apagar. Em Configurações → Privacidade, o dono ou administrador ganha
  "Esquecer este número": informa o telefone, e a confirmação nomeia o número e diz o que fica. Saem
  as notas do agente sobre esse número e as pendências fechadas dele (feitas ou canceladas). Ficam as
  ligações e as falas, que seguem o prazo de guarda das conversas, e as pendências abertas, que são
  trabalho em curso. Também fica o texto que o agente mandou para `create_task` antes da 0.7.0, nos
  argumentos gravados na linha do tempo daquelas chamadas e nos avisos antigos do sino, e os avisos
  de transferência e de recado da 0.14.0 em diante, que copiam os títulos das pendências abertas na
  hora da ligação: esses avisos são da ligação, e não da pendência. Para apagar o conteúdo das
  ligações, o caminho continua sendo o apagamento a pedido de quem ligou. O registro da página de
  Privacidade mostra quem apagou uma nota e quem esqueceu o número terminado em quais quatro dígitos,
  com as contagens e nunca o texto nem o número inteiro. Nada muda sem clique e confirmação.
  Crédito: @melgarafael.

## [0.15.0] - 2026-11-15

### Adicionado

- **O agente pode guardar notas sobre quem ligou, com prazo, exportação e apagamento** A ferramenta nova `remember_caller_note` deixa o agente anotar o que a pessoa disse e importa para a
  próxima ligação ("prefere de manhã", "o pedido é o 4471"). Ela vem desligada: nada muda até alguém
  marcá-la na tela do agente, e o agente de exemplo não nasce com ela. A nota guarda o telefone da
  própria ligação, nunca um número dito pelo modelo; a ligação sem número não anota, e cada ligação
  guarda no máximo 10 notas de até 300 caracteres. A equipe vê as notas no bloco "Este número" da tela
  da chamada, cada uma com o link da ligação em que nasceu; o agente ainda não as recebe, e nenhuma
  nota entra em aviso, evento ou na linha do tempo. As notas saem sozinhas pelo prazo da memória, de
  90 dias se ninguém escolher outro, ajustável de 30 a 365 dias no bloco novo "Memória entre chamadas",
  em Configurações (só dono ou administrador), e nunca duram mais que o prazo de guarda das conversas.
  A exportação dos dados de um telefone passa a trazer as notas dele, e o apagamento a pedido de quem
  ligou as apaga e as conta na prévia e no recibo. Crédito: @melgarafael.

### Corrigido

- **A pendência criada numa chamada simulada não entra mais no aviso do cliente real** Quando alguém da equipe simulava uma chamada com o número de um cliente e o agente abria uma
  pendência, ela aparecia no aviso de transferência e no de `notify_human` desse cliente (no painel e
  no WhatsApp) como se fosse dele. Agora o aviso só conta e só cita o que nasceu em ligação de verdade.
  No bloco "Este número", a pendência nascida numa simulada passa a aparecer com a marca "Simulada",
  como a chamada simulada já aparecia, e a nota nascida numa simulada aparece com a mesma marca. A pendência criada pela tela, sem ligação,
  continua contando. Corrige a #291. Crédito: @melgarafael.

## [0.14.0] - 2026-11-15

### Adicionado

- **Bancada de voz mede a redução de ruído local em 8 kHz, fora do produto** A bancada de voz (`scripts/bancada-de-voz/`) ganha uma medida manual da redução de ruído que
  poderia rodar na VPS antes do provedor: SpeexDSP, RNNoise e DeepFilterNet, em áudio de telefone
  (8 kHz) com voz sintética e ruído gerado. Ela mostra o atraso, a CPU, quanto cada um tira de obra,
  música e conversa de fundo, e quanto corta da fala baixa, medido na frase inteira. Nenhum deles
  entra no produto: não roda no CI, não entra na imagem e não muda nada numa instalação.
  Crédito: @melgarafael.
- **A tela da chamada mostra as ligações anteriores do mesmo número** Quem atualiza passa a ver, na tela de cada chamada, o bloco "Este número": as ligações anteriores
  do mesmo telefone (data, agente, desfecho e link) e as pendências abertas dele, sem procurar na
  lista de Chamadas. Não há interruptor, porque é leitura do que a equipe já via (registro 0020). O
  aviso de transferência e o de `notify_human` ganham uma linha como "Este número já ligou 3 vezes;
  1 pendência aberta: …". Pelo WhatsApp, essa linha leva só as contagens, nunca o título da
  pendência. Nada disso chega ao agente: as instruções e as ferramentas da ligação não mudam.
  Chamada sem número não mostra o bloco, e a ligação apagada a pedido do titular não aparece. A
  chamada simulada aparece na lista com a marca "Simulada" e não entra no "já ligou" dos avisos,
  porque qualquer pessoa da equipe pode simular com o número de um cliente. O histórico casa o número
  exatamente como ficou gravado: o mesmo cliente com o número escrito de outro jeito (com e sem o
  nono dígito, pela linha e pelo WhatsApp) pode aparecer como dois números, e o que a linha
  telefônica entrega não foi conferido. Crédito: @melgarafael.

## [0.13.1] - 2026-11-15

### Adicionado

- **Bancada de voz mede Deepgram, AssemblyAI, Soniox e o Jev, fora do produto** O script manual `scripts/bancada-de-voz/` ganha três serviços externos de transcrição em streaming
  (Deepgram Nova-3, AssemblyAI Universal-Streaming multilíngue e Soniox), cada um com o
  vocabulário pelo recurso do próprio serviço, e o Jev como modelo de decisão, com as mesmas
  perguntas do Laya. Cada um só roda com a chave entregue à bancada, para antes do teto de gasto e
  diz quanto gastou. Nada disso roda no CI, entra na imagem ou muda uma instalação. Crédito: @melgarafael.
- **Bancada de voz mede o acerto do Jev e do Laya com transcrição errada, fundo e fim do pensamento** O script manual `scripts/bancada-de-voz/` ganha um conjunto de texto inventado para o filtro, com a
  resposta esperada de cada item: a leitura com o nome escrito errado pela transcrição (ou sem nome
  nenhum), a fala de quem liga ou de fundo, e o pensamento completo ou a pausa. O Jev e o Laya
  respondem aos mesmos pedidos, e a bancada conta o acerto por pergunta e quantas falas de quem liga
  cada um marcou como fundo. O teto de gasto também para a medida quando um pedido custa mais que o
  reservado. Nada disso roda no CI, entra na imagem ou muda uma instalação. Crédito: @melgarafael.

### Corrigido

- **Uma falha ao calcular a impressão digital não faz mais a gravação contar como perdida** A impressão digital (SHA-256) é calculada lendo o arquivo depois que a gravação fecha. Na 0.13.0, se essa leitura falhasse, a gravação inteira contava como falha: na ligação, o log dizia que o áudio não tinha sido salvo, embora o arquivo existisse; no recado da caixa postal, a chamada virava recado com falha, e o arquivo ficava solto no disco. Agora a falha fica só na impressão: a gravação conta como salva, o motivo vai para o log do processo de voz, e a linha do tempo diz que a impressão não pôde ser calculada. O tamanho da gravação passou a vir do próprio cabeçalho do arquivo, sem outra leitura do disco depois de a gravação estar salva. Crédito: @melgarafael.
- **O envio por WhatsApp pede confirmação no máximo 3 vezes por ligação** Numa ligação recebida, o `send_whatsapp` pede a um responsável que confirme o envio antes de mandar a mensagem, e cada pedido avisa a equipe. O teto de 5 mensagens por ligação contava só os envios feitos, então os pedidos negados não tinham limite, e quem estava na linha podia fazer a equipe receber aviso atrás de aviso. Agora, depois de 3 pedidos de confirmação na mesma ligação, aprovados ou não, o agente não pede de novo: diz que não consegue enviar, passa a informação por voz e, se for preciso, anota para a equipe. É o mesmo teto do pedido de aprovação (`request_approval`). Nada muda numa ligação normal. Crédito: @melgarafael.

## [0.13.0] - 2026-11-15

### Adicionado

- **O aviso de versão nova aparece na lateral do painel, sem precisar abrir Configurações** A tela que atualiza já existia, com as notas da versão, o backup e a volta automática, mas o sinal de que havia versão nova morava dentro dela: quem não sabia que a atualização ficava em Configurações › Sistema não tinha como descobrir que havia algo esperando, e a instalação ficava parada numa versão antiga sem ninguém perceber. Agora a lateral mostra a versão em execução o tempo todo e, quando há uma publicada mais nova e atualizável, troca o texto por um aviso destacado que leva direto à tela de atualização; no cabeçalho do celular o aviso aparece só quando existe. O destaque é só para dono e administrador, que são quem pode atualizar; o operador vê a versão em execução na lateral, sem destaque. Quem decide continua sendo o servidor, com o resultado da consulta de versões guardado por alguns minutos, então abrir páginas não multiplica consultas ao GitHub. Instalação que roda versão não publicada, construída no próprio servidor, mostra a versão sem o aviso, porque a tela de atualização recusa trocar o que não foi publicado. Nada a fazer em instalações existentes. Crédito: @webtecnica.
- **A gravação fecha com impressão digital, para conferir se uma cópia é igual ao que foi gravado** Ao fim de cada ligação gravada, e de cada recado da caixa postal, a linha do tempo da chamada mostra "Gravação fechada", com o tamanho do arquivo e o começo da impressão digital (SHA-256); a impressão inteira fica logo abaixo, para copiar. Com ela dá para conferir se uma cópia do áudio, enviada por e-mail ou guardada fora do servidor, é igual ao arquivo que a instalação gravou: qualquer alteração na cópia muda a impressão. Ela não serve de prova contra quem administra o servidor: a impressão fica no mesmo banco, na mesma máquina que o áudio, e quem tem acesso aos dois pode trocar os dois. Gravações anteriores à atualização não têm impressão digital. Crédito: @webtecnica.

### Corrigido

- **O painel passa a enviar cabeçalhos de segurança** O painel respondia sem `X-Frame-Options`, sem CSP e sem `nosniff`, então qualquer página podia abri-lo dentro de um iframe invisível e colher o clique em botões que transferem chamada, apagam dado e disparam atualização. Agora toda resposta traz `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `base-uri` e `form-action` restritos ao próprio domínio, `nosniff`, política de referência, HSTS só para o endereço do painel (sem obrigar HTTPS nos outros subdomínios da empresa) e câmera e localização fechadas. O microfone continua liberado para o próprio painel, que o usa em "Falar com o agente". A CSP é curta de propósito: não mexe em `script-src` nem `style-src`, porque o Next injeta scripts inline e o painel abre WebSocket, e uma política que quebra a tela acaba sendo desligada por quem opera.
  Crédito: @webtecnica.
- **Em Custos, os minutos de cada motor são a duração das ligações, também no OpenAI Realtime** O quadro "Por motor" da tela de Custos somava os segundos que cada motor declara para cobrar. O OpenAI Realtime cobra por token e declara zero segundo, e por isso a linha dele mostrava perto de 0 minuto ao lado de um custo real. Agora os minutos são a duração das ligações que cada motor atendeu, do atendimento ao fim, e cada ligação conta no dia em que terminou, no fuso da organização, como o resto do quadro. O custo não muda: ele já era medido certo. Na API de custos (`/api/v1/system/costs`), que só o painel usa, os dois campos que se chamavam `seconds` passaram a ter nomes que dizem o que medem: `byDay[].billedSeconds` é o uso declarado pelos motores para cobrar, e `byEngine[].callSeconds` é a duração das ligações. Crédito: @melgarafael.
- **A tela avisa quando o modelo da classificação gravado não vale por estar fora da tabela de preço** Em Configurações → Inteligência artificial, um modelo da classificação gravado sem endpoint e fora da tabela de preço é trocado pelo modelo do motor na hora da classificação, e a tela continuava mostrando o modelo gravado como se valesse. Agora, nesse caso, um aviso ao lado do campo diz que o modelo não está na tabela desta versão, que a classificação usa o do motor, e como resolver. Pelo painel esse estado não se cria, porque o painel recusa salvar um modelo assim. Ele aparece com uma configuração posta por fora do painel ou com um modelo que saia da tabela numa versão futura. Crédito: @melgarafael.
- **As ferramentas de escrita passam a ter teto por ligação** O `send_whatsapp` já se recusava a mandar mais de cinco mensagens numa mesma ligação, mas as outras ferramentas de escrita não tinham teto nenhum: uma conversa podia criar dezenas de pendências, tocar o sino da equipe repetidamente ou disparar o webhook da organização a cada pedido, porque quem está na linha fala e é o modelo que decide chamar a ferramenta. Agora o `runTool` — o ponto único por onde o modelo alcança qualquer ferramenta — recusa a chamada que passa do teto daquela ligação, com limites de 5 para pendências, agendamentos e webhook, 3 para o aviso à equipe e 3 para o pedido de aprovação a um responsável, que conta tentativas porque cada pedido avisa a equipe, mesmo o que é negado; a recusa chega ao modelo como `ok: false` e fica registrada como qualquer outro desfecho, sem executar a ferramenta uma vez sequer. A recusa diz ao agente que o pedido não foi registrado e que a pessoa pode ligar de novo ou aguardar o retorno da equipe, sem afirmar que ele foi tratado. Entrada inválida e recusa feita antes de qualquer efeito não gastam cota; a chamada que pode ter feito o efeito gasta, mesmo quando volta com erro (o webhook que respondeu erro já recebeu o pedido). O teto vale também quando o modelo pede várias ferramentas ao mesmo tempo: a vaga é reservada antes de a ferramenta rodar. Nada muda para quem usa o produto: ligação normal não chega perto desses números.
  Crédito: @webtecnica.

## [0.12.1] - 2026-11-15

### Corrigido

- **A 0.12.0 não chegou a ser publicada, e a 0.12.1 é a primeira publicada com as imagens ARM** A publicação da 0.12.0 parou antes de etiquetar as imagens, por dois defeitos no workflow novo, que publica uma imagem por arquitetura. A voz e as rotinas eram enviadas para o repositório da imagem do painel, e o passo que guarda o resumo de cada imagem parava num erro de shell. A tag `v0.12.0` existe, mas não tem release nem imagens. A atualização para ela para antes de mexer em qualquer coisa, e a instalação parou sem instalar nada, as duas dizendo que não conseguiram baixar as imagens. A 0.12.1 traz tudo o que a 0.12.0 anunciava, sem nenhuma mudança além deste conserto. Quem tentou atualizar para a 0.12.0 roda a atualização de novo. Quem tentou instalar roda o instalador de novo: ele pede `git -C <pasta> checkout v0.12.1` e, feito isso, segue com os segredos que já tinha gravado. Crédito: @melgarafael.

## [0.12.0] - 2026-11-15

### Adicionado

- **As imagens publicadas passam a sair também para servidor ARM de 64 bits** A partir desta versão, as três imagens são publicadas também para ARM de 64 bits (arm64), e o
  instalador, num servidor ARM, puxa a imagem publicada como no x86_64, em vez de construí-la na
  própria VPS. Ainda não houve prova numa máquina ARM de verdade: as Ampere A1 do plano gratuito da
  Oracle e as Graviton são exemplos de onde a imagem deve servir. As versões anteriores continuam sem imagem ARM: em ARM,
  o instalador e o atualizador conferem antes de baixar e, se a versão pedida não tem a imagem,
  param antes de mexer em qualquer coisa e dizem que dá para construir com `--build`. Quem já tem
  uma instalação em ARM construída na máquina passa para esta versão com
  `bash install/update.sh --to <versão>`, sem reinstalar. Crédito: @webtecnica.
- **Link temporário para quem ligou baixar a gravação da própria chamada** Na tela de uma chamada com gravação, o dono ou o administrador cria um link que entrega o áudio a quem ligou, sem login. O link vale 72 horas e permite 10 downloads: cada download gasta um, e abrir a página do link não gasta nada. O endereço aparece uma vez só, na criação, e usa o endereço público da instalação; sem domínio configurado, ele só abre de dentro do servidor. A mesma tela lista os links que ainda valem e revoga todos na hora, e quem recebe o link vê uma página em português, inglês ou espanhol com a validade e o botão de baixar. Qualquer pessoa com o link baixa o áudio, que tem também a voz do agente, e a tela avisa isso. Chamada apagada a pedido de quem ligou, ou gravação que saiu pelo prazo de guarda, deixa de ser entregue. Criar, revogar e cada download ficam no registro de Configurações → Privacidade. Crédito: @webtecnica.
- **A ligação pode deixar recado quando ninguém atende** Com a caixa postal ligada em Configurações → Ligações, a ligação recebida pela linha telefônica para um número sem agente, ou com o agente desligado, é atendida em vez de desligada: quem liga ouve um aviso gravado de que a ligação será gravada, em português, inglês ou espanhol, depois um bipe, e deixa o recado, que fica na própria chamada, tocável ali. Nada do que a pessoa diz antes de o aviso terminar é gravado. O recado termina 4 segundos depois da última fala ou no tempo máximo configurado (60 segundos de fábrica, contados depois do aviso), e o silêncio não vira recado. Cada recado deixa um aviso no painel e segue o caminho do resumo de toda chamada; com a transcrição automática ligada, o recado de um número com agente desligado vira texto com a chave desse agente, e o de um número sem agente fica só em áudio. Os recados não ocupam a vaga das conversas no limite de ligações simultâneas e têm o mesmo número como limite próprio. A caixa postal só atende com a gravação das chamadas ligada em Configurações → Privacidade, e atender pode gerar custo na operadora que cobra a ligação recebida. O recado fica sem cifra no disco do servidor, como as gravações. A ligação pelo WhatsApp continua sem caixa postal. Vem desligada. Crédito: @webtecnica.

### Corrigido

- **Com a transcrição automática ligada, o dono é avisado da ligação mesmo quando a transcrição falha de vez** Com a transcrição automática ligada, o resumo de uma ligação sem fala espera a transcrição da gravação para avisar o dono e classificar o desfecho, e é a transcrição que o pede de novo no fim. Se a transcrição falhava em todas as tentativas da fila, esse pedido não saía, e a ligação terminava sem aviso nenhum. Agora, na última tentativa, o resumo vai para a fila mesmo sem o texto: o aviso ao dono e o desfecho saem como sairiam sem a transcrição. Nas tentativas anteriores nada muda, porque a próxima pode dar certo. Nada muda para quem não ligou a transcrição automática, que vem desligada de fábrica. Crédito: @melgarafael.
- **O painel atrás do Caddy do CRM não cai mais a cada atualização** Quem publica o DeskVoice pelo Caddy do DeskcommCRM na mesma VPS ligava o Caddy do DeskVoice na rede do CRM à mão, com `docker network connect`. Cada atualização recriava o contêiner, a ligação se perdia, e o domínio respondia 502 até alguém refazer o passo. Agora o instalador grava essa rede no arquivo de publicação que ele mesmo gera, com `DESKVOICE_PROXY_NETWORK=<rede> bash install/install.sh`, e o contêiner recriado já nasce nela, com o nome `deskvoice`. Se a rede não existe, a instalação e a atualização param antes de mudar qualquer coisa. `DESKVOICE_PROXY_NETWORK=off` tira a rede. Nada muda para quem não usa o CRM na mesma VPS. Quem fez a ligação à mão roda o passo 3 do guia uma vez e não precisa mais repeti-lo. Crédito: @melgarafael.
- **A restauração confere a rede do proxy do CRM antes de trocar o banco** Numa instalação publicada pelo Caddy do DeskcommCRM, com a rede dele gravada pelo instalador (`DESKVOICE_PROXY_NETWORK`), a restauração de um backup agora confere, antes de parar qualquer serviço, se essa rede ainda existe. Se ela sumiu, os serviços não voltariam a subir depois da troca do banco. Por isso a restauração para sem mexer em nada e diz como seguir, do mesmo jeito que a instalação e a atualização já faziam. Nada muda para quem não usa o CRM na mesma VPS. Crédito: @melgarafael.

## [0.11.0] - 2026-11-15

### Requer atenção

- **Linha por IP aceita mais de um bloco de endereço e um destino de saída** Antes de atualizar, confira em Linha telefônica se alguma linha por IP usa como endereço do servidor um bloco mais largo que /16 (IPv4) ou /32 (IPv6). A atualização não é recusada nem pede nada, mas essa linha passa a ficar de fora da configuração e deixa de receber ligações. A tela da linha mostra a linha com falha e o motivo. Para voltar a receber, cadastre na tela da linha os blocos menores que a operadora publica, ou o IP dela.

### Adicionado

- **O ambiente de quem liga, normal ou barulhento, se escolhe na tela do agente** Cada agente ganha o ambiente de quem liga: "Normal" ou "Barulhento (obra, música, conversa de fundo)". Na tela do agente, o campo "Ambiente" fica junto do motor, da voz e do idioma. Pela API de agentes, é o `listeningEnvironment` (`normal` ou `noisy`) em `POST` e `PATCH /api/v1/agents`, que recusa qualquer outro valor; sem o campo, fica `normal`. Com "Barulhento", o agente pede ao provedor uma detecção de fala ajustada para ruído de fundo: no OpenAI Realtime, redução de ruído e fim de turno pelo sentido da fala; no Gemini Live, início de fala menos sensível e fim de fala que não espera o ruído acabar. A fala de verdade continua interrompendo o agente. Por enquanto, a tela oferece "Barulhento" só no motor OpenAI Realtime, o único em que a sessão foi provada numa instalação real; em outro motor a opção não aparece, e a API segue aceitando o valor em qualquer motor. Um agente que já está em "Barulhento" e troca de motor continua vendo o campo, com um aviso e um botão para voltar a "Normal". Os valores são um ponto de partida: o efeito numa ligação de verdade ainda não foi medido. Os textos estão em português, inglês e espanhol. Nada muda para quem atualiza: todo agente nasce "Normal", e no "Normal" o agente envia ao provedor exatamente o mesmo de antes. Crédito: @melgarafael.
- **A ligação pode ser analisada no fim, na mesma chamada paga do desfecho, com a nota ao lado da régua** Em Configurações → Inteligência artificial, o interruptor "Analisar cada ligação no fim" (a chave `calls.analysis_enabled`) faz a rotina que lê o desfecho comercial pedir, na mesma chamada ao provedor do agente, a análise completa: o cumprimento de cada critério da régua, a temperatura da conversa e as objeções de quem ligou. Só o dono ou um administrador liga o interruptor, e o texto dele diz que cada ligação analisada é uma chamada paga ao provedor do agente, com a transcrição, que inclui o desfecho e que o custo entra no teto do agente. O custo entra uma vez no extrato. A nota é sempre a soma da régua, nunca um número do modelo. Objeção cuja citação não está numa fala de quem ligou, ou que tem menos de três palavras, é descartada. A tela da chamada ganha a seção "Análise": a nota, a régua inteira com os pontos de cada critério e a fala que os sustenta, a temperatura de quem ligou no início, no meio e no fim, as objeções com a resposta do agente, o que foi bem, o que foi mal e o próximo passo. A lista de chamadas ganha a coluna "Nota". Quando a análise não é feita (sem fala, sem chave, motor simulado, teto atingido ou falha do provedor), a linha do tempo e a tela da chamada dizem o motivo. Numa chamada apagada a pedido do titular, a nota fica e o texto da análise não é gravado. Depois do prazo de guarda, ou quando o titular pede o apagamento, ficam só a régua, a temperatura e a contagem de objeções, sem nenhum texto de fala; se o apagamento chega enquanto a análise é feita, fica só a nota, e a tela da chamada diz isso. Nada muda para quem atualiza: a análise nasce desligada, quem usa só o desfecho continua recebendo exatamente o mesmo pedido, com o mesmo custo, a coluna mostra um traço e a tela da chamada não ganha seção nenhuma. Crédito: @melgarafael.
- **Bancada de voz para medir transcritores, fora do produto** O repositório ganha um script manual em `scripts/bancada-de-voz/` que mede como cada serviço de
  transcrição ouve português: erro de palavra, acerto exato em nomes (com acento e cedilha), latência
  até o texto parcial e até o final, e custo, na linha de telefone (8 kHz) e na banda larga (16 kHz),
  com voz sintética e ruído gerado, sempre enviada em tempo real. Ela não roda no CI, não entra na
  imagem e não muda nada numa instalação. Crédito: @melgarafael.
- **A classificação do desfecho aceita um provedor compatível com OpenAI** Quem paga um provedor compatível com OpenAI, como DeepSeek, Qwen, OpenRouter ou Groq, agora classifica o desfecho das ligações nele: em Configurações, Inteligência artificial, o motor OpenAI ganhou os campos de endpoint, chave e modelo da classificação. O endpoint compatível tem chave própria, guardada cifrada: a chave do motor nunca vai a ele, e trocar o endpoint pede a chave de novo. Endpoint sem a chave dele não recebe nada, e a linha do tempo da ligação diz por quê. O destino passa pela mesma guarda de rede dos conectores. Sem endpoint, o modelo da classificação só é aceito se estiver na tabela de preço, porque o pedido vai ao provedor do motor, que cobra por ele; fora dela, o painel recusa salvar e pede o endpoint. Em branco, nada muda: o pedido continua indo à OpenAI com o modelo e a chave de sempre. A voz em tempo real segue no endpoint oficial do motor, e o custo de um modelo configurado não é estimado: o consumo em tokens aparece no extrato e o custo fica zero até o preço dele ser medido. Crédito: @webtecnica.
- **Linha por IP aceita mais de um bloco de endereço e um destino de saída** Na tela da linha, em modo por IP, há dois campos novos: outros endereços de onde as ligações chegam (um por linha, IP ou bloco) e o endereço para as ligações de saída. Com eles, uma operadora que entrega a chamada por vários blocos, um por região, entra no cadastro sem perder ligação quando uma região cai, e a mesma linha recebe pelo endereço e liga pelo nome da conta. Os endereços de entrada são só numéricos: o nome do provedor é aceito apenas no endereço de saída. O reconhecimento por IP recusa bloco largo demais, mais que /16 no IPv4 ou /32 no IPv6. A linha que já existe, com um endereço só, não muda. Crédito: @webtecnica.
- **Transcrição automática da gravação ao fim da chamada** Em Configurações → Inteligência artificial, ao lado da transcrição da gravação, uma chave nova transcreve sozinha, ao fim da chamada, toda gravação que terminou sem nenhuma fala na linha do tempo: a ligação em que o motor em tempo real falhou, a que caiu no meio. O que a pessoa disse e o que o agente disse entram cada um com o seu dono, e o resumo, o desfecho e o aviso ao responsável são feitos depois do texto existir. Chamada que já tem a conversa transcrita durante a ligação não é transcrita de novo. A chave nasce desligada e só age com a transcrição da gravação também permitida; só donos e administradores ligam. Cada chamada transcrita é um pedido pago ao provedor do motor do agente, que entra no custo da chamada e respeita o teto de custo do agente, o prazo de guarda da transcrição e o apagamento a pedido de quem ligou. Falha do provedor fica registrada na linha do tempo e não é repetida. Quem não ligar a chave nova não vê diferença nenhuma. Crédito: @webtecnica.
- **O agente guarda os nomes e termos que podem aparecer na ligação, por enquanto só pela API** Cada agente ganha uma lista de vocabulário: nomes de pessoa, da empresa, de produtos e termos que quem liga costuma dizer, até 50, de 1 a 60 caracteres cada, sem repetição. Ela se grava pela API de agentes (`vocabulary` em `POST` e `PATCH /api/v1/agents`), que recusa termo fora da regra dizendo o motivo. Na chamada, os termos vão ao provedor como dica: no Gemini Live, à lista de vocabulário da transcrição; no OpenAI Realtime, ao texto de apoio da transcrição; nos dois, também à instrução do agente. É uma dica, que o provedor pode ignorar, e o efeito no reconhecimento ainda não foi medido. O campo na tela do agente vem na próxima parte. Nada muda para quem atualiza: a lista nasce vazia, e agente sem termos envia ao provedor exatamente o mesmo de antes. Crédito: @melgarafael.

### Alterado

- **Transcrever a gravação avisa o custo da classificação e mostra a falha na linha do tempo** Na tela da chamada, ao lado do botão de transcrever a gravação, uma linha avisa que, com o desfecho ou a análise ligados, a transcrição também dispara a classificação paga da ligação. Quando o provedor não devolve o texto, a linha do tempo passa a mostrar o motivo, em vez de a falha existir só no custo. Nada a configurar em instalações existentes. Crédito: @webtecnica.

### Corrigido

- **A tela do agente conta que o Barulhento vale por enquanto só no OpenAI Realtime, e avisa quando a volta para Normal falta salvar** Dois ajustes na tela do agente, na seção Voz. O primeiro: fora do OpenAI Realtime, onde a opção "Barulhento" não aparece, ficava sem nenhuma explicação — quem usa o Gemini Live ou o motor simulado não descobria que o modo existe. Agora a tela mantém uma linha dizendo que o modo Barulhento vale por enquanto só no OpenAI Realtime, que é por isso que a escolha não aparece ali, e que para usar o modo é preciso escolher aquele motor. A linha não promete o modo em motor nenhum além daquele, e no OpenAI Realtime a ajuda do campo continua sendo uma só, sem repetição. O segundo: "Voltar para Normal" mexia só no rascunho, e o campo sumia na hora, como se a mudança já valesse — quem saía sem salvar continuava em Barulhento sem saber. Agora a tela avisa que a mudança está só no rascunho e que o agente continua em Barulhento até salvar; o aviso sai quando o salvamento termina, e recarregar sem salvar traz a escolha antiga de volta. Os textos estão em português, inglês e espanhol. Nada muda para quem atualiza: nenhum agente troca de ambiente e o campo continua se comportando como antes. Crédito: @webtecnica.
- **A atualização remove a imagem de terceiros que a versão nova deixou de usar** Quando uma versão troca a imagem de um serviço de terceiros (como o WaCalls, que passou da imagem oficial para a mantida pelo projeto, ou o WAHA, cuja imagem passa de 3 GB), a atualização deixava a antiga no disco da VPS. Agora, depois de subir tudo e conferir, ela remove a imagem que a versão de onde saiu fixava e a nova não fixa mais, pelo endereço exato e sem forçar: imagem que algum contêiner usa fica, com um aviso, e imagem de outro sistema na mesma VPS não é tocada. Voltar para a versão anterior passa a pedir internet para baixá-la de novo. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **A classificação da ligação deixa de custar 1 centavo quando custa 0,03, e o total do mês para de ser trinta vezes o real** Cada ligação lida para descobrir o desfecho custa cerca de 0,03 centavo de dólar ao provedor, mas o DeskVoice arredondava essa leitura para um centavo inteiro antes de somar: a chamada ficava até trinta vezes mais cara do que a fatura e o total do mês, na tela de custos, também. Agora o extrato guarda o valor exato da leitura em micro-centavos (1 centavo = 1 000 000), a chamada mostra a soma do extrato arredondada uma vez só e a tela de custos soma o período inteiro antes de arredondar. O teto de custo do agente continua valendo, na mesma unidade de centavos, e o valor arrecadado não é zerado em lugar nenhum: quem quiser ver a fração continua vendo no extrato. As leituras já gravadas continuam valendo 1 centavo cada, porque o valor exato delas não foi guardado; só as feitas depois da atualização saem exatas. Nada a fazer em instalações existentes, e nenhuma configuração muda. Crédito: @webtecnica.
- **Com barulho na linha, o agente não fica mais calado esperando a pessoa terminar de falar** Quando quem liga está num lugar com obra, música ou outras pessoas falando, o provedor de IA às vezes
  não percebe que a pessoa terminou de falar, e o agente ficava em silêncio, como se a ignorasse. Agora
  o DeskVoice percebe que a pessoa falou e ficou sem resposta. Cerca de 2,5 segundos depois da última
  palavra (8 segundos se o provedor ainda não mandou texto nenhum), ele pede ao provedor que responda
  ao que ouviu. Se o agente continuar calado por mais 4 segundos, ele diz "Desculpe, a linha está com
  bastante barulho. Pode repetir, por favor?", no idioma do agente. Ele age uma vez por fala e nunca
  pede de novo sem que a pessoa diga algo antes. Não age enquanto a pessoa ainda fala, nem durante uma
  ferramenta ou uma aprovação em espera. Cada vez que age, a linha do tempo da chamada mostra. Vale
  para todos os agentes, sem nada a configurar. Os prazos são um ponto de partida e ainda não foram
  medidos com os provedores. Crédito: @melgarafael.
- **A linha do tempo diz em frase por que a ligação terminou ou foi recusada** Onze motivos apareciam na linha do tempo como código, em vez de frase: a ligação pelo WhatsApp que o agente não conseguiu atender, a que tocou e ninguém atendeu, a chamada pelo navegador que não conectou, a transferência não atendida, o erro interno, o desligamento do DeskVoice no meio da chamada (acontece em toda chamada viva durante uma atualização) e as cinco recusas da política de ligações de saída. Agora todos têm frase em português, inglês e espanhol, e o CI reprova motivo novo sem frase. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **O prazo de guarda das conversas agora alcança o resumo da chamada** O resumo da chamada é escrito a partir das falas e guarda frases de quem ligou, em linhas "Cliente: …". Até agora, quando o prazo de guarda apagava a transcrição, o resumo ficava com parte do que a pessoa disse. Agora o resumo sai com a transcrição da mesma chamada: o texto dele vira um marcador, a linha da chamada continua e a tela diz que o resumo saiu com o prazo. A contagem do registro de expurgo passa a somar falas e resumos. O resumo de chamada dentro do prazo não é tocado, e os dados enviados pelas ferramentas continuam fora do prazo, como antes. Nada a fazer em instalações existentes. Crédito: @webtecnica.
- **O som que vai ao Gemini, e a voz do agente no WhatsApp, têm bem menos chiado falso acima de 4 kHz** Ao converter o áudio da chamada de 8 para 16 kHz, o DeskVoice criava cópias espelhadas da voz entre
  4 e 8 kHz, a faixa do chiado de "s", "ç", "f" e "x", só 4 a 28 dB abaixo da voz. Ele também abafava
  o topo da faixa telefônica (3 a 4 dB perdidos em 3 kHz). Isso acontecia no áudio de quem liga
  enviado ao Gemini Live e na fala do agente enviada ao WhatsApp. Agora a conversão filtra. Do jeito
  que o produto converte, em pedaços de 20 ms, as cópias ficam mais de 40 dB abaixo da voz, e o som
  até 3 kHz chega sem perda. O limite que resta é a junção entre os pedaços, convertidos um a um:
  ela deixa um resíduo entre 26 e 42 dB abaixo da voz, menor que o de antes em todos os tons medidos.
  Nada a configurar. O efeito no reconhecimento de fala do provedor ainda não foi medido. Crédito:
  @melgarafael.
- **A ligação pelo WhatsApp não fica muda quando o processo de voz cai no meio** Se o processo de voz parava sem se despedir (uma queda, falta de memória) no meio de uma ligação pelo WhatsApp, quem ligou ficava cerca de um minuto em silêncio até o WaCalls desistir. Agora o processo, ao voltar, confere as ligações vivas do WaCalls e desliga as que ele mesmo tinha atendido antes de cair. A linha dela já fechava na tela com o motivo "O processo de voz reiniciou no meio da chamada". As ligações atendidas por outra pessoa no WaCalls não são tocadas. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **A ligação pelo WhatsApp que chega com o processo de voz fora do ar é atendida quando ele volta** Uma ligação pelo WhatsApp que começava a tocar enquanto o processo de voz estava fora do ar ou sem contato com o serviço de ligações (uma atualização, uma queda) não era atendida pelo agente, nem depois que o processo voltava, e não aparecia em Chamadas. Agora, ao voltar, o processo confere as ligações que estão tocando e atende as que ninguém atendeu, pelas mesmas regras de sempre (agente escolhido, agente ligado, teto de recebidas). Nada a fazer em instalações existentes. Crédito: @melgarafael.

## [0.10.1] - 2026-11-14

### Alterado

- **A lista de Chamadas mostra por onde a ligação chegou** Na lista de Chamadas, nas chamadas ao vivo e no topo da tela de cada chamada, a ligação que veio pelo WhatsApp, pelo navegador ou pelo botão de simular agora diz isso, e a linha do tempo começa com "A ligação chegou pelo WhatsApp", "A chamada pelo navegador começou" ou "A chamada simulada começou". A chamada pelo navegador e a simulada, que não têm número, deixam de aparecer como número não identificado. As chamadas que já existem recebem o canal pelo que a própria linha do tempo delas registrou; as simuladas antigas, que não registravam canal, são reconhecidas por terem o motor simulado e nenhum número chamado; as da linha telefônica continuam como estavam. Nada a fazer em instalações existentes. Crédito: @melgarafael.

## [0.10.0] - 2026-11-14

### Adicionado

- **Transcrever a gravação de uma chamada que ficou sem texto** Chamada sem transcrição, como um recado, uma falha do motor em tempo real ou uma chamada sem motor, agora pode ter a gravação transcrita pelo provedor do motor do agente (OpenAI ou Google), com um botão na tela da chamada. Cada lado da ligação é transcrito em separado, e o texto entra na linha do tempo como fala de quem ligou e do agente, marcado como transcrito da gravação. A opção nasce desligada e se liga em Configurações → Inteligência artificial, porque o áudio gravado sai para o provedor e cada transcrição é paga: o valor entra no custo da chamada e respeita o teto de custo do agente. Só donos e administradores pedem. Chamada apagada a pedido de quem ligou, fora do prazo de guarda da transcrição, que já tem texto ou com gravação mais longa do que o provedor aceita num pedido não é transcrita, e a tela diz o motivo. Repetir o pedido devolve o mesmo texto sem cobrar de novo. Nada a fazer em instalações existentes. Crédito: @webtecnica.

## [0.9.0] - 2026-11-14

### Adicionado

- **O banco passa a ter onde guardar a análise da ligação, já com o prazo de guarda** Esta é a primeira parte da análise da ligação no fim: a nota de 0 a 10 por uma régua de cinco critérios, a temperatura da conversa e as objeções de quem ligou. Ela ainda não analisa nenhuma ligação e não tem tela; só prepara o lugar onde a análise fica e as regras dela. A citação de cada objeção precisa estar na fala de quem ligou, ou a objeção é descartada. Depois do prazo de guarda da transcrição, a análise perde todo o texto e mantém a nota, a régua e a temperatura. A exportação por telefone, em Configurações → Privacidade, passa a levar a análise e a nota de cada chamada. Nada a fazer em instalações existentes: as colunas nascem vazias e nenhuma ligação antiga é alterada. Crédito: @melgarafael.
- **Apagar a conversa a pedido de quem ligou** Em Configurações → Privacidade, o dono ou administrador passa a atender o pedido de apagamento de quem ligou, em dois passos: informa o telefone, vê a prévia do que sairia (chamadas, eventos, pendências, avisos, aprovações e gravações) e só então confirma, num botão que nomeia o telefone. Nas chamadas desse número saem as falas, o resumo, a citação do desfecho, o texto da análise, o motivo do pedido para parar a gravação, os argumentos e respostas das ferramentas, o texto das aprovações e dos avisos enviados ao dono, e as pendências ligadas ao número ou à chamada; o telefone da pessoa some dessas chamadas, dos eventos e das pendências. A gravação sai logo depois que o banco confirma, por uma rotina; se um arquivo não sair, o registro diz quantos ficaram, e a rotina e um novo pedido tentam de novo. Fica o registro do serviço prestado (horário, duração, custo, desfecho e nota), e o número continua na lista de não ligar, se estiver nela. Enquanto houver uma chamada em andamento com o número, o apagamento espera. O recibo fica no registro da tela, com quem pediu, as contagens e só os quatro últimos dígitos do telefone. Resumo, desfecho e avisos que chegam depois do fim da chamada não regravam texto numa chamada já apagada. A exportação por telefone passa a usar o mesmo critério: o número é o de quem ligou, na chamada recebida, ou o de quem recebeu, na feita, e exportar a própria linha da empresa não devolve mais as chamadas de outras pessoas. As cópias de backup já feitas pelo operador não são alcançadas pelo apagamento. Nada a fazer em instalações existentes. Crédito: @webtecnica.
- **A gravação para a pedido de quem liga, e o pedido fica registrado** Quando a pessoa na linha pede para não ser gravada, o agente pode parar a gravação naquele ponto, com a nova ferramenta `stop_recording`, e quem acompanha a chamada no painel também pode parar pelo botão na tela da chamada ao vivo. O trecho em que o pedido foi feito continua no arquivo, como prova de que ele existiu; do pedido em diante nada mais é gravado, e não há como retomar na mesma ligação. O que a pessoa disser entre o pedido e a resposta do agente ainda entra no arquivo. A tela e o agente dizem o que de fato aconteceu: se a chamada não estava sendo gravada (a gravação vem desligada, ou faltou espaço no disco), nada é parado nem registrado, e o agente diz isso à pessoa. A parada aparece na linha do tempo, dizendo se veio do agente ou do painel, e entra na exportação por telefone, em Configurações → Privacidade. O motivo do pedido é fala de quem ligou e sai no mesmo prazo de guarda da transcrição; quando e por quem ficam. Os agentes que já existem não ganham a ferramenta sozinhos: com a gravação ligada, marque `stop_recording` nas ferramentas de cada agente, em Agentes, para ele poder atender o pedido. Crédito: @webtecnica.
- **O agente aperta as teclas do menu automático em vez de pedir que a pessoa aperte** Ligação para fora esbarrava em menu automático: a URA da operadora ou do convênio pedia um número e
  o agente só podia pedir a quem ligou que digitasse. Agora existe a ferramenta `send_dtmf`, que toca
  o tom de cada tecla na própria fala do agente, como faz um telefone, e o rastro de cada tecla fica
  na linha do tempo da chamada. Funciona com o menu que reconhece o tom no áudio. O menu que só
  aceita tecla enviada à parte, pela sinalização (RFC 4733 ou SIP INFO), não reconhece: isso foi
  medido entre dois Asterisk, e ainda não há prova com a URA de uma operadora. Na ligação pelo
  WhatsApp a ferramenta se recusa. O tom não entra na gravação da chamada, porque sai direto para a linha, sem passar pelo motor. Agentes que já existem não a ganham sozinhos: ela se liga na lista
  de ferramentas do agente. Crédito: @webtecnica.

### Alterado

- **O serviço da ligação pelo WhatsApp passa a repassar o telefone de quem liga com o número oculto** O serviço que atende a ligação pelo WhatsApp (WaCalls) passa a vir de uma cópia mantida pelo projeto, igual à dos autores mais um conserto: quando o WhatsApp esconde o número de quem liga, ele repassa o telefone que a própria chamada informa. A troca acontece na atualização, só onde a ligação pelo WhatsApp está instalada, e o número conectado continua pareado. O conserto foi proposto aos autores, e a imagem volta a ser a deles quando eles o publicarem. Nada a fazer em instalações existentes. Crédito: @melgarafael e, pelo WaCalls, JotaDev66 e Joseph Fernandes.

### Corrigido

- **Transferência que ninguém atende não passa mais por atendida** Quando o destino da transferência não atende, está ocupado ou cai, a chamada terminava como se a
  transferência tivesse dado certo, e quem opera só descobria pelo cliente. Agora a equipe recebe, no
  painel, um aviso com quem ligou, por que pediu para falar com uma pessoa e o resumo do que já tinha
  sido combinado, com o pedido de retornar a ligação. Na linha do tempo da chamada, o fim da
  transferência aparece como "Transferência não atendida", e não mais como "Transferência concluída".
  Na lista de chamadas ela continua como "Transferida"; o motivo `transfer_unanswered` sai pela API e
  na exportação. Se quem ligou desligou enquanto a transferência tocava, o aviso sai igual, e o motivo
  continua `transferred`. A transferência atendida não gera aviso, seja quem for que desligue depois.
  As transferências atendidas gravadas antes desta versão ficaram registradas como não atendidas e passam a aparecer como "Transferência não atendida" na linha do tempo; as novas aparecem certas.
  Crédito: @webtecnica.
- **Quem liga pelo WhatsApp com o número oculto deixa de aparecer como não identificado** O WhatsApp passou a esconder o número de quem liga (`@lid`), e a ligação ficava como número não identificado, inclusive na linha do tempo e na exportação de dados. A própria chamada traz o telefone de quem liga, e o DeskVoice passa a usá-lo quando o serviço da ligação pelo WhatsApp o repassa. O WhatsApp não confirma esse telefone, assim como a operadora não confirma o número de quem liga pelo telefone. Nada a fazer em instalações existentes. Crédito: @melgarafael.

## [0.8.0] - 2026-11-13

### Adicionado

- **A chamada passa a dizer o que aconteceu, e não só o que foi dito** Depois do resumo, o motor de voz do agente lê a conversa e classifica o desfecho: agendou, pediu
  retorno, deixou recado, sem interesse ou só informação, com a fala de quem ligou que sustenta a
  classificação e a confiança que o provedor declarou. Nasce desligado: um dono ou administrador liga
  em Configurações → Inteligência artificial. Cada ligação classificada é uma chamada paga ao
  provedor, com a chave do motor do agente e a transcrição em texto; o valor entra no custo da
  chamada e no teto de custo do agente, e ligação que já atingiu o teto não é classificada. Quando o
  provedor falha, a linha do tempo da chamada diz por quê. A fala guardada sai com o prazo de guarda
  da transcrição e entra na exportação por telefone. Crédito: @webtecnica.
- **Ligação pelo WhatsApp, segunda parte - o agente atende quem liga pelo WhatsApp** Com o número conectado em Configurações, no bloco "Ligação pelo WhatsApp", escolha o agente que atende. A partir daí, quem liga para a empresa pelo WhatsApp é atendido na hora pelo agente, com o mesmo aviso de gravação, as mesmas ferramentas e os mesmos tetos de custo e de duração da ligação pelo telefone. A ligação conta no mesmo limite de ligações recebidas ao mesmo tempo das que chegam pela operadora. Quando o agente não atende (nenhum agente escolhido, agente desligado ou limite atingido), a ligação continua tocando no celular, e o painel recebe um aviso. Neste canal não há transferência para uma pessoa: o agente oferece deixar um recado. A saúde do sistema avisa quando o número está conectado e nenhum agente atende. O áudio tem a qualidade de telefone fixo, como o resto do DeskVoice. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **Quem opera a instalação pode ser avisado no WhatsApp quando uma ligação termina** Ao fim de cada ligação, o dono (ou, sem número dele, o primeiro administrador que tenha número no
  perfil) pode receber no WhatsApp uma mensagem curta dizendo que o resumo está no painel. O aviso
  nasce desligado, inclusive em quem atualiza: o dono ou um administrador liga em Configurações →
  WhatsApp. A mensagem não leva o conteúdo da conversa nem o número de quem ligou, só o aviso; o
  resumo continua no painel. É uma mensagem por ligação, mesmo que o resumo seja recalculado, e sem
  conector ou sem número nada sai. Crédito: @webtecnica.

### Alterado

- **O instalador diz o que o firewalld faz com as portas do Docker** Com o `firewalld` ativo (AlmaLinux e Rocky Linux), o instalador avisava que esse caso não tinha sido provado e mandava começar pelo `firewalld` o diagnóstico de uma ligação muda. Agora está medido: o `firewalld` não filtra as portas que o Docker publica. A porta SIP e a faixa de áudio chegam aos contêineres com ele ligado, e nem uma regra de bloqueio dele as fecha. O aviso passa a dizer isso e aponta o firewall do provedor da VPS, quando ele existe, como o lugar de fechar a porta. A regra na cadeia `DOCKER-USER`, que fecha a porta com o `ufw`, ainda não foi medida com o `firewalld`. Nada a fazer em instalações existentes. Crédito: @melgarafael.

### Corrigido

- **O celular de quem liga pelo WhatsApp fica gravado com o nono dígito** O WhatsApp manda o celular brasileiro antigo sem o nono dígito (`55 31 8888-7777` em vez de `55 31 98888-7777`). A ligação recebida pelo WhatsApp ficava como número não identificado nesses casos, mesmo quando o número chegava. Agora o nono dígito volta, e o número passa a casar com o mesmo telefone digitado no painel, na lista de não ligar e na exportação de dados. O mesmo vale para o número mostrado do WhatsApp conectado por QR Code e do número conectado à ligação pelo WhatsApp: os que já estavam gravados sem o nono dígito são corrigidos na atualização, e o aviso de "mesmo número" volta a reconhecer o mesmo telefone nos dois blocos. Quando o WhatsApp esconde o número de quem liga (`@lid`), ele continua não identificado: isso depende do WaCalls. Nada a fazer em instalações existentes. Crédito: @melgarafael.

## [0.7.0] - 2026-11-13

### Adicionado

- **A pendência combinada na ligação tem responsável, prazo e fecho** Quando o agente usa a ferramenta `create_task`, a pendência deixa de ser só um aviso no sino: ela vai para a nova tela Pendências, com abertas, minhas, vencidas e fechadas. Na tela do agente, em "Dono das pendências deste agente", você escolhe quem recebe as pendências que ele abre; sem escolha, elas são da equipe. Na hora marcada, o responsável recebe um aviso no sino e, se tiver WhatsApp cadastrado e houver conector, uma mensagem que diz só que há uma pendência, sem o assunto. Passado o prazo, a tela a mostra como "Para agora"; se ela continuar aberta um dia depois do prazo, passa a ser vencida, e o aviso de vencida sai uma vez. Fechar pede uma nota curta ("Retornei, consulta marcada para 14/11"), e o fecho aparece na linha do tempo da ligação de origem, com quem fechou. Operador mexe nas próprias pendências e nas da equipe; dono e administrador, em qualquer uma. Pessoa desativada devolve as pendências abertas à equipe, não pode ser escolhida como dono, e quem já fechou uma pendência só pode ser desativado, não removido, para o histórico continuar dizendo quem fechou. O título, os detalhes e a nota ficam só na pendência: a linha do tempo não grava mais o que o modelo mandou para `create_task`, o aviso do sino tem corpo fixo, a pendência fechada sai com o prazo de guarda da transcrição (contado do fecho), a aberta nunca sai pelo prazo, e a exportação dos dados de um telefone traz as pendências dele. Pendências que já estavam na fila antes da atualização ainda criam o aviso de antes, uma vez. Nada a configurar em instalações existentes. Crédito: @melgarafael.

### Alterado

- **Configurações passa a ser dividida em seções** A tela de Configurações deixou de ser uma página única com todos os blocos empilhados. Uma navegação no topo leva a sete seções, cada uma com endereço próprio: Inteligência artificial (motores de voz, chaves e motor padrão, que continua sendo o que abre em Configurações), Ligações (limite de ligações recebidas ao mesmo tempo, pedido de aprovação sem resposta e aviso de gravação), WhatsApp (número por QR Code, conector externo, envio direto para quem ligou e ligação pelo WhatsApp), Integrações (webhooks permitidos), Privacidade, Sistema (versão e atualização) e Sua conta (contato e senha). Os avisos do painel e da checagem de saúde que mandam a pessoa a Configurações agora dizem a seção. Nada muda no que cada bloco faz, e nada a configurar em instalações existentes. Crédito: @melgarafael.
- **O instalador não vende mais as regras de ufw como proteção** As portas de telefonia são publicadas pelo Docker, e o Docker passa por fora do `ufw`: as regras que o instalador oferecia não abriam nem fechavam nada. A mensagem do instalador passa a dizer isso, e a documentação aponta os dois lugares que de fato filtram a porta: o firewall do provedor da VPS, quando ele existe, e uma regra na cadeia `DOCKER-USER` da própria máquina. Nada a fazer em instalações existentes. Crédito: @webtecnica.

### Corrigido

- **A chamada simulada anda no ritmo de uma ligação** Na chamada simulada (painel e `pnpm demo`), a fala do agente agora toca no tempo dela: quem "ligou" só responde depois de ouvir a fala inteira, e ao encerrar ou transferir a chamada espera a última fala terminar, como já acontecia nas ligações reais. Antes, o roteiro corria com o agente ainda falando, e a gravação da chamada simulada mostrava, depois do fim, a fala do roteiro inteiro acumulada (issue #111). Agora sobra só a última fala, como nas ligações reais. A demonstração do painel fica mais longa, perto da duração de uma ligação de verdade. Nada a configurar em instalações existentes. Crédito: @melgarafael.
- **Quando quem ligou desliga com o agente ainda falando, a gravação para ali** O motor de voz manda a fala do agente mais rápido do que ela toca. Quando quem ligou desligava no meio de uma fala do agente, a gravação guardava também o resto dessa fala, que não chegou a tocar para ninguém, depois do horário de fim da chamada. Agora, nesse caso, a gravação corta a fala do agente no momento em que quem ligou desligou, como já fazia quando quem ligou interrompia. Quando é o agente que encerra a chamada, ou ela é transferida, nada muda: a telefonia toca a fala inteira antes de soltar a linha, e a gravação a guarda inteira. **Gravações feitas na 0.6.0 em que quem ligou desligou com o agente falando podem ter esse trecho a mais no fim**, depois do horário de fim da chamada na linha do tempo. A gravação vem desligada de fábrica. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **Quando a gravação falha no meio da chamada, a linha do tempo mostra** Se o disco enchesse ou desse erro durante uma chamada gravada, a gravação daquela chamada se perdia e o aviso ficava só no registro do processo de voz: quem olhava a linha do tempo não sabia que não havia áudio. Agora a linha do tempo mostra "Gravação interrompida" no momento da falha, com o motivo (disco cheio, erro de escrita ou disco lento demais), e a chamada segue normalmente, sem gravar o resto. O arquivo incompleto é apagado no fim, como antes. Com o disco lento, as escritas pendentes da gravação também tinham deixado de ter limite em memória: agora, quando mais de 10 segundos de áudio esperam para ir ao disco, a gravação é encerrada do mesmo jeito, e a chamada não é afetada. A gravação vem desligada de fábrica. Nada a fazer em instalações existentes. Crédito: @melgarafael.

## [0.6.0] - 2026-11-12

### Adicionado

- **Exportar pela tela os dados que a organização guarda sobre um telefone** Quando uma pessoa pede o que a central guarda sobre ela, dono ou administrador informa o telefone em Configurações, em "Dados de uma pessoa que ligou", e baixa um arquivo com as chamadas desse número, os eventos delas e a entrada na lista de não ligar. O arquivo só traz o que é da organização de quem pede, nunca de outra empresa da mesma instalação. Cada exportação fica registrada na tela, com quem exportou, de qual telefone e quando. Nada a configurar em instalações existentes. Crédito: @webtecnica, @melgarafael.
- **As chamadas podem ser gravadas em áudio, com a gravação desligada de fábrica** A instalação agora sabe gravar o áudio de cada chamada num arquivo WAV estéreo, com quem ligou num canal e o agente no outro, e tocá-lo na tela da chamada. A gravação vem desligada: quem atualiza continua sem gravar até um dono ou administrador ligar em Configurações, em "Gravação das chamadas", e cada organização decide a sua. A tela diz o custo em disco, cerca de 1,9 MB por minuto de chamada, pela conta do formato, e avisa quando não há prazo de guarda e o disco cresce sem limite. O áudio vai para o disco durante a chamada, sem ficar em memória, e com menos de 1 GiB livre a chamada segue sem gravar, com o motivo na linha do tempo. Ligar ou desligar fica no registro da mesma tela e não apaga nada: as gravações já feitas seguem o prazo de guarda das conversas e saem junto com o texto. A exportação dos dados de quem ligou passa a dizer, em cada chamada, se há gravação; o áudio não vai no arquivo. Os backups de hoje não incluem as gravações. Os arquivos ficam num volume novo do Compose, que a atualização cria sozinha. Crédito: @aliffstefano.
- **Ligação pelo WhatsApp, primeira parte - instalar o serviço e conectar o número pela tela** Em Configurações, o bloco "Ligação pelo WhatsApp" instala o serviço (o WaCalls, um cliente não oficial do WhatsApp) e conecta o número da empresa lendo um QR Code, como mais um aparelho do WhatsApp. A tela mostra o número conectado, avisa quando ele cai e quando é o mesmo número já conectado para mensagens, e a saúde do sistema ganha a linha "Ligação pelo WhatsApp". O serviço vem desligado: nada é baixado sem o pedido de um dono ou administrador. Nesta versão nenhuma ligação é atendida pelo agente; isso chega na próxima. O WhatsApp pode bloquear o número: use um número dedicado. Nada a fazer em instalações existentes: o atualizador gera as chaves do serviço sozinho. Crédito: @melgarafael.
- **O motor de voz declara onde o áudio é processado, e a tela mostra** A tela de Configurações mostrava o motor de voz e o preço, mas não dizia para onde o áudio da
  chamada vai. Agora cada motor declara provedor e lugar de processamento, e a tela exibe a
  declaração com a fonte — inclusive quando a resposta honesta é "o provedor não declara o país".
  Nada a fazer em instalações existentes: é informação, não configuração. Crédito: @webtecnica.
- **Prazo de guarda da transcrição, por organização, em Configurações** Dono ou administrador define em Configurações, em "Prazo de guarda das conversas", por quantos dias a transcrição de cada ligação fica guardada, com mínimo de 30. Depois do prazo, o texto de cada fala é trocado por um marcador, uma vez por dia; a chamada, o resumo e o resto da linha do tempo continuam. O que sai não volta, e os backups já feitos continuam com o texto até serem descartados. Cada mudança do prazo e cada expurgo ficam registrados na mesma tela. Nada a fazer em instalações existentes: sem prazo preenchido, a transcrição continua guardada para sempre, como antes. Crédito: @webtecnica, @melgarafael.

### Alterado

- **A voz do agente se escolhe numa lista, com as vozes de cada motor** Na tela do agente, o campo Voz era um texto livre: era preciso saber o nome exato da voz no provedor. Agora é uma lista com as vozes do motor escolhido (as 30 do Gemini Live, com o descritor oficial de cada uma, como "Warm" ou "Firm", e as 10 do OpenAI Realtime, com as duas que a OpenAI recomenda marcadas), mais "Padrão do motor", que mostra qual voz é essa. Trocar de motor volta a voz para o padrão, porque o nome de uma voz não existe no outro. Um agente com voz fora da lista continua com ela, marcada como tal. Crédito: @aliffstefano.
- **A saudação aponta o exemplo de aviso de IA do guia de conformidade** A dica do campo `Saudação` passou a indicar o exemplo de aviso de IA que está no guia de
  conformidade, nos três idiomas. O texto do agente continua sendo decisão de quem opera, e o
  aviso segue opcional: nada muda em instalações existentes. Crédito: @webtecnica.

### Corrigido

- **O aviso pelo WhatsApp leva uma chave de repetição, para o reenvio não duplicar a mensagem** A entrega do aviso é uma tarefa de fila com três tentativas: quando o destino recebia a mensagem mas a
  resposta se perdia no caminho, a tentativa seguinte mandava o mesmo texto outra vez. Agora cada envio
  vai com a chave de repetição igual ao id do próprio aviso, e quem recebe pode devolver o mesmo recibo
  em vez de mandar duas vezes. Vale para os conectores de endereço do operador; o número conectado por QR Code não muda. Nada a fazer em instalações existentes. Crédito: @webtecnica.
- **O custo estimado das chamadas com OpenAI Realtime bate com a fatura** O custo de cada chamada com o motor OpenAI Realtime era estimado cobrando todo token de entrada como áudio novo, a US$ 32 por milhão. Só que a cada resposta a OpenAI reconta a conversa inteira, e quase tudo isso vem do cache (US$ 0,40 por milhão) ou é texto, como as instruções do agente (US$ 4). Numa ligação real de dois minutos, o painel mostrou US$ 1,31 e a fatura foi de cerca de US$ 0,20, e o teto de custo do agente derrubou a ligação no meio. Agora a estimativa separa áudio, texto e cache com os preços da página da OpenAI. Gemini Live não muda. Crédito: @aliffstefano.
- **O agente se despede antes de desligar, em vez de cair na cara de quem ligou** Ao encerrar a ligação, o agente às vezes chamava a ferramenta de encerrar sem ter falado nada, e quem ligou ouvia a ligação cair no meio do "pode ser". Agora a ferramenta recebe a despedida: o agente a fala uma vez e só então a ligação cai. Crédito: @aliffstefano.
- **A mensagem de teste passou a provar o conector configurado, não só o QR Code** Quem configurava um conector de endereço do operador (DeskcommCRM ou webhook) não tinha como saber se
  ele funcionava antes da primeira ligação real: o botão de teste mandava a mensagem pelo número
  conectado por QR Code, e sem número conectado o botão nem aparecia na tela. Agora o teste sai pelo
  conector configurado, pelo mesmo caminho do aviso de ligação, e quando o destino recusa a tela diz
  que foi o conector — em vez de um erro sem nome. Nada a fazer em instalações existentes: o número
  conectado por QR Code continua sendo testado como antes. Crédito: @webtecnica.

## [0.5.0] - 2026-11-12

### Adicionado

- **A saída inteira de cada atualização fica guardada no servidor** O painel mostra só o fim da saída do atualizador. Agora o agente do servidor guarda a saída inteira de cada atualização em `deploy/agent/last-update.log`, na pasta do DeskVoice, com as mesmas senhas e e-mails escondidos que a tela esconde, e só o dono do arquivo o lê. Ficam as três últimas: a mais nova nesse arquivo e as duas anteriores em `last-update.log.1` e `last-update.log.2`. A tela, no resultado da atualização, aponta o arquivo. Quem executa uma atualização é o agente da versão que estava instalada, então a atualização que traz esta versão ainda não guarda o arquivo, e a tela não o aponta; as seguintes guardam. Crédito: @melgarafael.

### Alterado

- **A saída da atualização diz que o atualizador da versão nova assumiu** Numa atualização, o atualizador da versão instalada troca o código e passa a vez ao da versão nova, que termina o trabalho. Agora, perto do fim da saída, que é o trecho que a tela de atualização mostra, aparece uma linha como "O atualizador da versão 0.5.0 assumiu a atualização a partir da 0.4.0". Ela é a prova de que quem terminou foi o atualizador novo, e não o antigo. Nada a fazer em instalações existentes. Crédito: @melgarafael.

### Corrigido

- **A saída do atualizador não esconde mais nome de pacote como se fosse e-mail** A máscara que esconde e-mail na saída do atualizador e no arquivo de diagnóstico trocava também nomes de pacote com versão: a linha `> @deskvoice/routines@0.0.0 migrate` aparecia como `> @deskvoice/***@0.0.0 migrate`. Agora só é tratado como e-mail o que termina num domínio de letras, como `empresa.com.br`, e o e-mail de verdade continua escondido. Crédito: @melgarafael.
- **O custo do WhatsApp na tela usa a medida mais recente** O bloco WhatsApp, em Configurações, dizia que o DeskVoice inteiro usa cerca de 320 MB e que o serviço de WhatsApp custa cerca de 360 MB, números de medidas anteriores, de 11/11/2026. Agora ele diz o medido na 0.3.0, em 12/11/2026, numa VPS de 8 GB: cerca de 323 MiB para o serviço de WhatsApp sem número conectado, e cerca de 380 MiB para o resto do DeskVoice parado. Os guias e o README dizem o mesmo. Crédito: @melgarafael.
- **As notas da versão mostram os comandos sem as crases** Em Configurações, em Versão e atualização, o trecho "O que muda" mostrava as crases das notas como texto, por exemplo em volta de `systemctl enable --now docker`. Agora o que está entre crases aparece como comando, em letra de código, e uma crase sem par continua como texto. Nada das notas vira HTML. Crédito: @melgarafael.
- **A tela de atualização diz quando o servidor ainda não viu a versão nova** Em Configurações, em Versão e atualização, logo depois de sair uma versão a tela mostrava a versão nova como a mais recente publicada e, embaixo, que o servidor não tinha encontrado versão mais nova, sem botão. As duas coisas eram verdade ao mesmo tempo: a lista de versões é lida na hora, e o servidor só confere as versões publicadas a cada 10 minutos. Agora a tela diz que a versão já foi publicada e que o servidor ainda não a viu, e o botão aparece quando ele a vir. Depois de atualizar, com a instalada igual à mais recente, a tela diz só que o servidor está na versão publicada mais recente. Crédito: @melgarafael.

## [0.4.0] - 2026-11-12

### Adicionado

- **O instalador aceita AlmaLinux 9 e Rocky Linux 9** Além de Ubuntu 22.04+ e Debian 12+, o instalador passa a aceitar AlmaLinux 9+ e Rocky Linux 9+
  sem `--force`, e as mensagens dele mostram a lista inteira. Quando o Docker está instalado e com o
  serviço desligado, como veio numa VPS AlmaLinux da parceira, o instalador liga o serviço
  (`systemctl enable --now docker`) e diz isso na tela. Sem `git`, o comando de uma linha o instala
  pelo `dnf` quando não há `apt-get`. Com o `firewalld` ativo, ou com o SELinux em `Enforcing` e o
  Docker rodando com ele ligado, o instalador avisa que esse caminho não foi provado e segue. O
  AlmaLinux 9 foi instalado numa VPS em 12/11/2026 com o serviço do Docker ligado à mão; a ligação
  automática ainda não rodou numa máquina real, e o Rocky Linux 9 não foi provado. Nada a fazer em
  instalações existentes. Crédito: @melgarafael.

### Alterado

- **As imagens de voz e de rotinas passam a dividir a mesma base, e cada versão ocupa cerca de 900 MB a menos no servidor** Os processos de voz e de rotinas saem da mesma base (as dependências e os pacotes do núcleo), mas até a 0.3.0 cada imagem era montada separadamente, e a base saía duas vezes, com marcações diferentes: o servidor baixava e guardava as duas cópias. Na 0.3.0, as duas dividiam 5 de 18 camadas. A partir desta versão as três imagens são montadas juntas, e voz e rotinas diferem só no último passo. Quem atualiza baixa menos, e cada versão ocupa menos disco. Nada a fazer em instalações existentes. Crédito: @melgarafael.

### Corrigido

- **A atualização deixa de acumular no disco as imagens das versões antigas** Cada atualização deixava no servidor as imagens da versão anterior a ela, cerca de 2 GB por
  versão. Agora, depois que tudo responde, a atualização remove as imagens do DeskVoice que não
  são nem a versão nova nem a de onde se acabou de sair, que fica para voltar a ela sem internet,
  e diz quais removeu. A imagem construída no próprio servidor (`local`) sai quando a instalação
  passa a rodar a imagem publicada; quem instalou com `--build` e segue assim não perde nada.
  Imagem que algum contêiner ainda usa fica, com um aviso, e as imagens de terceiros (banco,
  telefonia, entrada, WhatsApp) não são tocadas. Quem limpa é o atualizador da versão nova, então
  a limpeza já acontece na atualização que leva a esta versão. Nada a fazer em instalações
  existentes. Crédito: @melgarafael.

## [0.3.0] - 2026-11-12

### Adicionado

- **Uma instalação cuja pasta foi movida pode ser adotada pela pasta nova, sem perder os dados** Os scripts do kit param quando a instalação desta máquina foi feita a partir de outra pasta. Se essa pasta não existe mais (a instalação foi movida, ou passou para outro usuário), a mensagem agora diz isso, em vez de mandar a pessoa para uma pasta que não está lá, e diz como adotar. Copie `deploy/.env`, `deploy/app.env` e `deploy/migrate.env` da pasta antiga (ou do backup dela) para a nova e rode `DESKVOICE_ADOPT=yes bash install/install.sh` (ou `--adopt`): o instalador recria os contêineres a partir da pasta nova, com os mesmos volumes, onde ficam o banco, os certificados do HTTPS e o pareamento do WhatsApp. Sem os três arquivos ele para antes de tocar em qualquer coisa, porque com segredos novos o banco recusaria a conexão; com a pasta antiga ainda existindo, também para, e manda rodar de lá. Crédito: @melgarafael.
- **A tela "Saúde do sistema" mostra cada peça e cada ligação entre elas, e o que fazer quando uma falha** O resumo da saúde, no menu, agora abre a tela "Saúde do sistema". Ela mostra uma linha para cada peça e para cada ligação que o painel consegue conferir de dentro, na ordem de quem procura um defeito: painel, painel ↔ banco, painel ↔ processo de voz, processo de voz ↔ Asterisk, rotinas ↔ fila de tarefas, agente de atualização, linha telefônica, motor de voz e WhatsApp. No topo vem o pior estado e o nome de quem falhou. Três linhas são novas. Rotinas: falha quando nenhum processo de rotinas está conectado ao banco esperando tarefas, mesmo com a fila vazia, e quando uma tarefa vencida espera há 10 minutos sem ninguém pegá-la (aviso a partir de 2 minutos); antes, com as rotinas paradas, resumos, avisos e o vencimento das aprovações paravam e a tela dizia que estava tudo bem. Agente de atualização: quando falou pela última vez, "não fala com o painel desde…" passados 5 minutos, e "não instalado" se nunca falou; nunca é falha, porque sem ele a atualização segue pelo terminal. WhatsApp: o mesmo estado do bloco de Configurações; não instalado é o normal, e instalado e caído é aviso. Quem é dono ou administrador vê, em cada linha que falha, o que fazer e o comando a rodar no servidor; operador vê as linhas e o estado, e o pedido para chamar quem administra. A tela não se atualiza sozinha: o botão "Conferir de novo" refaz a conferência. A rota de saúde continua pública: o instalador e o `install/healthcheck.sh` seguem lendo dela painel, linha telefônica e motor de voz; sem sessão ela não mostra agente nem WhatsApp, que são da organização. Quem lia o campo `asterisk` dessa rota passa a ler `telephony`. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **A chave do motor de voz pode ser testada antes da primeira ligação** Em Configurações → Motores de voz, cada chave do Gemini ou da OpenAI ganhou o botão Testar a chave, só para dono e administrador, e salvar uma chave nova já a testa e diz o resultado, sem impedir de salvar. O teste não abre sessão de voz e não gasta: ele lê, na API do provedor, os dados do modelo que o motor usa. A resposta diz o que falta: chave recusada, chave sem acesso ao modelo, falta de crédito ou teto de gasto, provedor que não atende o país do servidor, limite de pedidos do provedor, provedor sem resposta, ou resposta que o DeskVoice não reconhece. O resultado fica guardado ("testada em ...: aceita", ou o problema), e a linha Motor de voz da tela de saúde e do `install/healthcheck.sh` passa a acusar a chave recusada como falha, com o que fazer; a checagem de saúde nunca testa por conta própria. Na tela de saúde, cada pessoa vê só a chave da própria organização; o `install/healthcheck.sh`, que não entra no painel, diz só que um teste não deu certo e manda ver em Configurações. O botão tem limite de cinco testes por motor a cada dez minutos. Nada a fazer em instalações existentes: a chave que já está salva aparece como ainda não testada até alguém clicar. Crédito: @melgarafael.
- **Conecte um WhatsApp por QR Code para o agente mandar avisos e mensagens** Em Configurações há um bloco novo, WhatsApp, visível para dono e administrador. **Nada muda no servidor até você pedir:** o serviço de WhatsApp é uma peça à parte, que não vem instalada, não é baixada na atualização e não usa memória de quem não o quer. Para usar, clique em "Instalar o serviço de WhatsApp": em alguns minutos o agente do servidor (o mesmo da atualização pela tela) baixa e sobe o serviço, e a tela acompanha. Antes de baixar, o servidor confere o disco: sem 5 GB livres ele não baixa nada, e a tela diz quanto falta; com pouca memória ele instala e avisa. O custo está dito na tela antes do clique: cerca de 360 MB de memória com o serviço parado e 3,2 GB em disco, medidos numa VPS de 8 GB; com um número conectado ainda não foi medido, e o teto é de 1280 MB. Com o serviço de pé, você clica em Conectar, lê o QR Code com o celular do número (como no WhatsApp Web) e, a partir daí, os avisos para a equipe e as mensagens que o agente envia durante a ligação saem por esse número, com as mesmas regras de antes (destino só da ligação ou da equipe, confirmação de uma pessoa para o número exibido, 5 mensagens por ligação). A tela mostra o número conectado, envia uma mensagem de teste para o seu próprio WhatsApp, diz o motivo quando a conexão cai, deixa conectar de novo ou desconectar e, sem número conectado, remover o serviço, o que libera a memória e apaga do disco os arquivos dele (e só os dele). Leia o aviso antes de conectar: a conexão usa um cliente não oficial do WhatsApp (o WAHA), o número pode ser bloqueado, e por isso deve ser um número dedicado; o guia está em `docs/guides/whatsapp-por-qr-code.md`. Quem já usa um conector externo (DeskcommCRM ou webhook) continua com ele, e só o troca se conectar um número e confirmar. O pareamento do número não entra no backup: restaurando em outro servidor, leia o QR Code de novo. Nesta versão a tela só percebe que a conexão caiu quando alguém a abre, e a capacidade ainda não foi provada com um número real. Crédito: @melgarafael.

### Alterado

- **As fontes do painel vêm junto com o código, e a construção da imagem não depende do serviço de fontes do Google** O painel usa as mesmas duas fontes de antes (Atkinson Hyperlegible e IBM Plex Mono), mas os arquivos agora estão no repositório, com a licença de cada uma. Antes, a construção da imagem do painel baixava as fontes na hora; sem acesso a esse serviço, a construção parava, inclusive a construção local num servidor ARM. Nada muda para quem já instalou. Crédito: @melgarafael.
- **O instalador só diz "pronto" depois de entrar no painel com o seu usuário** Depois de criar o usuário dono, o instalador confere que a porta publicada responde e faz login de verdade pela tela de entrada, com o e-mail e a senha que você acabou de definir, antes de mostrar o endereço. A senha não aparece na tela nem em lista de processos. Se a porta local não responde ou o login do usuário recém-criado é recusado, a instalação termina com erro dizendo o que falhou e o que fazer, em vez de dizer que está pronta; rodar de novo retoma de onde parou. Com domínio, se o que ainda não abre é o endereço de fora (o caso mais comum é o domínio ainda não apontar para a VPS), a instalação não falha: termina dizendo "Instalado; o endereço ainda não abre", com a causa provável e o que fazer, sem dar o endereço como certo. O comando do túnel SSH passa a vir com o seu usuário preenchido. Numa instalação que já tinha dono, sem a senha em mãos, ele diz que não testou o login. O `reset-password.sh` ganhou a mesma conferência: só diz que trocou depois de entrar com a senha nova, e avisa quando o painel ainda está segurando tentativas para aquele e-mail. O `update.sh` passa a conferir também a porta publicada no fim. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **Sem domínio, o painel deixa de ser publicado na internet sem HTTPS** Muda o padrão de instalação nova: sem domínio não há HTTPS, então o instalador passa a deixar o painel só dentro da VPS (em `127.0.0.1:3080`) e mostra no fim o comando do túnel SSH para abri-lo do seu computador, e como apontar um domínio para ter HTTPS. Antes, com a porta 80 livre, a tela de login ficava aberta na internet por HTTP, com a senha trafegando sem criptografia. Quem quer mesmo publicar pelo IP, para um teste, pede de propósito com `DESKVOICE_PANEL_PUBLIC_HTTP=yes` (ou responde "s" à pergunta do instalador, que diz o risco). **Quem já instalou não muda:** rodar o instalador ou o atualizador de novo mantém o painel como está, inclusive se ele já abre pelo IP; nesse caso o instalador avisa em destaque e mostra o comando para fechar, `DESKVOICE_PANEL_LOCAL_ONLY=yes bash install/install.sh`, que agora funciona também com as portas 80 e 443 livres. A decisão do padrão está registrada em `docs/decisions/0011` e aguarda a revisão do dono do projeto. Crédito: @melgarafael.

### Corrigido

- **A atualização aplica a configuração nova do Asterisk sem derrubar ligações** O Asterisk só lê os arquivos de configuração ao recarregar ou reiniciar, e a atualização os regravava sem fazer nenhum dos dois: numa versão que mudasse um deles, as ligações seguiriam com a configuração antiga, e a volta automática não restauraria a anterior. Agora a atualização, na ida e na volta, regrava no lugar o arquivo que mudou e recarrega só o módulo dele, sem derrubar as ligações em andamento; reinicia o Asterisk apenas se recarregar não der certo, e diz por quê. A volta também regera a configuração da versão anterior, e o instalador, rodado de novo, faz a mesma conferência para o Asterisk e para o Caddy. Há uma exceção, uma vez só: até a 0.2.0 o kit trocava esses arquivos por cópias novas, e um Asterisk que já estava de pé quando isso aconteceu (numa atualização, ou com o instalador rodado de novo) continua preso ao arquivo antigo, que recarregar não alcança. Nessa instalação, a primeira atualização que mudar um desses arquivos reinicia o Asterisk uma vez, logo depois das migrations, que já deixam o atendimento parado por alguns instantes. Esta versão não muda nenhum desses arquivos: nada a fazer. Crédito: @melgarafael.
- **Quem veio da 0.1.0 ficava com o Caddy rodando a configuração antiga** Em quem atualizou da 0.1.0 para a 0.2.0 rodando `bash install/update.sh` duas vezes, o Caddy continuava com a configuração da 0.1.0, porque o arquivo só é relido quando o Caddy reinicia e o atualizador da 0.1.0 não o reiniciava. A rota do agente de atualização seguia recusada para quem vinha de fora, mas quem recusava era o painel, e não o Caddy, que é a camada que deveria escondê-la. Agora o `update.sh`, quando não há versão nova a instalar, compara o arquivo que o Caddy tem montado com o do disco e o reinicia se forem diferentes (o painel fica fora por alguns segundos, uma vez só). A checagem de saúde também passou a ver isso: a linha "Agente de atualização" vira aviso e diz para reiniciar o Caddy. Quem atualizar desta versão em diante pelo terminal ou pela tela já tem o Caddy reiniciado na própria atualização; nada a fazer. Crédito: @melgarafael.
- **Um segundo clone na mesma máquina não mexe mais na instalação de outra pasta** Todo clone do DeskVoice manda nos mesmos contêineres, porque o nome do projeto no Docker é fixo. Rodar o instalador, o `update.sh`, o `restore.sh` ou o `backup.sh` de uma segunda cópia do repositório na mesma VPS gerava segredos novos, ou trocava a versão e o banco da instalação que roda a partir da outra pasta. Agora esses scripts, a checagem de saúde e o instalador em modo de simulação conferem antes de tocar em qualquer coisa: se já há um DeskVoice nesta máquina, rodando ou parado, e ele foi instalado de outra pasta, param e dizem qual pasta é a dona e o comando a rodar de lá. Quem roda sempre da mesma pasta não percebe diferença. Crédito: @melgarafael.
- **Errar a senha de alguém não tranca mais essa pessoa fora do painel** Antes, cinco senhas erradas para um e-mail bloqueavam esse e-mail por 15 minutos, de qualquer lugar: quem soubesse o e-mail do dono o trancava fora, quantas vezes quisesse. Agora o bloqueio conta pelo e-mail junto com o endereço de onde a tentativa veio: cinco erros em 15 minutos bloqueiam só aquele endereço para aquele e-mail, e o dono, entrando de outro lugar, entra. Um mesmo endereço pode errar até 20 vezes em 15 minutos somando todas as contas, e um mesmo e-mail aceita até 50 erros por hora somando todos os endereços; passou disso, o painel pede para esperar. Quem entra por túnel SSH chega ao painel com o mesmo endereço que todo mundo, e para essa pessoa o bloqueio continua valendo por e-mail. O limite segue na memória do painel: reiniciá-lo zera a contagem. Nada a fazer em instalações existentes. Crédito: @melgarafael.
- **A opção de painel só local era ignorada com as portas 80 e 443 livres** Numa VPS sem domínio e com as portas 80 e 443 livres, `DESKVOICE_PANEL_LOCAL_ONLY` era ignorada em silêncio: o painel ia para a internet na porta 80 e o instalador anunciava o endereço pelo IP, como se nada tivesse sido pedido. Agora a opção vale em todo modo. O valor é conferido antes de qualquer arquivo ser gravado e o único aceito é `yes` (`1`, `true` ou `sim` param a instalação dizendo o valor certo). **`DESKVOICE_PANEL_LOCAL_ONLY=no`, que antes era aceito, passou a ser recusado:** quem tem esse valor num arquivo de respostas ou num script deve tirar a variável (não defini-la é o que pede o padrão) e, se o que queria era o painel aberto pelo IP, usar `DESKVOICE_PANEL_PUBLIC_HTTP=yes`. Além disso, e uma opção que não tem efeito no modo da sua máquina, como pedir painel só local numa instalação com domínio, para a instalação com um erro que nomeia a opção e o modo, em vez de seguir calada. O endereço mostrado no fim passa a ser lido do mesmo arquivo que publica a porta. Nada a fazer em instalações existentes, que não mudam ao reinstalar. Crédito: @melgarafael.
- **O instalador recusa as opções de firewall e de versão que antes passavam caladas** `DESKVOICE_APPLY_UFW` com qualquer valor diferente de `yes` era ignorada sem aviso, e a regra de firewall não aplicada deixa a ligação muda. Agora o instalador para antes de gravar qualquer coisa e diz o valor aceito, e diz quando a opção não tem efeito porque o `ufw` não está ativo. Com `DESKVOICE_APPLY_UFW=yes`, o instalador rodado com perguntas também passa a aplicar as regras sem perguntar; antes a opção só valia junto de `--yes`, e sem ele a pergunta aparecia mesmo assim. `DESKVOICE_VERSION` junto de `--build` também para com erro, nomeando as duas, em vez de ignorar a versão pedida e construir o código da pasta. Crédito: @melgarafael.
- **Endereço que embute IPv4 e passava pela checagem de destino agora é recusado** A checagem de destino do `safeFetch` (o `fetch` de endereço vindo de configuração) já recusava IPv4 embutido em IPv6 e a faixa global do NAT64, mas deixava passar três faixas que embutem IPv4 do mesmo jeito: a faixa de uso local do NAT64, o 6to4 e o Teredo. Numa rede IPv6-only com NAT64 de uso local, um endereço como `64:ff9b:1::a00:1` chegava no `10.0.0.1` interno, que é exatamente o que a lista existe para impedir. Agora as três são recusadas como qualquer destino interno, e endereço público de verdade continua aceito — nada a configurar em instalações existentes. Crédito: @webtecnica.
- **Mais três faixas de endereço interno passam a ser recusadas na checagem de destino** A checagem de destino do `safeFetch` (o `fetch` de endereço vindo de configuração, usado por webhooks e conectores) ganhou as três faixas que faltavam depois da correção anterior: o IPv4 traduzido (`::ffff:0:a.b.c.d`), que embute IPv4 do mesmo jeito que as já recusadas, o site-local antigo (`fec0::/10`) e o prefixo de descarte (`100::/64`). O risco prático era baixo, porque dependia de a rede da VPS traduzir ou rotear essas faixas, mas a lista existe para não depender disso. Endereço público continua aceito; nada a configurar em instalações existentes. Achado na revisão da contribuição de @webtecnica. Crédito: @melgarafael.
- **A checagem de saúde do terminal mostra se o painel chega ao banco e se as rotinas consomem a fila** `bash install/healthcheck.sh` ganhou duas linhas, lidas da mesma conferência que a tela "Saúde do sistema" faz. "Painel → banco" diz se o painel entra no banco, e não só se o banco está de pé; é peça essencial, então uma atualização em que o painel não consegue entrar no banco volta sozinha. "Rotinas → fila" diz se o processo de rotinas está conectado esperando tarefas e se a fila anda; antes, rotinas que perdiam a conexão apareciam como "ok". Ela é falha não essencial e não provoca a volta de uma atualização: as ligações seguem atendidas, e resumos e avisos esperam na fila até as rotinas voltarem. Crédito: @melgarafael.

## [0.2.0] - 2026-11-11

### Adicionado

- **Atualizar pela tela** **Quem já está na 0.1.0: depois de atualizar pelo terminal, rode `bash install/update.sh` uma segunda vez.** A 0.1.0 não tem o agente de atualização, e o atualizador que roda nessa primeira vez ainda é o dela; na segunda não há o que atualizar: é o atualizador novo instalando o agente (o painel reinicia por alguns segundos). Dali em diante a atualização é pela tela. Em Configurações, o bloco "Versão e atualização" mostra a versão que o servidor está rodando, a mais recente publicada e o que muda entre as duas, com os avisos de "requer atenção" em destaque. O dono ou um administrador clica em atualizar, confirma com a senha, e o servidor faz o resto: backup, troca de versão, mudanças no banco e conferência; se a versão nova não responder, volta sozinho para a anterior, e a tela diz o que aconteceu e por quê. O sistema fica fora do ar por alguns minutos e as chamadas em andamento caem, como na atualização pelo terminal. Quem executa não é o painel: é um agente pequeno do kit de instalação, que passa a cada minuto no servidor e só lê do painel um sim ou um não. A consulta à versão mais recente é pública e não envia nada sobre a sua instalação. Enquanto o agente não estiver instalado, a própria tela avisa e mostra o comando. Instalação construída no próprio servidor (`--build`, ou em processador ARM) continua atualizando só pelo terminal. Crédito: @melgarafael.

## [0.1.0] - 2026-11-11

### Requer atenção

- **Instalação em servidor com permissões restritivas passa a atender ligação** Quem já instalou precisa rodar `bash install/install.sh` de novo depois de atualizar: é ele que regrava os arquivos do Asterisk no lugar novo. Confira depois com `bash install/healthcheck.sh` que "Controle da telefonia" aparece como ok.
- **Ligações recebidas ao mesmo tempo passam a ter limite por organização** O limite já vale ao atualizar, com o valor de fábrica 5. Se a sua operação atende mais de cinco ligações recebidas ao mesmo tempo, abra Configurações, em "Ligações recebidas ao mesmo tempo", e aumente o limite logo depois de atualizar. Sem isso, a sexta ligação simultânea recebe sinal de ocupado.
- **Painel e voz do navegador saem por um endereço só, em todo modo de instalação** Depois de atualizar, rode `bash install/install.sh` de novo: ele passa a instalação para o formato de uma porta e mostra as instruções do seu caso. Quem usa proxy próprio com domínio precisa trocar o destino: o domínio inteiro vai para a porta do painel (a regra separada de `/voice-ws` para a segunda porta deve ser apagada), e o proxy precisa repassar WebSocket. Quem entra por túnel SSH volta a abrir uma porta só: `ssh -L 3080:127.0.0.1:3080 usuario@ip-da-vps`. Até rodar o instalador, o painel pode ficar inacessível de fora em instalações que usavam o proxy do DeskVoice nas portas 80 e 443.

### Adicionado

- **Equipe, convite por link e troca de senha** O painel ganhou a tela Equipe. O dono ou um administrador convida uma pessoa, copia o link e envia por onde preferir; o link aparece uma vez, vale sete dias e serve uma vez, sem depender de servidor de e-mail. Dá para trocar o papel de cada pessoa, desativar o acesso (o que encerra as sessões dela na hora) e revogar um convite. Cada pessoa troca a própria senha em Configurações. Não existe cadastro aberto: só entra quem foi convidado. Crédito: @melgarafael
- **Falar com o agente pelo navegador** Na tela Chamadas há um botão novo, "Falar com o agente": você conversa por voz com um agente direto do navegador, sem linha telefônica, vendo o cronômetro e a transcrição ao vivo. É uma chamada como as outras: usa as ferramentas, pede aprovação, respeita o teto de custo e deixa o resumo no histórico. O agente precisa de um motor de voz real, com a chave cadastrada em Configurações; o motor simulado não conversa. O navegador só libera o microfone em HTTPS ou em `localhost`. O áudio sai pelo mesmo endereço do painel, sem porta extra. Crédito: @melgarafael
- **Primeira versão do DeskVoice, a central telefônica com agentes de IA** Uma ligação recebida é atendida por um agente configurado no painel, que executa ferramentas durante a conversa, avisa ou pede aprovação a um humano, transfere quando precisa e deixa tarefas rodando depois que a chamada termina, com cada passo e o custo registrados na linha do tempo. A instalação numa VPS Ubuntu é feita por um comando, sem editar variável de ambiente à mão, e as ligações de saída vêm desligadas. Crédito: @melgarafael.
- **Instalar em uma linha** O README agora traz um comando só para instalar: ele baixa o DeskVoice na VPS e abre o instalador. Quem prefere ler antes de rodar continua com o passo a passo. A parceria com a HostGator, que sustenta o projeto, ganhou um bloco próprio na seção de instalação, em português, inglês e espanhol. Crédito: @melgarafael
- **Quem ainda não tem servidor encontra o caminho, com ou sem assistente de IA** Quem pede ajuda a um assistente de IA para instalar agora é perguntado primeiro se já tem um servidor; se não tem, fica sabendo em que tamanho de máquina a instalação foi provada e recebe o link da VPS da HostGator, declarado como link de parceria e sem obrigação, já que qualquer outra VPS com Docker funciona igual. Para quem prefere um comando, o kit ganhou o `install/start.sh`, que roda no seu computador antes de existir servidor, só informa e entrega o comando seguinte. No fim do instalador, a linha da VPS recomendada passou a dizer que o link é de parceria. Nada a fazer em instalações existentes. Crédito: @melgarafael

### Alterado

- **Ligações recebidas ao mesmo tempo passam a ter limite por organização** Até aqui, o gasto com IA de uma ligação recebida pela linha telefônica era limitado só por chamada: muitas ligações juntas gastavam o teto de uma chamada vezes o número de ligações. Agora cada organização tem um limite de ligações recebidas ao mesmo tempo, ajustável em Configurações, de 1 a 50. Quem liga acima do limite recebe sinal de ocupado antes de qualquer gasto com IA, a recusa aparece em Chamadas com o motivo, e o painel recebe um aviso (no máximo um a cada dez minutos). Chamadas pelo navegador e ligações feitas pelo agente não entram nesta conta. Crédito: @melgarafael
- **Painel e voz do navegador saem por um endereço só, em todo modo de instalação** "Falar com o agente" deixou de precisar de uma segunda porta. O proxy do DeskVoice (Caddy) agora sobe sempre e é a única entrada: com as portas 80 e 443 livres, nada muda para você; com elas ocupadas por outro proxy, o DeskVoice inteiro fica atrás de uma porta local só (a mesma em que o painel já estava). A checagem de saúde ganhou a linha "Entrada única", que acusa quando o painel abre e a voz não, e a tela passou a dizer o que falta em vez de mandar conferir a internet. Crédito: @melgarafael
- **A instalação passa a gravar o número da versão, e não constrói mais imagem na VPS depois da primeira versão publicada** O instalador agora descobre a versão publicada mais recente, baixa as imagens dela e grava o número em vez de "stable": você sabe o que está rodando (`bash install/diagnose.sh` mostra), e duas instalações com o mesmo número rodam as mesmas imagens. Se as imagens de uma versão publicada não baixam, o instalador e o `update.sh` param com a resposta do Docker e o comando para testar, sem alterar nada, em vez de construir na sua VPS; construir ali só acontece enquanto o projeto não tiver nenhuma versão publicada, ou a pedido de quem desenvolve, com `bash install/install.sh --build`. O banco e o Caddy passaram a ser baixados numa versão exata, a mesma em toda instalação. Nada a fazer em instalações existentes: uma instalação antiga, com "stable" gravado, passa para o número na próxima vez que você rodar `bash install/update.sh` ou o instalador, sem mexer nos dados. Crédito: @melgarafael

### Corrigido

- **Remover da lista de não ligar, a chave de IA, o conector de WhatsApp e um webhook pede confirmação** Esses quatro botões executavam no primeiro clique. Agora cada um abre um pedido de confirmação que nomeia o que vai ser removido e diz a consequência, como já acontecia ao excluir um agente, uma linha ou um número. O caso mais sério era a lista de não ligar: um clique errado devolvia ao agente a permissão de ligar para quem pediu para não ser chamado. Nada a fazer em instalações existentes. Crédito: @melgarafael
- **Instalação em servidor com permissões restritivas passa a atender ligação** Num servidor com permissões restritivas (umask 077), o Asterisk subia sem conseguir ler o plano de discagem e a interface de controle: a instalação terminava dizendo que estava tudo certo e nenhuma ligação seria atendida. O instalador agora grava tudo o que o Asterisk lê com a permissão correta, e a checagem de saúde ganhou a linha "Controle da telefonia", que falha quando o processo de voz não consegue falar com o Asterisk. Também dá para deixar o painel acessível só de dentro da VPS, por túnel SSH, quando não há domínio. Achado na primeira instalação real, numa VPS da HostGator. Crédito: @melgarafael
