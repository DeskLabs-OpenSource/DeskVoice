# 0010: Atualizar pela tela, por um agente do kit

- **Estado:** aceita
- **Data:** 2026-11-11
- **Quem decidiu:** o dono pediu que quem opera uma instalação atualize pela própria interface, pelo método da Fábrica (`manual/12-distribuicao.md`, "Atualizar pela tela"; itens 12.12 a 12.15 da conformidade). As escolhas de desenho abaixo são do dono, salvo as marcadas **[construtor]**, que ficam abertas à revisão dele.

## Contexto

Quem instala o DeskVoice não é de infraestrutura. Uma atualização que pede terminal é uma atualização que não acontece, e versão velha em produção é onde moram os defeitos já corrigidos.

No DeskcommCRM, a atualização pela tela deixou quatro erros medidos: uma atualização que tirou a instalação do ar sem recuperação; um pedido aceito e nunca concluído que travou todos os seguintes; a tela anunciando por dias uma versão que não estava no ar; e o agente falhando em silêncio, com o botão sumindo sem explicação.

## Decisão

O painel **pede**; não executa. Quem atualiza é um agente pequeno do kit de instalação, no servidor.

| Tema | O que vale | Onde está |
|---|---|---|
| Quem executa | `install/agent.sh`, agendado pelo instalador para passar a cada minuto (timer do systemd; sem systemd, uma linha em `/etc/cron.d`) | `install/agent.sh`, `install_agent_schedule` em `install/_common.sh` |
| O que passa do painel para o servidor | **Um booleano.** A resposta da rota do agente é `{ update: true \| false }` e mais nada | `apps/panel/src/app/api/v1/system/agent/route.ts` |
| Para qual versão | O painel não diz. O agente descobre a maior versão final nas tags do repositório (consulta no máximo a cada 10 minutos), **anuncia** essa versão ao painel a cada passada e, quando o painel diz sim, vai para ela com `update.sh --to` | `discover_target` em `install/agent.sh` |
| A pessoa confirma a versão que o servidor executaria | A tela nomeia, no botão e na confirmação, a versão anunciada pelo agente, e mostra as notas das versões até ela. Sem a página dessa versão na lista pública, a tela diz que a versão existe e não oferece o botão; a rota recusa do mesmo jeito | `apps/panel/src/app/api/v1/system/update/route.ts` |
| Ninguém é atualizado para o que não confirmou | O pedido guarda a versão vista. Na passada do agente, **o painel compara** essa versão com a que o agente acabou de anunciar: se saiu outra, o pedido termina como `superseded` e a resposta é "não". O agente continua recebendo só o booleano **[construtor]** | `agentCheckIn` em `apps/panel/src/server/update.ts` |
| Prazo na conversa | Cada chamada do agente ao painel tem 30 segundos. Estourou, é falha de comunicação: vai para o registro e a passada termina, liberando a trava | `with_deadline` em `install/agent.sh` |
| Como o agente fala com o painel | De **dentro do contêiner do painel** (`docker compose exec`), direto na porta dele. A rota recusa qualquer pedido que tenha passado por proxy (lê o endereço que o servidor do painel anota; é defesa a mais, e não autenticação, porque cabeçalho se forja), e o Caddy responde 404 nela: para a internet a rota não existe. Quem autentica é o segredo | `install/agent.sh`, `deploy/Caddyfile` |
| Como o agente se identifica | Segredo gerado pelo instalador (`UPDATE_AGENT_TOKEN`), comparado em tempo constante. Fica em `deploy/.env`, o arquivo que o Compose interpola, e chega **só ao painel** (pelo `environment` desse serviço, como a senha do banco chega só ao Postgres); voz e rotinas, que recebem o `app.env`, não o conhecem. Vai pela entrada padrão, nunca na linha de comando | `apps/panel/src/server/update.ts` |
| Quem pede | Dono e administrador, com a senha conferida de novo e o mesmo limite de tentativas do login | `apps/panel/src/app/api/v1/system/update/route.ts` |
| Um pedido por vez | Índice único parcial no banco, valendo para a instalação inteira | `db/migrations/20261111T190000_update_requests.sql` |
| Todo pedido termina | Não pego em 15 minutos, ou aceito e não concluído em 30, vira `expired`, aparece na tela e libera o próximo. Um resultado que chega depois do prazo substitui o "venceu" pelo que de fato aconteceu | `expireStale` em `apps/panel/src/server/update.ts` |
| O agente não morre calado | Ao aceitar o pedido, ele grava primeiro o resultado "parou no meio". Toda saída entrega o que estiver pendente; se nem isso der (processo morto, servidor reiniciado), a passada seguinte entrega | `install/agent.sh` |
| Registro que persiste | No banco: quando o agente falou por último, a versão que anunciou e a última falha de comunicação. No servidor: `deploy/agent/agent.log`, com rotação. A tela diz "não está respondendo desde ..." e mantém o botão | `update_agent_status`, `install/agent.sh` |
| O agente é dono da instalação | Antes de anunciar a versão, confere que os arquivos de ambiente existem e que o contêiner do painel foi criado a partir desta pasta | `install/agent.sh` |
| A tela lê o que está em execução | A versão vem de `APP_VERSION`, do processo do painel, a cada consulta. A mais recente vem da API pública de releases do GitHub, sem credencial, com cache de 10 minutos em memória | `apps/panel/src/server/releases.ts` |
| Sem telemetria | A consulta de versões não leva nada da instalação | idem |
| O agente que roda é o da versão antiga | O `update.sh` instalado decide o alvo, faz o backup, troca o código e **passa a vez ao `update.sh` da versão de destino** (`--resume`). O que uma versão nova precisa fazer de diferente cabe no atualizador dela **[construtor]** | `install/update.sh`, `install/test/15-update-handoff.sh` |
| Desfecho | Derivado do estado da instalação (código de saída, versão gravada, saúde), não do texto do atualizador, que muda entre versões **[construtor]** | `install/agent.sh` |
| Instalação `local` (construída no servidor, ou ARM) | Não atualiza pela tela; a tela diz por quê e mostra o comando | tela Configurações |

### Por que passar a vez, em vez de o agente extrair o atualizador da tag **[construtor]**

O `update.sh` carrega `_common.sh` e chama `backup.sh`, `restore.sh` e `healthcheck.sh` da mesma pasta, e descobre a instalação a partir de onde está. Extrair só ele da tag o separaria disso tudo; extrair o kit inteiro para uma pasta temporária exigiria ensinar cada script a operar uma instalação que não é a pasta dele. Passar a vez depois da troca do código usa o kit de destino inteiro, no lugar onde ele vai morar, e mantém o backup antes de qualquer mudança. O que cruza de uma versão para a outra são quatro variáveis (`DESKVOICE_UPDATE_FROM`, `_FROM_REF`, `_BACKUP`, `_ENTRY_WAS_OK`), que nunca mudam de sentido. Antes de passar a vez, o atualizador anterior confere que o de destino carrega (`bash -n`); se não, volta o código e nada mais foi tocado.

### O limite deste mecanismo, dito de uma vez

O atualizador que roda numa atualização **a partir da 0.1.0** é o da 0.1.0, que não passa a vez nem conhece o agente. Não há como mudar isso de fora. Por isso quem está na 0.1.0 atualiza uma vez pelo terminal e roda `bash install/update.sh` mais uma vez: na segunda, o atualizador novo não tem o que atualizar, gera o segredo, recria o painel para ele recebê-lo e agenda o agente.

## O que não existe, e por quê

| O que não existe | Por quê | O que vale hoje |
|---|---|---|
| Escolher a versão de destino pela tela | Seria um valor do painel virando argumento de um comando no servidor | A tela leva para a versão que o servidor anunciou. Versão específica: `bash install/update.sh --to <versão>` |
| Esperar as chamadas terminarem | Não foi pedido, e uma chamada longa seguraria a atualização sem prazo | A confirmação diz que as chamadas em andamento caem |
| Desinstalar o agente | Fora do escopo | `systemctl disable --now deskvoice-agent.timer` e apagar as duas unidades |
| Atualização automática, sem clique | Tirar o sistema do ar é decisão de quem administra | Só por pedido |
| Agente em instalação `local` ou ARM atualizando | Não há imagem publicada para trocar | Terminal |
| Várias instalações na mesma máquina | O projeto do Compose tem nome fixo | Uma instalação por máquina; o agente recusa a pasta que não é a dona |

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| O painel monta o socket do Docker e atualiza a si mesmo | Quem controla o socket do Docker é administrador da máquina. Uma falha no painel (que fica na internet) viraria controle total do servidor. E um contêiner que se substitui não tem quem desfaça quando a versão nova não sobe |
| O painel manda o comando (ou a versão) e um agente executa | É uma porta de administração remota com outro nome: quem conseguisse escrever no painel, ou no banco dele, executaria no servidor. Com um booleano, o pior que o painel consegue é pedir a atualização que o próprio servidor escolheria |
| Webhook de fora (o GitHub avisa a instalação, ou um serviço central dispara) | Exigiria a instalação aceitar pedido vindo da internet e, para saber a quem avisar, um cadastro das instalações: telemetria. Também tiraria de quem administra a decisão de quando sair do ar |
| O agente fala com o painel pela entrada pública (o Caddy) | A rota do agente ficaria exposta à internet, protegida só pelo segredo. Falando de dentro do contêiner, ela nem existe para quem está fora |
| A versão confirmada viajar junto com o "sim", para o agente comparar | O agente passaria a receber um número de versão do painel, mesmo que só para comparar. Com a comparação no painel, a resposta segue sendo um booleano e o agente não tem o que interpretar |
| O segredo do agente no `app.env` | Voz e rotinas também recebem esse arquivo. Um deles comprometido poderia se passar pelo agente: anunciar alvo falso ou segurar um pedido até vencer |
| Um arquivo `panel.env` só para o painel | O Compose recusa subir quando um `env_file` não existe, e o atualizador da 0.1.0, que roda de memória, não o criaria: a primeira atualização a partir dela falharia. Pelo `.env` interpolado, segredo ausente é só vazio |
| Guardar o pedido em arquivo, sem tabela | A tela não teria de onde ler o histórico, e "um por vez" viraria checagem em código |

## Consequências

- A atualização pela tela depende de o agente estar agendado. Sem systemd e sem cron, não há agente, a tela diz isso e a atualização continua pelo terminal.
- O agente passa a cada minuto e grava no banco a cada passada. É uma escrita pequena, por organização.
- O segredo do agente protege a rota contra outro processo da rede interna do Docker, inclusive um processo de voz ou de rotinas comprometido, que não o recebe. Não protege contra quem já tem acesso ao servidor: essa pessoa lê `deploy/.env` e, de todo modo, já pode rodar o atualizador.
- A saída do atualizador e o texto da última falha do agente citam caminhos do servidor: a tela só os entrega a dono e administrador. Está em "Limites conhecidos".
- Numa instalação com mais de uma organização, o dono ou administrador de qualquer uma pode pedir a atualização da instalação inteira, e todas recebem o aviso. A tela opera uma organização por instalação (registro `0006`); se isso mudar, "quem administra a instalação" precisa de um papel próprio.
- A regra "o agente que roda é o da versão antiga" passa a valer para toda mudança no `agent.sh` e nas variáveis `DESKVOICE_UPDATE_*`: o que é novo entra opcional, e o que existe não muda de sentido.
