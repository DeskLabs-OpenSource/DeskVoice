# 0012: WhatsApp por QR Code, com o WAHA na instalação de quem pedir

- **Estado:** proposta, valendo pelos padrões abaixo enquanto o dono não decide
- **Data:** 2026-11-11
- **Quem decidiu:** o dono pediu a capacidade (conectar um WhatsApp por QR Code, com o WAHA, como o DeskcommCRM faz, para o agente mandar avisos). As três escolhas de produto marcadas **[dono]** ainda são dele (`GOVERNANCE.md`); cada uma traz o padrão que vale sem resposta. O resto, marcado **[construtor]**, são escolhas de desenho abertas à revisão.
- **Origem:** o serviço `waha` e o cliente do DeskcommCRM (`docker-compose.prod.yml`, `lib/waha/client.ts`), lidos como referência. Nenhum código foi copiado; as lições medidas lá estão em `CREDITS.md`.

## Contexto

O envio por WhatsApp existia só por conector externo (`whatsapp.connector` = DeskcommCRM ou webhook próprio) e nunca foi exercitado com um conector real. Quem instala o DeskVoice sozinho não tinha por onde mandar um aviso sem montar outro sistema.

Esta é a **primeira fatia**: o serviço na instalação de quem pede, o cliente, o conector `waha`, a conexão por QR Code na tela e uma mensagem de teste. Ficaram de fora, de propósito: aviso de queda na hora (webhook do WAHA) com reconexão, pessoas e cadeia de aviso, e retorno de entrega.

Fatos externos conferidos em 11/11/2026 (mudam; confira antes de confiar):

| Fato | Como foi conferido |
|---|---|
| A imagem sem navegador da versão 2026.10.1 é `devlikeapro/waha:noweb-2026.10.1`, só para amd64, resumo `sha256:0d64cce1…85d0c`; a de ARM é `noweb-arm-2026.10.1`, resumo `sha256:fce6ae58…7c2c9` | API do Docker Hub e `docker buildx imagetools inspect`, sem o daemon. Os dois resumos são de índice; cada índice tem uma plataforma só |
| A imagem traz o Node, o `curl`, expõe a porta 3000 e já define `WHATSAPP_DEFAULT_ENGINE=NOWEB` | Configuração da imagem, lida do registro |
| `WAHA_API_KEY=sha512:<hash>` é o formato recomendado; o cliente manda o texto puro em `X-Api-Key` | Documentação do WAHA, página de segurança |
| A retomada depois de reiniciar é `WAHA_WORKER_RESTART_SESSIONS` (padrão ligado: retoma as sessões que estavam rodando). `WHATSAPP_RESTART_ALL_SESSIONS` é outra coisa: inicia também as sessões paradas | Documentação do WAHA, páginas de configuração e de sessões |
| Estados da sessão, QR Code (60 s o primeiro, 20 s os seguintes, até 6), `check-exists`, `sendText` | Documentação do WAHA. O formato da resposta do `sendText` **não** está documentado |

Medido em 11/11/2026 numa VPS de 8 GB, com a imagem e o resumo fixados aqui, num contêiner temporário e **sem sessão nenhuma**:

| O quê | Medido |
|---|---|
| Download da imagem | 18 s |
| Espaço em disco | 3,19 GB (os 757 MB do registro são o tamanho comprimido) |
| Tempo para subir | 6 s |
| Memória logo depois de subir | 431 MiB |
| Memória parado, depois de 2,5 minutos | 363 MiB, com processador perto de zero |
| `/ping` sem chave | 200 |
| `/api/sessions` sem chave | 401 |
| O DeskVoice inteiro, parado, para comparar | cerca de 320 MiB |

**Ainda não medido nem provado:** memória com um número conectado; ler um QR Code; enviar uma mensagem. Dentro do DeskVoice, o WAHA só foi exercitado contra um servidor falso que imita o que a documentação descreve.

## Decisão **[dono]** 1: quantos números

**Pergunta:** uma instalação conecta um número, ou vários?

| Opção | O que é | Custo |
|---|---|---|
| **A. Um número por organização (o padrão que vale)** | Uma sessão no WAHA por organização; o agente e os avisos saem todos por ele | Quem quer um número para avisos da equipe e outro para falar com clientes não tem como separar |
| **B. Vários números** | Várias sessões, com regra de qual número envia o quê | Tela de escolha, regra de roteamento, mais memória por sessão (não medida) e mais superfície de bloqueio |

**Recomendação:** A. O uso pedido é mandar avisos; um número resolve. **Enquanto o dono não responde:** vale A. Reversível: a tabela `whatsapp_sessions` tem `id` próprio, e a regra "uma por organização" é um índice único que sai numa migration.

## Decisão **[dono]** 2: onde mora o WAHA

**Pergunta:** o WAHA sobe dentro da instalação, ou o DeskVoice aponta para um WAHA que a pessoa já tem?

| Opção | O que é | Custo |
|---|---|---|
| **A. Embutido, sob demanda (o padrão que vale)** | Serviço `waha` no Compose, num perfil, só na rede interna, com chave gerada pelo instalador. Só é baixado e sobe quando alguém o instala pela tela | Quem usa paga cerca de 360 MB de memória parado e 3,2 GB de disco. Quem não usa não paga nada |
| **B. WAHA externo** | A pessoa informa endereço e chave de um WAHA dela | O painel passaria a mandar uma chave para um endereço digitado: é exatamente o que a guarda de rede (`safeFetch`) existe para impedir na rede interna, e a sessão de outro sistema poderia ser parada ou deslogada pelo DeskVoice |

**Recomendação:** A. **Enquanto o dono não responde:** vale A, e o endereço do WAHA é uma constante no código (`http://waha:3000`): nenhuma configuração do operador o muda. Quem já tem um WAHA continua podendo usar o conector `webhook`.

**O que a medição mudou.** A primeira versão desta decisão subia o serviço em toda instalação, com a sessão criada só ao conectar, e deixava anotado que a memória ociosa precisava ser medida. Medida, ela é maior que a do DeskVoice inteiro (363 MiB contra cerca de 320 MiB), e a imagem ocupa 3,19 GB. Subir sempre dobraria a memória e somaria 3 GB de disco em toda instalação, inclusive na de quem nunca vai usar WhatsApp. Por isso o serviço passou a existir só onde foi pedido.

## Decisão **[dono]** 3: mensagem para quem ligou, pelo número conectado

**Pergunta:** com um número próprio conectado, o agente continua podendo escrever para quem ligou?

| Opção | O que é | Custo |
|---|---|---|
| **A. Fica como é (o padrão que vale)** | `send_whatsapp` envia para o número da ligação com a confirmação humana e os tetos de sempre (5 por ligação; destino só da ligação ou da equipe) | Uma mensagem para quem ligou é o seu número iniciando conversa com alguém que talvez nunca tenha falado com ele: é o comportamento que mais leva a bloqueio num cliente não oficial |
| **B. Só para a equipe** | Pelo número conectado, o agente só avisa a equipe | Perde o caso de uso "te mando o endereço por WhatsApp" |
| **C. Afrouxar** | Tirar a confirmação quando o número é próprio | Aumenta o risco de bloqueio e reabre o número forjado. Não recomendado |

**Recomendação:** A, com a tela e o guia dizendo o risco. **Enquanto o dono não responde:** vale A; nada no comportamento de `send_whatsapp` mudou, e o aviso de risco está no bloco WhatsApp e em [`whatsapp-por-qr-code.md`](../guides/whatsapp-por-qr-code.md).

## O que vale enquanto isso **[construtor]**

| Tema | O que vale | Onde está |
|---|---|---|
| Motor | NOWEB, na imagem sem navegador. A documentação não recomenda um motor; chama o GOWS de "futuro substituto" do NOWEB. NOWEB é o que o DeskcommCRM roda em produção, então é o único com medição nossa | `deploy/docker-compose.yml` |
| Imagem | Fixada por etiqueta e resumo. A de amd64 é o padrão do Compose; em ARM o instalador grava `WAHA_IMAGE` com a etiqueta `noweb-arm-*` da mesma versão. Um teste do kit confere que as duas têm a mesma versão | `deploy/docker-compose.yml`, `WAHA_IMAGE_ARM64` em `install/_common.sh`, `install/test/17-whatsapp.sh` |
| Serviço sob demanda | O `waha` fica num perfil do Compose (`profiles: ["whatsapp"]`). Instalar e atualizar não o baixam nem o sobem. A tela mostra "Serviço de WhatsApp não instalado", com o custo medido, e o botão "Instalar o serviço de WhatsApp" (dono e administrador) | `deploy/docker-compose.yml`, `whatsapp-panel.tsx` |
| Quem liga e desliga | O painel só grava que a organização quer o serviço (`whatsapp_sessions.service_wanted`). O agente do kit lê isso como o segundo booleano da rota dele e converge a cada passada: com sim e o serviço fora, baixa a imagem e sobe só o `waha`; com não e o serviço de pé, para e remove o contêiner. O volume com o pareamento **fica**. Por que isso ainda não é um comando: [registro 0010](0010-atualizar-pela-tela.md) | `converge_whatsapp` em `install/agent.sh`, `agentCheckIn` em `apps/panel/src/server/update.ts` |
| A marca no servidor | Ao ligar, o agente grava `DESKVOICE_WHATSAPP=on` em `deploy/.env`. Com ela, todo comando do kit passa `--profile whatsapp` ao Compose: a atualização recria o serviço junto com os outros, e a checagem de saúde passa a cobrá-lo | `whatsapp_enabled` e `dc` em `install/_common.sh` |
| O que a tela sabe do serviço | O agente conta o estado na fala seguinte, em códigos fechados: `absent`, `running`, `failed` (`pull_failed`, `start_failed`, `remove_failed`). A tela cruza com o pedido: não instalado, preparando, de pé, falhou (com o motivo) ou removendo. "Baixando" não é um estado contado pelo agente: é o que a tela mostra entre o pedido e a primeira fala com o serviço de pé | `readStored` em `apps/panel/src/server/whatsapp.ts` |
| O agente confere o custo antes de baixar | Disco: exige 5 GB livres onde o Docker guarda as imagens (3,19 GB da imagem, mais cerca de 0,76 GB das camadas comprimidas durante o download, mais 1 GB de folga, abaixo do qual a checagem de saúde já acusa o disco e o banco pode parar de gravar). Sem espaço, **nada é baixado**: o agente conta `no_disk`, com quanto há e quanto precisa, e a tela diz quanto falta. Memória: se a disponível está abaixo do teto do serviço (1280 MB), instala e conta o aviso `low_memory`, que a tela mostra junto do estado | `WAHA_DISK_NEEDED_MB` em `install/_common.sh`, `converge_whatsapp` |
| Falha ao baixar | O agente grava o código e só tenta de novo depois de 10 minutos: um download de gigabytes não se repete a cada minuto | `install/agent.sh` |
| Download lento não prende a atualização | O download roda dentro da passada do agente, com a trava. Ele tem prazo de 10 minutos (o vigia que a conversa com o painel já usava): estourou, a passada termina, ouve o painel de novo (e pega um pedido de atualização que estiver esperando, antes dos 15 minutos em que ele venceria) e a passada seguinte continua de onde parou, porque o Docker guarda as camadas já baixadas. Não conta como falha; a tela segue em "Preparando" | `WA_PULL_DEADLINE` em `install/agent.sh` |
| Agente calado ou ausente | A tela diz, como o bloco de atualização, e mostra o comando que executa o pedido na hora: `bash install/agent.sh` (uma passada do agente). Não há comando novo no kit | `whatsapp-panel.tsx` |
| Remover o serviço | Botão que só aparece sem número conectado, com confirmação dizendo o que acontece (memória e disco liberados; conferir o aparelho no telefone). A rota recusa com número conectado ou conectando | `changeService` |
| Remover devolve o disco | Depois do contêiner, o agente remove a imagem **fixada** (`devlikeapro/waha@sha256:…`, a referência que o Compose desta instalação dá), e só ela: nunca um `prune`, que apagaria imagem de outros sistemas da máquina. Se a imagem não sai (outra coisa a usa), o pedido não falha: o agente conta o aviso `image_kept`, a tela diz que o disco não foi devolvido e mostra `bash install/agent.sh`, e cada passada tenta de novo. O volume com o pareamento continua ficando | `remove_whatsapp_image` em `install/agent.sh` |
| O pareamento que sobra | Antes de registrar a remoção, o painel tenta sair da sessão no WAHA (melhor esforço: com o WAHA fora do ar, a remoção segue). Ao instalar de novo, e em toda consulta com o banco dizendo "desconectado", o painel olha o estado real da sessão no WAHA: se ele retomou um pareamento antigo, a sessão é desfeita, porque o que a pessoa pediu foi desconectar. Consequência: um banco restaurado de antes da conexão também desfaz a sessão viva, e é preciso ler o QR Code de novo | `changeService` e `observe` em `apps/panel/src/server/whatsapp.ts` |
| Sessão só depois de conectar | Com o serviço de pé, ele não abre sessão sozinho. O painel só cria a sessão no primeiro "Conectar"; enquanto está desconectado, só confere que nenhuma sessão ficou de pé | `apps/panel/src/server/whatsapp.ts` |
| Teto de memória | `mem_limit: 1280m`, o valor do DeskcommCRM (pico medido lá: 893 MiB). Aqui, parado: 363 MiB; conectado, **não medido** | `deploy/docker-compose.yml` |
| Consulta do endereço que não derruba o envio | A documentação do motor NOWEB (lida em 11/11/2026) só exige o "store" para listar contatos, conversas e mensagens; não diz que `check-exists` depende dele, e o store não foi ligado (ele guardaria contatos e meses de mensagens do número no disco). Para não depender disso: se o WAHA recusar a rota `check-exists` em si (HTTP 4xx ou 5xx que não seja chave recusada), a mensagem vai para o número em E.164 como ele é, e fica registrado que o endereço não foi conferido (na mensagem do `tool_result`, ou em `notifications.error` do aviso enviado). Resposta fora do contrato e WAHA sem resposta continuam sendo falha | `sendViaWaha` |
| Chave | `WAHA_API_KEY`, gerada pelo instalador em `deploy/.env`, em **toda** instalação, com ou sem o serviço: é uma linha num arquivo, e assim ligar o serviço pela tela não exige recriar painel, voz e rotinas. O Compose a entrega a painel, voz e rotinas (os três falam com o WAHA: a tela, a ferramenta `send_whatsapp` e a entrega de avisos). O contêiner do WAHA recebe só `sha512:<hash>` | `ensure_waha` em `install/_common.sh` |
| Quem atualiza | Ganha a chave, e mais nada: nenhuma imagem é baixada e nenhum serviço sobe. Só na instalação que já ligou o WhatsApp a atualização baixa a imagem do WAHA, e antes de qualquer mudança: se não baixar, para sem tocar no banco | `install/update.sh` |
| Endereço | Constante no código. `baseUrl` só existe para teste. Um `url` gravado no conector `waha` é descartado na leitura, e a rota de configurações não aceita gravar o tipo `waha` | `packages/tools/src/connectors/waha.ts`, `whatsapp.ts` |
| Conector | Terceiro tipo em `whatsapp.connector`: `{ "type": "waha" }`, sem `url` nem `token`. Entra ao conectar e sai ao desconectar. Com um número conectado, a rota de configurações recusa trocar ou apagar o conector | `apps/panel/src/server/settings.ts` |
| Escolha do conector | Acontece no clique em "Conectar", com confirmação nomeando o conector que será substituído. Se o QR Code não for lido, o envio fica parado até conectar ou reconfigurar: a tela diz isso antes | `connect` em `apps/panel/src/server/whatsapp.ts` |
| Envio | Confere que a sessão está `WORKING` (senão falha com o estado no motivo, sem reconectar), pede o endereço canônico ao `check-exists` (número sem WhatsApp é falha antes do envio) e envia | `sendViaWaha` |
| Webhooks do WAHA | Nenhum. O painel compara o estado do WAHA com o último gravado a cada consulta da tela, e é aí que "conectou" e "caiu" viram aviso. Queda com a tela fechada só aparece na visita seguinte | `record` em `apps/panel/src/server/whatsapp.ts` |
| Consulta da tela | A cada 5 segundos, só enquanto espera o QR Code ou a leitura, e só com a aba visível. O código vale 20 segundos: intervalo maior deixaria um código vencido na tela por tempo demais | `whatsapp-panel.tsx` |
| Reconectar | Sessão em `FAILED`: parar, sair e iniciar (o pareamento pode ter sido revogado, e sem sair o QR Code nunca apareceria). Sessão em `STOPPED`: só iniciar, para não jogar fora um pareamento que ainda vale | `connect` |
| Desconectar | Sair (com a sessão conectada, é o que tira o aparelho de "Dispositivos conectados") e depois parar. Confirmação nomeando o número | `disconnect` |
| Backup | O volume `waha-sessions` **não** entra. É a credencial viva de um aparelho; uma cópia antiga não volta a valer e ficaria guardada em `backups/`. Depois de restaurar em outro servidor, a tela diz que os dados da conexão não existem mais e pede o QR Code | `install/backup.sh`, guia |
| Mensagem de teste | Vai para o WhatsApp cadastrado de quem está logado, pelo mesmo caminho do envio do agente. O texto é fixo, no idioma da tela de quem clicou (a tela manda só o idioma; o texto é do servidor) | `sendTest` |
| Papéis | Todas as rotas do bloco exigem `owner` ou `admin`, inclusive a de leitura, que traz o QR Code | `apps/panel/src/app/api/v1/whatsapp/` |

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Aceitar o endereço do WAHA por variável de ambiente ou por tela | Variável de ambiente que liga recurso não entra (convenção 7); por tela, é a opção B da decisão 2 |
| Passar a chave pelo `app.env` | O `migrate` também recebe o `app.env` e não fala com o WAHA |
| Servir o QR Code numa rota de imagem | Uma rota a mais para proteger. A imagem vai em `data:` dentro da resposta de estado, que já exige sessão e papel |
| O serviço subir em toda instalação | Era o desenho anterior. Dobraria a memória e somaria 3 GB de disco em quem nunca vai usar WhatsApp (medição acima) |
| Ligar o perfil por variável de ambiente ou por comando no servidor | Configuração de operador tem tela (convenção 7). O comando só aparece como saída para a instalação sem agente |
| O painel mandar ao agente "suba o serviço X" ou a imagem a usar | Seria o comando que o registro 0010 recusa. Com um booleano, a imagem é sempre a do kit |
| Ligar o store do NOWEB para garantir o `check-exists` | A documentação não diz que ele é necessário, e ligado ele guarda no disco contatos e meses de mensagens do número, que o DeskVoice não lê. A saída quando a consulta falha é enviar sem ela e registrar |
| `WHATSAPP_RESTART_ALL_SESSIONS=True`, como no DeskcommCRM | Iniciaria também a sessão que alguém desconectou de propósito |
| Apagar a sessão no WAHA ao desconectar | Não era preciso: sessão parada e sem pareamento não roda motor nenhum. Uma chamada a menos no cliente |
| Tipo novo em `call_events` para conectar e cair | Não é evento de chamada. Vira aviso no painel (`notifications`) |
| Guardar o estado só no WAHA, sem tabela | O painel não teria como perceber a mudança para avisar, nem dizer "desde quando" |

## Consequências

- Quem instala o serviço passa a rodar mais um contêiner e a baixar uma imagem de outro registro (Docker Hub): cerca de 360 MB de memória parado e 3,2 GB de disco. Nessas instalações, e só nelas, uma falha desse registro pode impedir uma atualização, que para antes de mexer em qualquer coisa. Quem não instala não muda nada.
- A resposta da rota do agente passa de um para dois booleanos, e o agente ganha duas ações (subir e remover o `waha`). O que isso permite a um painel comprometido está em `SECURITY.md` e no registro 0010.
- Instalar e remover dependem do agente. Sem systemd e sem cron não há agente agendado; a tela diz e mostra o comando.
- O DeskVoice passa a depender, para o WhatsApp, de um cliente não oficial. O número pode ser bloqueado. Está dito na tela, no guia e em `SECURITY.md`.
- Painel, voz e rotinas passam a ter uma chave que comanda o número conectado. O que um processo comprometido alcança com ela está em `SECURITY.md`.
- A prova real ainda não existe. Antes de cortar a versão: instalar o serviço pela tela numa VPS (o agente de verdade baixando e subindo), medir a memória com um número conectado, ler um QR Code e enviar a mensagem de teste.
