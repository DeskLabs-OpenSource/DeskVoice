# Changelog

O que muda em cada versão do DeskVoice, na voz de quem opera a instalação.
Este arquivo é montado a partir de `.changes/`; não edite à mão.

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
