# Instalação real

> Registro criado em 2026-11-11 pela auditoria de conformidade, a partir do que o dono informou e
> do que está no PR #3. Quem escreveu este arquivo não esteve na instalação.

## O que foi feito

| Campo | Valor |
|---|---|
| Data | 2026-11-11 |
| Máquina | VPS de teste do parceiro (HostGator), Ubuntu 22.04, segundo o PR #3. Máquina compartilhada, e não um servidor recém-criado |
| Caminho | O comando de uma linha do README (`install/get.sh`) |
| Modo | Sem perguntas (`--yes`), com as respostas por variáveis `DESKVOICE_*` |
| Chave de provedor | Nenhuma na instalação |

## O que a instalação achou

| Defeito | Efeito | Correção |
|---|---|---|
| Arquivos de configuração do Asterisk montados direto do repositório herdavam a permissão de quem baixou. Com permissões padrão restritas (umask 077), o Asterisk não lia o plano de discagem nem a interface de controle | O instalador terminava dizendo que tudo respondia, e nenhuma ligação seria atendida | PR #3: tudo o que o Asterisk lê sai de `deploy/asterisk/generated`, gravado com permissão explícita |
| A checagem de saúde não conferia a ligação entre o processo de voz e o Asterisk | O defeito acima não aparecia em lugar nenhum | PR #3: linha "Controle da telefonia" em `install/healthcheck.sh` |

Evidência: <https://github.com/DeskLabs-OpenSource/DeskVoice/pull/3>.

## O que não foi provado

- Instalação num servidor recém-criado.
- Instalação pelo modo com perguntas no terminal.
- Instalação numa VPS de outro provedor.
- Entrada no painel pelo navegador com o usuário criado pelo instalador, conferida pelo instalador.
- Backup, restauração e atualização nessa máquina.
- Ligação por operadora.
- Chamada pelo navegador a partir de um navegador.

## O que não foi medido

- Memória e disco do sistema parado, com o tamanho da máquina (item 3.4 da conformidade).

## O que aconteceu depois do merge das correções

Registrado por quem conduziu a instalação (a sessão que constrói o DeskVoice), a partir do que foi observado na própria máquina. Não há captura guardada no repositório; os comandos abaixo reproduzem a conferência.

| Quando (UTC, 2026-11-11) | O que foi feito | O que se observou |
|---|---|---|
| 13:48, depois do PR #3 | `git pull` e `bash install/install.sh --yes` de novo, na mesma instalação | O instalador reconheceu a instalação anterior, não criou outro dono e manteve o painel só local. `bash install/healthcheck.sh`: "Controle da telefonia: ok, o processo de voz está conectado ao Asterisk". O usuário do Asterisk lê os cinco arquivos de configuração; `dialplan show from-trunk` mostra as três entradas; a interface de controle está ligada |
| 14:09 | Chamada simulada pelas rotas do painel instalado | Desfecho `completed`, 24 eventos, aviso de gravação antes da saudação, resumo gravado pelas rotinas |
| 14:44, depois do PR #4 | `git pull` e instalador de novo | Painel em `127.0.0.1:3080` e voz do navegador em `127.0.0.1:3081`; de fora, pela internet, nenhuma das duas responde |
| 14:45 | Conversa por voz com o motor OpenAI Realtime, por um cliente de teste que faz o papel do navegador com fala gravada | Fala em português entendida e transcrita, ferramenta `notify_human` acionada, 67 s, custo estimado de 33 centavos de dólar |

| por volta de 17:10, depois do PR #7 | Backup, `git pull` e instalador de novo, com a instalação em duas portas | A instalação passou para a entrada única: só o Caddy publica porta (`127.0.0.1:3080`), painel e voz deixaram de publicar. `healthcheck.sh` com a linha "Entrada única: ok". Dados preservados |
| por volta de 17:20 | Conversa por voz pela entrada única, pelo mesmo cliente de teste, através de um túnel SSH para a porta única | Aviso de gravação, saudação, fala em português entendida e respondida; 17 centavos de dólar. O cliente de teste não foi guardado no repositório |
| 19:10, depois da versão 0.1.0 | `git pull` (a `main` era o commit da tag) e `bash install/update.sh --yes`, com a instalação em `stable` e imagens construídas na própria VPS | Primeira atualização entre versões. Backup conferido, as três imagens `0.1.0` baixadas do registro sem login, migrations, subida, saída 0. Depois: `DESKVOICE_VERSION=0.1.0`, a cópia do endereço das imagens saiu do `.env`, contêineres nas imagens publicadas, Postgres 17.11 e Caddy 2.11.9, todas as peças da saúde em ok, agente, usuário e nove chamadas preservados. Compose 5.1.4 |
| por volta de 19:20 | Comando de uma linha (`get.sh`) em simulação (`--yes --dry-run`), numa pasta separada da mesma VPS | O clone ficou na tag `v0.1.0`; o instalador reconheceu a 0.1.0 como a publicada mais recente e disse que baixaria as imagens dela, sem construir. Nada foi alterado na instalação viva |

Então rodar o instalador uma segunda vez **foi** exercitado, três vezes, numa instalação com dados. O que continua sem prova está na lista acima.

Correção sobre a causa do defeito de permissão: o `umask 077` não era da máquina. Veio do comando de quem instalava, que restringiu as permissões para proteger o arquivo da senha, e o instalador herdou. Um servidor endurecido teria o mesmo efeito, mas essa instalação não prova como é o padrão da VPS do parceiro.

## Ordem dos fatos

O repositório ficou público em 2026-11-11 às 12:09 UTC. A correção do defeito entrou às 13:47 UTC.
A instalação real aconteceu depois da publicação (item 13.5 da conformidade).

## O que continua sem prova depois da 0.1.0

- Instalação do zero, de verdade, pelo comando de uma linha contra uma versão publicada, numa máquina limpa. Só a simulação e a atualização foram exercitadas. (Depois da 0.2.0 a instalação do zero contra a 0.1.0 aconteceu, numa segunda VPS compartilhada: ver "Depois da 0.2.0". Máquina limpa continua sem prova.)
- Conversa por voz depois da atualização para a 0.1.0.
- A volta automática do `update.sh` numa VPS.
- Instalação em processador ARM, que só existe construindo na própria máquina.

## Depois da 0.2.0 (2026-11-11)

Registrado a partir do que informou quem conduziu as instalações e a versão. Quem escreveu esta seção não esteve nas máquinas, e não há captura guardada no repositório.

### Instalação do zero numa segunda VPS, contra a 0.1.0

| Campo | Valor |
|---|---|
| Máquina | Segunda VPS de teste: Ubuntu 22.04, x86_64, 8 GB, compartilhada |
| Caminho | O comando de uma linha (`install/get.sh`), contra a versão 0.1.0 |
| Tempo | 67 segundos do `curl` até tudo respondendo |
| O que se observou | O clone ficou na tag; as três imagens baixaram sem login; a checagem de saúde mostrou todas as peças em ok |
| Memória | Cerca de 320 MiB somando os seis contêineres, com o sistema **parado**, sem chamada. Não é o tamanho mínimo de máquina: esse continua sem medida |

Defeito achado nessa instalação: a máquina tinha as portas 80 e 443 livres e não tinha domínio, e a opção de painel só local (`DESKVOICE_PANEL_LOCAL_ONLY`) foi **ignorada em silêncio**. O valor passado, `1`, nem foi validado nesse modo. O Caddy publicou `0.0.0.0:80` e o instalador anunciou `http://<IP>`. A opção só existia para o caso de as portas 80 e 443 serem de outro proxy. A correção (a opção vale em todo modo, valor inválido e opção sem efeito param com erro, e sem domínio o padrão passa a ser só local) está no ramo `fix/instalador-confere-o-que-anuncia`, provada só com o Docker de mentira dos testes do kit: ver [`nao-exercitado.md`](nao-exercitado.md).

### Memória e disco na 0.3.0 (vps-teste, 2026-11-12)

Medido por quem conduziu a atualização, com `docker stats --no-stream` e `docker system df -v`. A saída não ficou guardada no repositório.

| Campo | Valor |
|---|---|
| Máquina | VPS de teste: x86_64, 8 GB. Na mesma máquina rodam outros sistemas, que não entraram na conta |
| Momento | 11:49 UTC, 8 minutos depois de `update.sh --to 0.3.0` subir as peças. Sistema **parado**: sem chamada, sem linha e sem motor configurados |
| Memória, sem o WhatsApp | Cerca de 380 MiB nos seis contêineres: voz 109, rotinas 99, banco 66, painel 58, Caddy 32, Asterisk 15 |
| Memória do WhatsApp | Cerca de 323 MiB no serviço instalado, sem número conectado |
| Disco, uma versão | Cerca de 2,7 GB em espaço único (sem contar duas vezes as camadas compartilhadas). São três imagens do DeskVoice (painel 95 MB, voz 943 MB, rotinas 942 MB, mais 239 MB de base comum), mais Postgres 411 MB, Asterisk 79 MB, Caddy e o banco (67 MB). O serviço do WhatsApp, quando instalado, ocupa mais 3,2 GB |
| Acúmulo | Imagens de versões antigas ficam no disco: esta máquina guardava 0.1.0, 0.2.0 e uma construída localmente, cerca de 2 GB únicos cada. Voz e rotinas publicadas não dividem as camadas que vêm do mesmo estágio de construção, porque cada uma é construída num job do CI |

Os cerca de 320 MiB de 11/11 foram medidos na 0.2.0, noutra máquina e com seis contêineres. A diferença para a medida de hoje não foi investigada.

### A versão 0.2.0

| O que rodou | O que se observou |
|---|---|
| Ato 1 do `release.yml` | Rodou pelo workflow pela primeira vez e abriu o PR de versão |
| Verificações do PR de versão | As verificações do evento de PR ficaram em `action_required`. O `ready` verde veio do `ci` disparado no ramo, anexado ao commit |
| Publicação | Inteira, sem intervenção: os pacotes seguiram públicos e a release nasceu sozinha |

### A ponte da 0.1.0, nas duas VPS de teste

Nas duas máquinas, `bash install/update.sh --yes` duas vezes, como a nota da 0.2.0 pede a quem está na 0.1.0.

| Rodada | O que se observou |
|---|---|
| 1 | Backup, imagens 0.2.0 e a migration nova |
| 2 | Recriou o painel e agendou o timer do systemd. O agente falou com o painel em menos de dois minutos, e a checagem de saúde mostrou "Agente de atualização: ok" |

Defeito achado na ponte: pela entrada única, o 404 da rota do agente vinha do **painel** (resposta em JSON), e não do Caddy, porque o Caddy não tinha sido reiniciado e seguia com o Caddyfile antigo. Depois de reiniciar o Caddy à mão, o 404 passou a vir do Caddy (corpo vazio). A rota continuava recusada nos dois casos; o que faltava era a camada da frente. A correção (a segunda rodada reinicia o Caddy quando o Caddyfile que ele tem montado não é o do disco, e a checagem de saúde avisa quando quem recusa é o painel) está no mesmo ramo, também provada só com o Docker de mentira.

### O que continua sem prova depois da 0.2.0

- O agente de atualização ouvindo um "sim" do painel e atualizando.
- A passagem de vez do `update.sh` com `--resume`. A ponte não a exercita, porque a 0.1.0 não a tem.
- A volta automática do `update.sh` numa VPS.
- A tela de atualização num navegador.
- Conversa por voz depois das atualizações.
- Instalação numa máquina limpa: a segunda VPS também é compartilhada.


## Na VPS da parceira, com AlmaLinux (2026-11-12)

Uma VPS cedida pela HostGator, parceira de infraestrutura do projeto, dedicada ao DeskVoice e sem nenhum outro sistema. Quem conduziu foi a sessão que mantém o projeto, por SSH. As saídas estão guardadas, inteiras, em [`registros/2026-11-12-vps-parceira/`](registros/2026-11-12-vps-parceira/), com o IP trocado por `<IP-da-VPS>`.

| Campo | Valor |
|---|---|
| Máquina antes de qualquer coisa | AlmaLinux 9.8, x86_64, 4 vCPU, 12 GB de memória, 295 GB de disco (3,7 GB usados). Já vinha com `docker-ce` 29.9.3, git e Compose v5, mas com o serviço do Docker desligado. Sem `ufw`, `firewalld` inativo, SELinux Disabled ([`0-maquina-antes.txt`](registros/2026-11-12-vps-parceira/0-maquina-antes.txt)) |
| Por que AlmaLinux | Quem compra VPS na HostGator escolhe o sistema e recebe Ubuntu. Esta máquina foi cedida pela HostGator já pronta, com AlmaLinux, segundo o dono do projeto. Ele decidiu que o DeskVoice deve ser compatível com AlmaLinux também |

| Rodada | O que se observou |
|---|---|
| 1. A linha única do README, `curl … get.sh \| bash -s -- --yes` | O `get.sh` clonou na 0.3.0. O instalador parou no passo 1: "Este sistema (almalinux 9.8) não é Ubuntu 22.04+ nem Debian 12+". Nada foi instalado ([`1-linha-unica.txt`](registros/2026-11-12-vps-parceira/1-linha-unica.txt)) |
| 2. `bash install/install.sh --force --yes` | Parou: o usuário não conseguia falar com o Docker, porque o serviço estava parado ([`2-force-docker-parado.txt`](registros/2026-11-12-vps-parceira/2-force-docker-parado.txt)) |
| Passo à mão | `systemctl enable --now docker`, feito pela sessão. Não fica na saída de nenhuma rodada |
| 3a. `--force --yes` de novo | Passos 1 e 2 em ok (Docker e Compose, versão 0.3.0, IP público na placa, portas livres). Parou nas perguntas: sem terminal, `DESKVOICE_ORG_NAME` vazio ([`3a-force-sem-respostas.txt`](registros/2026-11-12-vps-parceira/3a-force-sem-respostas.txt)) |
| 3b. `--force --yes` com `DESKVOICE_ORG_NAME` e `DESKVOICE_OWNER_*` | Instalação inteira contra as imagens publicadas da 0.3.0: migrations, dono criado, peças respondendo, agente agendado, entrada única e login conferidos. Painel só local, em `127.0.0.1:3080`, porque não há domínio ([`3b-force-com-respostas.txt`](registros/2026-11-12-vps-parceira/3b-force-com-respostas.txt)). A senha do dono foi gerada no servidor e não aparece em nenhuma saída |
| Saúde | `install/healthcheck.sh` saiu com 0. Avisos esperados: nenhuma linha, nenhum motor, e o agente de atualização ainda sem falar com o painel no primeiro minuto ([`4-healthcheck.txt`](registros/2026-11-12-vps-parceira/4-healthcheck.txt)) |

O que isto prova e o que não prova:

- Prova que a 0.3.0 publicada roda em AlmaLinux 9.8 numa VPS da parceira, desde que o serviço do Docker seja ligado à mão e o instalador rode com `--force`.
- Não prova a linha única sem nenhuma intervenção nesse sistema. Ela parou no passo 1, e o conserto (aceitar AlmaLinux e ligar o Docker parado) vem num PR próprio, que só se prova rodando de novo numa máquina dessas.
- Não prova `firewalld` ativo nem SELinux em Enforcing, porque a máquina não tinha nenhum dos dois.
- Não prova ligação: não há linha nem motor configurados.

## Primeira atualização pela tela: 0.3.0 → 0.4.0, na VPS da parceira (2026-11-12)

Na mesma VPS dedicada, a instalação estava na 0.3.0 publicada. Ninguém tocou no terminal do servidor durante a atualização. A sessão que mantém o projeto entrou no painel por túnel SSH, com um navegador dirigido por ela, e clicou. Do lado do servidor, só leu. As capturas e as saídas estão em [`registros/2026-11-12-atualizacao-pela-tela/`](registros/2026-11-12-atualizacao-pela-tela/).

| Momento (-03) | O que se observou |
|---|---|
| 11:45 | Configurações → "Versão e atualização" mostrava "Em execução 0.3.0", "Mais recente publicada 0.4.0" e, embaixo, "Este servidor não encontrou versão publicada mais nova que a instalada", sem botão ([`1-antes-sem-botao.jpg`](registros/2026-11-12-atualizacao-pela-tela/1-antes-sem-botao.jpg)). **Defeito:** o agente do servidor só consulta as tags a cada 10 minutos, e a última consulta (11:38) foi segundos antes de a tag `v0.4.0` existir. A tela disse duas coisas contrárias sobre a mesma versão |
| 11:48 | O agente consultou de novo e viu a tag. A tela passou a mostrar "O que muda da 0.3.0 para a 0.4.0" e o botão "Atualizar para a 0.4.0" ([`2-botao-depois-da-consulta.jpg`](registros/2026-11-12-atualizacao-pela-tela/2-botao-depois-da-consulta.jpg)) |
| 11:49 | O clique abriu a confirmação dentro da página, nomeando as duas versões, dizendo que o sistema sai do ar e pedindo a senha de novo ([`3-confirmacao-com-senha.jpg`](registros/2026-11-12-atualizacao-pela-tela/3-confirmacao-com-senha.jpg)). Confirmado: "Pedido registrado em 12 de nov., 11:49. O agente do servidor começa a atualização em até um minuto" ([`4-pedido-registrado.jpg`](registros/2026-11-12-atualizacao-pela-tela/4-pedido-registrado.jpg)) |
| 11:49:15 a 11:50:21 | `agent.log`: "pedido de atualização aceito; versão instalada: 0.3.0", e 66 s depois "atualização terminou: succeeded (de 0.3.0 para 0.4.0; update.sh saiu com 0)" ([`agent.log.txt`](registros/2026-11-12-atualizacao-pela-tela/agent.log.txt)) |
| 11:59 | A tela: "A atualização terminou em 12 de nov., 11:50: o servidor está na versão 0.4.0", com a saída do atualizador ([`5-terminou.jpg`](registros/2026-11-12-atualizacao-pela-tela/5-terminou.jpg), [`6-saida-do-atualizador-na-tela.txt`](registros/2026-11-12-atualizacao-pela-tela/6-saida-do-atualizador-na-tela.txt)) |

Depois, conferido pelo terminal, só lendo:

- **Versão:** pasta em `v0.4.0` e `.env` com `DESKVOICE_VERSION=0.4.0`. Painel, voz e rotinas nas imagens publicadas `0.4.0`.
- **Asterisk:** não reiniciou, com uptime de 1 h 28 min. A 0.4.0 não muda nenhum arquivo de configuração dele.
- **Saúde:** `healthcheck.sh` saiu com 0, com os avisos esperados (sem linha, sem motor).
- **Backup:** em `backups/20261112-114915`.
- **Imagens:** ficaram as da 0.4.0 e as da 0.3.0, que é a de onde se saiu. Não havia versão mais velha nesta máquina, então a limpeza não tinha o que remover.

O que isto prova:

- o caminho inteiro do botão numa máquina real: o pedido com a senha, o agente aceitando, o `update.sh` com backup, migrations e saúde, e o resultado de volta na tela;
- que a atualização entre duas versões publicadas terminou sem intervenção.

O que isto não prova:

- **A passagem de vez com `--resume`.** A tela mostra só o fim da saída. As linhas que diriam que o atualizador da 0.3.0 passou a vez ao da 0.4.0 não aparecem, e a saída inteira não ficou guardada no servidor.
- **A remoção de imagem antiga pelo `docker rmi` real.** Nesta máquina não havia o que remover.
- **A volta automática.** A atualização não falhou.
- **O espaço em disco antes e depois.** `docker system df` não foi medido antes do clique.

Defeitos achados aqui, com conserto em PR próprio:

- **A frase contrária da janela de 10 minutos.**
- **O número de memória antigo na tela do WhatsApp.** A tela diz "O DeskVoice inteiro, sem ele, usa cerca de 320 MB".
- **O mascaramento da saída, que trocou `routines` por `***`.** A linha `@deskvoice/routines@0.0.0` parecia um e-mail.

## Instalador duas vezes, backup e restauração, troca de senha (2026-11-12)

Na VPS da parceira, na 0.4.0 instalada pela tela, sem linha nem motor. As saídas inteiras estão em [`registros/2026-11-12-provas-destrutivas/`](registros/2026-11-12-provas-destrutivas/), com o IP trocado. Os números "N-…-contagens.txt" são organizações, usuários, chamadas e eventos de chamada.

| Prova | O que se observou |
|---|---|
| Instalador duas vezes seguidas, na mesma versão (11.3) | `install.sh --yes` duas vezes, saída 0 nas duas. Os três arquivos de ambiente têm o mesmo `sha256` antes e depois, ou seja, nenhum segredo foi regerado. Os contêineres são os mesmos (mesmos IDs, nenhum recriado). As contagens não mudaram (1, 1, 1, 25). Nas duas rodadas o instalador avisou "Login NÃO testado: o usuário dono já existia e eu não tenho a senha dele", que é o comportamento declarado |
| Backup (11.8) | `backup.sh` restaurou o dump num banco de rascunho, contou 20 tabelas e só então disse "Backup concluído e conferido" |
| Restauração sem mudança | `restore.sh latest --yes`: "Restaurado… com as contagens conferidas", saída 0. As contagens são as mesmas de antes |
| Restauração com mudança | Depois do backup, uma chamada simulada pelo painel levou o banco a 2 chamadas e 50 eventos. `restore.sh` com o backup anterior voltou o banco a 1 chamada e 25 eventos, saída 0 ([`5-antes-da-restauracao.txt`](registros/2026-11-12-provas-destrutivas/5-antes-da-restauracao.txt)) |
| Troca de senha pelo kit (6.5) | `reset-password.sh` com a senha nova pela variável: "Senha… trocada. Sessões encerradas: 1" e "Senha trocada e conferida: entrei pela tela de entrada com a senha nova". A senha nova não aparece na saída: o `grep` por ela deu zero |
| Saúde | `healthcheck.sh` saiu com 0 depois de cada etapa |

O que não prova:

- **Restauração em outro servidor** (`--with-config`): não rodou.
- **Restauração depois de uma migration nova:** não rodou. O backup e a restauração são da mesma versão.
- **Desempenho com banco grande:** o banco tem 84 KB de dump.
